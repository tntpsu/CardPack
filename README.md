# Card Pack

Eight classic card games for [Even Realities G2 smart glasses](https://www.evenrealities.com), wrapped in one cohesive product.

> **Status:** v0.4.0 — Eighth game: **Bridge** — the full deal. A real auction (pass / bid 1♣–7NT / double / redouble, correct ranking, three-pass termination, proper declarer determination), then the play with a revealed **dummy**: as declarer you play both your own and your partner's hand; on defense you play your own; if you're dummy you watch. Duplicate-style per-deal scoring (trick points, part-score/game/slam bonuses, doubled/redoubled, the full undertrick tables, vulnerability cycling each deal); first side to 500 wins. The AI uses a simplified Standard American bidder (HCP + distribution — credible part-scores and games, not a tournament partner; no Stayman/transfers/Blackwood). Engine + AI from scratch. 36 new tests incl. a 40-match seeded self-play proving auctions always terminate + per-game e2e (284 unit + 72 e2e, all green). The v1.0 list is complete except **Solitaire** (parked in ROADMAP — needs platform image rendering). v0.3.9 — Seventh game: **Oh Hell** (bid the *exact* number of tricks you'll take; trump turns each round; hand size grows 1→7; dealer is "hooked" so someone always misses; exact bid = 10 + bid, else 0). Reuses the plus-trick + hand renderers + a hook-aware bid picker. 16 new tests + e2e (248 unit + 63 e2e, all green). v0.3.8 — Crazy Eights now shows each opponent's remaining card count (`Left  W:3 N:1 E:5`) so you can spot when someone's about to go out and play to disrupt. Cleaned up the phone "In the pack" list + "How to play" heading — no more letter glyphs in front of game names. v0.3.7 — Sixth game: **Cribbage** (2-player to 121: lay 2 to the crib, cut the starter, peg the play for 15s/31s/pairs/runs/go, then the show counts fifteens + pairs + runs + flush + nobs — full 29-point hand scorer). Engine + AI from scratch. 25 new tests incl. a 30-hand self-play smoke + e2e (231 unit + 54 e2e, all green). Only **Solitaire** remains from the v1.0 list (parked in ROADMAP — needs platform image rendering). v0.3.6 — Fifth game: **Gin Rummy** (2-player: draw/discard, build sets + runs, knock at ≤10 deadwood, gin/undercut scoring to 100). Engine includes a deadwood-minimising meld solver; AI from scratch. 26 new tests + e2e flow (206 unit + 45 e2e, all green). Only **Solitaire** and **Cribbage** remain from the v1.0 list (Solitaire parked in ROADMAP — it needs platform image rendering). v0.3.5 — Fourth game: **Crazy Eights** (match suit/rank, 8s are wild + pick a suit, draw when stuck; lowest score wins at 100). Plus **full per-game simulator e2e**: `scripts/regression.mjs` now launches each of the four games, navigates the launcher to it, plays its core gestures, and asserts no crash / render survives (30 checks, green). The e2e also confirmed the v0.3.3 swipe-bounce fix didn't break input. v0.3.4 — Third game: **Spades**. Full bid + play: each player bids their tricks (your bid is pre-filled with a suggestion you dial with swipes), spades are trump, the standard nil / bags / 10-bag-penalty scoring applies, first team to 250 wins. Reuses the platform's plus-sign trick + hand renderers; engine + AI ported from the standalone Spades app. 26 new tests (92 total). Glasses layout still needs a real-hardware pass (see PREMORTEM). v0.3.3 — Display no longer bounces on swipe. Input capture moved off the visible text container onto an invisible single-space event layer (glasses-ui Image-Based App Pattern), so swiping to move the card cursor no longer triggers the firmware's overscroll springback. **Needs on-glasses confirmation** (see PREMORTEM § swipe-bounce). v0.3.2 — Phone panel polish. The "How to play" section now leads with the focused game's name + suit glyph, and the "In the pack" list shows the actual games (Hearts, Euchre) with their one-line descriptions instead of internal build-phase notes. v0.3.1 — Launcher fixes. The phone-side "How to play" panel now follows the glasses launcher cursor instead of always showing Hearts, and the launcher rows stay aligned: the `▶` selection arrow no longer shifts the highlighted game's name out of column (proportional-font prefix now pixel-padded via `@evenrealities/pretext`, platform v0.2.1). v0.3.0 — Euchre bid view rewrites to a plus-sign table. The four seats sit at a table with the upcard bracketed in the middle (`[J◆]`), and per-position markers (`(D)` dealer, `(▶)` currently bidding, `(—)` passed, `(me)` you) make it obvious whose turn it is, who's dealer, and who's already out. Position letters are letter-anchored at the center column so the cross stays visually square regardless of marker width (platform v0.2.0). Order/Pass toggle and suit picker remain as a line below the plus-sign. Hearts unchanged (play view already used the plus-sign trick layout). See the [shared platform](https://github.com/tntpsu/even-card-platform) for the visual + interaction contract every game obeys.

## Games (v1.0 planned)

- **Hearts** — 4-player trick-avoidance
- **Spades** — 4-player trick-taking with bidding
- **Euchre** — 4-player trick-taking with bowers
- **Bridge** — 4-player auction + contract play with a dummy
- **Solitaire** — Klondike patience
- **Crazy Eights** — shedding game
- **Cribbage** — 2-player pegging
- **Gin Rummy** — 2-player sets/runs
- **Oh Hell** — exact-bid trick-taking

## Sibling product

[**House Games**](https://github.com/tntpsu/HouseGames) — casino games (Blackjack, Video Poker, Three Card Poker, Roulette) using the same shared platform. Both packs feel like one product family by design — see [`even-card-platform/STYLE.md`](https://github.com/tntpsu/even-card-platform/blob/master/STYLE.md).

## Architecture

This repo holds the Card Pack `.ehpk` build (package_id `com.philtullai.cards`). The actual platform code — launcher chrome, frame composition, suit glyphs, deck primitives — lives in [`even-card-platform`](https://github.com/tntpsu/even-card-platform) and is consumed via `file:../even-card-platform`.

Each game lives in `src/games/<id>/` as a self-contained module implementing the `Game` interface from the platform.

## License

MIT.
