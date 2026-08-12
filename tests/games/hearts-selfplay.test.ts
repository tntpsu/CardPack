// Self-play soak for Hearts: drive all four seats with the AI across many
// seeds. Hearts is the game the Phase A hardware gate exercises first, so a
// wedge here is the most expensive one to discover on-device rather than here.
//
// Follows the shape of euchre-selfplay.test.ts: autoplayUntilHuman is handed a
// position that never comes up, so it drives every seat.
//
// Difficulty stays at DEFAULT_DIFFICULTY ('medium'); 'easy' calls Math.random()
// directly and can't be driven reproducibly from a seed.

import { describe, expect, it } from 'vitest'
import {
  gameWinner,
  newGame,
  startNewHand,
  type GameState,
  type Position,
} from '../../src/games/hearts/engine'
import { autoplayUntilHuman } from '../../src/games/hearts/ai'

const POSITIONS: Position[] = ['S', 'W', 'N', 'E']
/** 13 hearts + the queen. */
const POINTS_PER_HAND = 26

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

const STEP_CAP = 2000

interface HandRecord {
  handPoints: Record<Position, number>
  scoreBefore: Record<Position, number>
  scoreAfter: Record<Position, number>
}

function playOut(seed: number, targetScore = 50): { final: GameState; hands: HandRecord[] } {
  const rng = seededRng(seed * 7919)
  let s = newGame(targetScore, seededRng(seed))
  const hands: HandRecord[] = []
  let scoreBefore = { ...s.score }

  for (let i = 0; i < STEP_CAP; i++) {
    if (s.phase === 'game-end' || s.phase === 'hand-end') {
      hands.push({
        handPoints: { ...s.handPoints },
        scoreBefore,
        scoreAfter: { ...s.score },
      })
      if (s.phase === 'game-end') return { final: s, hands }
      s = startNewHand(s, rng)
      scoreBefore = { ...s.score }
      continue
    }

    const before = JSON.stringify({ phase: s.phase, turn: s.turn, tricksPlayed: s.tricksPlayed })
    // 'X' is not a real position, so every seat is driven by the AI.
    s = autoplayUntilHuman(s, 'X' as never)
    const after = JSON.stringify({ phase: s.phase, turn: s.turn, tricksPlayed: s.tricksPlayed })
    if (before === after && s.phase === 'play') throw new Error(`seed ${seed}: stuck at ${before}`)
  }

  throw new Error(`seed ${seed}: exceeded ${STEP_CAP} steps — game never ended`)
}

describe('Hearts self-play', () => {
  for (let seed = 1; seed <= 15; seed++) {
    it(`seed ${seed} runs to completion`, () => {
      const { final } = playOut(seed)
      expect(final.phase).toBe('game-end')
      expect(POSITIONS.some(p => final.score[p] >= final.targetScore)).toBe(true)
    })
  }

  it('puts all 26 points in play every hand', () => {
    for (let seed = 20; seed < 40; seed++) {
      for (const h of playOut(seed).hands) {
        const total = POSITIONS.reduce((a, p) => a + h.handPoints[p], 0)
        expect(total).toBe(POINTS_PER_HAND)
      }
    }
  })

  it('scores a shot moon as 0 for the shooter and 26 for everyone else', () => {
    let moons = 0
    for (let seed = 50; seed < 120; seed++) {
      for (const h of playOut(seed).hands) {
        const shooter = POSITIONS.find(p => h.handPoints[p] === POINTS_PER_HAND)
        if (!shooter) continue
        moons++
        for (const p of POSITIONS) {
          const gained = h.scoreAfter[p] - h.scoreBefore[p]
          expect(gained).toBe(p === shooter ? 0 : POINTS_PER_HAND)
        }
      }
    }
    // If the AI never shoots the moon the assertions above are vacuous; say so
    // rather than reporting a pass that checked nothing.
    expect(moons).toBeGreaterThan(0)
  })

  it('never lowers a score — hearts only ever accumulate', () => {
    for (let seed = 130; seed < 150; seed++) {
      for (const h of playOut(seed).hands) {
        for (const p of POSITIONS) {
          expect(h.scoreAfter[p]).toBeGreaterThanOrEqual(h.scoreBefore[p])
        }
      }
    }
  })

  it('crowns the lowest score', () => {
    for (let seed = 160; seed < 180; seed++) {
      const { final } = playOut(seed)
      const w = gameWinner(final)
      for (const p of POSITIONS) expect(final.score[w]).toBeLessThanOrEqual(final.score[p])
    }
  })
})
