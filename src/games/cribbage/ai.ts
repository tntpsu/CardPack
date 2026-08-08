// Cribbage AI. Picks the 2 cards to lay away to the crib (keep the strongest
// 4) and chooses pegging plays to maximise immediate points while avoiding
// the count positions that hand the opponent an easy 15/31.

import {
  legalPeg, pegPlayPoints, pegValue, rankIndex,
  type Card, type GameState, type Position,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

/** Quick value of a 4-card keep (no starter): fifteens + pairs + runs. */
function keepValue(cards: readonly Card[]): number {
  let pts = 0
  for (let mask = 1; mask < (1 << cards.length); mask++) {
    let sum = 0
    for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) sum += pegValue(cards[i]!.rank)
    if (sum === 15) pts += 2
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    if (cards[i]!.rank === cards[j]!.rank) pts += 2
  }
  const idxs = cards.map(c => rankIndex(c.rank)).sort((a, b) => a - b)
  let run = 1, best = 1
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] === idxs[i - 1]! + 1) { run++; best = Math.max(best, run) }
    else if (idxs[i] !== idxs[i - 1]) run = 1
  }
  if (best >= 3) pts += best
  return pts
}

function combos2(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j])
  return out
}

/** Choose 2 cards to lay away to the crib. Keeps the 4 with the highest
 *  keep-value; when the crib is the opponent's, breaks ties by laying away
 *  the lower-value cards (give the crib less). */
export function aiDiscard(hand: readonly Card[], ownCrib: boolean, difficulty: Difficulty = DEFAULT_DIFFICULTY): Card[] {
  if (difficulty === 'easy') return [hand[0]!, hand[1]!]
  let best: { lay: [number, number]; keep: number; layVal: number } | null = null
  for (const [a, b] of combos2(hand.length)) {
    const keep = hand.filter((_, i) => i !== a && i !== b)
    const kv = keepValue(keep)
    const layVal = pegValue(hand[a]!.rank) + pegValue(hand[b]!.rank)
    let better = best === null || kv > best.keep
    if (!better && best !== null && kv === best.keep) {
      // Tie on the kept hand: own crib → feed it (lay higher); opponent's
      // crib → starve it (lay lower).
      better = ownCrib ? layVal > best.layVal : layVal < best.layVal
    }
    if (better) best = { lay: [a, b], keep: kv, layVal }
  }
  return [hand[best!.lay[0]]!, hand[best!.lay[1]]!]
}

/** Choose a pegging card. Maximise immediate points; among ties avoid leaving
 *  the count at 5 or 21 (lets a 10-value card make 15/31), then deplete high. */
export function aiPeg(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): Card {
  const legal = legalPeg(state, pos)
  if (legal.length === 1) return legal[0]!
  if (difficulty === 'easy') return legal[Math.floor(Math.random() * legal.length)]!

  let best: { card: Card; pts: number; safe: boolean; val: number } | null = null
  for (const card of legal) {
    const count = state.pegCount + pegValue(card.rank)
    const pts = pegPlayPoints([...state.pegSeq, card], count)
    const safe = count !== 5 && count !== 21
    const val = pegValue(card.rank)
    const better =
      best === null ||
      pts > best.pts ||
      (pts === best.pts && safe && !best.safe) ||
      (pts === best.pts && safe === best.safe && val > best.val)
    if (better) best = { card, pts, safe, val }
  }
  return best!.card
}
