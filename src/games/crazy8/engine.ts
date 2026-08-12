// Pure Crazy Eights engine — deal, match, draw, score. No I/O.
//
// Conventions:
// - 4 players: South (you), West, North, East — each for themselves (no teams).
// - 52-card deck; 5 cards each. Remaining cards form the stock; the top card
//   is flipped to start the discard pile.
// - South is dealer; play starts to the left (West).
// - A card is legal if it matches the current suit, matches the top card's
//   rank, or is an 8 (8s are wild).
// - Playing an 8 lets you declare the next suit (`currentSuit`).
// - If you can't play, draw from the stock until you can (the stock reshuffles
//   from the discard when empty, at most MAX_RECYCLES times per hand). If
//   nothing's left to draw, you pass; four passes in a row end the hand.
// - A hand ends when someone empties their hand. Everyone else adds the point
//   value of their leftover cards to their running score.
// - Card values: 8 = 50, K/Q/J/10 = 10, A = 1, others = pip value.
// - Game ends when any player reaches targetScore (default 100). LOWEST wins.

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Phase = 'play' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }

export interface GameState {
  hands: Record<Position, Card[]>
  stock: Card[]
  /** Discard pile; the last element is the visible top card. */
  discard: Card[]
  /** Active suit to match. Equals the top card's suit unless an 8 set it. */
  currentSuit: Suit
  turn: Position
  phase: Phase
  score: Record<Position, number>
  targetScore: number
  /** Who emptied their hand this hand (set at hand-end / game-end). */
  winner: Position | null
  /** Times the discard pile has been recycled back into the stock this hand.
   *  Bounded by MAX_RECYCLES — see drawCard. */
  recycles: number
}

/** How many times a single hand may recycle the discard pile back into the
 *  stock.
 *
 *  Unbounded recycling livelocks: with the stock refilled forever, players draw
 *  one and play one indefinitely, nobody sheds a last card, and the hand never
 *  ends. It is not a hang the player can see as an error — just a hand that
 *  never finishes. Seed 84 of the self-play soak reproduced it at ~19,997 plays
 *  in a single hand, and it hit 1 of the first 200 seeds.
 *
 *  Capping recycling lets the stock genuinely run dry, at which point drawCard
 *  returns null, players pass, and the existing four-passes rule resolves the
 *  hand through endStuckHand. Normal hands end long before the stock empties
 *  even once, so this is invisible in ordinary play. */
export const MAX_RECYCLES = 1

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const POSITIONS: Position[] = ['S', 'W', 'N', 'E']
const HAND_SIZE = 5

export function newDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r })
  return deck
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export function nextPosition(p: Position): Position {
  return p === 'S' ? 'W' : p === 'W' ? 'N' : p === 'N' ? 'E' : 'S'
}

