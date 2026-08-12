#!/usr/bin/env node
// Phone-WebView layout check in Playwright/WebKit — the engine family iOS
// WKWebView is built on.
//
// Why this exists: hub reviewers exercise the PHONE panel, not just the
// glasses display, and phone layout that overflows the screen is a hard
// reject — confirmed on Euchre v0.3.0 and Hearts v0.1.5. Two scaffold bugs
// cause it: a native <select> sizes itself to its LONGEST option rather than
// its container, and the main wrapper has no overflow-x safety net. Card Pack
// has both fixes in place; this proves it at real iPhone viewports instead of
// assuming, and fails loudly if a future edit regresses them.
//
// Chromium-based checks (jsdom, the simulator, headless Chrome) don't model
// WebKit's intrinsic sizing of form controls, which is exactly where this
// class of bug lives — so it has to run in WebKit specifically.
//
// Prereq (one terminal):
//   npm run dev        # Vite on http://localhost:5180
// Then:
//   npm run test:webkit
// One-time, if the browser isn't cached: npx playwright install webkit

import { webkit } from 'playwright'

const URL = process.env.CARDPACK_URL || 'http://localhost:5180'

// Narrowest mainstream iPhone first — if it fits here it fits everywhere.
const VIEWPORTS = [
  { name: 'iPhone SE', width: 320, height: 568 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
]

let pass = 0
let fail = 0
const failures = []
const ok = (label, detail = '') => { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`) }
const bad = (label, detail = '') => {
  fail++; failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}
const check = (label, cond, detail = '') => (cond ? ok(label, detail) : bad(label, detail))

const browser = await webkit.launch({ headless: true })

try {
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} (${vp.width}×${vp.height}) ===`)
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(e.message))

    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 20_000 })
    } catch (err) {
      bad(`${vp.name}: page loads`, `${err.message.split('\n')[0]} (is \`npm run dev\` running?)`)
      await context.close()
      continue
    }
    // The phone panel is built by main.ts after bootstrap, not present in
    // index.html, so wait for it rather than racing it.
    await page.waitForSelector('main', { timeout: 10_000 }).catch(() => {})

    const m = await page.evaluate(() => {
      const doc = document.documentElement
      const main = document.querySelector('main')
      const sel = document.querySelector('select')
      const rect = el => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      // Widest element that pokes past the viewport, for a useful failure msg.
      let widest = null
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.right > doc.clientWidth + 1 && (!widest || r.right > widest.right)) {
          widest = { tag: el.tagName.toLowerCase(), right: Math.round(r.right), cls: el.className || '' }
        }
      }
      return {
        title: document.title,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        mainOverflowX: main ? getComputedStyle(main).overflowX : null,
        mainRect: rect(main),
        selRect: rect(sel),
        selMaxWidth: sel ? getComputedStyle(sel).maxWidth : null,
        selBoxSizing: sel ? getComputedStyle(sel).boxSizing : null,
        hasMain: !!main,
        widest,
      }
    })

    check(`${vp.name}: phone panel rendered`, m.hasMain)

    // The headline check: nothing may force the page to scroll sideways.
    check(
      `${vp.name}: no horizontal overflow`,
      m.scrollWidth <= m.clientWidth + 1,
      m.scrollWidth <= m.clientWidth + 1
        ? `${m.scrollWidth}px within ${m.clientWidth}px`
        : `scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}` +
          (m.widest ? ` — widest: <${m.widest.tag}> reaching ${m.widest.right}px` : ''),
    )

    check(
      `${vp.name}: <select> stays inside the viewport`,
      m.selRect !== null && m.selRect.right <= m.clientWidth + 1,
      m.selRect
        ? `right edge ${Math.round(m.selRect.right)}px vs ${m.clientWidth}px`
        : 'no <select> found',
    )

    // The two scaffold fixes, asserted directly so a regression names itself
    // rather than showing up as a mystery overflow.
    check(`${vp.name}: <main> keeps overflow-x hidden`, m.mainOverflowX === 'hidden', String(m.mainOverflowX))
    check(`${vp.name}: <select> constrained (max-width + border-box)`,
      m.selMaxWidth === '100%' && m.selBoxSizing === 'border-box',
      `max-width:${m.selMaxWidth} box-sizing:${m.selBoxSizing}`)

    check(`${vp.name}: no uncaught page errors`, pageErrors.length === 0,
      pageErrors.length ? pageErrors[0].slice(0, 90) : 'clean')

    if (vp === VIEWPORTS[0]) {
      check('title is Card Pack (not a scaffold leftover)', m.title === 'Card Pack', m.title)
    }

    await context.close()
  }
} finally {
  await browser.close()
}

console.log(`\nResult: ${pass} passed, ${fail} failed`)
if (fail) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
