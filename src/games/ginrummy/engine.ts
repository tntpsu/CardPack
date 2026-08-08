// Pure Gin Rummy engine — deal, draw, discard, meld-solve, knock, score.
// Two players: South (you) vs North (opponent). No I/O.
//
// Rules (standard, simplified):
// - 52-card deck, 10 cards each. Rest = stock; top flipped to the discard.
// - A turn is two steps: DRAW (top of stock or top of discard), then DISCARD
//   one card. After discarding you may KNOCK if your deadwood ≤ 10.
// - Melds: sets (3–4 same rank) and runs (3+ consecutive same suit, Ace LOW).
// - Deadwood = value of unmelded cards. A=1, 2–10 = pip, J/Q/K = 10.
// - Knock: deadwood 0 = Gin (+25 bonus, can't be undercut). Otherwise the
//   knocker scores opp_deadwood − knocker_deadwood; if the opponent's
//   deadwood is ≤ the knocker's, the opponent UNDERCUTS (+25 bonus and scores
//   the difference). Lay-offs are NOT modelled (documented simplification).
// - Stock exhausted with no knock → the hand is a wash (no score).
// - First player to targetScore (default 100) wins.

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'N'
export type Phase = 'draw' | 'discard' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }

export interface HandResult {
  knocker: Position | null     // null = wash (stock exhausted)
  gin: boolean
  undercut: boolean
  scorer: Position | null      // who scored points this hand
  points: number               // points awarded to scorer
}

export interface GameState {
  hands: Record<Position, Card[]>
  stock: Card[]
  discard: Card[]              // top is last element
  turn: Position
  phase: Phase
  score: Record<Position, number>
  targetScore: number
  result: HandResult | null    // set at hand-end / game-end
}

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const HAND_SIZE = 10
const KNOCK_MAX = 10
const GIN_BONUS = 25
const UNDERCUT_BONUS = 25

/** Ace LOW: A=1, 2..10, J=11, Q=12, K=13. Used for run adjacency. */
export function rankIndex(r: Rank): number {
  return RANKS.indexOf(r) + 1
}

