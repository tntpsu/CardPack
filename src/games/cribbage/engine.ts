// Pure Cribbage engine — deal, crib discard, cut, pegging, the show, score.
// Two players: South (you) vs North (opponent). No I/O. Game to 121.
//
// Flow per hand:
//   1. deal 6 each
//   2. discard: each player sends 2 cards to the dealer's crib
//   3. cut: a starter is turned; if it's a Jack the dealer pegs 2 ("his heels")
//   4. play (pegging): non-dealer leads; alternate, count to ≤31, peg 15/31/
//      pairs/runs/go/last-card
//   5. show: non-dealer's hand, then dealer's hand, then the crib (dealer's),
//      each scored with fifteens + pairs + runs + flush + nobs
//   6. swap dealer, next hand
// First to 121 wins, checked after every scoring event (first past the post).

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'N'
export type Phase = 'discard' | 'play' | 'show' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }

export interface ScorePart { label: string; points: number }

export interface GameState {
  hands: Record<Position, Card[]>      // current hands (6 → 4 after discard)
  crib: Card[]
  starter: Card | null
  dealer: Position
  // pegging
  pegHands: Record<Position, Card[]>   // cards still to play in the show? no — to peg
  pegSeq: Card[]                       // current sub-round pile (since last reset)
  pegCount: number
  pegTurn: Position
  pegLast: Position | null             // who played the last card (for go / last-card)
  // generic
  turn: Position                       // whose action is needed (discard / lead)
  phase: Phase
  score: Record<Position, number>
  targetScore: number
  // show bookkeeping
  showStage: 'non-dealer' | 'dealer' | 'crib' | 'done'
  lastShow: { who: string; parts: ScorePart[]; total: number } | null
  message: string | null               // transient note (his heels, go, etc.)
}

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const TARGET = 121

export function rankIndex(r: Rank): number { return RANKS.indexOf(r) + 1 } // A=1..K=13
export function pegValue(r: Rank): number {
  if (r === 'A') return 1
  if (r === 'J' || r === 'Q' || r === 'K' || r === '10') return 10
  return Number(r)
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
export function other(p: Position): Position { return p === 'S' ? 'N' : 'S' }
function cardEq(a: Card, b: Card): boolean { return a.suit === b.suit && a.rank === b.rank }
function removeCards(hand: readonly Card[], cards: readonly Card[]): Card[] {
  return hand.filter(h => !cards.some(c => cardEq(c, h)))
}

// ── the show: count a 4-card hand + starter ──────────────────────────────

/** Score a hand (4 cards) with the starter. `isCrib` requires a 5-card flush. */
export function scoreShow(hand: readonly Card[], starter: Card, isCrib: boolean): { total: number; parts: ScorePart[] } {
  const all = [...hand, starter]
  const parts: ScorePart[] = []

  // Fifteens — every subset summing to 15.
  let fifteens = 0
  for (let mask = 1; mask < (1 << all.length); mask++) {
    let sum = 0
    for (let i = 0; i < all.length; i++) if (mask & (1 << i)) sum += pegValue(all[i]!.rank)
    if (sum === 15) fifteens++
  }
  if (fifteens) parts.push({ label: `Fifteen×${fifteens}`, points: fifteens * 2 })

  // Pairs — every matching unordered pair.
  let pairPts = 0
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i]!.rank === all[j]!.rank) pairPts += 2
  }
  if (pairPts) parts.push({ label: `Pairs`, points: pairPts })

  // Runs — consecutive blocks, multiplied by rank counts (handles double/triple runs).
  const counts = new Map<number, number>()
  for (const c of all) counts.set(rankIndex(c.rank), (counts.get(rankIndex(c.rank)) ?? 0) + 1)
  const present = [...counts.keys()].sort((a, b) => a - b)
  let runPts = 0
  let i = 0
  while (i < present.length) {
    let j = i
    while (j + 1 < present.length && present[j + 1] === present[j]! + 1) j++
    const len = j - i + 1
    if (len >= 3) {
      let mult = 1
      for (let k = i; k <= j; k++) mult *= counts.get(present[k]!)!
      runPts += len * mult
    }
    i = j + 1
  }
  if (runPts) parts.push({ label: `Run`, points: runPts })

  // Flush.
  const handSuit = hand[0]!.suit
  const handFlush = hand.every(c => c.suit === handSuit)
  if (isCrib) {
    if (handFlush && starter.suit === handSuit) parts.push({ label: 'Flush 5', points: 5 })
  } else if (handFlush) {
    parts.push({ label: starter.suit === handSuit ? 'Flush 5' : 'Flush 4', points: starter.suit === handSuit ? 5 : 4 })
  }

  // His nobs — a Jack in hand matching the starter's suit.
  if (hand.some(c => c.rank === 'J' && c.suit === starter.suit)) parts.push({ label: 'Nobs', points: 1 })

  const total = parts.reduce((s, p) => s + p.points, 0)
  return { total, parts }
}

