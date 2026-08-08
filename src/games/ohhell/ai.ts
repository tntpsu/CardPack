// Oh Hell AI. Bids expected tricks from hand strength (respecting the dealer
// hook), then plays toward hitting that exact bid — win when short, duck when
// already there.

import {
  forbiddenDealerBid, legalPlays, wouldWinTrick,
  type Card, type GameState, type Position, type Suit,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }
const rankOf = (c: Card) => RV[c.rank] ?? 0

/** Estimated tricks: trump honours + off-suit aces/kings, roughly. */
function estimateTricks(hand: readonly Card[], trump: Suit): number {
  let exp = 0
  for (const c of hand) {
    if (c.suit === trump) exp += rankOf(c) >= 12 ? 0.9 : rankOf(c) >= 9 ? 0.55 : 0.3
    else if (c.rank === 'A') exp += 0.8
    else if (c.rank === 'K') exp += 0.45
  }
  return exp
}

export function aiBid(state: GameState, pos: Position, _difficulty: Difficulty = DEFAULT_DIFFICULTY): number {
  let bid = Math.round(estimateTricks(state.hands[pos], state.trump))
  bid = Math.max(0, Math.min(state.round, bid))
  if (pos === state.dealer) {
    const forbidden = forbiddenDealerBid(state)
    if (forbidden === bid) bid = bid > 0 ? bid - 1 : Math.min(state.round, bid + 1)
  }
  return bid
}

export function aiPlay(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): Card {
  const legal = legalPlays(state, pos)
  if (legal.length === 1) return legal[0]!
  if (difficulty === 'easy') return legal[Math.floor(Math.random() * legal.length)]!

  const wantWin = state.tricksWon[pos] < (state.bids[pos] ?? 0)
  const asc = legal.slice().sort((a, b) => rankOf(a) - rankOf(b))
  const winners = legal.filter(c => wouldWinTrick(state, c)).sort((a, b) => rankOf(a) - rankOf(b))
  const leading = state.trick.plays.length === 0

  if (wantWin) {
    if (leading) return asc[asc.length - 1]! // lead high to grab a trick
    if (winners.length > 0) return winners[0]! // cheapest card that wins
    return asc[0]! // can't win — throw the lowest
  }
  // Already have the bid (or can't change it): avoid winning.
  if (leading) return asc[0]! // lead low
  const losers = legal.filter(c => !wouldWinTrick(state, c)).sort((a, b) => rankOf(a) - rankOf(b))
  if (losers.length > 0) return losers[losers.length - 1]! // highest card that still loses
  return asc[0]! // forced to win — lose the least value
}
