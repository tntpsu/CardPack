#!/usr/bin/env node
// Capture store-listing screenshots straight from the simulator's glasses
// display, one per game, into store-assets/.
//
// The hub listing requires each screenshot to be EXACTLY 576×288 — which is
// the G2 glasses display resolution, so the simulator's own capture is already
// the right size and no scaling or letterboxing is involved.
//
// Prereq (one terminal):
//   npm run dev            # Vite on http://localhost:5180
// Then:
//   node scripts/capture-store-shots.mjs
//
// Each game gets its own simulator session (there is no glasses gesture path
// back to the launcher), is navigated to via the `focus=` state marker, then
// driven far enough into play that the frame shows real gameplay rather than
// an opening deal. A launcher shot is captured too, since the pack's whole
// pitch is "eight games in one place".

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 9899
const SIM_BASE = `http://127.0.0.1:${PORT}`
const DEV_URL = 'http://localhost:5180'
const HERE = dirname(fileURLToPath(import.meta.url))
const SIM_BIN = join(
  HERE, '..', 'node_modules', '@evenrealities',
  `sim-${process.platform}-${process.arch}`, 'bin', 'evenhub-simulator',
)
const OUT_DIR = join(HERE, '..', 'store-assets')

const REQUIRED_W = 576
const REQUIRED_H = 288

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Gestures reused from scripts/regression.mjs — they are already tuned to
// drive each game into a representative mid-play state.
//
// A gesture entry may be a number instead of an action string, meaning "pause
// this many ms here". Oh Hell needs it: round 1 deals a single card each, so a
// listing shot taken there is nearly empty. Getting to a wider round means
// playing two hands out and waiting on AI bids and plays between them, which
// the uniform 350 ms step is too short for.
const GAMES = [
  { id: 'hearts', gestures: ['down', 'down', 'up', 'double_click', 'down', 'double_click'] },
  { id: 'euchre', gestures: ['down', 'double_click', 'up', 'double_click', 'down', 'double_click'] },
  { id: 'spades', preWaitMs: 2800, gestures: ['up', 'up', 'double_click', 'down', 'double_click', 'down', 'double_click'] },
  { id: 'crazy8', preWaitMs: 1500, gestures: ['down', 'double_click', 'down', 'double_click', 'double_click'] },
  { id: 'ginrummy', gestures: ['double_click', 'down', 'down', 'double_click', 'down', 'double_click'] },
  { id: 'cribbage', gestures: ['double_click', 'down', 'double_click', 'down', 'down', 'down', 'down', 'down', 'double_click', 'double_click', 'down', 'double_click'] },
  // Play rounds 1 and 2 out so the shot lands in round 3 (three cards each)
  // rather than round 1's single-card hand, which renders nearly empty.
  {
    id: 'ohhell',
    gestures: [
      'double_click', 1200, // round 1: confirm bid, let the AI bid
      'double_click', 2500, // play the only card, let the hand finish
      'double_click', 1500, // hand-end → round 2
      'double_click', 1200, // round 2: confirm bid
      'double_click', 1200, // play
      'double_click', 2500, // play again, hand finishes
      'double_click', 1500, // hand-end → round 3
      'double_click', 1800, // round 3: confirm bid, AI bids
    ],
  },
  { id: 'bridge', preWaitMs: 1500, gestures: ['down', 'double_click', 'down', 'down', 'double_click', 'down', 'double_click', 'down', 'double_click'] },
]

async function ping() {
  const r = await fetch(`${SIM_BASE}/api/ping`).catch(() => null)
  return !!(r && r.ok)
}

async function spawnSim() {
  const child = spawn(SIM_BIN, ['--automation-port', String(PORT), DEV_URL], { stdio: 'ignore' })
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    if (await ping()) return child
    await sleep(400)
  }
  throw new Error('simulator did not come up within 20s')
}

async function killSim(child) {
  if (child && !child.killed) { try { child.kill('SIGKILL') } catch { /* gone */ } }
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    if (!(await ping())) return
    await sleep(300)
  }
}

