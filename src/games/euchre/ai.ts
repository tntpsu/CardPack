// Euchre AI. Three difficulty tiers in v0.2 — Easy / Medium / Hard.
// Pure functions of GameState + difficulty — no internal state, no mutation.
//
// Easy   : random legal play; orders only on 4+ trumps (very passive).
// Medium : count-trumps bidding + min-winner / max-dump play (v0.1 default).
// Hard   : Medium + partner-aware (don't override partner who's already
//          winning the trick).

import {
  callTrump,
  cardStrength,
  effectiveSuit,
  legalPlays,
  orderUp,
  passBid,
  playCard,
  type Card,
  type GameState,
  type Position,
  type Suit,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

function teammate(pos: Position): Position {
  return pos === 'N' ? 'S' : pos === 'S' ? 'N' : pos === 'E' ? 'W' : 'E'
}

// ─── Bidding ─────────────────────────────────────────────────────────

/** Decide whether to order up + (if so) which card the dealer discards.
 *  Heuristic: count trumps if upCard.suit becomes trump. Order if 3+
 *  trumps in hand (not counting the upcard). Dealer always considers
 *  the upcard as a free trump. */
export function aiBidRound1(
  state: GameState,
  pos: Position,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): { action: 'order'; discard: Card } | { action: 'pass' } {
  const trumpSuit = state.upCard.suit
  const hand = state.hands[pos]
  const trumpCount = hand.filter(c => effectiveSuit(c, trumpSuit) === trumpSuit).length
  const isDealer = pos === state.dealer
  const isPartnerOfDealer = state.dealer === 'S' && pos === 'N'
    || state.dealer === 'N' && pos === 'S'
    || state.dealer === 'W' && pos === 'E'
    || state.dealer === 'E' && pos === 'W'

  // Dealer effectively gets an extra trump (the upcard)
  const effectiveTrumps = trumpCount + (isDealer || isPartnerOfDealer ? 1 : 0)
  // Easy: only order on 4+ trumps (very passive). Medium/Hard: 3+.
  const orderThreshold = difficulty === 'easy' ? 4 : 3
  if (effectiveTrumps >= orderThreshold) {
    if (isDealer) {
      // Dealer picks up + must discard. Discard the weakest non-trump.
      const handPlusUp = [...hand, state.upCard]
      const discard = pickDiscard(handPlusUp, trumpSuit)
      return { action: 'order', discard }
    }
    return { action: 'order', discard: state.upCard } // dummy — engine will use dealer's discard logic
  }
  return { action: 'pass' }
}

/** Pick the weakest card in hand, treating trump as untouchable when
 *  there are non-trumps available. */
function pickDiscard(hand: Card[], trumpSuit: Suit): Card {
  const nonTrump = hand.filter(c => effectiveSuit(c, trumpSuit) !== trumpSuit)
  const pool = nonTrump.length > 0 ? nonTrump : hand
  // Sort by strength assuming we're leading off-suit (cardStrength
  // requires a leadSuit; pick the trump suit so off-suit comparison is
  // consistent). The weakest is the one with the lowest strength.
  return pool
    .slice()
    .sort((a, b) => cardStrength(a, trumpSuit, trumpSuit) - cardStrength(b, trumpSuit, trumpSuit))[0]!
}

/** Round 2 — pick a suit to call OR pass. Heuristic: tally trump
 *  candidates per suit; call the strongest IF it gives ≥3 trumps. */
export function aiBidRound2(
  state: GameState,
  pos: Position,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): { action: 'call'; suit: Suit } | { action: 'pass' } {
  const hand = state.hands[pos]
  const candidates: Suit[] = (['♠', '♥', '♦', '♣'] as Suit[]).filter(s => s !== state.forbiddenTrumpRound2)
  let best: { suit: Suit; count: number } | null = null
  for (const s of candidates) {
    const count = hand.filter(c => effectiveSuit(c, s) === s).length
    if (best === null || count > best.count) best = { suit: s, count }
  }
  // Stick-the-dealer: dealer cannot pass on round 2 if all others passed
  const isStickDealer = pos === state.dealer && state.passes === 3
  if (isStickDealer) {
    return { action: 'call', suit: best!.suit }
  }
  const callThreshold = difficulty === 'easy' ? 4 : 3
  if (best && best.count >= callThreshold) return { action: 'call', suit: best.suit }
  return { action: 'pass' }
}

// ─── Play ────────────────────────────────────────────────────────────

/** Pick a legal card to play. Heuristics:
 *  - If leading + holding a strong trump: lead it
 *  - If following + can win: play minimum winner
 *  - If can't win: dump the weakest legal card */
export function aiPlay(
  state: GameState,
  pos: Position,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): Card {
  const legal = legalPlays(state, pos)
  if (legal.length === 1) return legal[0]!
  if (state.trump === null) throw new Error('aiPlay: trump not set during play')

  // Easy: pick uniformly from legal plays. Reasonable opponents that
  // don't punish mistakes — good for new players learning the rules.
  if (difficulty === 'easy') {
    return legal[Math.floor(Math.random() * legal.length)]!
  }

  const trump = state.trump
  const leadSuit = state.trick.leadSuit

  if (leadSuit === null) {
    const sorted = legal.slice().sort((a, b) => cardStrength(b, trump, trump) - cardStrength(a, trump, trump))
    return sorted[0]!
  }

  // Find current best card + who's playing it.
  const bestPlay = state.trick.plays.reduce((best, cur) =>
    cardStrength(cur.card, trump, leadSuit) > cardStrength(best.card, trump, leadSuit) ? cur : best,
  )
  const bestSoFar = cardStrength(bestPlay.card, trump, leadSuit)

  // Hard: if partner is currently winning, dump weakest legal — don't
  // step on partner's trick. Skip when there's still a player to act
  // after us (we don't know if an opponent will overtake), but for the
  // last seat (3rd or 4th to play in a 4-player trick) this is safe.
  if (difficulty === 'hard' && state.trick.plays.length >= 2) {
    if (bestPlay.pos === teammate(pos)) {
      return legal.slice().sort((a, b) => cardStrength(a, trump, leadSuit) - cardStrength(b, trump, leadSuit))[0]!
    }
  }

  const winners = legal.filter(c => cardStrength(c, trump, leadSuit) > bestSoFar)
  if (winners.length > 0) {
    return winners.slice().sort((a, b) => cardStrength(a, trump, leadSuit) - cardStrength(b, trump, leadSuit))[0]!
  }
  return legal.slice().sort((a, b) => cardStrength(a, trump, leadSuit) - cardStrength(b, trump, leadSuit))[0]!
}

// ─── Driver: advance the game past all AI turns ─────────────────────

/** Advance the game by running AI turns until the human (south) needs to
 *  act, OR the hand/game ends. Returns the new state. */
/** Apply ONE AI action (bid, call, or play) for the current turn-holder.
 *  Caller is responsible for ensuring it isn't the human's turn. Used
 *  by main.ts to pace AI steps with delays + trick-completion lingers
 *  the user can actually see. */
export function applyOneAiStep(
  state: GameState,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): GameState {
  if (state.phase === 'order-up') {
    const decision = aiBidRound1(state, state.turn, difficulty)
    if (decision.action === 'order') {
      const dealerHandPlusUp = [...state.hands[state.dealer], state.upCard]
      const trumpSuit = state.upCard.suit
      const discard = pickDiscard(dealerHandPlusUp, trumpSuit)
      return orderUp(state, discard)
    }
    return passBid(state)
  }
  if (state.phase === 'call-trump') {
    const decision = aiBidRound2(state, state.turn, difficulty)
    if (decision.action === 'call') return callTrump(state, decision.suit)
    return passBid(state)
  }
  if (state.phase === 'play') {
    const card = aiPlay(state, state.turn, difficulty)
    return playCard(state, state.turn, card)
  }
  return state
}

export function autoplayUntilHuman(
  state: GameState,
  human: Position = 'S',
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): GameState {
  let s = state
  for (let i = 0; i < 30; i++) {
    if (s.phase === 'hand-end' || s.phase === 'game-end') return s
    if (s.turn === human) return s
    s = applyOneAiStep(s, difficulty)
  }
  return s
}
