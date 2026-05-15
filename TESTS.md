# TESTS — coverage matrix

Last updated: 2026-05-15 (v0.2.0 — Phase B: Euchre joins Hearts in the pack)

This is the build gate for Card Pack. Every feature gets a row, every cell
gets either a test reference, `manual:<reason>`, or `skip:<reason>`. Empty
cells block the next ship. See `~/.claude/skills/coverage-matrix/SKILL.md`
for the full discipline.

The shared platform's coverage (93 unit tests in `even-card-platform`) is
tracked in its own `TESTS.md`. Cells here that say `platform:<name>` reference
tests that already pass in that repo. Euchre engine + AI (109 + 284 + 73 unit
tests in `~/Documents/Euchre`) are tested upstream — cells that say
`engine:euchre` reference tests in that repo.

## Use case × failure mode

Columns dropped as n/a:
- **Network down** — Card Pack does no network I/O (no worker, no STT, no API)
- **Mic denied** — no microphone use

| Use case | Happy | Bad input | Storage hang | Concurrent gesture | Crash mid-flow |
|---|---|---|---|---|---|
| Bootstrap → bridge connect | e2e:1 | n/a | skip:platform-owns-storage | n/a | manual |
| Bootstrap → browser preview (no bridge) | e2e:1 (no-bridge variant) | n/a | n/a | n/a | manual |
| Launcher renders with N games | platform:launcher | platform:launcher:empty-list | n/a | n/a | n/a |
| Launcher cursor swipe-up/down | platform:launcher | n/a | n/a | n/a | n/a |
| Launcher tap launches cursored game | platform:launcher + e2e:4 | n/a | n/a | n/a | n/a |
| Launcher last-played persistence | platform:launcher | n/a | skip:platform-owns-storage | n/a | n/a |
| Hearts: init (deals, sets first turn) | unit:hearts:init+initial-frame | skip:no-user-input-surface | n/a | n/a | n/a |
| Hearts: render mid-play | unit:hearts:initial-frame+plus-trick | n/a | n/a | n/a | n/a |
| Hearts: cursor swipe moves through hand | unit:hearts:cursor-move+wrap | n/a | n/a | unit:hearts:gestures-execute | n/a |
| Hearts: double-tap on legal card plays it (v0.1.5: tap→double-tap to prevent accidental play) | unit:hearts:double-tap-plays | unit:hearts:double-tap-on-illegal-noop | skip:hearts-handle-no-storage | n/a | n/a |
| Hearts: single-tap mid-play is a no-op (v0.1.5 invariant — prevents accidental play) | unit:hearts:single-tap-mid-play-noop | n/a | n/a | n/a | n/a |
| Hearts: AI plays through after human | unit:hearts:double-tap-plays (indirectly — double-tap returns with state advanced past AI plays) | n/a | n/a | n/a | n/a |
| Hearts: auto-park cursor on first legal card (v0.1.5) | unit:hearts:cursor-park-on-lead-suit | n/a | n/a | n/a | n/a |
| Hearts: running hand-points visible in score header (v0.1.5) | unit:hearts:running-score-format | n/a | n/a | n/a | n/a |
| Hearts: render hand-end | unit:hearts:hand-end-render | n/a | n/a | n/a | n/a |
| Hearts: render game-end with banner | unit:hearts:game-end-render (both YOU WIN + THEM WIN) | n/a | n/a | n/a | n/a |
| Hearts: double-tap at hand-end → new hand | unit:hearts:hand-end-double-tap + unit:hearts:hand-end-single-tap-noop | n/a | n/a | n/a | n/a |
| Hearts: double-tap at game-end → exit | unit:hearts:game-end-double-tap + unit:hearts:game-end-single-tap-noop | n/a | n/a | n/a | n/a |
| (removed v0.1.5: mid-play double-tap is now the *play* gesture; see "double-tap on legal card plays it" above) | — | — | — | — | — |
| Hearts: ctx.endGame() returns to launcher | platform:runtime | n/a | n/a | n/a | n/a |
| Hearts: phone "New game" event | unit:hearts:phone-new-game | unit:hearts:unknown-phone-event | n/a | n/a | n/a |
| Hearts: destroy() doesn't throw | unit:hearts:destroy | n/a | n/a | n/a | n/a |
| Phone "End game" → exitToMenu | skip:one-line-wiring (`runtime.exitToMenu()` in main.ts; platform owns the behavior) | n/a | n/a | n/a | n/a |
| Glasses mirror updates on render | skip:one-line-wiring (`glassesMirror.textContent = frame` in onRender; covered indirectly by e2e bootstrap) | n/a | n/a | n/a | n/a |
| Bridge tap → runtime.handleGesture | e2e:4 | n/a | n/a | e2e:8 (gesture spam) | n/a |
| Bridge double-tap → runtime.handleGesture | e2e:7 | n/a | n/a | n/a | n/a |
| Bridge swipe-up/down → handleGesture | e2e:5 | n/a | n/a | n/a | n/a |
| Bridge onForeground triggers re-render | manual:hw (simulator API has no bg/fg toggle) | n/a | n/a | n/a | n/a |
| `.ehpk` boots in simulator | e2e:1 | n/a | n/a | n/a | manual |
| Glasses screenshot is non-blank | e2e:3+6 | n/a | n/a | n/a | n/a |
| BLE write serialization (no crash) | platform:runtime + manual:hw | n/a | n/a | e2e:8 (gesture spam) | manual |
| App icon renders in portal | manual:DOM | n/a | n/a | n/a | n/a |
| Euchre: module metadata (id, name, glyph, category) | unit:euchre:module-metadata | n/a | n/a | n/a | n/a |
| Euchre: init renders Order-up phase with Dealer + Up: header | unit:euchre:init-render | n/a | n/a | n/a | n/a |
| Euchre: order-up bidding — Order/Pass toggle cursor | unit:euchre:order-up-toggle | n/a | n/a | n/a | n/a |
| Euchre: order-up double-tap on Pass → state.passes++ | unit:euchre:order-up-pass | n/a | n/a | n/a | n/a |
| Euchre: call-trump renders 3 callable suits + Pass | unit:euchre:call-trump-render | n/a | n/a | n/a | n/a |
| Euchre: call-trump swipe cycles suits + Pass | unit:euchre:call-trump-cycle | n/a | n/a | n/a | n/a |
| Euchre: call-trump double-tap on suit → phase=play | unit:euchre:call-trump-confirm | n/a | n/a | n/a | n/a |
| Euchre: stick-the-dealer hides Pass + shows hint | unit:euchre:stick-dealer | n/a | n/a | n/a | n/a |
| Euchre: play-phase render shows Trump:X + trick + hand | unit:euchre:play-render | n/a | n/a | n/a | n/a |
| Euchre: single-tap mid-play no-op; double-tap plays legal | unit:euchre:play-double-tap | n/a | n/a | n/a | n/a |
| Euchre: hand-end render shows Hand done + tricks + trump | unit:euchre:hand-end-render | n/a | n/a | n/a | n/a |
| Euchre: game-end render shows US WIN / THEM WIN banner | unit:euchre:game-end-render | n/a | n/a | n/a | n/a |
| Euchre: hand-end double-tap → next hand (phase=order-up) | unit:euchre:hand-end-double-tap | n/a | n/a | n/a | n/a |
| Euchre: game-end double-tap → ctx.endGame() | unit:euchre:game-end-double-tap | n/a | n/a | n/a | n/a |
| Euchre: phone new-game resets to order-up + scores 0 | unit:euchre:phone-new-game | unit:euchre:unknown-phone-event | n/a | n/a | n/a |
| Euchre: phone set-difficulty updates this.difficulty | unit:euchre:phone-set-difficulty | n/a | n/a | n/a | n/a |
| Euchre: cursor parks on first legal card (must-follow) | unit:euchre:cursor-park | n/a | n/a | n/a | n/a |
| Euchre: destroy() doesn't throw + cancels timers | unit:euchre:destroy + unit:euchre:destroy-cancels-timers | n/a | n/a | n/a | n/a |
| Euchre: team-score format "Us:N(+T)  Them:N(+T)" | unit:euchre:initial-score | n/a | n/a | n/a | n/a |
| Two-game launcher: Hearts + Euchre both registered | manual:hw (launcher logic in platform; integration check on real glasses) | n/a | n/a | n/a | n/a |
| Rules pane swaps on active game change | skip:one-line-wiring (`game?.renderPhoneRules?.()` in main.ts; per-game HTML covered by unit:hearts:rules + unit:euchre:rules) | n/a | n/a | n/a | n/a |

