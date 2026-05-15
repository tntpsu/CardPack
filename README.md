# Card Pack

Seven classic card games for [Even Realities G2 smart glasses](https://www.evenrealities.com), wrapped in one cohesive product.

> **Status:** v0.1.7 — Hearts is playable on real glasses. Pre-Phase B (Spades / Euchre / Solitaire still to come). v0.1.7 adds row-locking during AI turns / trick linger (no more pop 3 ↔ 2 lines as cursor disappears) via platform v0.1.2, and fixes the stale `[tap] play` controlHint to read `[2x] play` matching the v0.1.5 gesture swap. All four Phase A field-test (2026-05-15) UX changes are now shipped: auto-park cursor on must-follow-suit, running hand-points in score header (`S:N(+H)` format), double-tap to play to prevent accidental plays, and **cursor anchored between rows with ▲/▼ row indicator**. See the [shared platform](https://github.com/tntpsu/even-card-platform) for the visual + interaction contract every game obeys.

## Games (v1.0 planned)

- **Hearts** — 4-player trick-avoidance
- **Spades** — 4-player trick-taking with bidding
- **Euchre** — 4-player trick-taking with bowers
- **Solitaire** — Klondike patience
- **Crazy Eights** — shedding game
- **Cribbage** — 2-player pegging
- **Gin Rummy** — 2-player sets/runs

## Sibling product

[**House Games**](https://github.com/tntpsu/HouseGames) — casino games (Blackjack, Video Poker, Three Card Poker, Roulette) using the same shared platform. Both packs feel like one product family by design — see [`even-card-platform/STYLE.md`](https://github.com/tntpsu/even-card-platform/blob/master/STYLE.md).

## Architecture

This repo holds the Card Pack `.ehpk` build (package_id `com.philtullai.cards`). The actual platform code — launcher chrome, frame composition, suit glyphs, deck primitives — lives in [`even-card-platform`](https://github.com/tntpsu/even-card-platform) and is consumed via `file:../even-card-platform`.

Each game lives in `src/games/<id>/` as a self-contained module implementing the `Game` interface from the platform.

## License

MIT.
