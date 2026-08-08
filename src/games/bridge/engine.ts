// Pure Contract Bridge engine — deal, auction, play, score. No I/O.
//
// Conventions:
// - 4 players: South (you) + North (partner) vs West + East.
// - Teams: NS = (S, N), EW = (W, E).
// - 52-card deck, 13 each. Dealer rotates each deal (S, W, N, E, …) and
//   bids first.
//
// Auction:
// - Each player in turn makes a Call: pass, a bid (level 1-7 × strain
//   ♣<♦<♥<♠<NT), double (of opponents' bid), or redouble (of a double of
//   our bid).
// - A bid must outrank the standing bid (level then strain).
// - The auction ends after three consecutive passes following any bid; if
//   the first four calls are all passes the deal is "passed out" (redeal).
// - Contract = the final bid, played by the DECLARER: the member of the
//   contracting side who FIRST named the contract's strain.
//
// Play:
// - Opening leader is the player to declarer's left. After that first card,
//   dummy (declarer's partner) is revealed face-up; declarer plays both
//   their own and dummy's cards.
// - Follow the led suit if able; otherwise play anything (trump may be led
//   any time, unlike Spades). Highest trump wins, else highest of the lead
//   suit. NT contracts have no trump.
// - Declarer's side must take 6 + level tricks to "make" the contract.
//
// Scoring (duplicate-style, per deal — see scoreDeal): contracted trick
// points, game/part-score/slam bonuses, doubled/redoubled multipliers and
// insult bonus, overtricks, and the standard undertrick penalty tables, all
// adjusted for vulnerability. First side to targetScore (default 500) wins.
//
// This is a deliberately bounded model of bridge: per-deal scoring (no
// rubber/below-the-line carry), a simplified vulnerability cycle, and a
// rule-based AI bidder. See README + the wrapper for the honest scope note.

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type Position = 'S' | 'W' | 'N' | 'E'
export type Team = 'NS' | 'EW'
export type Strain = '♣' | '♦' | '♥' | '♠' | 'NT'
export type Phase = 'auction' | 'play' | 'hand-end' | 'game-end'

export interface Card { suit: Suit; rank: Rank }

export type Call =
  | { kind: 'pass' }
  | { kind: 'bid'; level: number; strain: Strain }
  | { kind: 'double' }
  | { kind: 'redouble' }

export interface CallRecord { pos: Position; call: Call }

export interface Contract {
  level: number
  strain: Strain
  declarer: Position
  doubled: boolean
  redoubled: boolean
}

export interface Trick {
  plays: Array<{ pos: Position; card: Card }>
  leadSuit: Suit | null
}

export interface HandResult {
  passedOut: boolean
  contract: Contract | null
  /** Tricks taken by the declaring side. */
  declarerTricks: number
  made: boolean
  /** Points awarded this deal (always ≥ 0). */
  points: number
  /** Team that received the points (null on a passed-out deal). */
  scoringTeam: Team | null
}

export interface GameState {
  hands: Record<Position, Card[]>
  dealer: Position
  /** 1-indexed; drives the vulnerability cycle. */
  dealNumber: number
  turn: Position
  phase: Phase
  calls: CallRecord[]
  contract: Contract | null
  trick: Trick
  tricksPlayed: number
  /** Tricks won this deal, by team. */
  tricksWon: Record<Team, number>
  /** True once the opening lead has been played. */
  dummyRevealed: boolean
  score: Record<Team, number>
  vulnerable: Record<Team, boolean>
  targetScore: number
  lastResult: HandResult | null
}

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const POSITIONS: Position[] = ['S', 'W', 'N', 'E']
const STRAINS: Strain[] = ['♣', '♦', '♥', '♠', 'NT']

const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
}
const STRAIN_ORDER: Record<Strain, number> = { '♣': 0, '♦': 1, '♥': 2, '♠': 3, NT: 4 }

// ── deck / deal ──────────────────────────────────────────────────────────

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

export function deal(deck: Card[], dealer: Position): Record<Position, Card[]> {
  if (deck.length !== 52) throw new Error('deal: deck must be 52 cards')
  const hands: Record<Position, Card[]> = { S: [], W: [], N: [], E: [] }
  // First card to the player left of the dealer, as at a real table.
  let p = nextPosition(dealer)
  for (let i = 0; i < deck.length; i++) {
    hands[p].push(deck[i]!)
    p = nextPosition(p)
  }
  return hands
}

// ── seat geometry ──────────────────────────────────────────────────────────

export function teamOf(pos: Position): Team {
  return pos === 'S' || pos === 'N' ? 'NS' : 'EW'
}