/** Deadwood point value: A=1, 2–10 = pip, J/Q/K = 10. */
export function deadwoodValue(r: Rank): number {
  if (r === 'A') return 1
  if (r === 'J' || r === 'Q' || r === 'K') return 10
  return Number(r)
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

export function other(p: Position): Position {
  return p === 'S' ? 'N' : 'S'
}

function dealFresh(rng: () => number): Pick<GameState, 'hands' | 'stock' | 'discard' | 'turn'> {
  const deck = shuffle(newDeck(), rng)
  let i = 0
  const hands: Record<Position, Card[]> = { S: [], N: [] }
  for (let n = 0; n < HAND_SIZE; n++) { hands.S.push(deck[i++]!); hands.N.push(deck[i++]!) }
  const upcard = deck[i++]!
  const stock = deck.slice(i)
  return { hands, stock, discard: [upcard], turn: 'S' }
}

export function newGame(targetScore = 100, rng: () => number = Math.random): GameState {
  return {
    ...dealFresh(rng),
    phase: 'draw',
    score: { S: 0, N: 0 },
    targetScore,
    result: null,
  }
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  return { ...state, ...dealFresh(rng), phase: 'draw', result: null }
}

export function topDiscard(state: GameState): Card | null {
  return state.discard.length ? state.discard[state.discard.length - 1]! : null
}

// ── meld solver: minimise deadwood ───────────────────────────────────────

export interface MeldSplit {
  melds: Card[][]
  deadwood: Card[]
  deadwoodValue: number
}

function cardEq(a: Card, b: Card): boolean { return a.suit === b.suit && a.rank === b.rank }

/** All valid melds in `cards`, as index bitmasks over the `cards` array. */
function enumerateMelds(cards: readonly Card[]): Array<{ mask: number; cards: Card[] }> {
  const out: Array<{ mask: number; cards: Card[] }> = []

  // Sets: group by rank, size 3 or 4.
  const byRank = new Map<Rank, number[]>()
  cards.forEach((c, i) => { const a = byRank.get(c.rank) ?? []; a.push(i); byRank.set(c.rank, a) })
  for (const idxs of byRank.values()) {
    if (idxs.length >= 3) {
      // full group
      out.push({ mask: idxs.reduce((m, i) => m | (1 << i), 0), cards: idxs.map(i => cards[i]!) })
      // size-3 subsets when the group is 4 (any 3 of the 4)
      if (idxs.length === 4) {
        for (let drop = 0; drop < 4; drop++) {
          const sub = idxs.filter((_, k) => k !== drop)
          out.push({ mask: sub.reduce((m, i) => m | (1 << i), 0), cards: sub.map(i => cards[i]!) })
        }
      }
    }
  }

  // Runs: per suit, sort by rankIndex, find consecutive segments, emit every
  // contiguous sub-run of length ≥ 3.
  const bySuit = new Map<Suit, number[]>()
  cards.forEach((c, i) => { const a = bySuit.get(c.suit) ?? []; a.push(i); bySuit.set(c.suit, a) })
  for (const idxs of bySuit.values()) {
    const sorted = idxs.slice().sort((a, b) => rankIndex(cards[a]!.rank) - rankIndex(cards[b]!.rank))
    let seg: number[] = []
    const flush = () => {
      for (let start = 0; start < seg.length; start++) {
        for (let end = start + 2; end < seg.length; end++) {
          const window = seg.slice(start, end + 1)
          out.push({ mask: window.reduce((m, i) => m | (1 << i), 0), cards: window.map(i => cards[i]!) })
        }
      }
    }
    for (let k = 0; k < sorted.length; k++) {
      if (seg.length === 0) { seg = [sorted[k]!]; continue }
      const prev = cards[seg[seg.length - 1]!]!
      const cur = cards[sorted[k]!]!
      if (rankIndex(cur.rank) === rankIndex(prev.rank) + 1) seg.push(sorted[k]!)
      else { flush(); seg = [sorted[k]!] }
    }
    flush()
  }
  return out
}

/** Best partition of a hand into melds minimising deadwood value. */
export function bestMeldSplit(hand: readonly Card[]): MeldSplit {
  const cards = hand.slice()
  const n = cards.length
  const melds = enumerateMelds(cards)
  const memo = new Map<number, MeldSplit>()

  function lowestBit(mask: number): number {
    let i = 0
    while (!((mask >> i) & 1)) i++
    return i
  }

  function rec(mask: number): MeldSplit {
    if (mask === 0) return { melds: [], deadwood: [], deadwoodValue: 0 }
    const cached = memo.get(mask)
    if (cached) return cached
    const low = lowestBit(mask)
    // Option A: card `low` is deadwood.
    const sub = rec(mask & ~(1 << low))
    let best: MeldSplit = {
      melds: sub.melds,
      deadwood: [cards[low]!, ...sub.deadwood],
      deadwoodValue: deadwoodValue(cards[low]!.rank) + sub.deadwoodValue,
    }
    // Option B: any meld containing `low` and fully within `mask`.
    for (const m of melds) {
      if (!(m.mask & (1 << low))) continue
      if ((m.mask & mask) !== m.mask) continue
      const s = rec(mask & ~m.mask)
      if (s.deadwoodValue < best.deadwoodValue) {
        best = { melds: [m.cards, ...s.melds], deadwood: s.deadwood, deadwoodValue: s.deadwoodValue }
      }
    }
    memo.set(mask, best)
    return best
  }
  return rec(n === 0 ? 0 : (1 << n) - 1)
}

export function deadwoodCount(hand: readonly Card[]): number {
  return bestMeldSplit(hand).deadwoodValue
}

// ── moves ────────────────────────────────────────────────────────────────

export function drawStock(state: GameState, pos: Position): GameState {
  if (state.phase !== 'draw') throw new Error('drawStock: not draw phase')
  if (state.turn !== pos) throw new Error('drawStock: not your turn')
  if (state.stock.length === 0) return endWash(state)
  const card = state.stock[state.stock.length - 1]!
  return {
    ...state,
    stock: state.stock.slice(0, -1),
    hands: { ...state.hands, [pos]: [...state.hands[pos], card] },
    phase: 'discard',
  }
}

export function drawDiscard(state: GameState, pos: Position): GameState {
  if (state.phase !== 'draw') throw new Error('drawDiscard: not draw phase')
  if (state.turn !== pos) throw new Error('drawDiscard: not your turn')
  const top = topDiscard(state)
  if (!top) throw new Error('drawDiscard: empty discard')
  return {
    ...state,
    discard: state.discard.slice(0, -1),
    hands: { ...state.hands, [pos]: [...state.hands[pos], top] },
    phase: 'discard',
  }
}

/** Discard a card (no knock) and pass the turn. */
export function discard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'discard') throw new Error('discard: not discard phase')
  if (state.turn !== pos) throw new Error('discard: not your turn')
  const hand = state.hands[pos]
  if (!hand.some(c => cardEq(c, card))) throw new Error('discard: card not in hand')
  const newHand = removeOne(hand, card)
  const next: GameState = {
    ...state,
    hands: { ...state.hands, [pos]: newHand },
    discard: [...state.discard, card],
    turn: other(pos),
    phase: 'draw',
  }
  // If the stock is exhausted, the hand is a wash before the next draw.
  if (next.stock.length === 0) return endWash(next)
  return next
}

