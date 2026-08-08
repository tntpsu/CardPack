// Bridge engine + GameHandle wrapper tests.
//
// Engine coverage: auction legality/ranking/termination, declarer
// determination, doubled/redoubled tracking, trump + NT trick winners,
// follow-suit, the full duplicate-style scoring tables (made / set / doubled
// / slam / vulnerable), and the match-to-target lifecycle. A seeded self-play
// loop drives many full deals to prove auctions always terminate and the AI
// never emits an illegal call or play.
//
// Wrapper coverage: instantiate via bridgeGame.init(mockCtx) and exercise
// render / handleGlassesInput across phases, with crafted states injected by
// reflection (same pattern as spades.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameHandle, GameStorage, PlatformContext } from 'even-card-platform'
import { sortBySuit } from 'even-card-platform'
import { bridgeGame } from '../../src/games/bridge'
import { aiCall, aiPlay } from '../../src/games/bridge/ai'
import {
  auctionComplete, callIsLegal, contractedTrickPoints, controllerOf, dummyOf,
  legalCalls, legalPlays, newGame, placeCall, playCard, resolveContract,
  scoreDeal, standingBid, startNewHand, trickWinner, vulnerabilityFor,
  type Call, type CallRecord, type GameState, type Position, type Strain, type Trick,
} from '../../src/games/bridge/engine'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain })
const pass: Call = { kind: 'pass' }
const dbl: Call = { kind: 'double' }
const rdbl: Call = { kind: 'redouble' }

// ── auction mechanics ──────────────────────────────────────────────────────

describe('bridge auction — legality & ranking', () => {
  it('a bid must outrank the standing bid', () => {
    const calls: CallRecord[] = [{ pos: 'S', call: bid(2, '♥') }]
    expect(callIsLegal(calls, 'W', bid(2, '♠'))).toBe(true) // higher strain, same level
    expect(callIsLegal(calls, 'W', bid(3, '♣'))).toBe(true) // higher level
    expect(callIsLegal(calls, 'W', bid(2, '♦'))).toBe(false) // lower strain
    expect(callIsLegal(calls, 'W', bid(2, '♥'))).toBe(false) // equal
    expect(callIsLegal(calls, 'W', bid(1, 'NT'))).toBe(false) // lower level
  })

  it('NT outranks all suits at the same level', () => {
    const calls: CallRecord[] = [{ pos: 'S', call: bid(3, '♠') }]
    expect(callIsLegal(calls, 'W', bid(3, 'NT'))).toBe(true)
  })

  it('pass is always legal; any first bid is legal', () => {
    expect(callIsLegal([], 'S', pass)).toBe(true)
    expect(callIsLegal([], 'S', bid(1, '♣'))).toBe(true)
    expect(callIsLegal([], 'S', bid(7, 'NT'))).toBe(true)
  })

  it('double is legal only against an opponent bid, once', () => {
    const oppBid: CallRecord[] = [{ pos: 'S', call: bid(1, '♥') }]
    expect(callIsLegal(oppBid, 'W', dbl)).toBe(true) // W doubles S (opponent)
    expect(callIsLegal(oppBid, 'N', dbl)).toBe(false) // N is S's partner
    const doubled: CallRecord[] = [...oppBid, { pos: 'W', call: dbl }]
    expect(callIsLegal(doubled, 'E', dbl)).toBe(false) // already doubled
  })

  it('redouble is legal only when our side bid was doubled', () => {
    const calls: CallRecord[] = [
      { pos: 'S', call: bid(1, '♥') },
      { pos: 'W', call: dbl },
    ]
    expect(callIsLegal(calls, 'N', rdbl)).toBe(true) // N (S's partner) redoubles
    expect(callIsLegal(calls, 'S', rdbl)).toBe(true)
    expect(callIsLegal(calls, 'E', rdbl)).toBe(false) // E is on the doubling side
  })

  it('a new bid clears the doubled state', () => {
    const calls: CallRecord[] = [
      { pos: 'S', call: bid(1, '♥') },
      { pos: 'W', call: dbl },
      { pos: 'N', call: bid(2, '♥') },
    ]
    const c = resolveContract([...calls, { pos: 'E', call: pass }, { pos: 'S', call: pass }, { pos: 'W', call: pass }])
    expect(c?.doubled).toBe(false)
  })
})