// ── pegging scoring for a single play ────────────────────────────────────

/** Points from the just-played card given the current pile `seq` (ending with
 *  that card) and the resulting `count`. Covers 15, 31, pairs, runs. */
export function pegPlayPoints(seq: readonly Card[], count: number): number {
  let pts = 0
  if (count === 15) pts += 2
  if (count === 31) pts += 2

  // Pairs: trailing cards of the same rank as the last card.
  const lastRank = seq[seq.length - 1]!.rank
  let same = 0
  for (let i = seq.length - 1; i >= 0 && seq[i]!.rank === lastRank; i--) same++
  if (same >= 2) pts += same * (same - 1) // 2→2, 3→6, 4→12

  // Runs: longest trailing window (≥3) whose ranks form a consecutive set.
  for (let len = seq.length; len >= 3; len--) {
    const window = seq.slice(seq.length - len)
    const idxs = window.map(c => rankIndex(c.rank)).sort((a, b) => a - b)
    let consecutive = true
    for (let k = 1; k < idxs.length; k++) {
      if (idxs[k] === idxs[k - 1]) { consecutive = false; break } // a pair breaks a peg run
      if (idxs[k] !== idxs[k - 1]! + 1) { consecutive = false; break }
    }
    if (consecutive) { pts += len; break }
  }
  return pts
}

// ── lifecycle ─────────────────────────────────────────────────────────────

function dealFresh(dealer: Position, rng: () => number): Pick<GameState, 'hands' | 'crib' | 'starter' | 'pegHands' | 'pegSeq' | 'pegCount' | 'pegTurn' | 'pegLast' | 'turn'> {
  const deck = shuffle(newDeck(), rng)
  const hands: Record<Position, Card[]> = { S: deck.slice(0, 6), N: deck.slice(6, 12) }
  // starter is cut later from the remaining deck; stash it deterministically.
  return {
    hands,
    crib: [],
    starter: null,
    pegHands: { S: [], N: [] },
    pegSeq: [],
    pegCount: 0,
    pegTurn: other(dealer), // non-dealer leads the play
    pegLast: null,
    turn: other(dealer),    // non-dealer discards/decides first (order doesn't matter for discard)
  }
}

export function newGame(rng: () => number = Math.random, dealer: Position = 'N'): GameState {
  return {
    ...dealFresh(dealer, rng),
    dealer,
    phase: 'discard',
    score: { S: 0, N: 0 },
    targetScore: TARGET,
    showStage: 'non-dealer',
    lastShow: null,
    message: null,
  }
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  const dealer = other(state.dealer) // swap dealer each hand
  return {
    ...state,
    ...dealFresh(dealer, rng),
    dealer,
    phase: 'discard',
    showStage: 'non-dealer',
    lastShow: null,
    message: null,
  }
}

/** Both players send 2 cards to the crib. `cards` is the discarding player's
 *  two cards. When both have discarded, cut the starter + handle his-heels. */
export function discardToCrib(state: GameState, pos: Position, cards: readonly Card[], rng: () => number = Math.random): GameState {
  if (state.phase !== 'discard') throw new Error('discard: wrong phase')
  if (cards.length !== 2) throw new Error('discard: need exactly 2')
  const hand = removeCards(state.hands[pos], cards)
  if (hand.length !== state.hands[pos].length - 2) throw new Error('discard: cards not in hand')
  const crib = [...state.crib, ...cards]
  const next: GameState = { ...state, hands: { ...state.hands, [pos]: hand }, crib }
  if (crib.length < 4) return next // wait for the other player
  return cutStarter(next, rng)
}

function cutStarter(state: GameState, rng: () => number): GameState {
  // Cut a starter from cards not in either hand or the crib.
  const used = [...state.hands.S, ...state.hands.N, ...state.crib]
  const rest = newDeck().filter(c => !used.some(u => cardEq(u, c)))
  const starter = shuffle(rest, rng)[0]!
  let score = { ...state.score }
  let message: string | null = null
  if (starter.rank === 'J') { score = { ...score, [state.dealer]: score[state.dealer] + 2 }; message = 'His heels +2 (dealer)' }
  const reached = score.S >= state.targetScore || score.N >= state.targetScore
  return {
    ...state,
    starter,
    score,
    message,
    pegHands: { S: state.hands.S.slice(), N: state.hands.N.slice() },
    pegSeq: [], pegCount: 0, pegTurn: other(state.dealer), pegLast: null,
    phase: reached ? 'game-end' : 'play',
  }
}

export function legalPeg(state: GameState, pos: Position): Card[] {
  return state.pegHands[pos].filter(c => pegValue(c.rank) <= 31 - state.pegCount)
}
export function mustGo(state: GameState, pos: Position): boolean {
  return legalPeg(state, pos).length === 0
}
function pegHandsEmpty(state: GameState): boolean {
  return state.pegHands.S.length === 0 && state.pegHands.N.length === 0
}