export function canKnock(hand: readonly Card[]): boolean {
  return deadwoodCount(hand) <= KNOCK_MAX
}

/** Discard `card` and knock. Requires the resulting 10-card hand's deadwood
 *  ≤ 10. Settles the hand. */
export function knock(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'discard') throw new Error('knock: not discard phase')
  if (state.turn !== pos) throw new Error('knock: not your turn')
  const newHand = removeOne(state.hands[pos], card)
  if (!canKnock(newHand)) throw new Error('knock: deadwood > 10')
  const handsAfter = { ...state.hands, [pos]: newHand }
  return settle(
    { ...state, hands: handsAfter, discard: [...state.discard, card] },
    pos,
  )
}

function settle(state: GameState, knocker: Position): GameState {
  const opp = other(knocker)
  const kDead = deadwoodCount(state.hands[knocker])
  const oDead = deadwoodCount(state.hands[opp])
  let result: HandResult

  if (kDead === 0) {
    result = { knocker, gin: true, undercut: false, scorer: knocker, points: oDead + GIN_BONUS }
  } else if (oDead <= kDead) {
    // Undercut — opponent scores.
    result = { knocker, gin: false, undercut: true, scorer: opp, points: (kDead - oDead) + UNDERCUT_BONUS }
  } else {
    result = { knocker, gin: false, undercut: false, scorer: knocker, points: oDead - kDead }
  }

  const score = { ...state.score }
  if (result.scorer) score[result.scorer] += result.points
  const reachedTarget = score.S >= state.targetScore || score.N >= state.targetScore
  return { ...state, score, result, phase: reachedTarget ? 'game-end' : 'hand-end' }
}

function endWash(state: GameState): GameState {
  return {
    ...state,
    result: { knocker: null, gin: false, undercut: false, scorer: null, points: 0 },
    phase: 'hand-end',
  }
}

function removeOne(hand: readonly Card[], card: Card): Card[] {
  const i = hand.findIndex(c => cardEq(c, card))
  if (i < 0) return hand.slice()
  return [...hand.slice(0, i), ...hand.slice(i + 1)]
}

/** Lowest cumulative... no — highest score wins (you accrue points). */
export function gameWinner(state: GameState): Position {
  return state.score.S >= state.score.N ? 'S' : 'N'
}
