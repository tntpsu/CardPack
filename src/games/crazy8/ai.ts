// Crazy Eights AI. Three difficulty tiers.
// Picks a card to play from the legal set; the wrapper handles drawing when
// the AI has nothing legal. When forced to an 8, declares the suit it holds
// most of (so it can keep matching).

import {
  cardPenalty, legalPlays,
  type Card, type GameState, type Position, type Suit,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

export interface AiPlay { card: Card; declaredSuit?: Suit }

/** Choose a card from the (assumed non-empty) legal set. Caller guarantees
 *  legalPlays(state, pos).length > 0. */
export function aiChooseCard(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): AiPlay {
  const legal = legalPlays(state, pos)
  if (difficulty === 'easy') {
    const card = legal[Math.floor(Math.random() * legal.length)]!
    return withSuit(state, pos, card)
  }

  // Prefer to shed a high-penalty NON-8 card; hoard 8s for when stuck.
  const nonEights = legal.filter(c => c.rank !== '8')
  if (nonEights.length > 0) {
    const card = nonEights.slice().sort((a, b) => cardPenalty(b) - cardPenalty(a))[0]!
    return { card }
  }
  // Only 8s are legal — play one and declare our strongest suit.
  const eight = legal[0]!
  return { card: eight, declaredSuit: bestSuit(state.hands[pos], eight) }
}

function withSuit(state: GameState, pos: Position, card: Card): AiPlay {
  return card.rank === '8' ? { card, declaredSuit: bestSuit(state.hands[pos], card) } : { card }
}

/** The suit the hand holds most of, ignoring the 8 being played and other 8s. */
function bestSuit(hand: readonly Card[], playing: Card): Suit {
  const counts: Record<Suit, number> = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 }
  for (const c of hand) {
    if (c === playing) continue
    if (c.suit === playing.suit && c.rank === playing.rank) continue
    if (c.rank === '8') continue
    counts[c.suit]++
  }
  return (['♠', '♥', '♦', '♣'] as Suit[]).reduce((best, s) => (counts[s] > counts[best] ? s : best), '♠')
}
