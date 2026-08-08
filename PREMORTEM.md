# PREMORTEM — Card Pack

Field-test log + open risks. Companion to TESTS.md. Each entry is dated;
once an entry's behavior is fixed AND covered by a test, the test reference
goes in the entry and the entry stays as a regression marker.

---

## Phase A field test — Hearts on real glasses

**2026-05-15** — first session of live Hearts play on G2 hardware.

### Feedback

1. **Cursor moves through hand row; should anchor between rows, point ▲/▼
   to row.** **Shipped in v0.1.6 (platform v0.1.1)** as `renderHand`'s
   new `multiRowCursor: 'between'` default. The cursor sits between the
   two card rows and flips ▲ (active card is in row above) or ▼ (active
   card is in row below). Horizontal position still tracks the active
   card's column so the user can scan visually. Legacy `multiRowCursor:
   'below'` retained as an opt-out for sister apps that prefer the old
   look. Output is 3 lines (row1, between-cursor, row2) instead of 3-4
   under the old layout. Affected platform tests updated.

2. **Auto-park cursor on first legal card when must-follow-suit.** When
   a trick has a lead suit and you have cards of that suit, the only
   legal plays are that suit. Make the cursor land on the first legal
   card automatically so the user doesn't have to swipe past illegals.
   Especially time-saving on every-trick-after-the-first. **Scope:
   CardPack/Hearts only. Shipped in v0.1.5 (unit:hearts:cursor-park).**

3. **Running hand-points score visible during play.** Header currently
   shows `S:0 W:0 N:0 E:0` — cumulative game score across hands. The
   user can't see who has taken what *this hand*. Promote the
   hand-points to always show. **Scope: CardPack/Hearts only.** Format
   chosen for v0.1.5: `S:N(+H)  W:N(+H)  N:N(+H)  E:N(+H)` where `N`
   is game score and `(+H)` is points taken this hand. **Parens
   intentionally match the hand-end render's `(+N)` convention** —
   single consistent format, no plus-as-math ambiguity. Briefly tried
   `S:N+H` (one fewer glyph per cell) and rejected — "+" reads as
   addition, but hand-points don't always sum into game-score (shoot
   the moon flips 26→0 for the shooter). Parens visually subordinate
   the delta to the running total. (unit:hearts:running-score-format)

4. **Double-tap to play a card.** Single tap is too easy to fire
   accidentally on real glasses. Swap: tap = no-op mid-play, double-tap
   = play the cursored card. **Scope: CardPack/Hearts only. Shipped in
   v0.1.5 (unit:hearts:double-tap-to-play, plus inverted regression for
   the old single-tap-plays behavior).**

### What hardware testing surfaced that the simulator could not

- Accidental-tap rate on real glasses is non-zero (#4). The simulator
  fires `click` actions intentionally; users tap with intent. Field-only
  signal.
- Cursor tracking on a small, monochrome display is harder than the
  jsdom-rendered test asserts (#1). Tests only check that `▲` is
  *present* — not that a user can *follow* it visually. Open problem
  for the e2e + unit layers.
- "How many points have I taken this hand" is invisible in scoreString
  during play, even though the data exists (#3). A pure UI-information
  gap, not a logic gap.

---

## Open risks (pre-Phase B)

(closed — Euchre landed in v0.2.0)

---

## Phase B integration — Euchre joins Hearts

**2026-05-15** — v0.2.0 ships with two games registered in the same pack.

### What the platform was asked to do for the first time

- Two `Game` modules registered in the Runtime constructor (`[heartsGame, euchreGame]`).
- `Launcher.render()` returns a 2-row game list.
- `renderPhoneRules()` swaps based on `runtime.currentGameId()` across two games.
- `GlassesFrame` shape ({score, body, controlHint, banner?}) had to absorb three new render modes:
  - **Bidding (order-up)**: header line + "Order up X?" + cursor toggle line + control hint.
  - **Bidding (call-trump)**: header line + "Call trump?" line + cursor over 3 suits + Pass option.
  - **Dealer discard sub-state**: hand+upcard rendering (6 cards in the row).
- **Team score format**: Hearts uses `S:N(+H)` per-player; Euchre uses `Us:N(+T)  Them:N(+T)`. Same `(+N)` parens convention preserved for consistency.
- **5-card vs 13-card hand**: Euchre fits in one row (single-row cursor below), Hearts wraps to two rows (between-rows cursor flip). Same `renderHand` API handles both via the `maxPerRow` threshold.

### What did not need to change

- Auto-park cursor on legal card — works identically for trump-aware `legalPlays`.
- Double-tap-to-play / single-tap-no-op convention — applied uniformly across Hearts + Euchre.
- Pacing engine (AI step delay + trick linger) — Euchre uses the same pattern; bid phases run at a faster `BID_STEP_MS` since there's no card-on-screen.

### Hardware gate (pending)

A round of Euchre on real glasses to confirm:
- The Order/Pass toggle is glanceable.
- The 3-suit picker with Pass cycles cleanly.
- Score format "Us:N(+T)  Them:N(+T)" fits the 576 px display in worst case.
- Bidding phases pace correctly (not too fast, not too slow).

---

## Swipe-bounce on the display — two-layer event capture

**2026-06-06** — field report: "the screen *bounces* when I scroll to move
the pointer to a different card."

### Diagnosis

Not a layout-count bug. The Hearts play frame is 9 lines × 27 px ≈ 243 px,
inside the 288 px container — the hand renderer already locks line count
across the turn cycle, so nothing pops as the cursor moves. The bounce is
**firmware overscroll rubber-band**: `even.ts` used a *single* full-screen
text container that was BOTH the event-capture layer AND the visible
content. On the G2, a swipe on a text-capture container fires as
`SCROLL_TOP`/`SCROLL_BOTTOM` (that's how we receive swipes) and the firmware
tries to scroll the content it's drawing. With content that fits, there's no
scroll range, so the gesture springs back = the visible bounce.

### Fix shipped (v0.3.3) — needs on-glasses confirmation

Split into two full-screen text containers per the glasses-ui **Image-Based
App Pattern**:
- `events` (id 2): `content: ' '`, `isEventCapture: 1`, no border/padding.
  Invisible. Catches every gesture; nothing scrollable, so any overscroll
  has nothing to render.
- `display` (id 1): `isEventCapture: 0`, holds the composed frame, updated
  via `textContainerUpgrade`. Receives no input → firmware never scrolls it
  → cannot bounce.

**Unverified assumption (device-only):** that swipes still arrive as
`SCROLL_TOP`/`SCROLL_BOTTOM` from a single-space capture layer. The launcher
already relies on direction-based swipe reporting with content that fits, so
this should hold — but confirm on hardware:
- Swipe up/down still moves the hand cursor (input not dead).
- The visible frame no longer bounces/springs on each swipe.
- Tap / double-tap still register (they route via `sysEvent`, unaffected).
- No second container pushed the page past the 8-text-container / 12-total
  limit (only 2 used — fine).

If swipes turn out NOT to fire from the empty capture layer, fall back:
either give `events` a tall (>288 px worth) invisible content so it has real
scroll range, or move to a list-container for the launcher + a paginated
page-container for play. This is the standalone-`even.ts` shared pattern, so
a confirmed fix should be mirrored into `~/Documents/Hearts/src/even.ts`
(ask first — `even.ts` is not in a formal sync set).
