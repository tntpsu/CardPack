# Card Pack

Seven classic card games for [Even Realities G2 smart glasses](https://www.evenrealities.com), wrapped in one cohesive product.

> **Status:** v0.0.1 — Phase A scaffold. Reference module (Hearts) lands next. **Not yet shippable.** See the [shared platform](https://github.com/tntpsu/even-card-platform) for the visual + interaction contract every game obeys.

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
