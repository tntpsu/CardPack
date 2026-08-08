#!/usr/bin/env node
// End-to-end regression for Card Pack via the Even Hub simulator HTTP API.
// Catches what unit tests can't: bootstrap hangs, gesture-handler binding,
// render-loop death, per-game launch + play not crashing on real render.
//
// FULL coverage: every registered game gets its own flow — navigate the
// launcher to it (deterministically, via the `focus=<id>` state marker),
// launch it, drive its core gestures, and assert it stayed alive and kept
// rendering. There is no glasses-gesture path back to the launcher, so each
// game runs in its own fresh simulator session (this script spawns + kills
// the simulator itself, one session per game).
//
// Prereq (one terminal):
//   cd ~/Documents/CardPack && npm run dev       # Vite on http://localhost:5180
// Then:
//   npm run test:e2e
//
// The simulator binary is resolved from node_modules; no manual sim launch.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 9899
const SIM_BASE = `http://127.0.0.1:${PORT}`
const DEV_URL = 'http://localhost:5180'
const HERE = dirname(fileURLToPath(import.meta.url))
// Spawn the NATIVE simulator binary directly, not the `.bin` Node wrapper.
// The wrapper runs the native binary as a child via execFileSync, so killing
// the wrapper orphans the real sim — it keeps holding the automation port and
// later sessions end up talking to a stale instance.
const SIM_BIN = join(
  HERE, '..', 'node_modules', '@evenrealities',
  `sim-${process.platform}-${process.arch}`, 'bin', 'evenhub-simulator',
)
const OUT_DIR = join(HERE, '..', 'tests', 'screenshots-regression')

let pass = 0
let fail = 0
const failures = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── simulator lifecycle ────────────────────────────────────────────────

async function ping() {
  const r = await fetch(`${SIM_BASE}/api/ping`).catch(() => null)
  return !!(r && r.ok)
}

async function spawnSim() {
  const child = spawn(SIM_BIN, ['--automation-port', String(PORT), DEV_URL], {
    stdio: 'ignore',
    detached: false,
  })
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    if (await ping()) return child
    await sleep(400)
  }
  throw new Error('simulator did not come up within 20s')
}

async function killSim(child) {
  if (child && !child.killed) {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
  // Wait until the automation port stops answering — guarantees the next
  // session binds a fresh sim rather than racing a dying one.
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    if (!(await ping())) return
    await sleep(300)
  }
}

// ── automation API ───────────────────────────────────────────────────────

