// Pure Hearts game engine — deck, deal, trick, points, score. No I/O.
//
// Conventions:
// - 4 players at compass positions: South (you), West, North, East
// - 52-card deck (2..A in 4 suits), 13 cards each
// - No trump
// - 2 of clubs leads the first trick of the hand
// - Must follow lead suit if possible
// - Hearts cannot be led until "broken" (someone played a heart on a
//   non-heart-led trick, or has only hearts left)
// - On the very first trick, no points may be played (no hearts, no QS),
//   except: if you only have point cards, you may play one (engine
//   handles the "must follow if possible" — so this only triggers if
//   you literally have no clubs and no off-points)
// - Each Heart = 1 point; Queen of Spades = 13 points
// - Shoot the moon: a player taking ALL 26 points → that player gets 0,
//   every other player gets 26
// - Game ends when any player reaches the target score; lowest wins
//
// v0.1 simplification: no card-passing phase. Each hand is dealt fresh.

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Phase = 'play' | 'hand-end' | 'game-end'

export interface Card {
  suit: Suit
  rank: Rank
}

export interface Trick {
  plays: Array<{ pos: Position; card: Card }>
  leadSuit: Suit | null
}

export interface GameState {
  hands: Record<Position, Card[]>
  /** Whose turn it is now. */
  turn: Position
  phase: Phase
  trick: Trick
  /** Tricks-completed-so-far this hand (for "first trick" rule). */
  tricksPlayed: number
  /** Hearts have been broken this hand. Resets each hand. */
  heartsBroken: boolean
  /** Points taken this hand, per player (resets each hand). */
  handPoints: Record<Position, number>
  /** Cumulative game score, per player. Game ends when any hits target. */
  score: Record<Position, number>
  /** Who plays first card of next hand — 2♣ holder. */
  // Tracked implicitly via `turn` at hand-start.
  /** Score that ends the game. Lowest cumulative score wins. */
  targetScore: number
}

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const POSITIONS: Position[] = ['S', 'W', 'N', 'E']

export const QUEEN_OF_SPADES: Card = { suit: '♠', rank: 'Q' }
export const TWO_OF_CLUBS: Card = { suit: '♣', rank: '2' }

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
  for (let i = 0; i < deck.length; i++) {
    hands[POSITIONS[i % 4]!]!.push(deck[i]!)
  }
  return hands
}

export function nextPosition(p: Position): Position {
  // Clockwise: S → W → N → E → S
  return p === 'S' ? 'W' : p === 'W' ? 'N' : p === 'N' ? 'E' : 'S'
}

function findHolderOf2C(hands: Record<Position, Card[]>): Position {
  for (const p of POSITIONS) {
    if (hands[p].some(c => c.suit === TWO_OF_CLUBS.suit && c.rank === TWO_OF_CLUBS.rank)) return p
  }
  throw new Error('2 of clubs missing from deal')
}

export function newGame(targetScore = 50, rng: () => number = Math.random): GameState {
  const deck = shuffle(newDeck(), rng)
  const hands = deal(deck)
  const starter = findHolderOf2C(hands)
  return {
    hands,
    turn: starter,
    phase: 'play',
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    heartsBroken: false,
    handPoints: { S: 0, W: 0, N: 0, E: 0 },
    score: { S: 0, W: 0, N: 0, E: 0 },
    targetScore,
  }
}

/** Compute legal plays for `pos` given the current trick. Caller is
 *  responsible for ensuring it is `pos`'s turn. */
export function legalPlays(state: GameState, pos: Position): Card[] {
  const hand = state.hands[pos]
  const isFirstTrickOfHand = state.tricksPlayed === 0 && state.trick.plays.length === 0
  const isLeading = state.trick.leadSuit === null

  if (isLeading) {
    // First card of the very first trick of the hand: must lead 2♣.
    if (state.tricksPlayed === 0) {
      const twoOfClubs = hand.find(c => c.suit === '♣' && c.rank === '2')
      if (twoOfClubs) return [twoOfClubs]
    }
    // Hearts can't be led until broken UNLESS player has only hearts.
    if (!state.heartsBroken) {
      const nonHearts = hand.filter(c => c.suit !== '♥')
      if (nonHearts.length > 0) return nonHearts
    }
    return hand
  }

  // Following: must match lead suit if able.
  const leadSuit = state.trick.leadSuit!
  const matching = hand.filter(c => c.suit === leadSuit)
  if (matching.length > 0) {
    if (isFirstTrickOfHand) {
      // First trick: no points (hearts or QS) unless that's literally all.
      const safe = matching.filter(c => !isPointCard(c))
      if (safe.length > 0) return safe
    }
    return matching
  }

  // Off-suit dump.
  if (isFirstTrickOfHand) {
    // No point cards on first trick if you can avoid it.
    const safe = hand.filter(c => !isPointCard(c))
    if (safe.length > 0) return safe
  }
  return hand
}