describe('bridge auction — termination & contract', () => {
  it('four opening passes is passed out (no contract)', () => {
    const calls: CallRecord[] = (['S', 'W', 'N', 'E'] as Position[]).map(pos => ({ pos, call: pass }))
    expect(auctionComplete(calls)).toBe(true)
    expect(resolveContract(calls)).toBeNull()
  })

  it('a bid followed by three passes ends the auction', () => {
    const calls: CallRecord[] = [
      { pos: 'S', call: bid(3, 'NT') },
      { pos: 'W', call: pass },
      { pos: 'N', call: pass },
    ]
    expect(auctionComplete(calls)).toBe(false)
    calls.push({ pos: 'E', call: pass })
    expect(auctionComplete(calls)).toBe(true)
    expect(resolveContract(calls)).toMatchObject({ level: 3, strain: 'NT', declarer: 'S' })
  })

  it('declarer is the first of the side to name the strain', () => {
    // N opens 1♥, E pass, S (partner) bids 2♥, all pass → N declares (first ♥).
    const calls: CallRecord[] = [
      { pos: 'N', call: bid(1, '♥') },
      { pos: 'E', call: pass },
      { pos: 'S', call: bid(2, '♥') },
      { pos: 'W', call: pass },
      { pos: 'N', call: pass },
      { pos: 'E', call: pass },
    ]
    expect(resolveContract(calls)).toMatchObject({ level: 2, strain: '♥', declarer: 'N' })
  })

  it('placeCall: passed-out deal → hand-end; live auction → play with LHO on lead', () => {
    let s = newGame(500, mulberry32(1))
    // S deals (turn S). Everyone passes → passed out.
    for (const pos of ['S', 'W', 'N', 'E'] as Position[]) s = placeCall(s, pos, pass)
    expect(s.phase).toBe('hand-end')
    expect(s.lastResult?.passedOut).toBe(true)

    let t = newGame(500, mulberry32(1))
    t = placeCall(t, 'S', bid(1, 'NT'))
    t = placeCall(t, 'W', pass)
    t = placeCall(t, 'N', pass)
    t = placeCall(t, 'E', pass)
    expect(t.phase).toBe('play')
    expect(t.contract).toMatchObject({ level: 1, strain: 'NT', declarer: 'S' })
    expect(t.turn).toBe('W') // declarer's left-hand opponent leads
  })

  it('standingBid reports the latest bid ignoring pass/double', () => {
    const calls: CallRecord[] = [
      { pos: 'S', call: bid(1, '♣') },
      { pos: 'W', call: bid(1, '♥') },
      { pos: 'N', call: dbl },
    ]
    expect(standingBid(calls)).toMatchObject({ pos: 'W', level: 1, strain: '♥' })
  })
})

// ── play mechanics ─────────────────────────────────────────────────────────

