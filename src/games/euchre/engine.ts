// Pure Euchre game engine — deck, deal, trump, trick, score. No I/O,
// no rendering. Side-effect-free state transitions for easy testing.
//
// Conventions:
// - 4 players at compass positions: South (you), West, North (partner), East
// - Teams: NS = (S, N), EW = (W, E)
// - Dealer rotates clockwise: S → W → N → E → S
// - 24-card deck: 9, 10, J, Q, K, A in 4 suits
// - Bowers: Right Bower = J of trump suit (highest trump);
//   Left Bower = J of same color as trump (next-highest trump)
// - First team to 10 points wins
// - This v0.1 engine omits going-alone (deferred)

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Team = 'NS' | 'EW'
export type Phase = 'order-up' | 'call-trump' | 'play' | 'hand-end' | 'game-end'

export interface Card {
  suit: Suit
  rank: Rank
}

export interface Trick {
  /** Cards in play order; player[0] is the lead position. */
  plays: Array<{ pos: Position; card: Card }>
  /** Lead suit — set after the first play. null at trick start. */
  leadSuit: Suit | null
}

export interface GameState {
  /** Players' hands at compass positions. Each starts with 5 cards. */
  hands: Record<Position, Card[]>
  /** Dealer for this hand. Bidding starts to dealer's left. */
  dealer: Position
  /** The card flipped up at deal time (for the order-up bid). */
  upCard: Card
  /** Trump suit (set after bidding completes). */
  trump: Suit | null
  /** Player who made trump (so we can score them as makers). */
  maker: Position | null
  /** Whose turn it is right now. */
  turn: Position
  /** Current phase. */
  phase: Phase
  /** Current trick in progress (resets after 4 plays). */
  trick: Trick
  /** Tricks won this hand, by team. Resets at hand-end. */
  tricks: Record<Team, number>
  /** Game score. Resets at game-end. */
  score: Record<Team, number>
  /** Number of bidding passes so far in the current bid round. */
  passes: number
  /** Bid round 1 = order-up of upcard suit; round 2 = call any other suit. */
  bidRound: 1 | 2
  /** Suits forbidden as call-trump (round 2 can't call the upcard's suit). */
  forbiddenTrumpRound2: Suit | null
}

// ─── Card helpers ────────────────────────────────────────────────────

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RANKS: Rank[] = ['9', '10', 'J', 'Q', 'K', 'A']
const RANK_VALUE: Record<Rank, number> = { '9': 0, '10': 1, J: 2, Q: 3, K: 4, A: 5 }

export function cardId(c: Card): string {
  return `${c.rank}${c.suit}`
}

export function colorOf(suit: Suit): 'red' | 'black' {
  return suit === '♥' || suit === '♦' ? 'red' : 'black'
}

/** Same color = the partner suit for left-bower purposes. */
export function sameColorSuit(suit: Suit): Suit {
  switch (suit) {
    case '♠': return '♣'
    case '♣': return '♠'
    case '♥': return '♦'
    case '♦': return '♥'
  }
}

/** Effective suit for trick-taking: a Jack of the same color as trump
 *  is treated as a trump card (the Left Bower). */
export function effectiveSuit(card: Card, trump: Suit): Suit {
  if (card.rank === 'J' && card.suit === sameColorSuit(trump)) return trump
  return card.suit
}

/** Strength in the current trump context. Higher = stronger.
 *  Trump cards beat non-trump; bowers beat other trumps; lead suit
 *  beats off-suit non-trump. Off-suit non-lead is the weakest. */
export function cardStrength(card: Card, trump: Suit, leadSuit: Suit): number {
  const eff = effectiveSuit(card, trump)
  // Trump cards: very high baseline + ordering by bower / rank
  if (eff === trump) {
    // Right Bower: Jack of trump suit
    if (card.rank === 'J' && card.suit === trump) return 1000
    // Left Bower: Jack of same color as trump
    if (card.rank === 'J' && card.suit === sameColorSuit(trump)) return 999
    // Other trumps: 900 + rank value (trump 9 = 900, trump A = 905)
    return 900 + RANK_VALUE[card.rank]
  }
  // Lead suit (non-trump): mid baseline
  if (eff === leadSuit) return 500 + RANK_VALUE[card.rank]
  // Off-suit, off-trump: weakest
  return RANK_VALUE[card.rank]
}

