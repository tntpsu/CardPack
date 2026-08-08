// Bridge AI — a simplified Standard American bidder + a trump/NT-aware play
// engine. Three difficulty tiers.
//
// HONEST SCOPE: the bidder is rule-based, not tournament-grade. It opens on
// HCP + length, responds/raises conservatively, makes the occasional overcall
// or takeout-style double, and otherwise passes. No Stayman, transfers,
// Blackwood, or competitive rebidding. The design priority is that every
// auction terminates in a plausible contract — partner reaching a part-score
// or game with opponents passing is the common, intended shape.

import {
  callIsLegal, highCardPoints, legalPlays, standingBid, suitLengths,
  partnerOf, teamOf,
  type Call, type Card, type GameState, type Position, type Strain, type Suit,
} from './engine'

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
}
const rankOf = (c: Card) => RANK_VAL[c.rank] ?? 0
const PASS: Call = { kind: 'pass' }
const SUIT_LIST: Suit[] = ['♠', '♥', '♦', '♣']

// ── bidding ────────────────────────────────────────────────────────────────

export function aiCall(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): Call {
  const calls = state.calls
  const hand = state.hands[pos]
  const hcp = highCardPoints(hand)
  const len = suitLengths(hand)
  const lengthPts = SUIT_LIST.reduce((s, su) => s + Math.max(0, len[su] - 4), 0)
  // Easy under-evaluates slightly (bids/competes less); hard counts straight.
  const pts = (difficulty === 'easy' ? hcp - 1 : hcp) + lengthPts

  const std = standingBid(calls)
  const partner = partnerOf(pos)
  const myBids = calls.filter(c => c.pos === pos && c.call.kind === 'bid')
  const partnerBids = calls.filter(c => c.pos === partner && c.call.kind === 'bid')
  const weHaveStd = std !== null && teamOf(std.pos) === teamOf(pos)

  const tryBid = (level: number, strain: Strain): Call | null =>
    callIsLegal(calls, pos, { kind: 'bid', level, strain }) ? { kind: 'bid', level, strain } : null

  // ── Nobody has bid: opening decision ──
  if (!std) {
    if (isBalanced(len) && hcp >= 15 && hcp <= 17) return tryBid(1, 'NT') ?? PASS
    if (isBalanced(len) && hcp >= 20 && hcp <= 21) return tryBid(2, 'NT') ?? PASS
    if (pts >= 22) return tryBid(2, 'NT') ?? PASS
    if (pts >= 12) return tryBid(1, chooseOpeningSuit(len)) ?? PASS
    return PASS
  }

  // ── Our side already holds the standing bid ──
  if (weHaveStd) {
    // Responder: partner opened, we haven't bid yet.
    if (myBids.length === 0 && partnerBids.length > 0) {
      const open = partnerBids[0]!.call as Extract<Call, { kind: 'bid' }>
      return respond(open, hcp, len, tryBid)
    }
    // Opener's rebid / later: only push a major part-score to game with
    // clear extras; otherwise settle. Keeps the auction converging.
    if ((std.strain === '♥' || std.strain === '♠') && std.level < 4 && hcp >= 17) {
      return tryBid(4, std.strain) ?? PASS
    }
    return PASS
  }

  // ── Opponents hold the standing bid: overcall / double / pass ──
  if (hcp >= 16 && callIsLegal(calls, pos, { kind: 'double' })) return { kind: 'double' }
  if (pts >= 8) {
    const longest = longestSuit(len)
    if (len[longest] >= 5) {
      for (let lv = 1; lv <= 3; lv++) {
        const b = tryBid(lv, longest)
        if (b) return b // cheapest legal level only — no jump overcalls
      }
    }
  }
  return PASS
}

function respond(
  open: Extract<Call, { kind: 'bid' }>,
  hcp: number,
  len: Record<Suit, number>,
  tryBid: (level: number, strain: Strain) => Call | null,
): Call {
  // Partner opened NT.
  if (open.strain === 'NT') {
    if (open.level === 1) {
      if (hcp <= 7) return PASS
      if (hcp <= 9) return tryBid(2, 'NT') ?? PASS
      return tryBid(3, 'NT') ?? PASS
    }
    // 2NT (20-21): ~5 HCP gives a play for game.
    if (hcp <= 4) return PASS
    return tryBid(3, 'NT') ?? PASS
  }

  // Partner opened a suit.
  if (hcp < 6) return PASS
  const s = open.strain
  const major = s === '♥' || s === '♠'
  if (len[s] >= 3) {
    if (major) {
      if (hcp <= 9) return tryBid(2, s) ?? PASS
      if (hcp <= 12) return tryBid(3, s) ?? PASS
      return tryBid(4, s) ?? PASS
    }
    // minor fit: prefer NT for game
    if (hcp <= 9) return tryBid(2, s) ?? PASS
    if (hcp <= 12) return tryBid(2, 'NT') ?? tryBid(3, s) ?? PASS
    return tryBid(3, 'NT') ?? PASS
  }

  // No fit: bid a new 4+ suit at the cheapest legal level, else climb the NT ladder.
  const newSuit = pickResponseSuit(len, s)
  if (newSuit) {
    for (let lv = 1; lv <= 3; lv++) {
      const b = tryBid(lv, newSuit)
      if (b) return b
    }
  }
  if (hcp <= 9) return tryBid(1, 'NT') ?? PASS
  if (hcp <= 12) return tryBid(2, 'NT') ?? PASS
  return tryBid(3, 'NT') ?? PASS
}