export function pegPlay(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('peg: wrong phase')
  if (state.pegTurn !== pos) throw new Error('peg: not your turn')
  if (pegValue(card.rank) > 31 - state.pegCount) throw new Error('peg: would exceed 31')
  if (!state.pegHands[pos].some(c => cardEq(c, card))) throw new Error('peg: card not in hand')

  const seq = [...state.pegSeq, card]
  const count = state.pegCount + pegValue(card.rank)
  let score = { ...state.score, [pos]: state.score[pos] + pegPlayPoints(seq, count) }
  let s: GameState = {
    ...state,
    score,
    pegHands: { ...state.pegHands, [pos]: removeCards(state.pegHands[pos], [card]) },
    pegSeq: seq,
    pegCount: count,
    pegLast: pos,
    message: null,
  }

  if (pegHandsEmpty(s)) {
    if (count !== 31) s = { ...s, score: { ...s.score, [pos]: s.score[pos] + 1 }, message: 'Last card +1' } // last-card
    return afterPegScore(s, () => enterShow(s))
  }
  if (count === 31) {
    // sub-round resets; the other player leads next.
    s = { ...s, pegSeq: [], pegCount: 0, pegTurn: other(pos), message: '31 for 2' }
    return afterPegScore(s, () => s)
  }
  s = { ...s, pegTurn: other(pos) }
  return afterPegScore(s, () => s)
}

/** Current player can't play. Pass; if both are stuck, the last player pegs 1
 *  for the go and the sub-round resets. */
export function pegGo(state: GameState, pos: Position): GameState {
  if (state.phase !== 'play') throw new Error('go: wrong phase')
  if (state.pegTurn !== pos) throw new Error('go: not your turn')
  const opp = other(pos)
  if (legalPeg(state, opp).length > 0) {
    // Opponent can still play; pass the turn to them.
    return { ...state, pegTurn: opp, message: `${pos === 'S' ? 'You' : 'Opp'}: go` }
  }
  // Both stuck — last player pegs the go point, reset the sub-round.
  let score = { ...state.score }
  if (state.pegLast && state.pegCount !== 31) score = { ...score, [state.pegLast]: score[state.pegLast] + 1 }
  let s: GameState = { ...state, score, pegSeq: [], pegCount: 0, message: 'Go +1' }
  if (pegHandsEmpty(s)) return afterPegScore(s, () => enterShow(s))
  // Whoever did NOT play the last card leads the next sub-round (or the one with cards).
  const leader = state.pegLast ? other(state.pegLast) : pos
  s = { ...s, pegTurn: s.pegHands[leader].length > 0 ? leader : other(leader) }
  return afterPegScore(s, () => s)
}

function afterPegScore(s: GameState, cont: () => GameState): GameState {
  if (s.score.S >= s.targetScore || s.score.N >= s.targetScore) return { ...s, phase: 'game-end' }
  return cont()
}

function enterShow(state: GameState): GameState {
  // Non-dealer scores first.
  return { ...state, phase: 'show', showStage: 'non-dealer', lastShow: null, pegSeq: [], pegCount: 0 }
}

/** Advance the show one step, scoring the current stage's hand/crib. */
export function advanceShow(state: GameState): GameState {
  if (state.phase !== 'show') throw new Error('show: wrong phase')
  const starter = state.starter!
  const nonDealer = other(state.dealer)

  if (state.showStage === 'non-dealer') {
    const r = scoreShow(state.hands[nonDealer], starter, false)
    return settleShow(state, nonDealer, r, `${seatName(nonDealer)} hand`, 'dealer')
  }
  if (state.showStage === 'dealer') {
    const r = scoreShow(state.hands[state.dealer], starter, false)
    return settleShow(state, state.dealer, r, `${seatName(state.dealer)} hand`, 'crib')
  }
  if (state.showStage === 'crib') {
    const r = scoreShow(state.crib, starter, true)
    return settleShow(state, state.dealer, r, `${seatName(state.dealer)} crib`, 'done')
  }
  // done → hand ends
  return { ...state, phase: 'hand-end' }
}

function settleShow(state: GameState, scorer: Position, r: { total: number; parts: ScorePart[] }, who: string, nextStage: GameState['showStage']): GameState {
  const score = { ...state.score, [scorer]: state.score[scorer] + r.total }
  const reached = score.S >= state.targetScore || score.N >= state.targetScore
  return {
    ...state,
    score,
    lastShow: { who, parts: r.parts, total: r.total },
    showStage: nextStage,
    phase: reached ? 'game-end' : 'show',
  }
}

function seatName(p: Position): string { return p === 'S' ? 'You' : 'Opp' }

export function gameWinner(state: GameState): Position {
  return state.score.S >= state.score.N ? 'S' : 'N'
}
