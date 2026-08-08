// Gin Rummy AI. Decides draw source (stock vs discard) and which card to
// discard, and whether to knock. Greedy deadwood-minimisation — good enough
// for a casual opponent; the engine's meld solver does the heavy lifting.

import {
  deadwoodCount, deadwoodValue, topDiscard,
  type Card, type GameState, type Position,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

/** The discard from an 11-card hand that minimises resulting deadwood;
 *  ties broken by shedding the highest-value card. */
export function bestDiscard(hand: readonly Card[]): { card: Card; deadwood: number } {
  let best: { card: Card; deadwood: number } | null = null
  for (const card of hand) {
    const rest = hand.filter(c => !(c.suit === card.suit && c.rank === card.rank))
    const dw = deadwoodCount(rest)
    if (
      best === null ||
      dw < best.deadwood ||
      (dw === best.deadwood && deadwoodValue(card.rank) > deadwoodValue(best.card.rank))
    ) {
      best = { card, deadwood: dw }
    }
  }
  return best!
}

/** True if the AI should take the face-up discard rather than the stock. */
export function aiDrawFromDiscard(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): boolean {
  const top = topDiscard(state)
  if (!top) return false
  const hand = state.hands[pos]
  const current = deadwoodCount(hand)
  const withTop = bestDiscard([...hand, top]).deadwood
  if (difficulty === 'easy') return withTop < current - 2 // only obvious gains
  return withTop < current            // any improvement
}

export interface AiDiscard { card: Card; knock: boolean }

/** Choose a discard from an 11-card hand and decide whether to knock. */
export function aiDiscardChoice(hand: readonly Card[], difficulty: Difficulty = DEFAULT_DIFFICULTY): AiDiscard {
  if (difficulty === 'easy') {
    // Random discard; only knock on a near-perfect hand.
    const card = hand[Math.floor(Math.random() * hand.length)]!
    const rest = hand.filter(c => !(c.suit === card.suit && c.rank === card.rank))
    return { card, knock: deadwoodCount(rest) <= 5 }
  }
  const { card, deadwood } = bestDiscard(hand)
  // Hard waits for a stronger hand before knocking (holds for gin more often).
  const knockThreshold = difficulty === 'hard' ? 7 : 10
  return { card, knock: deadwood <= knockThreshold }
}