`TODO:unit` = vitest case to be written in `tests/games/hearts.test.ts` or `tests/main.test.ts`.
`TODO:integration` = vitest with jsdom + a fake bridge.
`TODO:e2e` = `scripts/regression.mjs` against the simulator.
`manual:DOM` = phone WebView interaction the simulator HTTP API can't drive.
`manual:hw` = requires real hardware (BLE, real glasses display).
`platform:<name>` = covered by `even-card-platform/tests/<name>.test.ts`.

## By dimension

### Static (all green)
- [x] tsc strict: passes
- [x] app.json validation: `npm run pack` succeeds
- [ ] Lint: not wired (no ESLint config in CardPack yet)
- [ ] Secret scan: not wired
- [x] Bundle size: 67 KB packed `.ehpk`, well under any hub limit
- [x] Network whitelist: no permissions in `app.json` (no fetches at all)
- [x] License/NOTICE present

### Unit (Vitest, CardPack-side)
- **60 tests across 2 files** — `tests/games/hearts.test.ts` (35) and
  `tests/games/euchre.test.ts` (25). Euchre wrapper tests cover module
  metadata, init render, order-up bidding (toggle, Pass, single-tap no-op),
  call-trump render + cycle + confirm + stick-the-dealer, play-phase
  render + gestures, hand-end + game-end render, phone new-game and
  set-difficulty events, cursor parking, and destroy semantics. Engine +
  AI correctness is covered upstream in `~/Documents/Euchre/tests/` and
  not duplicated here.