export function isPointCard(c: Card): boolean {
  return c.suit === '♥' || (c.suit === '♠' && c.rank === 'Q')
}

export function pointsOf(c: Card): number {
  if (c.suit === '♥') return 1
  if (c.suit === '♠' && c.rank === 'Q') return 13
  return 0
}

const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

/** Winner of a complete trick (4 plays). */
export function trickWinner(trick: Trick): Position {
  if (trick.plays.length !== 4) throw new Error('trickWinner: trick incomplete')
  const lead = trick.leadSuit!
  let bestPos = trick.plays[0]!.pos
  let bestRank = -1
  for (const p of trick.plays) {
    if (p.card.suit !== lead) continue
    if (RANK_ORDER[p.card.rank] > bestRank) {
      bestRank = RANK_ORDER[p.card.rank]
      bestPos = p.pos
    }
  }
  return bestPos
}

export function playCard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('playCard: phase != play')
  if (state.turn !== pos) throw new Error('playCard: not your turn')
  const legal = legalPlays(state, pos)
  if (!legal.some(c => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error('playCard: illegal')
  }

  const hand = state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank))
  const newHands = { ...state.hands, [pos]: hand }
  const plays = [...state.trick.plays, { pos, card }]
  const leadSuit = state.trick.leadSuit ?? card.suit
  const heartsBroken = state.heartsBroken || card.suit === '♥'

  if (plays.length < 4) {
    return {
      ...state,
      hands: newHands,
      trick: { plays, leadSuit },
      heartsBroken,
      turn: nextPosition(pos),
    }
  }

  // Trick complete: tally points, set next leader.
  const completedTrick: Trick = { plays, leadSuit }
  const winner = trickWinner(completedTrick)
  const trickPoints = plays.reduce((sum, p) => sum + pointsOf(p.card), 0)
  const handPoints = { ...state.handPoints, [winner]: state.handPoints[winner] + trickPoints }
  const tricksPlayed = state.tricksPlayed + 1

  if (tricksPlayed === 13) {
    // Hand over — apply shoot-the-moon, update game score.
    return endHand({ ...state, hands: newHands, handPoints, heartsBroken, tricksPlayed, trick: { plays: [], leadSuit: null } })
  }

  return {
    ...state,
    hands: newHands,
    handPoints,
    heartsBroken,
    tricksPlayed,
    trick: { plays: [], leadSuit: null },
    turn: winner,
  }
}

function endHand(state: GameState): GameState {
  // Shoot the moon: if any single player took all 26 points, they get 0
  // and every other player gets 26.
  const moonShooter = POSITIONS.find(p => state.handPoints[p] === 26)
  let scoreDelta: Record<Position, number>
  if (moonShooter) {
    scoreDelta = { S: 26, W: 26, N: 26, E: 26 }
    scoreDelta[moonShooter] = 0
  } else {
    scoreDelta = state.handPoints
  }
  const score: Record<Position, number> = {
    S: state.score.S + scoreDelta.S,
    W: state.score.W + scoreDelta.W,
    N: state.score.N + scoreDelta.N,
    E: state.score.E + scoreDelta.E,
  }
  const reachedTarget = POSITIONS.some(p => score[p] >= state.targetScore)
  return {
    ...state,
    score,
    phase: reachedTarget ? 'game-end' : 'hand-end',
  }
}

/** Deal a fresh hand. Score persists; handPoints / heartsBroken / etc reset. */
export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  const deck = shuffle(newDeck(), rng)
  const hands = deal(deck)
  const starter = findHolderOf2C(hands)
  return {
    ...state,
    hands,
    turn: starter,
    phase: 'play',
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    heartsBroken: false,
    handPoints: { S: 0, W: 0, N: 0, E: 0 },
  }
}

/** Lowest score wins — return the winner at game-end. */
export function gameWinner(state: GameState): Position {
  let best: Position = 'S'
  for (const p of POSITIONS) {
    if (state.score[p] < state.score[best]) best = p
  }
  return best
}
