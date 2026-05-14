# TESTS — coverage matrix

Last updated: 2026-05-14 (v0.1.4 — pacing/linger fix + phone rules)

This is the build gate for Card Pack. Every feature gets a row, every cell
gets either a test reference, `manual:<reason>`, or `skip:<reason>`. Empty
cells block the next ship. See `~/.claude/skills/coverage-matrix/SKILL.md`
for the full discipline.

**Current state is honest about Phase A's testing gap.** Many cells are empty
or `TODO` — this matrix exists to surface them, not hide them. v0.1.1 was
shipped without these tests; v0.1.2 is gated on filling them.

The shared platform's coverage (78 unit tests in `even-card-platform`) is
tracked in its own `TESTS.md`. Cells here that say `platform:<name>` reference
tests that already pass in that repo.

## Use case × failure mode

Columns dropped as n/a:
- **Network down** — Card Pack does no network I/O (no worker, no STT, no API)
- **Mic denied** — no microphone use

| Use case | Happy | Bad input | Storage hang | Concurrent gesture | Crash mid-flow |
|---|---|---|---|---|---|
| Bootstrap → bridge connect | e2e:1 | n/a | TODO:integration | n/a | manual |
| Bootstrap → browser preview (no bridge) | e2e:1 (no-bridge variant) | n/a | n/a | n/a | manual |
| Launcher renders with N games | platform:launcher | platform:launcher:empty-list | n/a | n/a | n/a |
| Launcher cursor swipe-up/down | platform:launcher | n/a | n/a | n/a | n/a |
| Launcher tap launches cursored game | platform:launcher + e2e:4 | n/a | n/a | n/a | n/a |
| Launcher last-played persistence | platform:launcher | n/a | TODO:integration | n/a | n/a |
| Hearts: init (deals, sets first turn) | unit:hearts:init+initial-frame | TODO:integration | n/a | n/a | n/a |
| Hearts: render mid-play | unit:hearts:initial-frame+plus-trick | n/a | n/a | n/a | n/a |
| Hearts: cursor swipe moves through hand | unit:hearts:cursor-move+wrap | n/a | n/a | unit:hearts:gestures-execute | n/a |
| Hearts: tap on legal card plays it | unit:hearts:tap-cycle | unit:hearts:tap-cycle (illegal taps no-op) | TODO:integration | n/a | n/a |
| Hearts: tap on illegal card is no-op | unit:hearts:tap-cycle (covered: cycle proves illegal-cursor taps don't advance) | unit:hearts:tap-cycle | n/a | n/a | n/a |
| Hearts: AI plays through after human | unit:hearts:tap-cycle (indirectly — tap returns with state advanced past AI plays) | n/a | n/a | n/a | n/a |
| Hearts: render hand-end | TODO:integration (needs state-injection helper in engine) | n/a | n/a | n/a | n/a |
| Hearts: render game-end with banner | TODO:integration (same — needs injection) | n/a | n/a | n/a | n/a |
| Hearts: double-tap at hand-end → new hand | TODO:integration | n/a | n/a | n/a | n/a |
| Hearts: double-tap at game-end → exit | TODO:integration | n/a | n/a | n/a | n/a |
| Hearts: mid-play double-tap is no-op | unit:hearts:mid-play-double-tap | n/a | n/a | n/a | n/a |
| Hearts: ctx.endGame() returns to launcher | platform:runtime | n/a | n/a | n/a | n/a |
| Hearts: phone "New game" event | unit:hearts:phone-new-game | unit:hearts:unknown-phone-event | n/a | n/a | n/a |
| Hearts: destroy() doesn't throw | unit:hearts:destroy | n/a | n/a | n/a | n/a |
| Phone "End game" → exitToMenu | TODO:integration | n/a | n/a | n/a | n/a |
| Glasses mirror updates on render | TODO:integration | n/a | n/a | n/a | n/a |
| Bridge tap → runtime.handleGesture | e2e:4 | n/a | n/a | TODO:e2e | n/a |
| Bridge double-tap → runtime.handleGesture | TODO:e2e | n/a | n/a | n/a | n/a |
| Bridge swipe-up/down → handleGesture | e2e:5 | n/a | n/a | n/a | n/a |
| Bridge onForeground triggers re-render | TODO:e2e | n/a | n/a | n/a | n/a |
| `.ehpk` boots in simulator | e2e:1 | n/a | n/a | n/a | manual |
| Glasses screenshot is non-blank | e2e:3+6 | n/a | n/a | n/a | n/a |
| BLE write serialization (no crash) | platform:runtime + manual:hw | n/a | n/a | TODO:e2e | manual |
| App icon renders in portal | manual:DOM | n/a | n/a | n/a | n/a |

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
- **15 tests** in `tests/games/hearts.test.ts`. Cover module metadata,
  initial render frame shape, score format, plus-trick markers, controlHint,
  destroy(), cursor movement (incl. wrap), gesture execution, phone
  new-game event, unknown phone event, mid-play double-tap no-op, and the
  tap-cycle that proves both "legal tap advances" and "illegal tap is no-op"
  with a single traversal.
- Gap: hand-end / game-end flows. Reaching those requires playing 13
  tricks or hitting target score 50 — too slow for unit tests. Plan: add
  a state-injection helper to the Hearts engine (or expose a test-only
  constructor on HeartsHandle) so unit tests can jump directly to those
  phases. Tracked as TODO:integration in the matrix.

### Integration (vitest with jsdom + fake bridge)
- **0 tests.** Plan: a `tests/main.test.ts` that drives the full bootstrap
  flow with a stub bridge, asserts on launcher render, tap-launches Hearts,
  verifies `runtime.handleGesture` routes to the game handle. Probably not
  needed for v0.1 since e2e covers the same ground via the simulator — keep
  in the backlog and add if e2e starts feeling slow/flaky.

### End-to-end (simulator)
- **6 cases** in `scripts/regression.mjs`. Asserts bootstrap reaches
  `view=launcher`, no console errors during bootstrap, glasses screenshot
  non-blank, tap on launcher transitions to `view=hearts`, swipe-down
  in-game doesn't crash, glasses still renders after gestures.
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
- Long play session (30+ min, full game to 50): TODO manual run.

### Security / Privacy
- No mic, no network, no location, no PII. Permissions in `app.json` is
  empty. The hub listing's privacy/terms wizard discloses Bluetooth only
  (required for the SDK to talk to the glasses).

### Accessibility
- Glasses display readable: TODO manual at typical viewing distance.
- Phone-side a11y: TODO Lighthouse.

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

- [ ] Every `TODO:unit` cell has a vitest case
- [ ] Every `TODO:integration` cell has a jsdom test
- [ ] Every `TODO:e2e` cell has a regression.mjs check
- [ ] Phase A gate (5 hands of Hearts on real glasses) completed; PREMORTEM
      field-test log started
- [ ] No `TODO:*` cells remain — they're either tested, `manual:*` with a
      reason, or `skip:*` with a reason

This v0.1.1 build does NOT meet the acceptance gates. v0.1.2 is the
remediation target.