describe('bridge play — legality, trump, dummy', () => {
  it('must follow suit when able, else free', () => {
    const s = newGame(500, mulberry32(2))
    const st: GameState = {
      ...s,
      phase: 'play',
      contract: { level: 4, strain: '♥', declarer: 'S', doubled: false, redoubled: false },
      turn: 'W',
      hands: {
        ...s.hands,
        W: [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: '2' }, { suit: '♦', rank: '5' }],
      },
      trick: { plays: [{ pos: 'N', card: { suit: '♠', rank: 'K' } }], leadSuit: '♠' },
    }
    const legal = legalPlays(st, 'W')
    expect(legal).toEqual([{ suit: '♠', rank: 'A' }]) // only the spade follows

    const voidSt: GameState = { ...st, hands: { ...st.hands, W: [{ suit: '♥', rank: '2' }, { suit: '♦', rank: '5' }] } }
    expect(legalPlays(voidSt, 'W')).toHaveLength(2) // void in ♠ → anything
  })

  it('highest trump wins; with no trump highest of led suit wins', () => {
    const trumpTrick: Trick = {
      leadSuit: '♦',
      plays: [
        { pos: 'S', card: { suit: '♦', rank: 'A' } },
        { pos: 'W', card: { suit: '♥', rank: '2' } }, // ♥ trump ruffs the ace
        { pos: 'N', card: { suit: '♦', rank: 'K' } },
        { pos: 'E', card: { suit: '♦', rank: 'Q' } },
      ],
    }
    expect(trickWinner(trumpTrick, '♥')).toBe('W')

    const ntTrick: Trick = {
      leadSuit: '♦',
      plays: [
        { pos: 'S', card: { suit: '♦', rank: '9' } },
        { pos: 'W', card: { suit: '♥', rank: 'A' } }, // off-suit can't win at NT
        { pos: 'N', card: { suit: '♦', rank: 'K' } },
        { pos: 'E', card: { suit: '♦', rank: '3' } },
      ],
    }
    expect(trickWinner(ntTrick, 'NT')).toBe('N')
  })

  it('dummy is declarer\'s partner; declarer controls both seats', () => {
    const s = newGame(500, mulberry32(3))
    const st: GameState = {
      ...s, phase: 'play',
      contract: { level: 3, strain: 'NT', declarer: 'S', doubled: false, redoubled: false },
    }
    expect(dummyOf(st)).toBe('N')
    expect(controllerOf(st, 'N')).toBe('S') // declarer plays the dummy
    expect(controllerOf(st, 'S')).toBe('S')
    expect(controllerOf(st, 'W')).toBe('W') // defenders play themselves
    expect(controllerOf(st, 'E')).toBe('E')
  })

  it('opening lead reveals the dummy', () => {
    let s = newGame(500, mulberry32(4))
    s = placeCall(s, 'S', bid(1, 'NT'))
    s = placeCall(s, 'W', pass)
    s = placeCall(s, 'N', pass)
    s = placeCall(s, 'E', pass)
    expect(s.dummyRevealed).toBe(false)
    const lead = legalPlays(s, 'W')[0]!
    s = playCard(s, 'W', lead)
    expect(s.dummyRevealed).toBe(true)
  })
})

// ── scoring tables ─────────────────────────────────────────────────────────

