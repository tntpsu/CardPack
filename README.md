# Card Pack

Seven classic card games for [Even Realities G2 smart glasses](https://www.evenrealities.com), wrapped in one cohesive product.

> **Status:** v0.2.1 — Phase B field-test fixes. v0.2.1 lands four Euchre UX fixes: bid screens (order-up + call-trump) now show your hand below the picker (was missing, you couldn't tell what to bid on); play screen shows a `D:W  Maker:E  Up:J♥` context line so you know who dealt, who called trump, and what the upcard was (relevant for "did dealer pick it up"); single-row hand cursor row stays locked across cursor on/off cycles via platform v0.1.3 (was popping 1↔2 lines on Euchre, same fix shape as v0.1.7's multi-row row-lock); phone rules disclosure closed by default + `overscroll-behavior: contain` to reduce phone-side scroll artifacts during glasses gestures. Hearts unchanged. Phase B = Hearts + Euchre. See the [shared platform](https://github.com/tntpsu/even-card-platform) for the visual + interaction contract every game obeys.

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
