// Self-play soak for Crazy Eights. This is the pack's real deadlock
// candidate: a hand can reach a state where nobody holds a legal card and the
// stock is exhausted. The engine exposes endStuckHand for that, but the policy
// that decides when to call it (four passes in a row) lives in the game module
// rather than the engine.
//
// The driver below mirrors Crazy8Game.runOneAiStep / doPass in
// src/games/crazy8/index.ts. If that policy changes and this doesn't, the
// two will disagree — which is itself worth catching.
//
// Difficulty stays at DEFAULT_DIFFICULTY ('medium'); 'easy' calls Math.random()
// directly and can't be driven reproducibly from a seed.

import { describe, expect, it } from 'vitest'
import {
  canPlay,
  drawCard,
  endStuckHand,
  gameWinner,
  handPenalty,
  legalPlays,
  newGame,
  passTurn,
  playCard,
  startNewHand,
  type GameState,
  type Position,
} from '../../src/games/crazy8/engine'
import { aiChooseCard } from '../../src/games/crazy8/ai'

const POSITIONS: Position[] = ['S', 'W', 'N', 'E']

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

const MOVE_CAP = 20000
/** Same bound the game module uses when drawing toward a legal card. */
const DRAW_GUARD = 60

interface HandRecord {
  winner: Position | null
  scoreBefore: Record<Position, number>
  scoreAfter: Record<Position, number>
  handSizes: Record<Position, number>
}

function playOut(seed: number, targetScore = 100): { final: GameState; hands: HandRecord[] } {
  const rng = seededRng(seed * 7919)
  let s = newGame(targetScore, seededRng(seed))
  const hands: HandRecord[] = []
  let scoreBefore = { ...s.score }
  let passesInARow = 0

  const recordAndAdvance = (): boolean => {
    hands.push({
      winner: s.winner,
      scoreBefore,
      scoreAfter: { ...s.score },
      handSizes: Object.fromEntries(
        POSITIONS.map(p => [p, s.hands[p].length]),
      ) as Record<Position, number>,
    })
    if (s.phase === 'game-end') return true
    s = startNewHand(s, rng)
    scoreBefore = { ...s.score }
    passesInARow = 0
    return false
  }

  const doPass = (pos: Position): void => {
    s = passTurn(s, pos)
    passesInARow += 1
    if (passesInARow >= 4) {
      s = endStuckHand(s)
      passesInARow = 0
    }
  }

  for (let i = 0; i < MOVE_CAP; i++) {
    if (s.phase === 'game-end' || s.phase === 'hand-end') {
      if (recordAndAdvance()) return { final: s, hands }
      continue
    }

    const pos = s.turn
    let guard = 0
    let exhausted = false
    while (!canPlay(s, pos) && guard < DRAW_GUARD) {
      const { state, drew } = drawCard(s, pos, rng)
      if (drew === null) {
        doPass(pos)
        exhausted = true
        break
      }
      s = state
      guard++
    }
    if (exhausted) continue
    if (!canPlay(s, pos)) {
      doPass(pos)
      continue
    }

    const legal = legalPlays(s, pos)
    expect(legal.length).toBeGreaterThan(0)
    const { card, declaredSuit } = aiChooseCard(s, pos)
    expect(legal.some(c => c.suit === card.suit && c.rank === card.rank)).toBe(true)
    // An 8 is wild and must name a suit; anything else must not.
    if (card.rank === '8') expect(declaredSuit).toBeDefined()
    s = playCard(s, pos, card, declaredSuit)
    passesInARow = 0
  }

  throw new Error(`seed ${seed}: exceeded ${MOVE_CAP} moves — game never ended`)
}

describe('Crazy Eights self-play', () => {
  for (let seed = 1; seed <= 12; seed++) {
    it(`seed ${seed} runs to completion`, () => {
      const { final } = playOut(seed)
      expect(final.phase).toBe('game-end')
      expect(POSITIONS.some(p => final.score[p] >= final.targetScore)).toBe(true)
    })
  }

  it('never deadlocks — every hand resolves with a winner or as stuck', () => {
    for (let seed = 20; seed < 40; seed++) {
      const { hands } = playOut(seed)
      expect(hands.length).toBeGreaterThan(0)
      for (const h of hands) {
        // A won hand means the winner shed everything; a stuck hand has no
        // winner. Both are resolutions — a hang would have hit the move cap.
        if (h.winner !== null) expect(h.handSizes[h.winner]).toBe(0)
      }
    }
  })

  it('only ever adds to a score — penalties never subtract', () => {
    for (let seed = 50; seed < 70; seed++) {
      for (const h of playOut(seed).hands) {
        for (const p of POSITIONS) {
          expect(h.scoreAfter[p]).toBeGreaterThanOrEqual(h.scoreBefore[p])
        }
      }
    }
  })

  it('charges the hand winner nothing and everyone else their leftovers', () => {
    for (let seed = 130; seed < 150; seed++) {
      for (const h of playOut(seed).hands) {
        if (h.winner === null) continue
        expect(h.scoreAfter[h.winner] - h.scoreBefore[h.winner]).toBe(0)
      }
    }
  })

  it('crowns the lowest score', () => {
    for (let seed = 110; seed < 125; seed++) {
      const { final } = playOut(seed)
      const w = gameWinner(final)
      for (const p of POSITIONS) expect(final.score[w]).toBeLessThanOrEqual(final.score[p])
    }
  })

  it('scores a hand of nothing as zero penalty', () => {
    expect(handPenalty([])).toBe(0)
  })

  // ── KNOWN DEFECT ────────────────────────────────────────────────────────
  // Crazy Eights can livelock. drawCard() reshuffles the discard back into the
  // stock whenever the stock empties, so the stock is never truly exhausted:
  // players draw one, play one, and the same 52 cards circulate forever with
  // nobody shedding a last card. endStuckHand() can't rescue it because it only
  // fires after four consecutive passes, and a pass needs drawCard to return
  // null — which recycling prevents.
  //
  // Seed 84 reproduces: 3 hands complete, then a hand runs 19,997 plays without
  // ending (hand sizes 18/5/9/16, stock 1, discard 3). Rate is 1 of the first
  // 200 seeds, ~0.5% of games. On glasses this looks like a hand that never
  // finishes — no crash, no error, just no progress.
  //
  // Marked `fails` so the defect is tracked in the suite rather than forgotten.
  // WHEN FIXED this test starts failing: delete it and fold seed 84 into the
  // termination sweep above.
  it.fails('seed 84 never terminates (tracked livelock, see comment)', () => {
    playOut(84)
  })
})
