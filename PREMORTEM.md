# PREMORTEM — Card Pack

Field-test log + open risks. Companion to TESTS.md. Each entry is dated;
once an entry's behavior is fixed AND covered by a test, the test reference
goes in the entry and the entry stays as a regression marker.

---

## Phase A field test — Hearts on real glasses

**2026-05-15** — first session of live Hearts play on G2 hardware.

### Feedback

1. **Cursor moves through hand row; should anchor at center, point ▲/▼ to
   row.** The current 2-row hand layout puts a single `▲` glyph under
   whichever card is selected; the cursor "floats" left/right as the user
   swipes through cards. Hard to track on a small display. Proposed:
   cursor stays at a fixed horizontal position (center) and flips ▲/▼ to
   indicate which row holds the active card. Active card itself bracketed
   `[X]` or otherwise distinguished. **Scope: platform-level
   (`even-card-platform/src/hand.ts` renderHand). Affects every sister
   card game.** Deferred from v0.1.5 — needs a design pass and explicit
   opt-in vs flag-day decision for the suite.

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

(none yet beyond the four-point list above)