- **35 tests** in `tests/games/hearts.test.ts`. Cover module metadata,
  initial render frame shape, score format, plus-trick markers, controlHint,
  destroy(), cursor movement (incl. wrap), gesture execution, phone
  new-game event, unknown phone event, mid-play double-tap no-op, the
  tap-cycle that proves both "legal tap advances" and "illegal tap is
  no-op" with a single traversal, and — new in v0.1.4 — hand-end render,
  game-end render (both win banners), double-tap at hand-end / game-end,
  and single-tap-at-end no-op invariants.
- Hand-end / game-end flows are reached via private-state injection
  (`(h as any).state.phase = ...`) — the existing `getTurn()` helper
  already uses this pattern, no engine changes needed.

### Integration (vitest with jsdom + fake bridge)
- **0 tests.** Plan: a `tests/main.test.ts` that drives the full bootstrap
  flow with a stub bridge, asserts on launcher render, tap-launches Hearts,
  verifies `runtime.handleGesture` routes to the game handle. Probably not
  needed for v0.1 since e2e covers the same ground via the simulator — keep
  in the backlog and add if e2e starts feeling slow/flaky.

### End-to-end (simulator)
- **8 cases** in `scripts/regression.mjs`. Asserts bootstrap reaches
  `view=launcher`, no console errors during bootstrap, glasses screenshot
  non-blank, tap on launcher transitions to `view=hearts`, swipe-down
  in-game doesn't crash, glasses still renders after gestures, **double-tap
  mid-play is a non-crashing no-op (e2e:7)**, and **10-input gesture spam
  doesn't crash with the glasses still rendering after (e2e:8 — stands in
  for BLE write-serialization stress)**.
