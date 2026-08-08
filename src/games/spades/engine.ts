// Pure Spades engine — bid, deal, trick, score. No I/O.
//
// Ported from the standalone ~/Documents/Spades engine (which is unit-tested
// upstream). Types are module-local but structurally identical to the
// platform Card, so the index wrapper casts to PlatformCard when calling
// renderHand / renderPlusTrick / sortBySuit.
//
// Conventions:
// - 4 players: South (you) + North (partner) vs West + East
// - Teams: NS = (S, N), EW = (W, E)
// - 52-card deck, 13 each. Spades is always trump.
// - Each player BIDS their tricks (0-13) before play. 0 = nil.
// - South is dealer; bidding starts to dealer's left (W) and South bids last.
// - Lead suit must be followed if possible.
// - Cannot lead spades until "broken" (a spade played off-suit), unless
//   spades are all you hold.
// - Trick winner: highest spade if any spade played, else highest of lead.
// - Game ends when a team reaches targetScore (default 250); high score wins.
//
// Scoring per hand (settleTeam):
//   combined positive bid made:   +10*bid + 1 per overtrick (bag)
//   combined positive bid missed: -10*bid
//   nil made (player took 0):     +100 (that player)
//   nil failed (player took ≥1):  -100
//   10 bags accumulated:          -100 (applied in endHand, bags %= 10)

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Team = 'NS' | 'EW'
export type Phase = 'bid' | 'play' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }
export interface Trick {
  plays: Array<{ pos: Position; card: Card }>
  leadSuit: Suit | null
}

export interface GameState {
  hands: Record<Position, Card[]>
  bids: Record<Position, number | null>
  /** Tricks won this hand by each player. */
  tricksWon: Record<Position, number>
  /** Whose turn (to bid or to play). */
  turn: Position
  phase: Phase
  trick: Trick
  tricksPlayed: number
  spadesBroken: boolean
  /** Cumulative game score, by team. */
  score: Record<Team, number>
  /** Cumulative bags carried, by team — reset to 0 on every 10. */
  bags: Record<Team, number>
  targetScore: number
}

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const POSITIONS: Position[] = ['S', 'W', 'N', 'E']

const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

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

export function deal(deck: Card[]): Record<Position, Card[]> {
  if (deck.length !== 52) throw new Error('deal: deck must be 52 cards')
  const hands: Record<Position, Card[]> = { S: [], W: [], N: [], E: [] }
  for (let i = 0; i < deck.length; i++) hands[POSITIONS[i % 4]!]!.push(deck[i]!)
  return hands
}

export function teamOf(pos: Position): Team {
  return pos === 'S' || pos === 'N' ? 'NS' : 'EW'
}

export function nextPosition(p: Position): Position {
  return p === 'S' ? 'W' : p === 'W' ? 'N' : p === 'N' ? 'E' : 'S'
}

export function newGame(targetScore = 250, rng: () => number = Math.random): GameState {
  const deck = shuffle(newDeck(), rng)
  return {
    hands: deal(deck),
    bids: { S: null, W: null, N: null, E: null },
    tricksWon: { S: 0, W: 0, N: 0, E: 0 },
    // South is dealer; bidding starts to the dealer's left at West.
    turn: 'W',
    phase: 'bid',
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    spadesBroken: false,
    score: { NS: 0, EW: 0 },
    bags: { NS: 0, EW: 0 },
    targetScore,
  }
}

export function placeBid(state: GameState, pos: Position, bid: number): GameState {
  if (state.phase !== 'bid') throw new Error('placeBid: not bid phase')
  if (state.turn !== pos) throw new Error('placeBid: not your turn')
  if (bid < 0 || bid > 13 || !Number.isInteger(bid)) throw new Error('placeBid: invalid')
  const bids = { ...state.bids, [pos]: bid }
  const allBid = POSITIONS.every(p => bids[p] !== null)
  return {
    ...state,
    bids,
    turn: nextPosition(pos),
    phase: allBid ? 'play' : 'bid',
  }
}

export function legalPlays(state: GameState, pos: Position): Card[] {
  const hand = state.hands[pos]
  const isLeading = state.trick.leadSuit === null

  if (isLeading) {
    // Cannot lead spades until broken, unless that's all you have.
    if (!state.spadesBroken) {
      const nonSpades = hand.filter(c => c.suit !== '♠')
      if (nonSpades.length > 0) return nonSpades
    }
    return hand
  }

  const matching = hand.filter(c => c.suit === state.trick.leadSuit)
  return matching.length > 0 ? matching : hand
}

