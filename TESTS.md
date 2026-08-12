# TESTS — coverage matrix

Last updated: 2026-06-10 (v0.4.0 — Bridge added; 284 unit + 72 e2e)

This is the build gate for Card Pack. Every feature gets a row, every cell
gets either a test reference, `manual:<reason>`, or `skip:<reason>`. Empty
cells block the next ship. See `~/.claude/skills/coverage-matrix/SKILL.md`
for the full discipline.

The shared platform's coverage (101 unit tests in `even-card-platform` as of
v0.2.0) is tracked in its own `TESTS.md`. Cells here that say `platform:<name>`
reference tests that already pass in that repo. Euchre engine + AI (109 + 284
+ 73 unit tests in `~/Documents/Euchre`) are tested upstream — cells that say
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
| Euchre: init renders plus-sign bid view with (D) marker + bracketed upcard (v0.3.0) | unit:euchre:init-render | n/a | n/a | n/a | n/a |
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
| Euchre: bid screens show your hand below the picker (v0.2.1) | unit:euchre:order-up-shows-hand + unit:euchre:call-trump-shows-hand | n/a | n/a | n/a | n/a |
| Euchre: play render shows D + Maker + Up context line (v0.2.1) | unit:euchre:play-context-line | n/a | n/a | n/a | n/a |
| Euchre: glasses-side suit displays route through SUIT_GLYPH (diamond → ◆) (v0.2.2) | unit:euchre:diamond-glyph | n/a | n/a | n/a | n/a |
| Euchre: plus-sign bid view marks current bidder with (▶) (v0.3.0) | unit:euchre:plus-bid-current-bidder | n/a | n/a | n/a | n/a |
| Euchre: plus-sign bid view marks passed players with (—) (v0.3.0) | unit:euchre:plus-bid-passed-marker | n/a | n/a | n/a | n/a |
| Plus-sign primitives: N + S letter-anchored at center column (v0.3.0 / platform v0.2.0) | platform:plus-bid:letter-alignment | n/a | n/a | n/a | n/a |
| Plus-sign bid: upcard bracketed `[J♥]` in W↔E row center (v0.3.0) | platform:plus-bid:upcard-rendered | n/a | n/a | n/a | n/a |
| Plus-sign bid: multi-marker stacking (me,D,▶) (v0.3.0) | platform:plus-bid:multi-marker | n/a | n/a | n/a | n/a |
| Two-game launcher: Hearts + Euchre both registered | manual:hw (launcher logic in platform; integration check on real glasses) | n/a | n/a | n/a | n/a |
| Rules pane swaps on active game change | skip:one-line-wiring (`game?.renderPhoneRules?.()` in main.ts; per-game HTML covered by unit:hearts:rules + unit:euchre:rules) | n/a | n/a | n/a | n/a |
| Spades: module metadata (id, name, glyph, category) | unit:spades:module-metadata | n/a | n/a | n/a | n/a |
| Spades: renderPhoneRules covers bid/nil/trump/broken | unit:spades:rules | n/a | n/a | n/a | n/a |
| Spades: init phase=bid, score "Us:0  Them:0" | unit:spades:init-bid-phase | n/a | n/a | n/a | n/a |
| Spades: bid view shows others' bids + hand + selector | unit:spades:bid-render | n/a | n/a | n/a | n/a |
| Spades: bid selector shows "nil (0)" at zero | unit:spades:bid-nil-label | n/a | n/a | n/a | n/a |
| Spades: swipe dials bid, clamped 0–13 | unit:spades:bid-dial-clamp | unit:spades:bid-dial-clamp (clamp branches) | n/a | n/a | n/a |
| Spades: double-tap confirms bid → phase=play | unit:spades:bid-confirm | n/a | n/a | n/a | n/a |
| Spades: AI bids run on timer until human's turn | unit:spades:ai-bids-timer | n/a | n/a | n/a | n/a |
| Spades: play view shows plus-trick + hand + tricks/bid score | unit:spades:play-render | n/a | n/a | n/a | n/a |
| Spades: double-tap on legal card plays it | unit:spades:play-legal | n/a | n/a | unit:spades:play-legal | n/a |
| Spades: double-tap on illegal (must-follow) is no-op | n/a | unit:spades:play-illegal-noop | n/a | n/a | n/a |
| Spades: single-tap mid-play is a no-op | unit:spades:single-tap-noop | n/a | n/a | n/a | n/a |
| Spades: swipe wraps the hand cursor | unit:spades:cursor-wrap | n/a | n/a | n/a | n/a |
| Spades: hand-end render + double-tap → next hand | unit:spades:hand-end | n/a | n/a | n/a | n/a |
| Spades: game-end YOU WIN / THEM WIN + double-tap exits | unit:spades:game-end-you + unit:spades:game-end-them | n/a | n/a | n/a | n/a |
| Spades: phone new-game resets to bid + score 0 | unit:spades:phone-new-game | unit:spades:phone-unknown-event | n/a | n/a | n/a |
| Spades: phone set-difficulty updates tier | unit:spades:phone-set-difficulty | n/a | n/a | n/a | n/a |
| Spades: destroy() doesn't throw + cancels timers | unit:spades:destroy | n/a | n/a | n/a | n/a |
| Spades engine: deals 13 to each seat | unit:spades:engine-deal | n/a | n/a | n/a | n/a |
| Spades engine: bid W→N→E→S then flips to play | unit:spades:engine-bid-transition | n/a | n/a | n/a | n/a |
| Spades engine: spades can't lead until broken | unit:spades:engine-spade-lock | n/a | n/a | n/a | n/a |
| Spades engine: must follow lead suit | unit:spades:engine-follow-suit | n/a | n/a | n/a | n/a |
| Spades engine: trick winner (high spade / high lead) | unit:spades:engine-winner-spade + unit:spades:engine-winner-lead | n/a | n/a | n/a | n/a |
| Spades scoring: made bid + overtricks/bags | unit:spades:engine-score-made | n/a | n/a | n/a | n/a |
| Spades scoring: successful nil (+100 over partner's made bid) | unit:spades:engine-score-nil | n/a | n/a | n/a | n/a |
| Spades scoring: missed bid (set, −10/bid) | unit:spades:engine-score-miss | n/a | n/a | n/a | n/a |
| Spades scoring: 10-bag overflow −100 penalty + carry | unit:spades:engine-score-bag-overflow | n/a | n/a | n/a | n/a |
| Spades scoring: failed nil (−100, stray trick bags partner) | unit:spades:engine-score-failed-nil | n/a | n/a | n/a | n/a |
| Crazy Eights: module metadata (id, name, glyph, category) | unit:crazy8:module-metadata | n/a | n/a | n/a | n/a |
| Crazy Eights: renderPhoneRules covers wild/draw/scoring | unit:crazy8:rules | n/a | n/a | n/a | n/a |
| Crazy Eights: init play phase, per-seat score row | unit:crazy8:init-play | n/a | n/a | n/a | n/a |
| Crazy Eights: play view shows top + active suit + stock + hand | unit:crazy8:play-render | n/a | n/a | n/a | n/a |
| Crazy Eights: double-tap on a legal card plays it | unit:crazy8:play-legal | n/a | n/a | unit:crazy8:play-legal | n/a |
| Crazy Eights: illegal card → must-draw (double-tap draws, not plays) | n/a | unit:crazy8:play-illegal-draws | n/a | n/a | n/a |
| Crazy Eights: single-tap mid-play is a no-op | unit:crazy8:single-tap-noop | n/a | n/a | n/a | n/a |
| Crazy Eights: 8 opens suit picker, commits with chosen suit | unit:crazy8:eight-suit-pick | n/a | n/a | n/a | n/a |
| Crazy Eights: no legal card → must-draw view; draw from stock | unit:crazy8:must-draw | n/a | n/a | n/a | n/a |
| Crazy Eights: stuck + empty stock → pass advances turn | n/a | unit:crazy8:pass-on-empty-stock | n/a | n/a | n/a |
| Crazy Eights: hand-end names who went out; double-tap deals | unit:crazy8:hand-end | n/a | n/a | n/a | n/a |
| Crazy Eights: game-end YOU WIN / SEAT WINS + double-tap exits | unit:crazy8:game-end-you + unit:crazy8:game-end-seat | n/a | n/a | n/a | n/a |
| Crazy Eights: phone new-game resets; set-difficulty; unknown | unit:crazy8:phone-new-game + unit:crazy8:phone-set-difficulty | unit:crazy8:phone-unknown | n/a | n/a | n/a |
| Crazy Eights: destroy() doesn't throw | unit:crazy8:destroy | n/a | n/a | n/a | n/a |
| Crazy Eights engine: deal 5 each + stock + 1 discard | unit:crazy8:engine-deal | n/a | n/a | n/a | n/a |
| Crazy Eights engine: legal = suit / rank / any-8 | unit:crazy8:engine-legal | unit:crazy8:engine-legal | n/a | n/a | n/a |
| Crazy Eights engine: 8 sets the declared suit | unit:crazy8:engine-eight-suit | n/a | n/a | n/a | n/a |
| Crazy Eights engine: drawCard pulls from stock (turn unchanged) | unit:crazy8:engine-draw | n/a | n/a | n/a | n/a |
| Crazy Eights engine: reshuffle discard into empty stock | unit:crazy8:engine-reshuffle | n/a | n/a | n/a | n/a |
| Crazy Eights engine: draw null when stock + recycle exhausted | n/a | unit:crazy8:engine-draw-null | n/a | n/a | n/a |
| Crazy Eights engine: card/hand penalty values | unit:crazy8:engine-penalty | n/a | n/a | n/a | n/a |
| Crazy Eights engine: going out ends hand + charges leftovers | unit:crazy8:engine-endhand | n/a | n/a | n/a | n/a |
| Crazy Eights engine: hand to target ends the game (lowest wins) | unit:crazy8:engine-gameend | n/a | n/a | n/a | n/a |
| **E2E per game**: launch → navigate launcher → enter → play, no crash, render survives | e2e:hearts + e2e:euchre + e2e:spades + e2e:crazy8 | n/a | n/a | e2e:* (gesture spam, all 4) | e2e:* (render survives) |
| Gin Rummy: module metadata + rules HTML | unit:gin:metadata | n/a | n/a | n/a | n/a |
| Gin Rummy: init draw phase, score "You:0  Opp:0" | unit:gin:init | n/a | n/a | n/a | n/a |
| Gin Rummy: draw view (stock/take) swipe + double-tap draws | unit:gin:draw-view | n/a | n/a | unit:gin:draw-view | n/a |
| Gin Rummy: discard view shows hand + KNOCK affordance | unit:gin:discard-view | n/a | n/a | n/a | n/a |
| Gin Rummy: discard passes to opponent; AI turn on timer | unit:gin:discard-passes-ai | n/a | n/a | n/a | n/a |
| Gin Rummy: KNOCK item ends the hand | unit:gin:knock-item | n/a | n/a | n/a | n/a |
| Gin Rummy: single-tap mid-turn no-op | unit:gin:single-tap-noop | n/a | n/a | n/a | n/a |
| Gin Rummy: hand-end render + double-tap → next hand | unit:gin:hand-end | n/a | n/a | n/a | n/a |
| Gin Rummy: game-end YOU/OPPONENT WINS + double-tap exits | unit:gin:game-end | n/a | n/a | n/a | n/a |
| Gin Rummy: phone new-game/set-difficulty/unknown | unit:gin:phone | unit:gin:phone (unknown) | n/a | n/a | n/a |
| Gin Rummy engine: meld solver (run+set, gin, ace-low, min-deadwood) | unit:gin:solver | n/a | n/a | n/a | n/a |
| Gin Rummy engine: deal/draw-stock/draw-discard/discard | unit:gin:moves | n/a | n/a | n/a | n/a |
| Gin Rummy scoring: knock diff / gin+25 / undercut+25 / wash | unit:gin:score-knock + unit:gin:score-gin + unit:gin:score-undercut + unit:gin:score-wash | n/a | n/a | n/a | n/a |
| Cribbage: module metadata + rules HTML | unit:crib:metadata | n/a | n/a | n/a | n/a |
| Cribbage: init discard phase, score "You:0  Opp:0", lay-2 prompt | unit:crib:init | n/a | n/a | n/a | n/a |
| Cribbage: pick 2 + confirm → lay away, cut, enter play | unit:crib:discard-confirm | n/a | n/a | unit:crib:discard-confirm | n/a |
| Cribbage: single-tap no-op in discard | unit:crib:single-tap-noop | n/a | n/a | n/a | n/a |
| Cribbage: show view steps on double-tap | unit:crib:show-step | n/a | n/a | n/a | n/a |
| Cribbage: hand-end → next hand swaps dealer | unit:crib:next-hand-swap | n/a | n/a | n/a | n/a |
| Cribbage: game-end banner + exit; phone events; destroy | unit:crib:game-end + unit:crib:phone | unit:crib:phone (unknown) | n/a | n/a | n/a |
| Cribbage show scorer: perfect 29 | unit:crib:show-29 | n/a | n/a | n/a | n/a |
| Cribbage show scorer: pairs / runs / double-run / fifteens | unit:crib:show-pair + unit:crib:show-run + unit:crib:show-doublerun + unit:crib:show-fifteens | n/a | n/a | n/a | n/a |
| Cribbage show scorer: flush 4/5, hand vs crib | unit:crib:show-flush4 + unit:crib:show-flush5 | n/a | n/a | n/a | n/a |
| Cribbage show scorer: nobs | unit:crib:show-nobs | n/a | n/a | n/a | n/a |
| Cribbage pegging scores: 15 / 31 / pair / trips / run / pair≠run | unit:crib:peg-* | n/a | n/a | n/a | n/a |
| Cribbage lifecycle: deal / discard→cut / advanceShow stages | unit:crib:newgame + unit:crib:cut + unit:crib:advanceshow | n/a | n/a | n/a | n/a |
| Cribbage self-play: 30 full hands terminate, sane scores, all cards pegged | unit:crib:selfplay (×30 seeds) | n/a | n/a | n/a | n/a |
| Six-game launcher: …+ Gin Rummy + Cribbage launchable | e2e:* (each navigated via focus= marker and launched) | n/a | n/a | n/a | n/a |
| Oh Hell: metadata + rules | unit:ohhell:metadata | n/a | n/a | n/a | n/a |
| Oh Hell: init bid phase, S bids first, per-seat score | unit:ohhell:init | n/a | n/a | n/a | n/a |
| Oh Hell: bid view shows trump + selector; confirm advances | unit:ohhell:bid-view | n/a | n/a | n/a | n/a |
| Oh Hell: bid picker skips dealer-hook value (human deals) | unit:ohhell:hook-picker | n/a | n/a | n/a | n/a |
| Oh Hell: AI bids on timer until human leads | unit:ohhell:ai-bids | n/a | n/a | n/a | n/a |
| Oh Hell: hand-end → next round (round++, dealer swap); game-end exits | unit:ohhell:next-round + unit:ohhell:game-end | n/a | n/a | n/a | n/a |
| Oh Hell: single-tap no-op; phone events; destroy | unit:ohhell:single-tap + unit:ohhell:phone | unit:ohhell:phone (unknown) | n/a | n/a | n/a |
| Oh Hell engine: trump beats non-trump / highest trump / highest lead | unit:ohhell:winner-trump + unit:ohhell:winner-lead | n/a | n/a | n/a | n/a |
| Oh Hell engine: must follow suit; wouldWinTrick | unit:ohhell:follow + unit:ohhell:wouldwin | n/a | n/a | n/a | n/a |
| Oh Hell engine: bid order; dealer hook forbids balancing bid | unit:ohhell:bid-order + unit:ohhell:hook | unit:ohhell:hook (throws) | n/a | n/a | n/a |
| Oh Hell scoring: exact = 10+bid, miss = 0; last round ends game | unit:ohhell:score + unit:ohhell:lastround | n/a | n/a | n/a | n/a |
| Oh Hell: end-to-end launch + play in simulator | e2e:ohhell | n/a | n/a | e2e:ohhell-spam | n/a |
| Bridge game: metadata (id/name/glyph/category) + phone rules | unit:bridge:metadata | n/a | n/a | n/a | n/a |
| Bridge auction: bid must outrank; NT tops a level; pass always legal | unit:bridge:bid-rank + unit:bridge:nt-rank + unit:bridge:pass-legal | unit:bridge:bid-rank (rejects low) | n/a | n/a | n/a |
| Bridge auction: double only vs opponent bid once; redouble only on our doubled bid; new bid clears double | unit:bridge:double-legal + unit:bridge:redouble-legal + unit:bridge:double-cleared | n/a | n/a | n/a | n/a |
| Bridge auction: 4 passes = passed out; bid + 3 passes ends; declarer = first to name strain | unit:bridge:passed-out + unit:bridge:three-pass + unit:bridge:declarer | n/a | n/a | n/a | n/a |
| Bridge auction: placeCall transitions (passed-out→hand-end; live→play, LHO leads); standingBid | unit:bridge:placecall + unit:bridge:standingbid | unit:bridge:placecall (illegal throws via engine) | n/a | n/a | n/a |
| Bridge play: must follow suit when able else free; trump/NT trick winner | unit:bridge:follow + unit:bridge:winner | n/a | n/a | n/a | n/a |
| Bridge play: dummy = declarer's partner; declarer controls both seats; opening lead reveals dummy | unit:bridge:dummy + unit:bridge:controller + unit:bridge:dummy-reveal | n/a | n/a | n/a | n/a |
| Bridge scoring: part-scores/games/vul/overtricks/slams (exact tables) | unit:bridge:score-made + unit:bridge:score-vul + unit:bridge:score-over + unit:bridge:score-slam | n/a | n/a | n/a | n/a |
| Bridge scoring: doubled making (+insult, doubled overtricks); undertrick tables (undoubled/doubled/redoubled, vul) | unit:bridge:score-doubled + unit:bridge:score-set | n/a | n/a | n/a | n/a |
| Bridge: vulnerability cycle; dealer rotation + deal#; endHand credits side + ends at target | unit:bridge:vul-cycle + unit:bridge:rotate + unit:bridge:endhand | n/a | n/a | n/a | n/a |
| Bridge AI: 40-match seeded self-play — auctions always terminate, no illegal call/play; 1NT opening | unit:bridge:selfplay + unit:bridge:open-1nt | n/a | n/a | unit:bridge:selfplay (drives every seat) | n/a |
| Bridge wrapper: auction render + call selector; double-tap makes call; play render + declarer plays dummy; hand-end/game-end double-tap | unit:bridge:wrap-auction + unit:bridge:wrap-makecall + unit:bridge:wrap-play + unit:bridge:wrap-handend + unit:bridge:wrap-gameend | unit:bridge:wrap-play (illegal-card double-tap no-ops) | n/a | n/a | n/a |
| Bridge game: end-to-end launch + auction + play in simulator | e2e:bridge | n/a | n/a | e2e:bridge-spam | n/a |
| Hearts self-play: 15 seeded games terminate; 26 points in play every hand; shot moon = 0 shooter / 26 others; scores never fall | unit:hearts:selfplay | n/a | n/a | unit:hearts:selfplay (AI drives all four seats) | n/a |
| Spades self-play: 12 seeded games terminate despite the −100 bag penalty moving scores backwards; 13 tricks per hand; bags always carry 0..9 | unit:spades:selfplay | n/a | n/a | unit:spades:selfplay (AI drives all four seats) | n/a |
| Spades AI never bids nil, so the engine's nil scoring is reachable only by a human (that path stays covered by the hand-built deals in unit:spades:nil-*) | unit:spades:selfplay:no-nil (pins current behavior) | n/a | n/a | n/a | n/a |
| Crazy Eights self-play: 12 seeded games terminate; a won hand means the winner shed everything; penalties only ever add | unit:crazy8:selfplay | n/a | n/a | unit:crazy8:selfplay (AI drives all four seats) | n/a |
| Crazy Eights livelock (FIXED): unbounded discard recycling let a hand circulate 52 cards forever — seed 84 ran 19,997 plays in one hand, 1 of the first 200 seeds. MAX_RECYCLES caps recycling so the stock genuinely empties and the existing four-passes rule ends the hand | unit:crazy8:selfplay:seed84 + unit:crazy8:selfplay:recycle-cap + unit:crazy8:selfplay:sweep200 | n/a | n/a | unit:crazy8:selfplay:sweep200 (200 seeds, none run away) | n/a |
| Gin Rummy self-play: 15 seeded games terminate; a wash scores 0 and stalls nothing; each scoring hand credits exactly one player | unit:ginrummy:selfplay | n/a | n/a | unit:ginrummy:selfplay (AI drives both seats) | n/a |
| Every game advances under its e2e gesture flow — `progress=<phase>:<turn>:c<cards>:s<score>` must move, so an input handler that silently no-ops can no longer pass on "render changed + no errors" alone | e2e:*:advanced (all 8 games) | n/a | n/a | n/a | n/a |
| Oh Hell self-play: 15 seeded games reach round 7; the dealer hook never lets bids total the trick count; exact bid pays 10+bid and nothing otherwise | unit:ohhell:selfplay | n/a | n/a | unit:ohhell:selfplay (AI drives all four seats) | n/a |
| Eight-game launcher: …+ Bridge launchable | e2e:* (each navigated via focus= marker and launched) | n/a | n/a | n/a | n/a |
| Three-game launcher: Hearts + Euchre + Spades registered | manual:hw (launcher logic in platform; integration check on real glasses) | n/a | n/a | n/a | n/a |
| Spades bid view fits 288px (header+1+3hand+selector+footer ≈ 8 lines) | manual:hw (real-glasses layout check) | n/a | n/a | n/a | n/a |

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
- [x] Secret scan: grep over `src/games/spades/` clean (no Bearer/sk-/AIza/token/secret); no `http://`, no `eval`/`Function`/`innerHTML` in the new module (rules HTML is inlined by main.ts)
- [x] No stale `.js`: `noEmit: true` set, `find src -name '*.js'` empty
- [x] Bundle size: 75 KB packed `.ehpk` (v0.3.4, +Spades), well under any hub limit
- [x] Network whitelist: no permissions in `app.json` (no fetches at all)
- [x] License/NOTICE present

### Unit (Vitest, CardPack-side) — 284 tests, 12 files
- **Bridge: 36 tests** in `tests/games/bridge.test.ts` — engine (auction
  legality/ranking/termination, declarer determination, doubled/redoubled
  tracking, trump + NT trick winners, follow-suit, dummy reveal + controller),
  the full duplicate-style **scoring tables** (made / vulnerable / overtricks /
  slams / doubled-making / undertrick penalty tables incl. redoubled), the
  vulnerability cycle + dealer rotation + endHand-credits-and-ends-at-target,
  a **40-match seeded self-play** asserting every auction terminates and the AI
  never emits an illegal call or play, plus wrapper coverage (auction render +
  call selector, double-tap makes the call, play render + declarer-plays-dummy,
  hand-end/game-end double-tap). Engine + AI are CardPack-native (not ported).
- **Engine + AI now tested IN-REPO for all four games.** Hearts
  (`hearts-engine.test.ts`, 9) and Euchre (`euchre-engine.test.ts` 31 +
  `euchre-ai.test.ts` + `euchre-selfplay.test.ts`, 49 total) are mirrors of
  the sibling-repo suites repointed at CardPack's OWN engine copies — so an
  edit to `src/games/{hearts,euchre}/engine.ts` here is caught by `npm test`,
  not only upstream (closes the v0.3.5 latent-divergence gap). Spades &
  Crazy 8s engines were already tested in-repo. Keep the mirrors in sync if
  an engine changes.
- **Spades: 31 tests** in `tests/games/spades.test.ts` — wrapper coverage
  (metadata, rules HTML, bid-phase render + dial/clamp + confirm, AI-bids-on-
  timer, play render, legal/illegal/single-tap/cursor-wrap gestures, hand-end
  + game-end banners, phone new-game/set-difficulty/unknown, destroy) PLUS
  engine sanity (deal, bid order→play, spade-lead lock, follow-suit, trick
  winner) AND the previously-uncovered **end-of-hand scoring path**: made +
  overtricks/bags, successful nil, failed nil (stray trick bags partner),
  missed bid (set), and 10-bag overflow −100 penalty + carry. The scoring
  tests play the real 13th trick through `playCard` and assert the computed
  `score`/`bags` — this is the dimension that was a hidden empty cell until
  the coverage-matrix pass that followed the v0.3.4 Spades add.
- **66 tests across 2 files** — `tests/games/hearts.test.ts` (35) and
  `tests/games/euchre.test.ts` (31). Euchre wrapper tests cover module
  metadata, init render, order-up bidding (toggle, Pass, single-tap no-op),
  call-trump render + cycle + confirm + stick-the-dealer, play-phase
  render + gestures, hand-end + game-end render, phone new-game and
  set-difficulty events, cursor parking, destroy semantics, hand
  visibility on bid screens (v0.2.1), play context line (v0.2.1),
  diamond suit glyph routing (v0.2.2), and plus-sign bid view markers
  ((▶) on current bidder, (—) on passed) (v0.3.0). Engine + AI
  correctness is covered upstream in `~/Documents/Euchre/tests/` and not
  duplicated here.
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

### End-to-end (simulator) — full per-game, 72 checks
- **`scripts/regression.mjs` runs one flow per registered game**
  (hearts, euchre, spades, crazy8, ginrummy, cribbage, ohhell, bridge) — 72 assertions, all green as of v0.4.0.
  Each flow: boot the sim, assert `view=launcher`, navigate the launcher
  cursor to that game via the `focus=<id>` state marker, tap to launch it
  (`view=<id>`), drive its core gestures (bid-dial/confirm, play, draw,
  suit-pick as applicable), then assert no console errors, glasses still
  non-blank, and the in-game render differs from the launcher. **All four
  games also run the 10-input gesture-spam stress** (stands in for the
  BLE-write-serialization × concurrent-gesture cell).
- **Self-launching:** the script spawns the NATIVE simulator binary directly
  (not the `.bin` Node wrapper, which orphans the real sim on kill) and waits
  for the automation port to free between games. There is no glasses-gesture
  path back to the launcher, so each game runs in its own fresh sim session.
  Prereq: `npm run dev` on 5180; then `npm run test:e2e`.
- State-log emission lives in `src/main.ts` (`emitState()`):
  `[cardpack:state] view=launcher focus=<cursored id>` in the launcher,
  `view=<id>` in a game. The `focus=` field is what makes launcher navigation
  deterministic in e2e.
- **Runtime finding (v0.3.5):** the e2e confirmed the v0.3.3 two-layer
  bounce fix did NOT break swipe input — the launcher cursor moves on swipe
  in the simulator. (Real-glasses confirmation of the *visual* bounce is
  still pending per PREMORTEM; the sim can't show the overscroll animation.)

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
- SDK pinned: `@evenrealities/even_hub_sdk@0.0.12` (exact — a caret on a
  `0.0.x` version pins anyway, so the range was never granting flexibility)
- iOS WKWebView vs Android: not tested
- Min app version: 2.0.0; min SDK: 0.0.10 (in app.json)

### Migration
- No prior data to migrate (new package_id `com.philtullai.cards`).
- Standalone Hearts/Spades/Euchre installs persist their own storage under
  their own package_ids; no migration needed when CardPack ships.

### Build / release verification
- [x] `.ehpk` packs successfully
- [x] Manifest version matches package.json
- [x] Bundle has no debug logs: two `console.*` calls survive into the bundle
      and both are intentional — `main.ts` emits the `[cardpack:state]` marker
      that `regression.mjs` parses, and logs a bootstrap failure. No stray logs.
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
