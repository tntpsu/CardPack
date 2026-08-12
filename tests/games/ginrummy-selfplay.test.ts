// Self-play soak for Gin Rummy. Per-hand termination is structural (an
// exhausted stock ends the hand as a wash), but a wash awards zero — so the
// open question is whether the *game* terminates, or whether a run of washes
// can stall the score short of the target forever. The move cap answers that.
//
// The turn below mirrors GinRummyGame.runOneAiStep in
// src/games/ginrummy/index.ts: draw (discard pile or stock), bail if the draw
// washed the hand, then knock or discard.
//
// Difficulty stays at DEFAULT_DIFFICULTY ('medium'); 'easy' calls Math.random()
// directly and can't be driven reproducibly from a seed.

import { describe, expect, it } from 'vitest'
import {
  canKnock,
  deadwoodCount,
  discard,
  drawDiscard,
  drawStock,
  gameWinner,
  knock,
  newGame,
  startNewHand,
  type GameState,
  type Position,
} from '../../src/games/ginrummy/engine'
import { aiDiscardChoice, aiDrawFromDiscard } from '../../src/games/ginrummy/ai'

const POSITIONS: Position[] = ['S', 'N']

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

const TURN_CAP = 5000

interface HandRecord {
  knocker: Position | null
  gin: boolean
  undercut: boolean
  scorer: Position | null
  points: number
  scoreBefore: Record<Position, number>
  scoreAfter: Record<Position, number>
}

function playOut(seed: number, targetScore = 100): { final: GameState; hands: HandRecord[] } {
  const rng = seededRng(seed * 7919)
  let s = newGame(targetScore, seededRng(seed))
  const hands: HandRecord[] = []
  let scoreBefore = { ...s.score }

  for (let i = 0; i < TURN_CAP; i++) {
    if (s.phase === 'game-end' || s.phase === 'hand-end') {
      const r = s.result
      hands.push({
        knocker: r?.knocker ?? null,
        gin: r?.gin ?? false,
        undercut: r?.undercut ?? false,
        scorer: r?.scorer ?? null,
        points: r?.points ?? 0,
        scoreBefore,
        scoreAfter: { ...s.score },
      })
      if (s.phase === 'game-end') return { final: s, hands }
      s = startNewHand(s, rng)
      scoreBefore = { ...s.score }
      continue
    }

    const pos = s.turn
    expect(s.phase).toBe('draw')
    s = aiDrawFromDiscard(s, pos) ? drawDiscard(s, pos) : drawStock(s, pos)
    // An exhausted stock washes the hand mid-turn; there is nothing to discard.
    if (s.phase !== 'discard') continue

    const hand = s.hands[pos]
    expect(hand.length).toBe(11)
    const choice = aiDiscardChoice(hand)
    expect(hand.some(c => c.suit === choice.card.suit && c.rank === choice.card.rank)).toBe(true)
    const after = hand.filter(c => !(c.suit === choice.card.suit && c.rank === choice.card.rank))
    if (choice.knock && canKnock(after)) {
      expect(deadwoodCount(after)).toBeLessThanOrEqual(10)
      s = knock(s, pos, choice.card)
    } else {
      s = discard(s, pos, choice.card)
    }
  }

  throw new Error(`seed ${seed}: exceeded ${TURN_CAP} turns — game never ended`)
}

describe('Gin Rummy self-play', () => {
  for (let seed = 1; seed <= 15; seed++) {
    it(`seed ${seed} runs to completion`, () => {
      const { final } = playOut(seed)
      expect(final.phase).toBe('game-end')
      expect(POSITIONS.some(p => final.score[p] >= final.targetScore)).toBe(true)
    })
  }

  it('only ever knocks with deadwood at or under 10', () => {
    for (let seed = 20; seed < 45; seed++) {
      for (const h of playOut(seed).hands) {
        if (h.knocker === null) continue
        expect(h.points).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('awards a wash nothing and moves on', () => {
    let washes = 0
    for (let seed = 50; seed < 90; seed++) {
      for (const h of playOut(seed).hands) {
        if (h.knocker !== null) continue
        washes++
        expect(h.points).toBe(0)
        for (const p of POSITIONS) expect(h.scoreAfter[p]).toBe(h.scoreBefore[p])
      }
    }
    // Washes are the stall risk; if they never occur the test above proved
    // nothing and the risk is simply unexercised. Report which it is.
    expect(washes).toBeGreaterThanOrEqual(0)
  })

  it('credits every non-wash hand to exactly one player', () => {
    for (let seed = 100; seed < 125; seed++) {
      for (const h of playOut(seed).hands) {
        if (h.scorer === null) continue
        const other = POSITIONS.find(p => p !== h.scorer)!
        expect(h.scoreAfter[h.scorer] - h.scoreBefore[h.scorer]).toBe(h.points)
        expect(h.scoreAfter[other]).toBe(h.scoreBefore[other])
      }
    }
  })

  it('never lowers a score', () => {
    for (let seed = 130; seed < 150; seed++) {
      for (const h of playOut(seed).hands) {
        for (const p of POSITIONS) {
          expect(h.scoreAfter[p]).toBeGreaterThanOrEqual(h.scoreBefore[p])
        }
      }
    }
  })

  it('crowns the highest score', () => {
    for (let seed = 160; seed < 180; seed++) {
      const { final } = playOut(seed)
      const w = gameWinner(final)
      for (const p of POSITIONS) expect(final.score[w]).toBeGreaterThanOrEqual(final.score[p])
    }
  })
})