async function input(action) {
  const r = await fetch(`${SIM_BASE}/api/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!r.ok) throw new Error(`/api/input ${action} → ${r.status}`)
}

async function consoleEntries() {
  const r = await fetch(`${SIM_BASE}/api/console`).catch(() => null)
  if (!r || !r.ok) return []
  const data = await r.json()
  return data.entries ?? []
}

function stateMessages(entries) {
  return entries
    .map(e => e.message)
    .filter(m => typeof m === 'string' && m.includes('[cardpack:state]'))
}

async function waitForState(predicate, { timeoutMs = 8000, label } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const msgs = stateMessages(await consoleEntries())
    if (msgs.some(predicate)) return true
    await sleep(200)
  }
  throw new Error(`timed out waiting for state: ${label ?? '(unlabeled)'}`)
}

async function latestFocus() {
  const msgs = stateMessages(await consoleEntries())
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = /focus=(\w+)/.exec(msgs[i])
    if (m) return m[1]
  }
  return null
}

async function realErrors() {
  const entries = await consoleEntries()
  return entries.filter(e =>
    (e.level === 'error' ||
      (typeof e.message === 'string' && (e.message.includes('[uncaught]') || e.message.includes('[unhandledrejection]')))) &&
    !String(e.message).includes('Failed to fetch') &&
    !String(e.message).includes('NetworkError'),
  )
}

async function glassesShot() {
  const r = await fetch(`${SIM_BASE}/api/screenshot/glasses`).catch(() => null)
  if (!r || !r.ok) return { bytes: 0, hash: '' }
  const buf = Buffer.from(await r.arrayBuffer())
  return { bytes: buf.byteLength, hash: createHash('sha1').update(buf).digest('hex') }
}

// ── per-game flow ──────────────────────────────────────────────────────

// Every game runs its core-gesture flow AND the gesture-spam stress pass.
const GAMES = [
  { id: 'hearts', gestures: ['down', 'down', 'up', 'double_click', 'down', 'double_click'], spam: true },
  { id: 'euchre', gestures: ['down', 'double_click', 'up', 'double_click', 'down', 'double_click'], spam: true },
  { id: 'spades', preWaitMs: 2800, gestures: ['up', 'up', 'double_click', 'down', 'double_click', 'down', 'double_click'], spam: true },
  { id: 'crazy8', preWaitMs: 1500, gestures: ['down', 'double_click', 'down', 'double_click', 'double_click'], spam: true },
  { id: 'ginrummy', gestures: ['double_click', 'down', 'down', 'double_click', 'down', 'double_click'], spam: true },
  // Cribbage: pick 2 cards, swipe to the CONFIRM slot (index 6), commit, then peg.
  { id: 'cribbage', gestures: ['double_click', 'down', 'double_click', 'down', 'down', 'down', 'down', 'down', 'double_click', 'double_click', 'down', 'double_click'], spam: true },
  // Oh Hell: confirm your bid, let AI bid, then play.
  { id: 'ohhell', gestures: ['double_click', 'down', 'down', 'double_click', 'down', 'double_click', 'down', 'double_click'], spam: true },
  // Bridge: dial through calls + make the seeded call, let the AI auction
  // settle, then play (declarer may drive own + dummy seats).
  { id: 'bridge', preWaitMs: 1500, gestures: ['down', 'double_click', 'down', 'down', 'double_click', 'down', 'double_click', 'down', 'double_click'], spam: true },
]

async function navigateToFocus(targetId) {
  // Cursor start position depends on persisted last-played; swipe down until
  // the focus marker reports the target (cursor wraps, so ≤ #games steps).
  // A swipe sent before the bridge handlers finish binding is dropped, so we
  // confirm each swipe moved the focus and re-swipe if it didn't.
  let cur = await latestFocus()
  for (let i = 0; i < 10 && cur !== targetId; i++) {
    const prev = cur
    await input('down')
    const t0 = Date.now()
    while (Date.now() - t0 < 1500) {
      const f = await latestFocus()
      if (f && f !== prev) { cur = f; break }
      await sleep(150)
    }
    cur = await latestFocus()
  }
  return cur === targetId
}

async function runGame(game) {
  console.log(`\n=== ${game.id} ===`)
  const child = await spawnSim()
  try {
    await sleep(6000) // SDK init + bridge connect + handler binding
    // NB: don't clear the console — the app emits state only on CHANGE, so
    // clearing would drop the bootstrap `view=launcher focus=…` marker with
    // nothing to re-emit it. Each session is a fresh process, so the console
    // already starts clean.

    // 1. Bootstrap to launcher.
    let ok = true
    try { await waitForState(m => m.includes('view=launcher'), { timeoutMs: 6000, label: `${game.id}: launcher` }) }
    catch { ok = false }
    check(`${game.id}: bootstrap → launcher`, ok)

    const launcherShot = await glassesShot()
    check(`${game.id}: launcher screenshot non-blank`, launcherShot.bytes > 1000, `${launcherShot.bytes} bytes`)

    // 2. Navigate the launcher cursor to this game and launch it.
    const navOk = await navigateToFocus(game.id)
    check(`${game.id}: launcher cursor reaches focus=${game.id}`, navOk)
    await input('click')
    let entered = true
    try { await waitForState(m => m.includes(`view=${game.id}`), { timeoutMs: 4000, label: `${game.id}: enter` }) }
    catch { entered = false }
    check(`${game.id}: tap launches it (view=${game.id})`, entered)

    // 3. Drive the game's core gestures.
    if (game.preWaitMs) await sleep(game.preWaitMs) // let AI bids/plays settle
    for (const g of game.gestures) {
      try { await input(g) } catch { /* tolerate rate-limit */ }
      await sleep(350)
    }

    // 4. Survived: no errors, still rendering, render changed from launcher.
    const errs = await realErrors()
    check(`${game.id}: play flow raised no console errors`, errs.length === 0,
      errs.length ? errs[0].message.slice(0, 80) : 'clean')

    const gameShot = await glassesShot()
    check(`${game.id}: glasses still rendering after play`, gameShot.bytes > 1000, `${gameShot.bytes} bytes`)
    check(`${game.id}: in-game render differs from launcher`, gameShot.hash !== launcherShot.hash)

    // 5. Optional gesture-spam stress (one game is enough to cover the cell).
    if (game.spam) {
      const spam = ['up', 'down', 'up', 'down', 'click', 'up', 'down', 'click', 'up', 'down']
      for (const a of spam) { try { await input(a) } catch { /* tolerate */ } }
      await sleep(800)
      const spamErrs = await realErrors()
      check(`${game.id}: gesture spam (10 rapid) does not crash`, spamErrs.length === 0,
        spamErrs.length ? spamErrs[0].message.slice(0, 80) : 'clean')
      const afterSpam = await glassesShot()
      check(`${game.id}: still rendering after spam`, afterSpam.bytes > 1000, `${afterSpam.bytes} bytes`)
    }
  } finally {
    await killSim(child)
    await sleep(500)
  }
}

async function main() {
  console.log('Card Pack regression — full per-game e2e')
  console.log('========================================')

  // Dev server must be up; the simulator loads it.
  const devUp = await fetch(DEV_URL).then(r => r.ok).catch(() => false)
  if (!devUp) {
    console.error(`Dev server not reachable at ${DEV_URL}. Run: npm run dev`)
    process.exit(1)
  }
  await mkdir(OUT_DIR, { recursive: true })

  for (const game of GAMES) {
    try { await runGame(game) }
    catch (err) { check(`${game.id}: harness ran without throwing`, false, err.message) }
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('Failures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Regression run failed:', err.message)
  process.exit(1)
})