function isBalanced(len: Record<Suit, number>): boolean {
  const counts = SUIT_LIST.map(s => len[s])
  if (counts.some(c => c === 0 || c === 1)) return false
  return counts.filter(c => c === 2).length <= 1
}

function chooseOpeningSuit(len: Record<Suit, number>): Suit {
  if (len['♠'] >= 5 && len['♠'] >= len['♥']) return '♠'
  if (len['♥'] >= 5) return '♥'
  if (len['♦'] > len['♣']) return '♦'
  if (len['♣'] > len['♦']) return '♣'
  // Equal minors: open the 4-card (♦) or, if 3-3, the club.
  return len['♦'] >= 4 ? '♦' : '♣'
}

function pickResponseSuit(len: Record<Suit, number>, partnerSuit: Suit): Suit | null {
  let best: Suit | null = null
  for (const s of SUIT_LIST) {
    if (s === partnerSuit) continue
    if (len[s] < 4) continue
    if (best === null || len[s] > len[best]) best = s
  }
  return best
}

function longestSuit(len: Record<Suit, number>): Suit {
  let best: Suit = '♠'
  for (const s of SUIT_LIST) if (len[s] > len[best]) best = s
  return best
}

// ── card play ────────────────────────────────────────────────────────────

export function aiPlay(state: GameState, pos: Position, difficulty: Difficulty = DEFAULT_DIFFICULTY): Card {
  const legal = legalPlays(state, pos)
  if (legal.length === 1) return legal[0]!
  if (difficulty === 'easy') return legal[Math.floor(Math.random() * legal.length)]!

  const trump = state.contract!.strain
  const hasTrump = trump !== 'NT'
  const isTrump = (s: Suit) => hasTrump && s === (trump as Suit)
  const trick = state.trick
  const lead = trick.leadSuit
  const lowest = (cs: Card[]) => cs.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]!

  // Leading: cash a non-trump ace, else lead a low non-trump, else low.
  if (lead === null) {
    const aces = legal.filter(c => c.rank === 'A' && !isTrump(c.suit))
    if (aces.length > 0) return aces[0]!
    const nonTrump = legal.filter(c => !isTrump(c.suit))
    return lowest(nonTrump.length > 0 ? nonTrump : legal)
  }

  const matching = legal.filter(c => c.suit === lead)
  const trumpsOnTrick = hasTrump ? trick.plays.filter(p => isTrump(p.card.suit)) : []
  const bestRankOnLead = trick.plays.filter(p => p.card.suit === lead).reduce((m, p) => Math.max(m, rankOf(p.card)), 0)
  const bestTrumpRank = trumpsOnTrick.reduce((m, p) => Math.max(m, rankOf(p.card)), 0)

  if (matching.length > 0) {
    // Following suit. If a trump already ruffed (and lead isn't trump), we
    // can't win — dump our lowest. Else play the cheapest winner, or dump.
    if (trumpsOnTrick.length > 0 && !isTrump(lead)) return lowest(matching)
    const winners = matching.filter(c => rankOf(c) > bestRankOnLead)
    return lowest(winners.length > 0 ? winners : matching)
  }

  // Void in the led suit. Ruff cheaply if we can beat any trump already on.
  if (hasTrump) {
    const myTrumps = legal.filter(c => isTrump(c.suit))
    if (myTrumps.length > 0) {
      const winners = myTrumps.filter(c => rankOf(c) > bestTrumpRank)
      if (winners.length > 0) return lowest(winners)
      const discard = legal.filter(c => !isTrump(c.suit))
      if (discard.length > 0) return lowest(discard)
      return lowest(myTrumps)
    }
  }
  // Can't follow, can't (usefully) trump — discard lowest.
  return lowest(legal)
}
