// Pure Oh Hell (Oh Heck) engine — bid exact, trump per round, score. No I/O.
//
// Conventions:
// - 4 players: South (you), West, North, East. Each for themselves (no teams).
// - Rounds ascend in hand size 1,2,…,MAX_ROUND (7). Dealer rotates each round.
// - After dealing, the next card is turned; its suit is trump for the round.
// - Bidding starts left of the dealer; the dealer bids LAST and is "hooked":
//   the bids may not total the number of tricks (someone must fail).
// - Play: follow the lead suit if able; trump beats non-trump; highest wins.
// - Scoring: make your EXACT bid → 10 + bid; miss by any amount → 0.
// - After the last round, highest cumulative score wins.

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Phase = 'bid' | 'play' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }
export interface Trick { plays: Array<{ pos: Position; card: Card }>; leadSuit: Suit | null }

export interface GameState {
  hands: Record<Position, Card[]>
  bids: Record<Position, number | null>
  tricksWon: Record<Position, number>
  trump: Suit
  trumpCard: Card
  dealer: Position
  round: number          // 1-based; hand size == round
  turn: Position
  phase: Phase
  trick: Trick
  tricksPlayed: number
  score: Record<Position, number>
}

export const MAX_ROUND = 7
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const POSITIONS: Position[] = ['S', 'W', 'N', 'E']
const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

export function newDeck(): Card[] {
  const d: Card[] = []
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r })
  return d
}
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
  return a
}
export function nextPosition(p: Position): Position {
  return p === 'S' ? 'W' : p === 'W' ? 'N' : p === 'N' ? 'E' : 'S'
}
/** Bidding/seat order starting left of the dealer, dealer last. */
export function orderFrom(dealer: Position): Position[] {
  const out: Position[] = []
  let p = nextPosition(dealer)
  for (let i = 0; i < 4; i++) { out.push(p); p = nextPosition(p) }
  return out // [left-of-dealer, …, dealer]
}

function dealRound(dealer: Position, round: number, rng: () => number): Pick<GameState, 'hands' | 'trump' | 'trumpCard' | 'bids' | 'tricksWon' | 'trick' | 'tricksPlayed' | 'turn'> {
  const deck = shuffle(newDeck(), rng)
  const hands: Record<Position, Card[]> = { S: [], W: [], N: [], E: [] }
  let i = 0
  for (let n = 0; n < round; n++) for (const p of POSITIONS) hands[p].push(deck[i++]!)
  const trumpCard = deck[i]!
  return {
    hands,
    trump: trumpCard.suit,
    trumpCard,
    bids: { S: null, W: null, N: null, E: null },
    tricksWon: { S: 0, W: 0, N: 0, E: 0 },
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    turn: nextPosition(dealer), // left of dealer bids first
  }
}

export function newGame(rng: () => number = Math.random, dealer: Position = 'E'): GameState {
  return {
    ...dealRound(dealer, 1, rng),
    dealer,
    round: 1,
    phase: 'bid',
    score: { S: 0, W: 0, N: 0, E: 0 },
  }
}

/** The bid the dealer is forbidden from making (would make bids total tricks),
 *  or null if the other three haven't all bid yet / no constraint. */
export function forbiddenDealerBid(state: GameState): number | null {
  const others = POSITIONS.filter(p => p !== state.dealer)
  if (others.some(p => state.bids[p] === null)) return null
  const sum = others.reduce((a, p) => a + (state.bids[p] ?? 0), 0)
  const f = state.round - sum
  return f >= 0 && f <= state.round ? f : null
}

export function placeBid(state: GameState, pos: Position, bid: number): GameState {
  if (state.phase !== 'bid') throw new Error('placeBid: not bid phase')
  if (state.turn !== pos) throw new Error('placeBid: not your turn')
  if (bid < 0 || bid > state.round || !Number.isInteger(bid)) throw new Error('placeBid: out of range')
  if (pos === state.dealer && forbiddenDealerBid(state) === bid) throw new Error('placeBid: dealer hook')
  const bids = { ...state.bids, [pos]: bid }
  const allBid = POSITIONS.every(p => bids[p] !== null)
  return {
    ...state,
    bids,
    turn: allBid ? nextPosition(state.dealer) : nextPosition(pos), // leader = left of dealer
    phase: allBid ? 'play' : 'bid',
  }
}

export function legalPlays(state: GameState, pos: Position): Card[] {
  const hand = state.hands[pos]
  if (state.trick.leadSuit === null) return hand
  const follow = hand.filter(c => c.suit === state.trick.leadSuit)
  return follow.length > 0 ? follow : hand
}

/** Card strength within a trick: trump beats lead beats off-suit; rank breaks ties. */
function strength(card: Card, trump: Suit, lead: Suit): number {
  const base = card.suit === trump ? 200 : card.suit === lead ? 100 : 0
  return base + RANK_VALUE[card.rank]
}

/** Would `card`, played now by the current player, take the trick so far? */
export function wouldWinTrick(state: GameState, card: Card): boolean {
  const lead = state.trick.leadSuit ?? card.suit
  const cand = strength(card, state.trump, lead)
  return state.trick.plays.every(p => strength(p.card, state.trump, lead) < cand)
}

export function trickWinner(trick: Trick, trump: Suit): Position {
  if (trick.plays.length === 0) throw new Error('trickWinner: empty')
  const lead = trick.leadSuit!
  return trick.plays.reduce((best, p) =>
    strength(p.card, trump, lead) > strength(best.card, trump, lead) ? p : best,
  ).pos
}

export function playCard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('playCard: not play phase')
  if (state.turn !== pos) throw new Error('playCard: not your turn')
  if (!legalPlays(state, pos).some(c => c.suit === card.suit && c.rank === card.rank)) throw new Error('playCard: illegal')

  const hand = state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank))
  const plays = [...state.trick.plays, { pos, card }]
  const leadSuit = state.trick.leadSuit ?? card.suit
  const base: GameState = { ...state, hands: { ...state.hands, [pos]: hand } }

  if (plays.length < 4) {
    return { ...base, trick: { plays, leadSuit }, turn: nextPosition(pos) }
  }
  const completed: Trick = { plays, leadSuit }
  const winner = trickWinner(completed, state.trump)
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 }
  const tricksPlayed = state.tricksPlayed + 1
  if (tricksPlayed === state.round) {
    return endHand({ ...base, tricksWon, tricksPlayed, trick: { plays: [], leadSuit: null } })
  }
  return { ...base, tricksWon, tricksPlayed, trick: { plays: [], leadSuit: null }, turn: winner }
}

function endHand(state: GameState): GameState {
  const score = { ...state.score }
  for (const p of POSITIONS) {
    if (state.tricksWon[p] === state.bids[p]) score[p] += 10 + (state.bids[p] ?? 0)
  }
  const lastRound = state.round >= MAX_ROUND
  return { ...state, score, phase: lastRound ? 'game-end' : 'hand-end' }
}

export function startNextHand(state: GameState, rng: () => number = Math.random): GameState {
  const dealer = nextPosition(state.dealer)
  const round = state.round + 1
  return { ...state, ...dealRound(dealer, round, rng), dealer, round, phase: 'bid' }
}

export function gameWinner(state: GameState): Position {
  return POSITIONS.reduce((best, p) => (state.score[p] > state.score[best] ? p : best), 'S' as Position)
}