/** Clockwise: S → W → N → E → S. */
export function nextPosition(p: Position): Position {
  return p === 'S' ? 'W' : p === 'W' ? 'N' : p === 'N' ? 'E' : 'S'
}

export function partnerOf(p: Position): Position {
  return p === 'S' ? 'N' : p === 'N' ? 'S' : p === 'W' ? 'E' : 'W'
}

/** The dummy = declarer's partner (only meaningful once a contract exists). */
export function dummyOf(state: GameState): Position | null {
  return state.contract ? partnerOf(state.contract.declarer) : null
}

/** Who controls a seat's cards during play. Defenders play their own; the
 *  declarer plays both their own hand and the dummy's. */
export function controllerOf(state: GameState, seat: Position): Position {
  const c = state.contract
  if (!c) return seat
  const dummy = partnerOf(c.declarer)
  return seat === dummy ? c.declarer : seat
}

// ── vulnerability ────────────────────────────────────────────────────────

/** Simplified duplicate cycle by deal number: none, NS, EW, both, repeat. */
export function vulnerabilityFor(dealNumber: number): Record<Team, boolean> {
  switch ((dealNumber - 1) % 4) {
    case 0: return { NS: false, EW: false }
    case 1: return { NS: true, EW: false }
    case 2: return { NS: false, EW: true }
    default: return { NS: true, EW: true }
  }
}

// ── auction ────────────────────────────────────────────────────────────────

function bidValue(level: number, strain: Strain): number {
  return level * 5 + STRAIN_ORDER[strain]
}

/** The standing (highest) bid so far, or null if no one has bid. */
export function standingBid(calls: CallRecord[]): { pos: Position; level: number; strain: Strain } | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!
    if (c.call.kind === 'bid') return { pos: c.pos, level: c.call.level, strain: c.call.strain }
  }
  return null
}

/** Doubled / redoubled state currently applying to the standing bid. */
function doubleState(calls: CallRecord[]): { doubled: boolean; redoubled: boolean } {
  let doubled = false
  let redoubled = false
  for (const c of calls) {
    if (c.call.kind === 'bid') { doubled = false; redoubled = false }
    else if (c.call.kind === 'double') doubled = true
    else if (c.call.kind === 'redouble') redoubled = true
  }
  return { doubled, redoubled }
}

export function callIsLegal(calls: CallRecord[], pos: Position, call: Call): boolean {
  if (call.kind === 'pass') return true

  if (call.kind === 'bid') {
    if (!Number.isInteger(call.level) || call.level < 1 || call.level > 7) return false
    if (!STRAINS.includes(call.strain)) return false
    const std = standingBid(calls)
    if (!std) return true
    return bidValue(call.level, call.strain) > bidValue(std.level, std.strain)
  }

  const std = standingBid(calls)
  if (!std) return false
  const { doubled, redoubled } = doubleState(calls)

  if (call.kind === 'double') {
    // Legal only against an opponent's standing bid that isn't already doubled.
    if (teamOf(std.pos) === teamOf(pos)) return false
    return !doubled && !redoubled
  }
  // redouble: only when our side's bid has been doubled by an opponent.
  if (teamOf(std.pos) !== teamOf(pos)) return false
  return doubled && !redoubled
}

export function legalCalls(calls: CallRecord[], pos: Position): Call[] {
  const out: Call[] = [{ kind: 'pass' }]
  for (let level = 1; level <= 7; level++) {
    for (const strain of STRAINS) {
      const c: Call = { kind: 'bid', level, strain }
      if (callIsLegal(calls, pos, c)) out.push(c)
    }
  }
  if (callIsLegal(calls, pos, { kind: 'double' })) out.push({ kind: 'double' })
  if (callIsLegal(calls, pos, { kind: 'redouble' })) out.push({ kind: 'redouble' })
  return out
}

/** Auction is over: 4 opening passes (passed out) OR a bid then 3 passes. */
export function auctionComplete(calls: CallRecord[]): boolean {
  if (calls.length < 4) return false
  const anyBid = calls.some(c => c.call.kind === 'bid')
  if (!anyBid) return calls.slice(-4).every(c => c.call.kind === 'pass')
  return calls.slice(-3).every(c => c.call.kind === 'pass')
}

export function resolveContract(calls: CallRecord[]): Contract | null {
  const std = standingBid(calls)
  if (!std) return null
  const { doubled, redoubled } = doubleState(calls)
  const side = teamOf(std.pos)
  // Declarer: first of the contracting side to have named this strain.
  const declarer = calls.find(
    c => c.call.kind === 'bid' && c.call.strain === std.strain && teamOf(c.pos) === side,
  )!.pos
  return { level: std.level, strain: std.strain, declarer, doubled, redoubled }
}