describe('bridge scoring — making contracts', () => {
  it('contractedTrickPoints by strain', () => {
    expect(contractedTrickPoints(5, '♣')).toBe(100) // 5×20
    expect(contractedTrickPoints(4, '♥')).toBe(120) // 4×30
    expect(contractedTrickPoints(3, 'NT')).toBe(100) // 40+30+30
    expect(contractedTrickPoints(1, 'NT')).toBe(40)
  })

  it('part-scores and games, non-vulnerable', () => {
    expect(scoreDeal(1, 'NT', false, false, 7, false)).toEqual({ made: true, points: 90 }) // 40 + 50
    expect(scoreDeal(2, '♠', false, false, 8, false)).toEqual({ made: true, points: 110 }) // 60 + 50
    expect(scoreDeal(3, 'NT', false, false, 9, false)).toEqual({ made: true, points: 400 }) // 100 + 300
    expect(scoreDeal(4, '♥', false, false, 10, false)).toEqual({ made: true, points: 420 }) // 120 + 300
    expect(scoreDeal(5, '♣', false, false, 11, false)).toEqual({ made: true, points: 400 }) // 100 + 300
  })

  it('games are bigger when vulnerable', () => {
    expect(scoreDeal(4, '♥', false, false, 10, true)).toEqual({ made: true, points: 620 }) // 120 + 500
  })

  it('overtricks score (undoubled = trick value)', () => {
    expect(scoreDeal(4, '♥', false, false, 11, false)).toEqual({ made: true, points: 450 }) // 420 + 30
    expect(scoreDeal(3, 'NT', false, false, 11, false)).toEqual({ made: true, points: 460 }) // 400 + 2×30
  })

  it('slam bonuses', () => {
    expect(scoreDeal(6, '♠', false, false, 12, false)).toEqual({ made: true, points: 980 }) // 180+300+500
    expect(scoreDeal(6, '♠', false, false, 12, true)).toEqual({ made: true, points: 1430 }) // 180+500+750
    expect(scoreDeal(7, 'NT', false, false, 13, false)).toEqual({ made: true, points: 1520 }) // 220+300+1000
    expect(scoreDeal(7, 'NT', false, false, 13, true)).toEqual({ made: true, points: 2220 }) // 220+500+1500
  })

  it('doubled making: contract value doubles, +50 insult, doubled overtricks', () => {
    // 2♥X made exactly: 120 trick (≥100 ⇒ game) + 300 game + 50 insult = 470
    expect(scoreDeal(2, '♥', true, false, 8, false)).toEqual({ made: true, points: 470 })
    // 2♥X +1 nonvul: 470 + 100 (doubled overtrick nonvul) = 570
    expect(scoreDeal(2, '♥', true, false, 9, false)).toEqual({ made: true, points: 570 })
  })
})

describe('bridge scoring — defeated contracts (points to defenders)', () => {
  it('undoubled undertricks', () => {
    expect(scoreDeal(3, 'NT', false, false, 7, false)).toEqual({ made: false, points: 100 }) // 2×50
    expect(scoreDeal(3, 'NT', false, false, 7, true)).toEqual({ made: false, points: 200 }) // 2×100
  })

  it('doubled undertricks, non-vulnerable: 100/300/500/800', () => {
    expect(scoreDeal(4, '♠', true, false, 9, false)).toEqual({ made: false, points: 100 }) // down 1
    expect(scoreDeal(4, '♠', true, false, 8, false)).toEqual({ made: false, points: 300 }) // down 2
    expect(scoreDeal(4, '♠', true, false, 7, false)).toEqual({ made: false, points: 500 }) // down 3
    expect(scoreDeal(4, '♠', true, false, 6, false)).toEqual({ made: false, points: 800 }) // down 4
  })

  it('doubled undertricks, vulnerable: 200/500/800', () => {
    expect(scoreDeal(4, '♠', true, false, 9, true)).toEqual({ made: false, points: 200 }) // down 1
    expect(scoreDeal(4, '♠', true, false, 8, true)).toEqual({ made: false, points: 500 }) // down 2
  })

  it('redoubled = double the doubled penalty', () => {
    expect(scoreDeal(4, '♠', false, true, 9, false)).toEqual({ made: false, points: 200 }) // 2×100
  })
})

// ── vulnerability cycle & match lifecycle ──────────────────────────────────

