// Mirror of ~/Documents/Euchre/tests/ — runs against CardPack's OWN engine
// copy (src/games/euchre/) so an edit here is caught by `npm test`, not only
// by the sibling repo. Keep in sync if the engine changes.
// Self-play smoke test: have the AI play 4 players against itself for
// many seeds. Catches engine bugs that unit tests of individual
// functions miss (illegal-play attempts, deadlocks, score-never-
// increments, hand-never-ends).

import { describe, expect, it } from 'vitest'
import { newGame, startNewHand, type GameState } from '../../src/games/euchre/engine'
import { autoplayUntilHuman } from '../../src/games/euchre/ai'

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

// Drive AI for ALL positions (not just non-human) by treating "human"
// as a position that won't be reached — pass an unused dummy position
// so autoplayUntilHuman drives every real player.
function driveAllAi(state: GameState, rng: () => number): GameState {
  let s = state
  // Cap iterations to detect stuck states
  for (let i = 0; i < 200; i++) {
    if (s.phase === 'game-end') return s
    if (s.phase === 'hand-end') {
      s = startNewHand(s, rng)
      continue
    }
    const before = JSON.stringify({ phase: s.phase, turn: s.turn, score: s.score, tricks: s.tricks })
    // 'X' is not a valid position, so autoplay drives every turn
    s = autoplayUntilHuman(s, 'X' as never)
    const after = JSON.stringify({ phase: s.phase, turn: s.turn, score: s.score, tricks: s.tricks })
    // Liveness check: state must change each iteration (else we're stuck)
    if (before === after && s.phase !== 'hand-end' && s.phase !== 'game-end') {
      throw new Error(`stuck: ${before}`)
    }
  }
  throw new Error('exceeded iteration cap (200) — game never ended')
}

describe('AI self-play across many seeds', () => {
  // Run 20 different seeded games end-to-end; each must reach game-end
  // with a valid score (one team >= 10, other team < 10) and no thrown
  // errors along the way.
  for (let seed = 1; seed <= 20; seed++) {
    it(`seed ${seed} runs to completion`, () => {
      const start = newGame(seededRng(seed))
      const final = driveAllAi(start, seededRng(seed * 7919))
      expect(final.phase).toBe('game-end')
      const winner = final.score.NS >= 10 ? 'NS' : 'EW'
      const loser = winner === 'NS' ? 'EW' : 'NS'
      expect(final.score[winner]).toBeGreaterThanOrEqual(10)
      expect(final.score[loser]).toBeLessThan(10)
    })
  }

  it('produces a winner across many trials (sanity: NS not always winning)', () => {
    let nsWins = 0
    let ewWins = 0
    for (let seed = 100; seed < 130; seed++) {
      const start = newGame(seededRng(seed))
      const final = driveAllAi(start, seededRng(seed * 13))
      if (final.score.NS >= 10) nsWins++
      else ewWins++
    }
    // With 30 trials, AI should produce a mix — exact balance depends
    // on dealer rotation + AI's bidding bias. Both teams should win
    // at least once.
    expect(nsWins).toBeGreaterThan(0)
    expect(ewWins).toBeGreaterThan(0)
  })
})