/** Point value of a card when left in hand at hand-end. */
export function cardPenalty(c: Card): number {
  if (c.rank === '8') return 50
  if (c.rank === 'A') return 1
  if (c.rank === '10' || c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 10
  return Number(c.rank)
}

export function handPenalty(hand: readonly Card[]): number {
  return hand.reduce((sum, c) => sum + cardPenalty(c), 0)
}

function dealFresh(rng: () => number): Pick<GameState, 'hands' | 'stock' | 'discard' | 'currentSuit' | 'turn'> {
  const deck = shuffle(newDeck(), rng)
  const hands: Record<Position, Card[]> = { S: [], W: [], N: [], E: [] }
  let i = 0
  for (let n = 0; n < HAND_SIZE; n++) {
    for (const p of POSITIONS) hands[p].push(deck[i++]!)
  }
  const top = deck[i++]!
  const stock = deck.slice(i)
  return {
    hands,
    stock,
    discard: [top],
    currentSuit: top.suit,
    turn: 'W', // left of dealer (South)
  }
}

export function newGame(targetScore = 100, rng: () => number = Math.random): GameState {
  return {
    ...dealFresh(rng),
    phase: 'play',
    score: { S: 0, W: 0, N: 0, E: 0 },
    targetScore,
    winner: null,
    recycles: 0,
  }
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  return {
    ...state,
    ...dealFresh(rng),
    phase: 'play',
    winner: null,
    recycles: 0,
  }
}

export function topCard(state: GameState): Card {
  return state.discard[state.discard.length - 1]!
}

export function legalPlays(state: GameState, pos: Position): Card[] {
  const top = topCard(state)
  return state.hands[pos].filter(c =>
    c.rank === '8' || c.suit === state.currentSuit || c.rank === top.rank,
  )
}

/** True if the player has at least one legal card to play right now. */
export function canPlay(state: GameState, pos: Position): boolean {
  return legalPlays(state, pos).length > 0
}

export function playCard(
  state: GameState,
  pos: Position,
  card: Card,
  declaredSuit?: Suit,
): GameState {
  if (state.phase !== 'play') throw new Error('playCard: not play phase')
  if (state.turn !== pos) throw new Error('playCard: not your turn')
  const legal = legalPlays(state, pos)
  if (!legal.some(c => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error('playCard: illegal')
  }
  if (card.rank === '8' && !declaredSuit) throw new Error('playCard: 8 needs a declared suit')

  const hand = state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank))
  const newHands = { ...state.hands, [pos]: hand }
  const discard = [...state.discard, card]
  const currentSuit: Suit = card.rank === '8' ? declaredSuit! : card.suit

  if (hand.length === 0) {
    return endHand({ ...state, hands: newHands, discard, currentSuit }, pos)
  }
  return {
    ...state,
    hands: newHands,
    discard,
    currentSuit,
    turn: nextPosition(pos),
  }
}

/** Draw one card for `pos` from the stock, reshuffling the discard (minus its
 *  top) into the stock when empty. Returns the new state and the drawn card
 *  (null when the stock is truly exhausted). Turn does NOT advance. */
export function drawCard(
  state: GameState,
  pos: Position,
  rng: () => number = Math.random,
): { state: GameState; drew: Card | null } {
  let stock = state.stock
  let discard = state.discard
  let recycles = state.recycles
  if (stock.length === 0) {
    if (discard.length <= 1) return { state, drew: null } // nothing to recycle
    if (recycles >= MAX_RECYCLES) return { state, drew: null } // see MAX_RECYCLES
    const top = discard[discard.length - 1]!
    stock = shuffle(discard.slice(0, -1), rng)
    discard = [top]
    recycles += 1
  }
  const drew = stock[stock.length - 1]!
  const newStock = stock.slice(0, -1)
  const hand = [...state.hands[pos], drew]
  return {
    state: { ...state, stock: newStock, discard, recycles, hands: { ...state.hands, [pos]: hand } },
    drew,
  }
}

/** Advance the turn without playing — used when a player is stuck and the
 *  stock is exhausted. */
export function passTurn(state: GameState, pos: Position): GameState {
  if (state.turn !== pos) throw new Error('passTurn: not your turn')
  return { ...state, turn: nextPosition(pos) }
}

function endHand(state: GameState, winner: Position): GameState {
  const score = { ...state.score }
  for (const p of POSITIONS) {
    if (p !== winner) score[p] += handPenalty(state.hands[p])
  }
  const reachedTarget = POSITIONS.some(p => score[p] >= state.targetScore)
  return {
    ...state,
    score,
    winner,
    phase: reachedTarget ? 'game-end' : 'hand-end',
  }
}

/** Resolve a deadlocked hand (everyone stuck, stock exhausted): every player
 *  banks their leftover penalty, no winner. Rare, but prevents a hang. */
export function endStuckHand(state: GameState): GameState {
  const score = { ...state.score }
  for (const p of POSITIONS) score[p] += handPenalty(state.hands[p])
  const reachedTarget = POSITIONS.some(p => score[p] >= state.targetScore)
  return {
    ...state,
    score,
    winner: null,
    phase: reachedTarget ? 'game-end' : 'hand-end',
  }
}

/** Position with the lowest cumulative score (ties broken S→W→N→E). */
export function gameWinner(state: GameState): Position {
  return POSITIONS.reduce((best, p) => (state.score[p] < state.score[best] ? p : best), 'S' as Position)
}
