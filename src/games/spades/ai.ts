// Spades AI. Three difficulty tiers.
// Ported from the standalone ~/Documents/Spades AI (unit-tested upstream).
// Bid heuristic: expected tricks from high spades + side aces + short suits.

import {
  legalPlays,
  type Card,
  type GameState,
  type Position,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
}
const rankOf = (c: Card) => RANK_VAL[c.rank] ?? 0

export function aiBid(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): number {
  const hand = state.hands[pos]
  const spades = hand.filter(c => c.suit === '♠')
  const sideSuits = (['♥', '♦', '♣'] as const).map(s => hand.filter(c => c.suit === s))
  const aces = hand.filter(c => c.rank === 'A' && c.suit !== '♠').length

  let score = 0
  for (const sp of spades) {
    const r = rankOf(sp)
    if (r === 14) score += 1
    else if (r >= 11) score += 0.7
    else if (r >= 8) score += 0.3
  }
  score += aces * 0.85
  for (const s of sideSuits) {
    if (s.length === 0) score += 0.5
    if (s.length === 1) score += 0.3
  }
  const bid = Math.max(1, Math.round(score))
  if (difficulty === 'easy') return Math.max(1, bid - 1) // under-bid
  return bid // medium + hard bid honestly
}

export function aiPlay(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): Card {
  const legal = legalPlays(state, pos)
  if (legal.length === 1) return legal[0]!
  if (difficulty === 'easy') return legal[Math.floor(Math.random() * legal.length)]!

  const trick = state.trick
  const lead = trick.leadSuit
  const isLeading = lead === null

  if (isLeading) {
    // Lead a non-spade ace if available, else lowest non-spade, else lowest spade.
    const aces = legal.filter(c => c.rank === 'A' && c.suit !== '♠')
    if (aces.length > 0) return aces[0]!
    const nonSp = legal.filter(c => c.suit !== '♠')
    if (nonSp.length > 0) {
      return nonSp.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
    }
    return legal.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
  }

  const matching = legal.filter(c => c.suit === lead)
  const spadesOnTrick = trick.plays.filter(p => p.card.suit === '♠')
  const bestRankOnLead = trick.plays
    .filter(p => p.card.suit === lead)
    .reduce((m, p) => Math.max(m, rankOf(p.card)), 0)
  const bestSpadeRank = spadesOnTrick.reduce((m, p) => Math.max(m, rankOf(p.card)), 0)

  if (matching.length > 0) {
    if (spadesOnTrick.length > 0) {
      // A spade is already on; our lead-suit card can't beat it — dump weakest.
      return matching.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
    }
    // Play minimum winner; else dump weakest.
    const winners = matching.filter(c => rankOf(c) > bestRankOnLead)
    if (winners.length > 0) {
      return winners.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
    }
    return matching.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
  }

  // Off-suit. Can we trump with a spade?
  const spadesInHand = legal.filter(c => c.suit === '♠')
  if (spadesInHand.length > 0) {
    const winners = spadesInHand.filter(c => rankOf(c) > bestSpadeRank)
    if (winners.length > 0) {
      return winners.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
    }
    const nonSp = legal.filter(c => c.suit !== '♠')
    if (nonSp.length > 0) {
      return nonSp.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
    }
    return spadesInHand.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
  }
  // Pure dump.
  return legal.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!
}
