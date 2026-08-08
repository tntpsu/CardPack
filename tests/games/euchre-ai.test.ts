// Mirror of ~/Documents/Euchre/tests/ — runs against CardPack's OWN engine
// copy (src/games/euchre/) so an edit here is caught by `npm test`, not only
// by the sibling repo. Keep in sync if the engine changes.
// Tests for difficulty-aware AI behavior. The pure engine has its own
// suite (engine.test.ts); this one covers the bidding/play strategy
// branches added in v0.2.0.

import { describe, expect, it } from 'vitest'
import { aiBidRound1, aiPlay } from '../../src/games/euchre/ai'
import type { Card, GameState } from '../../src/games/euchre/engine'

function makeState(overrides: Partial<GameState> = {}): GameState {
  // Minimal play-phase fixture. Tests will set hand + trump + plays.
  return {
    hands: { S: [], W: [], N: [], E: [] },
    dealer: 'S',
    upCard: { suit: '♥', rank: '9' },
    trump: '♥',
    maker: 'S',
    turn: 'S',
    phase: 'play',
    trick: { plays: [], leadSuit: null },
    tricks: { NS: 0, EW: 0 },
    score: { NS: 0, EW: 0 },
    passes: 0,
    bidRound: 1,
    forbiddenTrumpRound2: null,
    ...overrides,
  }
}

describe('aiBidRound1 — Easy is more passive than Medium', () => {
  it('Medium orders on 3 effective trumps; Easy passes (needs 4)', () => {
    // East is bidding (not dealer / not partner-of-dealer) so no upcard
    // bonus — pure trump count rules apply.
    const state = makeState({
      dealer: 'S',
      upCard: { suit: '♠', rank: '10' },
      hands: {
        S: [],
        W: [],
        N: [],
        E: [
          { suit: '♠', rank: 'A' },
          { suit: '♠', rank: 'K' },
          { suit: '♠', rank: 'Q' },
          { suit: '♥', rank: '9' },
          { suit: '♣', rank: '9' },
        ],
      },
    })
    const med = aiBidRound1(state, 'E', 'medium')
    const easy = aiBidRound1(state, 'E', 'easy')
    expect(med.action).toBe('order')
    expect(easy.action).toBe('pass')
  })

  it('Both order on 4 trumps', () => {
    const state = makeState({
      dealer: 'S',
      upCard: { suit: '♠', rank: '10' },
      hands: {
        S: [],
        W: [],
        N: [],
        E: [
          { suit: '♠', rank: 'A' },
          { suit: '♠', rank: 'K' },
          { suit: '♠', rank: 'Q' },
          { suit: '♠', rank: 'J' },
          { suit: '♥', rank: '9' },
        ],
      },
    })
    expect(aiBidRound1(state, 'E', 'easy').action).toBe('order')
    expect(aiBidRound1(state, 'E', 'medium').action).toBe('order')
    expect(aiBidRound1(state, 'E', 'hard').action).toBe('order')
  })
})

describe('aiPlay — Hard refuses to overtake winning partner', () => {
  it('partner is winning + we have a winner: Medium overtakes, Hard dumps low', () => {
    // Trump = Hearts. N (partner of S) led the AH (winning so far).
    // E played 9H (loses). It is now S's turn. S holds JH (right bower,
    // would win) and 9C (loser). Medium should play JH (min winner).
    // Hard should dump 9C since N is currently winning.
    const partnerWinningPlays = [
      { pos: 'N' as const, card: { suit: '♥' as const, rank: 'A' as const } },
      { pos: 'E' as const, card: { suit: '♥' as const, rank: '9' as const } },
    ]
    const baseState = makeState({
      trump: '♥',
      turn: 'S',
      trick: { plays: partnerWinningPlays, leadSuit: '♥' },
      hands: {
        S: [
          { suit: '♥', rank: 'J' }, // right bower — would win
          { suit: '♥', rank: '10' }, // also winning
        ],
        W: [],
        N: [],
        E: [],
      },
    })
    const med = aiPlay(baseState, 'S', 'medium')
    const hard = aiPlay(baseState, 'S', 'hard')
    // Medium: plays the JH (min winner) — overtakes partner.
    expect(med).toEqual({ suit: '♥', rank: 'J' })
    // Hard: dumps the 10H (weakest legal) — leaves partner's AH on top.
    expect(hard).toEqual({ suit: '♥', rank: '10' })
  })
})