export function placeCall(state: GameState, pos: Position, call: Call): GameState {
  if (state.phase !== 'auction') throw new Error('placeCall: not auction phase')
  if (state.turn !== pos) throw new Error('placeCall: not your turn')
  if (!callIsLegal(state.calls, pos, call)) throw new Error('placeCall: illegal call')

  const calls = [...state.calls, { pos, call }]
  if (!auctionComplete(calls)) {
    return { ...state, calls, turn: nextPosition(pos) }
  }

  const contract = resolveContract(calls)
  if (!contract) {
    // Passed out — no score, deal is dead.
    const result: HandResult = {
      passedOut: true, contract: null, declarerTricks: 0, made: false, points: 0, scoringTeam: null,
    }
    return { ...state, calls, phase: 'hand-end', contract: null, lastResult: result }
  }
  return {
    ...state,
    calls,
    contract,
    phase: 'play',
    turn: nextPosition(contract.declarer), // opening leader = declarer's LHO
    trick: { plays: [], leadSuit: null },
    dummyRevealed: false,
  }
}

// ── play ───────────────────────────────────────────────────────────────────

export function legalPlays(state: GameState, pos: Position): Card[] {
  const hand = state.hands[pos]
  if (state.trick.leadSuit === null) return hand // leading: anything, incl. trump
  const matching = hand.filter(c => c.suit === state.trick.leadSuit)
  return matching.length > 0 ? matching : hand
}

export function trickWinner(trick: Trick, trump: Strain): Position {
  if (trick.plays.length !== 4) throw new Error('trickWinner: incomplete')
  if (trump !== 'NT') {
    const trumps = trick.plays.filter(p => p.card.suit === trump)
    if (trumps.length > 0) {
      return trumps.reduce((best, p) => (RANK_ORDER[p.card.rank] > RANK_ORDER[best.card.rank] ? p : best)).pos
    }
  }
  const lead = trick.leadSuit!
  const onLead = trick.plays.filter(p => p.card.suit === lead)
  return onLead.reduce((best, p) => (RANK_ORDER[p.card.rank] > RANK_ORDER[best.card.rank] ? p : best)).pos
}

export function playCard(state: GameState, pos: Position, card: Card): GameState {
  if (state.phase !== 'play') throw new Error('playCard: not play phase')
  if (state.turn !== pos) throw new Error('playCard: not your turn')
  const legal = legalPlays(state, pos)
  if (!legal.some(c => c.suit === card.suit && c.rank === card.rank)) throw new Error('playCard: illegal')

  const hand = state.hands[pos].filter(c => !(c.suit === card.suit && c.rank === card.rank))
  const newHands = { ...state.hands, [pos]: hand }
  const plays = [...state.trick.plays, { pos, card }]
  const leadSuit = state.trick.leadSuit ?? card.suit
  const dummyRevealed = state.dummyRevealed || state.tricksPlayed > 0 || plays.length >= 1

  if (plays.length < 4) {
    return { ...state, hands: newHands, trick: { plays, leadSuit }, dummyRevealed, turn: nextPosition(pos) }
  }

  const completed: Trick = { plays, leadSuit }
  const winner = trickWinner(completed, state.contract!.strain)
  const winTeam = teamOf(winner)
  const tricksWon = { ...state.tricksWon, [winTeam]: state.tricksWon[winTeam] + 1 }
  const tricksPlayed = state.tricksPlayed + 1

  if (tricksPlayed === 13) {
    return endHand({
      ...state, hands: newHands, tricksWon, tricksPlayed, dummyRevealed,
      trick: { plays: [], leadSuit: null },
    })
  }
  return {
    ...state, hands: newHands, tricksWon, tricksPlayed, dummyRevealed,
    trick: { plays: [], leadSuit: null }, turn: winner,
  }
}

function endHand(state: GameState): GameState {
  const c = state.contract!
  const declarerTricks = state.tricksWon[teamOf(c.declarer)]
  const vul = state.vulnerable[teamOf(c.declarer)]
  const { made, points } = scoreDeal(c.level, c.strain, c.doubled, c.redoubled, declarerTricks, vul)
  const scoringTeam: Team = made ? teamOf(c.declarer) : (teamOf(c.declarer) === 'NS' ? 'EW' : 'NS')
  const score = {
    NS: state.score.NS + (scoringTeam === 'NS' ? points : 0),
    EW: state.score.EW + (scoringTeam === 'EW' ? points : 0),
  }
  const result: HandResult = { passedOut: false, contract: c, declarerTricks, made, points, scoringTeam }
  const reached = score.NS >= state.targetScore || score.EW >= state.targetScore
  return { ...state, score, lastResult: result, phase: reached ? 'game-end' : 'hand-end' }
}

