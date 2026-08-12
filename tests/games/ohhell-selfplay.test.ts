// Self-play soak for Oh Hell: drive all four seats with the AI across many
// seeds. Catches what per-function unit tests can't — a hand that wedges
// because nobody has a legal play, a dealer hook the AI can't satisfy, a
// round counter that never reaches MAX_ROUND, or scores that drift from the
// exact-bid rule.
//
// Difficulty is left at DEFAULT_DIFFICULTY ('medium'). The 'easy' path calls
// Math.random() directly, so it cannot be driven reproducibly from a seed.

import { describe, expect, it } from 'vitest'
import {
  MAX_ROUND,
  forbiddenDealerBid,
  gameWinner,
  legalPlays,
  newGame,
  placeBid,
  playCard,
  startNextHand,
  type GameState,
  type Position,
} from '../../src/games/ohhell/engine'
import { aiBid, aiPlay } from '../../src/games/ohhell/ai'

const POSITIONS: Position[] = ['S', 'W', 'N', 'E']

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

/** Rounds 1..7 cost 4 bids + 4*round plays; 140 moves total. Cap well above. */
const MOVE_CAP = 1000

interface HandRecord {
  round: number
  bids: Record<Position, number | null>
  tricksWon: Record<Position, number>
  scoreBefore: Record<Position, number>
  scoreAfter: Record<Position, number>
}

/**
 * Play one full game with the AI in every seat, asserting move-level
 * legality as it goes. Returns the final state plus a record of each hand.
 */
function playOut(seed: number): { final: GameState; hands: HandRecord[] } {
  const rng = seededRng(seed * 7919)
  let s = newGame(seededRng(seed))
  const hands: HandRecord[] = []
  let scoreBefore = { ...s.score }

  for (let i = 0; i < MOVE_CAP; i++) {
    if (s.phase === 'game-end' || s.phase === 'hand-end') {
      hands.push({
        round: s.round,
        bids: { ...s.bids },
        tricksWon: { ...s.tricksWon },
        scoreBefore,
        scoreAfter: { ...s.score },
      })
      if (s.phase === 'game-end') return { final: s, hands }
      s = startNextHand(s, rng)
      scoreBefore = { ...s.score }
      continue
    }

    const pos = s.turn
    if (s.phase === 'bid') {
      const bid = aiBid(s, pos)
      expect(Number.isInteger(bid)).toBe(true)
      expect(bid).toBeGreaterThanOrEqual(0)
      expect(bid).toBeLessThanOrEqual(s.round)
      // The hook: the dealer must never be handed a bid the engine rejects.
      if (pos === s.dealer) expect(bid).not.toBe(forbiddenDealerBid(s))
      s = placeBid(s, pos, bid)
      continue
    }

    const legal = legalPlays(s, pos)
    expect(legal.length).toBeGreaterThan(0)
    const card = aiPlay(s, pos)
    expect(legal.some(c => c.suit === card.suit && c.rank === card.rank)).toBe(true)
    s = playCard(s, pos, card)
  }

  throw new Error(`seed ${seed}: exceeded ${MOVE_CAP} moves — game never ended`)
}

describe('Oh Hell self-play', () => {
  for (let seed = 1; seed <= 15; seed++) {
    it(`seed ${seed} runs to completion`, () => {
      const { final, hands } = playOut(seed)
      expect(final.phase).toBe('game-end')
      expect(final.round).toBe(MAX_ROUND)
      // One hand per round, 1..MAX_ROUND, in order.
      expect(hands.map(h => h.round)).toEqual(
        Array.from({ length: MAX_ROUND }, (_, i) => i + 1),
      )
      expect(POSITIONS).toContain(gameWinner(final))
    })
  }

  it('never lets the bids total the trick count (the dealer hook holds)', () => {
    for (let seed = 20; seed < 50; seed++) {
      for (const h of playOut(seed).hands) {
        const total = POSITIONS.reduce((a, p) => a + (h.bids[p] ?? 0), 0)
        expect(total).not.toBe(h.round)
      }
    }
  })

  it('awards exactly 10 + bid for an exact bid and nothing otherwise', () => {
    for (let seed = 60; seed < 80; seed++) {
      for (const h of playOut(seed).hands) {
        for (const p of POSITIONS) {
          const gained = h.scoreAfter[p] - h.scoreBefore[p]
          const exact = h.tricksWon[p] === h.bids[p]
          expect(gained).toBe(exact ? 10 + (h.bids[p] ?? 0) : 0)
        }
      }
    }
  })

  it('distributes every trick in the round among the four seats', () => {
    for (let seed = 90; seed < 110; seed++) {
      for (const h of playOut(seed).hands) {
        const won = POSITIONS.reduce((a, p) => a + h.tricksWon[p], 0)
        expect(won).toBe(h.round)
      }
    }
  })

  it('does not always crown the same seat', () => {
    const winners = new Set<Position>()
    for (let seed = 200; seed < 240; seed++) winners.add(gameWinner(playOut(seed).final))
    expect(winners.size).toBeGreaterThan(1)
  })
})