describe('bridge — match lifecycle', () => {
  it('vulnerability cycles none → NS → EW → both', () => {
    expect(vulnerabilityFor(1)).toEqual({ NS: false, EW: false })
    expect(vulnerabilityFor(2)).toEqual({ NS: true, EW: false })
    expect(vulnerabilityFor(3)).toEqual({ NS: false, EW: true })
    expect(vulnerabilityFor(4)).toEqual({ NS: true, EW: true })
    expect(vulnerabilityFor(5)).toEqual({ NS: false, EW: false })
  })

  it('dealer rotates and deal number advances on a new hand', () => {
    const s = newGame(500, mulberry32(9))
    expect(s.dealer).toBe('S')
    const t = startNewHand(s, mulberry32(10))
    expect(t.dealer).toBe('W')
    expect(t.dealNumber).toBe(2)
    expect(t.phase).toBe('auction')
  })

  it('endHand credits the right side and ends the match at target', () => {
    // Construct a state one trick from the end where declarer (S) makes 1NT.
    let s = newGame(120, mulberry32(11))
    s = {
      ...s,
      phase: 'play',
      contract: { level: 1, strain: 'NT', declarer: 'S', doubled: false, redoubled: false },
      tricksWon: { NS: 6, EW: 6 },
      tricksPlayed: 12,
      turn: 'S',
      trick: { plays: [], leadSuit: null },
      hands: { S: [{ suit: '♠', rank: 'A' }], W: [{ suit: '♠', rank: '2' }], N: [{ suit: '♥', rank: '3' }], E: [{ suit: '♦', rank: '4' }] },
      vulnerable: { NS: false, EW: false },
    }
    s = playCard(s, 'S', { suit: '♠', rank: 'A' })
    s = playCard(s, 'W', { suit: '♠', rank: '2' })
    s = playCard(s, 'N', { suit: '♥', rank: '3' })
    s = playCard(s, 'E', { suit: '♦', rank: '4' })
    expect(s.lastResult?.made).toBe(true)
    expect(s.lastResult?.scoringTeam).toBe('NS')
    expect(s.score.NS).toBe(90) // 1NT = 40 + 50 part-score
    expect(s.phase).toBe('hand-end') // 90 < 120 target
  })
})

// ── AI self-play: auctions terminate, no illegal moves ─────────────────────

describe('bridge AI — seeded self-play across many deals', () => {
  it('every auction terminates and the AI never makes an illegal call or play', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 2654435761)
      let s = newGame(500, rng)
      for (let deal = 0; deal < 6 && s.phase !== 'game-end'; deal++) {
        // Auction
        let guard = 0
        while (s.phase === 'auction') {
          expect(++guard).toBeLessThan(60) // must terminate
          const call = aiCall(s, s.turn, 'medium')
          expect(callIsLegal(s.calls, s.turn, call)).toBe(true)
          s = placeCall(s, s.turn, call)
        }
        // Play
        guard = 0
        while (s.phase === 'play') {
          expect(++guard).toBeLessThan(60)
          const card = aiPlay(s, s.turn, 'medium')
          expect(legalPlays(s, s.turn).some(c => c.suit === card.suit && c.rank === card.rank)).toBe(true)
          s = playCard(s, s.turn, card)
        }
        // Deal resolved: 13 tricks split (or passed out).
        if (!s.lastResult?.passedOut) {
          expect(s.tricksWon.NS + s.tricksWon.EW).toBe(13)
        }
        if (s.phase === 'hand-end') s = startNewHand(s, rng)
      }
    }
  })

  it('a 15-17 balanced hand opens 1NT', () => {
    // Craft: ♠AKQ ♥KQ2 ♦Q32 ♣J32 = 4+3+... HCP: A4 K3 Q2 + K3 Q2 + Q2 + J1 = 17, balanced 4-3-3-3
    const s = newGame(500, mulberry32(1))
    const st: GameState = {
      ...s, turn: 'S', phase: 'auction', calls: [],
      hands: {
        ...s.hands,
        S: [
          { suit: '♠', rank: 'A' }, { suit: '♠', rank: 'K' }, { suit: '♠', rank: 'Q' }, { suit: '♠', rank: '4' },
          { suit: '♥', rank: 'K' }, { suit: '♥', rank: 'Q' }, { suit: '♥', rank: '2' },
          { suit: '♦', rank: 'Q' }, { suit: '♦', rank: '3' }, { suit: '♦', rank: '2' },
          { suit: '♣', rank: 'J' }, { suit: '♣', rank: '3' }, { suit: '♣', rank: '2' },
        ],
      },
    }
    expect(aiCall(st, 'S', 'medium')).toEqual({ kind: 'bid', level: 1, strain: 'NT' })
  })
})