/** Decide the winner of a trick that has 4 plays. */
export function trickWinner(trick: Trick, trump: Suit): Position {
  if (trick.leadSuit === null || trick.plays.length !== 4) {
    throw new Error('trickWinner: trick incomplete')
  }
  let best = trick.plays[0]!
  let bestStrength = cardStrength(best.card, trump, trick.leadSuit)
  for (let i = 1; i < trick.plays.length; i++) {
    const p = trick.plays[i]!
    const s = cardStrength(p.card, trump, trick.leadSuit)
    if (s > bestStrength) {
      best = p
      bestStrength = s
    }
  }
  return best.pos
}

// ─── Deck / deal ─────────────────────────────────────────────────────

export function newDeck(): Card[] {
  const out: Card[] = []
  for (const s of SUITS) for (const r of RANKS) out.push({ suit: s, rank: r })
  return out
}

/** Fisher-Yates shuffle. Caller passes the RNG so tests can seed. */
export function shuffle<T>(deck: T[], rng: () => number = Math.random): T[] {
  const a = deck.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Standard Euchre deal: 5 cards per player, 4 in the kitty (top is upcard). */
export function deal(deck: Card[], dealer: Position): {
  hands: Record<Position, Card[]>
  upCard: Card
  kitty: Card[]
} {
  if (deck.length !== 24) throw new Error('deal: need a 24-card deck')
  const hands: Record<Position, Card[]> = { S: [], W: [], N: [], E: [] }
  // Deal in clockwise order starting to dealer's left.
  const order = positionsAfter(dealer) // 4 positions starting after dealer
  let idx = 0
  // Two passes (3+2 then 2+3 is canonical Euchre but we keep it simpler — 5 each)
  for (let r = 0; r < 5; r++) {
    for (const p of order) {
      hands[p].push(deck[idx++]!)
    }
  }
  const upCard = deck[idx++]!
  const kitty = deck.slice(idx)
  return { hands, upCard, kitty }
}

/** Returns the 4 positions in clockwise play order starting AFTER `from`. */
export function positionsAfter(from: Position): Position[] {
  const order: Position[] = ['S', 'W', 'N', 'E'] // clockwise
  const i = order.indexOf(from)
  return [order[(i + 1) % 4]!, order[(i + 2) % 4]!, order[(i + 3) % 4]!, order[(i + 4) % 4]!]
}

/** Returns the position immediately clockwise of `from`. */
export function nextPosition(from: Position): Position {
  return positionsAfter(from)[0]!
}

/** Map position → team. */
export function teamOf(pos: Position): Team {
  return pos === 'S' || pos === 'N' ? 'NS' : 'EW'
}

// ─── Bidding ─────────────────────────────────────────────────────────

/** Order-up the dealer (round 1): trump becomes upCard.suit, dealer
 *  picks up the upcard + discards one. */
export function orderUp(state: GameState, discard: Card): GameState {
  if (state.phase !== 'order-up') throw new Error('orderUp: not in order-up phase')
  const next: GameState = { ...state, hands: { ...state.hands } }
  next.trump = state.upCard.suit
  next.maker = state.turn
  // Dealer picks up upcard, then discards
  const dealerHand = state.hands[state.dealer].slice()
  dealerHand.push(state.upCard)
  const dropIdx = dealerHand.findIndex(c => c.suit === discard.suit && c.rank === discard.rank)
  if (dropIdx < 0) throw new Error('orderUp: discard not in dealer hand')
  dealerHand.splice(dropIdx, 1)
  next.hands[state.dealer] = dealerHand
  next.phase = 'play'
  next.turn = nextPosition(state.dealer) // lead is to dealer's left
  next.passes = 0
  return next
}

/** Pass on the round-1 order-up bid. */
export function passBid(state: GameState): GameState {
  const next: GameState = { ...state, passes: state.passes + 1 }
  if (state.bidRound === 1) {
    if (next.passes >= 4) {
      // All four passed — move to round 2
      next.bidRound = 2
      next.passes = 0
      next.forbiddenTrumpRound2 = state.upCard.suit
      next.phase = 'call-trump'
      next.turn = nextPosition(state.dealer)
    } else {
      next.turn = nextPosition(state.turn)
    }
  } else {
    // Round 2 — if reaches dealer with 3 passes, "stick the dealer" (must call)
    if (next.passes >= 4) {
      // Shouldn't happen — dealer must call. Caller's responsibility.
      throw new Error('round 2 reached 4 passes — stick-the-dealer should have prevented this')
    }
    next.turn = nextPosition(state.turn)
  }
  return next
}

/** Call trump in round 2. Suit must not equal the upcard's suit. */
export function callTrump(state: GameState, suit: Suit): GameState {
  if (state.phase !== 'call-trump') throw new Error('callTrump: not in call-trump phase')
  if (suit === state.forbiddenTrumpRound2) throw new Error('callTrump: cannot call upcard suit in round 2')
  const next: GameState = {
    ...state,
    trump: suit,
    maker: state.turn,
    phase: 'play',
    turn: nextPosition(state.dealer),
    passes: 0,
  }
  return next
}

// ─── Play ────────────────────────────────────────────────────────────

/** Get the legal cards a player may play right now. */
export function legalPlays(state: GameState, pos: Position): Card[] {
  const hand = state.hands[pos]
  if (state.trump === null) return hand // pre-trump: any
  if (state.trick.leadSuit === null) return hand // leading
  // Must follow lead suit if possible (treating left bower as trump)
  const followers = hand.filter(c => effectiveSuit(c, state.trump!) === state.trick.leadSuit)
  return followers.length > 0 ? followers : hand
}

/** Play a card from `pos`'s hand. Asserts legality. Advances state. */
export function playCard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('playCard: not in play phase')
  if (state.turn !== pos) throw new Error(`playCard: not ${pos}'s turn (it is ${state.turn})`)
  if (state.trump === null) throw new Error('playCard: trump not set')
  const legal = legalPlays(state, pos)
  if (!legal.some(c => c.suit === card.suit && c.rank === card.rank)) {
    throw new Error(`playCard: ${cardId(card)} is not a legal play`)
  }
  const next: GameState = {
    ...state,
    hands: { ...state.hands, [pos]: state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank)) },
    trick: {
      plays: [...state.trick.plays, { pos, card }],
      leadSuit: state.trick.leadSuit ?? effectiveSuit(card, state.trump),
    },
  }
  // Trick complete?
  if (next.trick.plays.length === 4) {
    const winner = trickWinner(next.trick, state.trump)
    const winningTeam = teamOf(winner)
    next.tricks = { ...state.tricks, [winningTeam]: state.tricks[winningTeam] + 1 }
    next.trick = { plays: [], leadSuit: null }
    next.turn = winner
    // Hand complete after 5 tricks
    const totalTricks = next.tricks.NS + next.tricks.EW
    if (totalTricks >= 5) {
      return scoreHand(next)
    }
    return next
  }
  next.turn = nextPosition(pos)
  return next
}