// ── scoring ────────────────────────────────────────────────────────────────

function perTrickValue(strain: Strain): number {
  return strain === '♣' || strain === '♦' ? 20 : 30
}

/** Contracted trick points (the `level` tricks above book), before doubling. */
export function contractedTrickPoints(level: number, strain: Strain): number {
  if (strain === 'NT') return 40 + (level - 1) * 30
  return level * perTrickValue(strain)
}

function doubledUndertrickPenalty(under: number, vul: boolean): number {
  if (vul) return 300 * under - 100 // 200, 500, 800, …
  let p = 0
  for (let i = 1; i <= under; i++) {
    if (i === 1) p += 100
    else if (i <= 3) p += 200
    else p += 300
  }
  return p
}

/**
 * Score one deal from the declaring side's perspective.
 * Returns { made, points } where `points` is always ≥ 0 — awarded to the
 * declaring side if made, otherwise to the defenders.
 */
export function scoreDeal(
  level: number, strain: Strain, doubled: boolean, redoubled: boolean,
  declarerTricks: number, vul: boolean,
): { made: boolean; points: number } {
  const needed = 6 + level
  const mult = redoubled ? 4 : doubled ? 2 : 1

  if (declarerTricks >= needed) {
    const contractPts = contractedTrickPoints(level, strain) * mult
    let score = contractPts
    // Game vs part-score bonus.
    score += contractPts >= 100 ? (vul ? 500 : 300) : 50
    // Slam bonuses.
    if (level === 6) score += vul ? 750 : 500
    if (level === 7) score += vul ? 1500 : 1000
    // Insult bonus for making a (re)doubled contract.
    if (redoubled) score += 100
    else if (doubled) score += 50
    // Overtricks.
    const over = declarerTricks - needed
    if (over > 0) {
      if (redoubled) score += over * (vul ? 400 : 200)
      else if (doubled) score += over * (vul ? 200 : 100)
      else score += over * (strain === 'NT' ? 30 : perTrickValue(strain))
    }
    return { made: true, points: score }
  }

  const under = needed - declarerTricks
  let pen: number
  if (redoubled) pen = doubledUndertrickPenalty(under, vul) * 2
  else if (doubled) pen = doubledUndertrickPenalty(under, vul)
  else pen = under * (vul ? 100 : 50)
  return { made: false, points: pen }
}

// ── match lifecycle ──────────────────────────────────────────────────────

export function newGame(targetScore = 500, rng: () => number = Math.random): GameState {
  const dealer: Position = 'S'
  const deck = shuffle(newDeck(), rng)
  return {
    hands: deal(deck, dealer),
    dealer,
    dealNumber: 1,
    turn: dealer, // dealer bids first
    phase: 'auction',
    calls: [],
    contract: null,
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    tricksWon: { NS: 0, EW: 0 },
    dummyRevealed: false,
    score: { NS: 0, EW: 0 },
    vulnerable: vulnerabilityFor(1),
    targetScore,
    lastResult: null,
  }
}

export function startNewHand(state: GameState, rng: () => number = Math.random): GameState {
  const dealer = nextPosition(state.dealer)
  const dealNumber = state.dealNumber + 1
  const deck = shuffle(newDeck(), rng)
  return {
    ...state,
    hands: deal(deck, dealer),
    dealer,
    dealNumber,
    turn: dealer,
    phase: 'auction',
    calls: [],
    contract: null,
    trick: { plays: [], leadSuit: null },
    tricksPlayed: 0,
    tricksWon: { NS: 0, EW: 0 },
    dummyRevealed: false,
    vulnerable: vulnerabilityFor(dealNumber),
    lastResult: null,
  }
}

export function gameWinner(state: GameState): Team {
  return state.score.NS >= state.score.EW ? 'NS' : 'EW'
}

// ── shared helpers (used by AI + wrapper) ─────────────────────────────────

export function highCardPoints(hand: Card[]): number {
  let hcp = 0
  for (const c of hand) {
    if (c.rank === 'A') hcp += 4
    else if (c.rank === 'K') hcp += 3
    else if (c.rank === 'Q') hcp += 2
    else if (c.rank === 'J') hcp += 1
  }
  return hcp
}

export function suitLengths(hand: Card[]): Record<Suit, number> {
  const len: Record<Suit, number> = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 }
  for (const c of hand) len[c.suit]++
  return len
}

export { RANK_ORDER, STRAIN_ORDER, POSITIONS, STRAINS }