export function trickWinner(trick: Trick): Position {
  if (trick.plays.length !== 4) throw new Error('trickWinner: incomplete')
  // Highest spade wins if any played; else highest of lead suit.
  const spades = trick.plays.filter(p => p.card.suit === '♠')
  if (spades.length > 0) {
    return spades.reduce((best, p) =>
      RANK_ORDER[p.card.rank] > RANK_ORDER[best.card.rank] ? p : best,
    ).pos
  }
  const lead = trick.leadSuit!
  const onLead = trick.plays.filter(p => p.card.suit === lead)
  return onLead.reduce((best, p) =>
    RANK_ORDER[p.card.rank] > RANK_ORDER[best.card.rank] ? p : best,
  ).pos
}

export function playCard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('playCard: not play phase')
  if (state.turn !== pos) throw new Error('playCard: not your turn')
  const legal = legalPlays(state, pos)
  if (!legal.some(c => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error('playCard: illegal')
  }
  const hand = state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank))
  const newHands = { ...state.hands, [pos]: hand }
  const plays = [...state.trick.plays, { pos, card }]
  const leadSuit = state.trick.leadSuit ?? card.suit
  const spadesBroken = state.spadesBroken || (card.suit === '♠' && state.trick.leadSuit !== '♠')

  if (plays.length < 4) {
    return { ...state, hands: newHands, trick: { plays, leadSuit }, spadesBroken, turn: nextPosition(pos) }
  }

  const completed: Trick = { plays, leadSuit }
  const winner = trickWinner(completed)
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 }
  const tricksPlayed = state.tricksPlayed + 1

  if (tricksPlayed === 13) {
    return endHand({ ...state, hands: newHands, tricksWon, spadesBroken, tricksPlayed, trick: { plays: [], leadSuit: null } })
  }
  return {
    ...state,
    hands: newHands,
    tricksWon,
    spadesBroken,
    tricksPlayed,
    trick: { plays: [], leadSuit: null },
    turn: winner,
  }
}

function endHand(state: GameState): GameState {
  const ns = settleTeam(state, 'NS')
  const ew = settleTeam(state, 'EW')
  const newScore: Record<Team, number> = {
    NS: state.score.NS + ns.score,
    EW: state.score.EW + ew.score,
  }
  const totalBagsNS = state.bags.NS + ns.bags
  const totalBagsEW = state.bags.EW + ew.bags
  // 10-bag overflow penalty: -100 per multiple of 10 reached.
  const finalScoreNS = newScore.NS - 100 * Math.floor(totalBagsNS / 10)
  const finalScoreEW = newScore.EW - 100 * Math.floor(totalBagsEW / 10)
  const newBags: Record<Team, number> = {
    NS: totalBagsNS % 10,
    EW: totalBagsEW % 10,
  }
  const score = { NS: finalScoreNS, EW: finalScoreEW }
  const reachedTarget = score.NS >= state.targetScore || score.EW >= state.targetScore
  return {
    ...state,
    score,
    bags: newBags,
    phase: reachedTarget ? 'game-end' : 'hand-end',
  }
}

function settleTeam(state: GameState, team: Team): { score: number; bags: number } {
  const teamPositions: Position[] = team === 'NS' ? ['S', 'N'] : ['W', 'E']
  let score = 0
  let bags = 0
  const partnerBids = teamPositions.map(p => ({ pos: p, bid: state.bids[p]!, tricks: state.tricksWon[p] }))
  let combinedBid = 0
  let combinedTricks = 0

  for (const pb of partnerBids) {
    if (pb.bid === 0) {
      score += pb.tricks === 0 ? 100 : -100
      combinedTricks += pb.tricks
    } else {
      combinedBid += pb.bid
      combinedTricks += pb.tricks
    }
  }

  if (combinedBid > 0) {
    if (combinedTricks >= combinedBid) {
      const overtricks = combinedTricks - combinedBid
      score += combinedBid * 10 + overtricks
      bags += overtricks
    } else {
      score += -combinedBid * 10
    }
  }
  return { score, bags }
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  const deck = shuffle(newDeck(), rng)
  return {
    ...state,
    hands: deal(deck),
    bids: { S: null, W: null, N: null, E: null },
    tricksWon: { S: 0, W: 0, N: 0, E: 0 },
    turn: 'W',
    phase: 'bid',
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    spadesBroken: false,
  }
}

export function gameWinner(state: GameState): Team {
  return state.score.NS >= state.score.EW ? 'NS' : 'EW'
}