- Runs against a manually-launched simulator on port 9899; `npm run test:e2e`.
- State-log emission lives in `src/main.ts` (the `emitState()` wrapper
  around `runtime.onRender`). Format: `[cardpack:state] view=<id>`.

### Hardware (real glasses)
- The Phase A gate: 5 hands of Hearts on real glasses. **Not yet run.**
  Field-test log will live in `PREMORTEM.md` once that's created.

### Performance
- Bundle: 67 KB packed. Target <200 KB.
- Boot-to-launcher: untested. Target <2 s on real glasses.
- BLE write rate: untested. Target ≤2/sec per Cue's KNOWN_QUIRKS.

### Stress
- Long play session (30+ min, full game to 50): `manual:hw` — covered by the
  Phase A gate (5 hands on real glasses). No software simulator can prove
  the BLE link / battery / sleep cycle behaves over a full game.

### Security / Privacy
- No mic, no network, no location, no PII. Permissions in `app.json` is
  empty. The hub listing's privacy/terms wizard discloses Bluetooth only
  (required for the SDK to talk to the glasses).

### Accessibility
- Glasses display readable at typical viewing distance: `manual:hw` —
  Phase A gate.
- Phone-side a11y: `skip:phone-surface-minimal` — the phone WebView has two
  buttons, one status line, and a static "How to play" disclosure. No
  forms, no nav, no dynamic content. Lighthouse would surface near nothing
  and Phase A field-testers will catch any real readability issue.

### Compatibility
- TS strict ✓
- SDK pinned: `@evenrealities/even_hub_sdk@^0.0.10`
- iOS WKWebView vs Android: not tested
- Min app version: 2.0.0; min SDK: 0.0.10 (in app.json)

### Migration
- No prior data to migrate (new package_id `com.philtullai.cards`).
- Standalone Hearts/Spades/Euchre installs persist their own storage under
  their own package_ids; no migration needed when CardPack ships.

### Build / release verification
- [x] `.ehpk` packs successfully
- [x] Manifest version matches package.json
- [ ] Bundle has no debug logs: not checked
- [ ] Sideload boots on real glasses: pending Phase A gate

### Documentation
- README current ✓
- `~/Documents/even-card-platform/STYLE.md` is the load-bearing visual contract ✓
- `KNOWN_QUIRKS.md`: not created — should land if/when a real-world bug surfaces
- `ROADMAP.md`: lives in `Pulse/`; CardPack's plan is in conversation history (Phase A/B/C/D) — should be extracted to `ROADMAP.md` here at some point

### Regression (closed bugs as permanent tests)
- None yet — CardPack hasn't shipped publicly. Will populate as field bugs
  surface during Phase A gate.

## Acceptance gates

Before any version bump out of v0.1.x:

- [x] Every `TODO:unit` cell has a vitest case (all hand-end/game-end cells filled in v0.1.4)
- [x] Every `TODO:integration` cell has a verdict (reclassified to `skip:` with reason or `unit:` injection)
- [x] Every `TODO:e2e` cell has a regression.mjs check or a `manual:hw` reclassification
- [ ] Phase A gate (5 hands of Hearts on real glasses) completed; PREMORTEM
      field-test log started — **user-only, hardware-bound**
- [x] No `TODO:*` cells remain — they're either tested, `manual:*` with a
      reason, or `skip:*` with a reason
- [x] No stale build artifacts (per `coverage-matrix` static gate): `tsconfig.json`
      has `"noEmit": true` and `find src -name "*.js"` is empty (verified 2026-05-15)

v0.1.4 meets all software gates. Hardware gate (Phase A field test) remains
the only blocker on a clean v0.2 cut — but it doesn't block the v0.1.4 portal
upload itself, since the build is software-equivalent to what's been
simulator-validated.
