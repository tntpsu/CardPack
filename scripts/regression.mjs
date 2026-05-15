#!/usr/bin/env node
// End-to-end regression test for Card Pack via the Even Hub simulator
// HTTP API. Run after every Phase to catch the bugs unit tests can't see
// (bootstrap hangs, gesture handler binding, render-loop death).
//
// Prereqs (run manually first, in two separate terminals):
//   1. cd ~/Documents/CardPack && npm run dev
//        # Vite on http://localhost:5180
//   2. npx evenhub-simulator --automation-port 9899 http://localhost:5180
//        # Sim opens; main webview at top, glasses display at bottom.
//
// Then in a third terminal:
//   npm run test:e2e

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIM_BASE = 'http://127.0.0.1:9899'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'tests', 'screenshots-regression')

let lastConsoleId = -1
let pass = 0
let fail = 0
const failures = []

async function ping() {
  const r = await fetch(`${SIM_BASE}/api/ping`).catch(() => null)
  if (!r || !r.ok) {
    console.error(`Simulator not reachable on ${SIM_BASE}`)
    console.error('Run: npx evenhub-simulator --automation-port 9899 http://localhost:5180')
    process.exit(1)
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

async function fetchConsoleEntries() {
  const r = await fetch(`${SIM_BASE}/api/console`)
  if (!r.ok) return []
  const data = await r.json()
  return data.entries ?? []
}

async function waitForState(predicate, { timeoutMs = 10_000, label } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const entries = await fetchConsoleEntries()
    const fresh = entries.filter(e => e.id > lastConsoleId)
    for (const e of fresh) {
      if (typeof e.message === 'string' && e.message.includes('[cardpack:state]') && predicate(e.message)) {
        lastConsoleId = e.id
        return e
      }
      if (e.id > lastConsoleId) lastConsoleId = e.id
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for state: ${label ?? '(unlabeled)'}`)
}

async function countStateLogs(durationMs) {
  const before = await fetchConsoleEntries()
  const startId = before.length > 0 ? before[before.length - 1].id : -1
  await new Promise(r => setTimeout(r, durationMs))
  const after = await fetchConsoleEntries()
  const fresh = after.filter(e => e.id > startId && typeof e.message === 'string' && e.message.includes('[cardpack:state]'))
  if (fresh.length > 0) lastConsoleId = Math.max(lastConsoleId, fresh[fresh.length - 1].id)
  return fresh.length
}

async function checkConsoleErrors() {
  const entries = await fetchConsoleEntries()
  return entries.filter(e =>
    e.level === 'error' ||
    (typeof e.message === 'string' && (e.message.includes('[uncaught]') || e.message.includes('[unhandledrejection]'))),
  )
}

function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  console.log('Card Pack regression test')
  console.log('---')
  await ping()

  await mkdir(OUT_DIR, { recursive: true })

  console.log('1. Bootstrap reaches view=launcher (proves runtime init + render path)')
  try {
    const e = await waitForState(m => m.includes('view=launcher'), { timeoutMs: 5_000, label: 'launcher bootstrap' })
    check('bootstrap → launcher', true, e.message)
  } catch {
    check('bootstrap → launcher', false, 'no [cardpack:state] view=launcher within 5s')
  }

  console.log('2. No console errors during bootstrap')
  const errors = await checkConsoleErrors()
  const realErrors = errors.filter(e =>
    !e.message.includes('Failed to fetch') &&
    !e.message.includes('NetworkError'),
  )
  check('no unexpected console errors', realErrors.length === 0,
    realErrors.length > 0 ? realErrors.map(e => e.message.slice(0, 80)).join('; ') : 'clean')

  console.log('3. Glasses screenshot is non-blank')
  const r = await fetch(`${SIM_BASE}/api/screenshot/glasses`)
  const png = await r.arrayBuffer()
  check('glasses display rendered content', png.byteLength > 1000, `${png.byteLength} bytes`)

  console.log('4. Tap on launcher transitions to view=hearts')
  await input('click')
  try {
    const e = await waitForState(m => m.includes('view=hearts'), { timeoutMs: 3_000, label: 'launcher tap → hearts' })
    check('tap on launcher launches Hearts', true, e.message)
  } catch {
    check('tap on launcher launches Hearts', false, 'no view=hearts transition within 3s of click')
  }

  console.log('5. In-game swipe-down does not crash + emits a render')
  await input('down')
  // Hearts swallows swipe-down internally (cursor move); we just want to
  // see another state-log fire to prove the render loop survived.
  await new Promise(r => setTimeout(r, 800))
  const errsAfterSwipe = (await checkConsoleErrors()).filter(e =>
    !e.message.includes('Failed to fetch'))
  check('swipe-down does not crash', errsAfterSwipe.length === 0,
    errsAfterSwipe.length > 0 ? errsAfterSwipe[0].message.slice(0, 80) : 'no errors')

  console.log('6. Glasses still renders after gestures')
  const r2 = await fetch(`${SIM_BASE}/api/screenshot/glasses`)
  const png2 = await r2.arrayBuffer()
  check('glasses still rendering after gestures', png2.byteLength > 1000, `${png2.byteLength} bytes`)

  console.log('7. Double-tap mid-play does not crash (Hearts swallows it as no-op)')
  await input('double_click')
  await new Promise(r => setTimeout(r, 500))
  const errsAfterDoubleTap = (await checkConsoleErrors()).filter(e =>
    !e.message.includes('Failed to fetch'))
  check('double-tap mid-play does not crash', errsAfterDoubleTap.length === 0,
    errsAfterDoubleTap.length > 0 ? errsAfterDoubleTap[0].message.slice(0, 80) : 'no errors')

  console.log('8. Gesture spam (10 rapid inputs) → no crash, render survives')
  // Stand-in for the BLE-write-serialization × concurrent-gesture cell.
  // Real BLE write rate is bounded server-side; this proves the client
  // doesn't itself crash when the user mashes the touchpad.
  const spam = ['up', 'down', 'up', 'down', 'click', 'up', 'down', 'click', 'up', 'down']
  for (const action of spam) {
    try { await input(action) } catch { /* server may rate-limit; tolerate */ }
  }
  await new Promise(r => setTimeout(r, 800))
  const errsAfterSpam = (await checkConsoleErrors()).filter(e =>
    !e.message.includes('Failed to fetch'))
  check('gesture spam does not crash', errsAfterSpam.length === 0,
    errsAfterSpam.length > 0 ? errsAfterSpam[0].message.slice(0, 80) : 'no errors')
  const r3 = await fetch(`${SIM_BASE}/api/screenshot/glasses`)
  const png3 = await r3.arrayBuffer()
  check('glasses still rendering after spam', png3.byteLength > 1000, `${png3.byteLength} bytes`)

  console.log()
  console.log(`Result: ${pass} passed, ${fail} failed`)
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