/** Compute hand score + transition to hand-end. */
function scoreHand(state: GameState): GameState {
  if (state.maker === null || state.trump === null) throw new Error('scoreHand: maker/trump not set')
  const makerTeam = teamOf(state.maker)
  const defenderTeam: Team = makerTeam === 'NS' ? 'EW' : 'NS'
  const makerTricks = state.tricks[makerTeam]
  const next: GameState = { ...state }
  if (makerTricks >= 3) {
    // Maker wins; 3-4 = 1, 5 = 2
    const points = makerTricks === 5 ? 2 : 1
    next.score = { ...state.score, [makerTeam]: state.score[makerTeam] + points }
  } else {
    // Euchred — defenders get 2
    next.score = { ...state.score, [defenderTeam]: state.score[defenderTeam] + 2 }
  }
  next.phase = next.score.NS >= 10 || next.score.EW >= 10 ? 'game-end' : 'hand-end'
  return next
}

// ─── New game / new hand ─────────────────────────────────────────────

export function newGame(rng: () => number = Math.random): GameState {
  const dealer: Position = 'S' // arbitrary first dealer
  return startNewHand({
    hands: { S: [], W: [], N: [], E: [] },
    dealer,
    upCard: { suit: '♠', rank: '9' }, // placeholder, overwritten
    trump: null,
    maker: null,
    turn: nextPosition(dealer),
    phase: 'order-up',
    trick: { plays: [], leadSuit: null },
    tricks: { NS: 0, EW: 0 },
    score: { NS: 0, EW: 0 },
    passes: 0,
    bidRound: 1,
    forbiddenTrumpRound2: null,
  }, rng)
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  const newDealer = state.phase === 'hand-end' ? nextPosition(state.dealer) : state.dealer
  const dealt = deal(shuffle(newDeck(), rng), newDealer)
  return {
    ...state,
    hands: dealt.hands,
    dealer: newDealer,
    upCard: dealt.upCard,
    trump: null,
    maker: null,
    turn: nextPosition(newDealer),
    phase: 'order-up',
    trick: { plays: [], leadSuit: null },
    tricks: { NS: 0, EW: 0 },
    passes: 0,
    bidRound: 1,
    forbiddenTrumpRound2: null,
  }
}