async function input(action) {
  const r = await fetch(`${SIM_BASE}/api/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!r.ok) throw new Error(`/api/input ${action} → ${r.status}`)
}

async function stateMessages() {
  const r = await fetch(`${SIM_BASE}/api/console`).catch(() => null)
  if (!r || !r.ok) return []
  const data = await r.json()
  return (data.entries ?? [])
    .map(e => e.message)
    .filter(m => typeof m === 'string' && m.includes('[cardpack:state]'))
}

async function latestFocus() {
  const msgs = await stateMessages()
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = /focus=(\w+)/.exec(msgs[i])
    if (m) return m[1]
  }
  return null
}

async function waitForState(predicate, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if ((await stateMessages()).some(predicate)) return true
    await sleep(200)
  }
  return false
}

async function shot() {
  const r = await fetch(`${SIM_BASE}/api/screenshot/glasses`).catch(() => null)
  if (!r || !r.ok) throw new Error('screenshot fetch failed')
  return Buffer.from(await r.arrayBuffer())
}

/** PNG dimensions live in the IHDR chunk at fixed offsets. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

async function navigateToFocus(targetId, steps) {
  for (let i = 0; i < steps; i++) {
    if ((await latestFocus()) === targetId) return true
    await input('down')
    await sleep(300)
  }
  return (await latestFocus()) === targetId
}

async function captureLauncher() {
  const child = await spawnSim()
  try {
    await waitForState(m => m.includes('view=launcher'), 8000)
    await sleep(600)
    return await shot()
  } finally {
    await killSim(child)
    await sleep(400)
  }
}

async function captureGame(game) {
  const child = await spawnSim()
  try {
    if (!(await waitForState(m => m.includes('view=launcher'), 8000))) {
      throw new Error('never reached launcher')
    }
    if (!(await navigateToFocus(game.id, GAMES.length + 2))) {
      throw new Error(`launcher cursor never reached focus=${game.id}`)
    }
    await input('click')
    if (!(await waitForState(m => m.includes(`view=${game.id}`), 5000))) {
      throw new Error(`never entered view=${game.id}`)
    }
    if (game.preWaitMs) await sleep(game.preWaitMs)
    for (const g of game.gestures) {
      if (typeof g === 'number') { await sleep(g); continue }
      try { await input(g) } catch { /* tolerate rate-limit */ }
      await sleep(350)
    }
    await sleep(700) // let the last render settle
    return await shot()
  } finally {
    await killSim(child)
    await sleep(400)
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const written = []
  const problems = []

  // Optional filter so a single shot can be re-taken without re-running all
  // nine simulator sessions: `node scripts/capture-store-shots.mjs ohhell`.
  const only = process.argv.slice(2)
  const all = [
    { id: 'launcher', capture: captureLauncher },
    ...GAMES.map(g => ({ id: g.id, capture: () => captureGame(g) })),
  ]
  const targets = only.length ? all.filter(t => only.includes(t.id)) : all
  if (!targets.length) {
    console.error(`no target matched ${only.join(', ')} — known: ${all.map(t => t.id).join(', ')}`)
    process.exit(2)
  }

  for (const [n, t] of targets.entries()) {
    // Number the file by its position in the FULL list so a filtered re-take
    // overwrites the same filename instead of renumbering the listing.
    const i = all.findIndex(a => a.id === t.id)
    process.stdout.write(`[${n + 1}/${targets.length}] ${t.id} … `)
    try {
      const buf = await t.capture()
      const size = pngSize(buf)
      if (!size) {
        problems.push(`${t.id}: not a PNG`)
        console.log('✗ not a PNG')
        continue
      }
      if (size.w !== REQUIRED_W || size.h !== REQUIRED_H) {
        // Report rather than silently ship a file the portal will reject.
        problems.push(`${t.id}: ${size.w}×${size.h}, need ${REQUIRED_W}×${REQUIRED_H}`)
        console.log(`✗ ${size.w}×${size.h} (need ${REQUIRED_W}×${REQUIRED_H})`)
        continue
      }
      const name = `${String(i + 1).padStart(2, '0')}-${t.id}.png`
      await writeFile(join(OUT_DIR, name), buf)
      written.push(`${name} (${buf.byteLength} bytes)`)
      console.log(`✓ ${size.w}×${size.h} → ${name}`)
    } catch (err) {
      problems.push(`${t.id}: ${err.message}`)
      console.log(`✗ ${err.message}`)
    }
  }

  console.log(`\nWrote ${written.length} screenshot(s) to store-assets/`)
  for (const w of written) console.log(`  ${w}`)
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