// ── wrapper ──────────────────────────────────────────────────────────────

function makeStorage(): GameStorage {
  const mem = new Map<string, string>()
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const raw = mem.get(key)
      if (!raw) return fallback
      try { return JSON.parse(raw) as T } catch { return fallback }
    },
    async set(key, value) { mem.set(key, JSON.stringify(value)) },
    async remove(key) { mem.delete(key) },
  }
}

function makeCtx(): PlatformContext & { endGame: ReturnType<typeof vi.fn>; requestRender: ReturnType<typeof vi.fn> } {
  return { storage: makeStorage(), difficulty: 'medium', endGame: vi.fn(), requestRender: vi.fn() }
}

describe('bridge wrapper — GameHandle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('exposes the Game metadata and phone rules', () => {
    expect(bridgeGame.id).toBe('bridge')
    expect(bridgeGame.category).toBe('trick')
    expect(bridgeGame.renderPhoneRules?.()).toContain('auction')
  })

  it('renders the auction with a call selector on the human turn', () => {
    const h: GameHandle = bridgeGame.init(makeCtx())
    // Deal 1: South deals and bids first → human turn immediately.
    const frame = h.render()
    expect(frame.controlHint).toContain('call')
    expect(frame.body.join('\n')).toContain('Your call ▸')
    h.destroy()
  })

  it('double-tap makes the selected call and advances the auction', () => {
    const h: GameHandle = bridgeGame.init(makeCtx())
    const before = (h as unknown as { state: GameState }).state.calls.length
    h.handleGlassesInput({ kind: 'double-tap' }) // commit the seeded call
    const after = (h as unknown as { state: GameState }).state.calls.length
    expect(after).toBe(before + 1)
    h.destroy()
  })

  it('renders the play view and lets the declarer play a dummy card', () => {
    const ctx = makeCtx()
    const h = bridgeGame.init(ctx) as GameHandle & { state: GameState; cursor: number }
    // Inject: 1NT by S, dummy (N) on lead, declarer controls N.
    const base = newGame(500, mulberry32(21))
    h.state = {
      ...base, phase: 'play', dummyRevealed: true,
      contract: { level: 1, strain: 'NT', declarer: 'S', doubled: false, redoubled: false },
      turn: 'N',
      trick: { plays: [{ pos: 'W', card: { suit: '♣', rank: '5' } }], leadSuit: '♣' },
    }
    const frame = h.render()
    expect(frame.controlHint).toContain('play N') // playing from the dummy seat
    const handBefore = h.state.hands.N.length
    // Point the cursor at a card that legally follows the ♣ lead.
    const legalN = legalPlays(h.state, 'N')
    const sortedN = sortBySuit(h.state.hands.N) as typeof h.state.hands.N
    h.cursor = sortedN.findIndex(c => legalN.some(l => l.suit === c.suit && l.rank === c.rank))
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(h.state.hands.N.length).toBe(handBefore - 1)
    h.destroy()
  })

  it('hand-end double-tap deals the next hand', () => {
    const ctx = makeCtx()
    const h = bridgeGame.init(ctx) as GameHandle & { state: GameState }
    const base = newGame(500, mulberry32(22))
    h.state = {
      ...base, phase: 'hand-end',
      lastResult: { passedOut: true, contract: null, declarerTricks: 0, made: false, points: 0, scoringTeam: null },
    }
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(h.state.phase).toBe('auction')
    expect(h.state.dealNumber).toBe(2)
    h.destroy()
  })

  it('game-end double-tap returns to the menu', () => {
    const ctx = makeCtx()
    const h = bridgeGame.init(ctx) as GameHandle & { state: GameState }
    const base = newGame(500, mulberry32(23))
    h.state = { ...base, phase: 'game-end', score: { NS: 520, EW: 110 } }
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })
})
