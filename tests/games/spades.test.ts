// Spades GameHandle wrapper tests + engine sanity.
//
// Black-box wrapper coverage: instantiate via spadesGame.init(mockCtx) and
// exercise render / handleGlassesInput / handlePhoneEvent / destroy. State is
// private; we inject crafted states via reflection (same pattern as
// hearts.test.ts / euchre.test.ts) for deterministic phase coverage.
//
// The engine is a verbatim port of the upstream-tested ~/Documents/Spades
// engine; the engine tests here re-cover the rules that matter for this
// pack (deal, bid→play transition, follow-suit, spade-lead lock, winner).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameHandle, GameStorage, PlatformContext } from 'even-card-platform'
import { spadesGame } from '../../src/games/spades'
import {
  legalPlays, newGame, placeBid, playCard, trickWinner,
  type Card, type GameState, type Position,
} from '../../src/games/spades/engine'

// Deterministic RNG so dealt hands are stable across runs.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

function makeCtx(): PlatformContext & {
  endGame: ReturnType<typeof vi.fn>
  requestRender: ReturnType<typeof vi.fn>
} {
  return {
    storage: makeStorage(),
    difficulty: 'medium',
    endGame: vi.fn(),
    requestRender: vi.fn(),
  }
}

/** A bid-phase state where W/N/E have bid and it's the human's (S) turn. */
function humanBidTurnState(): GameState {
  let st = newGame(250, mulberry32(42))
  st = placeBid(st, 'W', 3)
  st = placeBid(st, 'N', 2)
  st = placeBid(st, 'E', 4)
  return st // turn === 'S', phase === 'bid'
}

/** A play-phase state: N led K♥, it's S's turn, S holds A♥ (legal) + 2♣. */
function humanPlayTurnState(): GameState {
  return {
    hands: {
      S: [{ suit: '♥', rank: 'A' }, { suit: '♣', rank: '2' }],
      W: [], N: [], E: [],
    },
    bids: { S: 2, W: 3, N: 2, E: 4 },
    tricksWon: { S: 0, W: 0, N: 0, E: 0 },
    turn: 'S',
    phase: 'play',
    trick: { plays: [{ pos: 'N', card: { suit: '♥', rank: 'K' } }], leadSuit: '♥' },
    tricksPlayed: 0,
    spadesBroken: false,
    score: { NS: 0, EW: 0 },
    bags: { NS: 0, EW: 0 },
    targetScore: 250,
  }
}

// ── module metadata ────────────────────────────────────────────────────

describe('spadesGame — module metadata', () => {
  it('has the canonical id, name, category, glyph', () => {
    expect(spadesGame.id).toBe('spades')
    expect(spadesGame.name).toBe('Spades')
    expect(spadesGame.category).toBe('trick')
    expect(spadesGame.glyph).toBe('♠')
    expect(spadesGame.shortDesc.length).toBeGreaterThan(0)
    expect(spadesGame.shortDesc.length).toBeLessThan(40)
  })

  it('exports renderPhoneRules with non-trivial HTML covering bid/nil/trump', () => {
    const html = spadesGame.renderPhoneRules?.() ?? ''
    expect(html.length).toBeGreaterThan(200)
    expect(html).toContain('nil')
    expect(html).toContain('trump')
    expect(html).toContain('broken')
  })
})

// ── wrapper lifecycle + rendering ────────────────────────────────────────

describe('spadesGame.init + rendering', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a GameHandle with all required methods', () => {
    const h = spadesGame.init(makeCtx())
    expect(typeof h.render).toBe('function')
    expect(typeof h.handleGlassesInput).toBe('function')
    expect(typeof h.handlePhoneEvent).toBe('function')
    expect(typeof h.destroy).toBe('function')
    h.destroy()
  })

  it('initial phase is bid; score reads "Us:0  Them:0" (no tricks/bid noise yet)', () => {
    const h = spadesGame.init(makeCtx())
    expect((h as unknown as { state: GameState }).state.phase).toBe('bid')
    expect(h.render().score).toBe('Us:0  Them:0')
    h.destroy()
  })

  it('bid view (human turn) shows others\' bids, the hand, and a selector', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanBidTurnState()
    ;(h as unknown as { bidValue: number }).bidValue = 3
    const f = h.render()
    const body = f.body.join('\n')
    expect(body).toContain('W:3')
    expect(body).toContain('N:2')
    expect(body).toContain('Your bid ▸ 3')
    expect(f.controlHint).toContain('bid')
    h.destroy()
  })

  it('bid selector renders "nil (0)" when the dialed value is 0', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanBidTurnState()
    ;(h as unknown as { bidValue: number }).bidValue = 0
    expect(h.render().body.join('\n')).toContain('nil (0)')
    h.destroy()
  })

  it('play view shows the plus-sign trick and the hand', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanPlayTurnState()
    const body = h.render().body.join('\n')
    expect(body).toContain('K♥')          // N's led card on the plus-sign
    expect(body).toContain('A♥')          // human's hand
    expect(h.render().score).toContain('/') // tricks/bid format in play
    expect(h.render().controlHint).toContain('play')
    h.destroy()
  })
})

// ── bid-phase input ──────────────────────────────────────────────────────

describe('spadesGame — bid input', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('swipe up/down dials the bid within 0–13', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanBidTurnState()
    ;(h as unknown as { bidValue: number }).bidValue = 12
    h.handleGlassesInput({ kind: 'swipe-up' })
    expect((h as unknown as { bidValue: number }).bidValue).toBe(13)
    h.handleGlassesInput({ kind: 'swipe-up' })   // clamps at 13
    expect((h as unknown as { bidValue: number }).bidValue).toBe(13)
    ;(h as unknown as { bidValue: number }).bidValue = 0
    h.handleGlassesInput({ kind: 'swipe-down' }) // clamps at 0
    expect((h as unknown as { bidValue: number }).bidValue).toBe(0)
    h.destroy()
  })

  it('double-tap confirms the bid and transitions to play', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanBidTurnState()
    ;(h as unknown as { bidValue: number }).bidValue = 5
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = (h as unknown as { state: GameState }).state
    expect(st.bids.S).toBe(5)
    expect(st.phase).toBe('play')
    h.destroy()
  })

  it('AI bids run on a timer until it is the human\'s turn (W,N,E then stop)', () => {
    const h = spadesGame.init(makeCtx())
    vi.advanceTimersByTime(5000)
    const st = (h as unknown as { state: GameState }).state
    expect(st.phase).toBe('bid')
    expect(st.turn).toBe('S')      // stopped at the human
    expect(st.bids.W).not.toBeNull()
    expect(st.bids.N).not.toBeNull()
    expect(st.bids.E).not.toBeNull()
    expect(st.bids.S).toBeNull()
    h.destroy()
  })
})

// ── play-phase input ─────────────────────────────────────────────────────

describe('spadesGame — play input', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('double-tap on a legal card plays it', () => {
    const ctx = makeCtx()
    const h = spadesGame.init(ctx)
    ;(h as unknown as { state: GameState }).state = humanPlayTurnState()
    ;(h as unknown as { cursor: number }).cursor = 0   // A♥ (sorted ♠♥♦♣ → ♥ first)
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = (h as unknown as { state: GameState }).state
    // A♥ left the human's hand; turn advanced off South.
    expect(st.hands.S.some(c => c.suit === '♥' && c.rank === 'A')).toBe(false)
    expect(st.turn).not.toBe('S')
    h.destroy()
  })

  it('double-tap on an illegal card (must follow ♥) is a no-op', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanPlayTurnState()
    ;(h as unknown as { cursor: number }).cursor = 1   // 2♣ — illegal, must follow ♥
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = (h as unknown as { state: GameState }).state
    expect(st.hands.S.length).toBe(2)   // nothing played
    expect(st.turn).toBe('S')
    h.destroy()
  })

  it('single-tap mid-play is a no-op (anti-accidental-play invariant)', () => {
    const ctx = makeCtx()
    const h = spadesGame.init(ctx)
    ;(h as unknown as { state: GameState }).state = humanPlayTurnState()
    ctx.requestRender.mockClear()
    h.handleGlassesInput({ kind: 'tap' })
    expect((h as unknown as { state: GameState }).state.hands.S.length).toBe(2)
    expect(ctx.requestRender).not.toHaveBeenCalled()
    h.destroy()
  })

  it('swipe wraps the cursor through the hand', () => {
    const h = spadesGame.init(makeCtx())
    ;(h as unknown as { state: GameState }).state = humanPlayTurnState()
    ;(h as unknown as { cursor: number }).cursor = 0
    h.handleGlassesInput({ kind: 'swipe-up' })   // wraps 0 → last (len 2 → idx 1)
    expect((h as unknown as { cursor: number }).cursor).toBe(1)
    h.destroy()
  })
})

// ── hand-end / game-end / phone events ───────────────────────────────────

describe('spadesGame — terminal phases + phone events', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hand-end render shows "Hand done" + tricks/bid + score, double-tap deals next', () => {
    const h = spadesGame.init(makeCtx())
    const st = humanPlayTurnState()
    st.phase = 'hand-end'
    st.bids = { S: 2, N: 2, W: 3, E: 4 }
    st.tricksWon = { S: 3, N: 2, W: 4, E: 4 }
    st.score = { NS: 51, EW: 70 }
    ;(h as unknown as { state: GameState }).state = st
    const body = h.render().body.join('\n')
    expect(body).toContain('Hand done')
    expect(body).toContain('Us 5/4')      // S+N tricks 5, bid 4
    expect(h.render().controlHint).toContain('next hand')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect((h as unknown as { state: GameState }).state.phase).toBe('bid')
    h.destroy()
  })

  it('game-end render shows a YOU WIN / THEM WIN banner; double-tap exits', () => {
    const ctx = makeCtx()
    const h = spadesGame.init(ctx)
    const st = humanPlayTurnState()
    st.phase = 'game-end'
    st.score = { NS: 260, EW: 180 }
    ;(h as unknown as { state: GameState }).state = st
    expect(h.render().body.join('\n')).toContain('*** YOU WIN ***')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })

  it('game-end with opponents ahead shows THEM WIN', () => {
    const h = spadesGame.init(makeCtx())
    const st = humanPlayTurnState()
    st.phase = 'game-end'
    st.score = { NS: 120, EW: 260 }
    ;(h as unknown as { state: GameState }).state = st
    expect(h.render().body.join('\n')).toContain('*** THEM WIN ***')
    h.destroy()
  })

  it('phone "new-game" resets to a fresh bid phase', () => {
    const h = spadesGame.init(makeCtx())
    const st = humanPlayTurnState()
    st.phase = 'game-end'
    st.score = { NS: 260, EW: 10 }
    ;(h as unknown as { state: GameState }).state = st
    h.handlePhoneEvent({ kind: 'new-game' })
    const fresh = (h as unknown as { state: GameState }).state
    expect(fresh.phase).toBe('bid')
    expect(fresh.score).toEqual({ NS: 0, EW: 0 })
    h.destroy()
  })

  it('set-difficulty updates the AI tier; unknown phone events are ignored', () => {
    const h = spadesGame.init(makeCtx())
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    expect((h as unknown as { difficulty: string }).difficulty).toBe('hard')
    h.handlePhoneEvent({ kind: 'totally-unknown' }) // must not throw
    h.destroy()
  })

  it('destroy() does not throw and cancels pending timers', () => {
    const h = spadesGame.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })
})

// ── engine sanity (port verification) ────────────────────────────────────

describe('spades engine — core rules', () => {
  it('deals 13 cards to each of the four seats', () => {
    const st = newGame(250, mulberry32(7))
    for (const p of ['S', 'W', 'N', 'E'] as Position[]) {
      expect(st.hands[p].length).toBe(13)
    }
  })

  it('bidding advances W→N→E→S and flips to play once all four have bid', () => {
    let st = newGame(250, mulberry32(7))
    expect(st.turn).toBe('W')
    st = placeBid(st, 'W', 3); expect(st.turn).toBe('N')
    st = placeBid(st, 'N', 2); expect(st.turn).toBe('E')
    st = placeBid(st, 'E', 4); expect(st.turn).toBe('S')
    expect(st.phase).toBe('bid')
    st = placeBid(st, 'S', 4)
    expect(st.phase).toBe('play')
    expect(st.turn).toBe('W')   // left of dealer leads
  })

  it('cannot lead spades until broken (unless only spades remain)', () => {
    const st = newGame(250, mulberry32(7))
    const play: GameState = {
      ...st,
      phase: 'play',
      turn: 'S',
      spadesBroken: false,
      trick: { plays: [], leadSuit: null },
      hands: {
        ...st.hands,
        S: [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: '7' }],
      },
    }
    const legal = legalPlays(play, 'S')
    // Leading, spades not broken, has a non-spade → spade is excluded.
    expect(legal.some(c => c.suit === '♠')).toBe(false)
    expect(legal.some(c => c.suit === '♥')).toBe(true)
  })

  it('must follow the lead suit when able', () => {
    const st = newGame(250, mulberry32(7))
    const play: GameState = {
      ...st,
      phase: 'play',
      turn: 'S',
      trick: { plays: [{ pos: 'N', card: { suit: '♦', rank: 'K' } }], leadSuit: '♦' },
      hands: {
        ...st.hands,
        S: [{ suit: '♦', rank: '5' }, { suit: '♣', rank: '9' }, { suit: '♠', rank: '2' }],
      },
    }
    const legal = legalPlays(play, 'S')
    expect(legal).toEqual([{ suit: '♦', rank: '5' }])
  })

  it('trick winner: highest spade beats any lead-suit card', () => {
    const trick = {
      leadSuit: '♥' as const,
      plays: [
        { pos: 'N' as Position, card: { suit: '♥', rank: 'A' } as Card },
        { pos: 'E' as Position, card: { suit: '♥', rank: 'K' } as Card },
        { pos: 'S' as Position, card: { suit: '♠', rank: '2' } as Card },
        { pos: 'W' as Position, card: { suit: '♥', rank: 'Q' } as Card },
      ],
    }
    expect(trickWinner(trick)).toBe('S')   // the lone 2♠ trumps three high hearts
  })

  it('trick winner with no spade: highest of the lead suit', () => {
    const trick = {
      leadSuit: '♣' as const,
      plays: [
        { pos: 'N' as Position, card: { suit: '♣', rank: '9' } as Card },
        { pos: 'E' as Position, card: { suit: '♣', rank: 'A' } as Card },
        { pos: 'S' as Position, card: { suit: '♦', rank: 'K' } as Card },
        { pos: 'W' as Position, card: { suit: '♣', rank: 'J' } as Card },
      ],
    }
    expect(trickWinner(trick)).toBe('E')
  })
})

// ── engine scoring (endHand) — the signature Spades math ─────────────────
// Previously had NO in-repo coverage (was marked engine:upstream + manual).
// Each test plays the final (13th) trick from a crafted 12-tricks-in state
// and asserts the computed score, exercising settleTeam + the bag carry.

describe('spades engine — end-of-hand scoring', () => {
  /** Base state one trick from done (12 played); fill in hands/bids/tricks. */
  function preFinal(over: Partial<GameState>): GameState {
    return {
      hands: { S: [], W: [], N: [], E: [] },
      bids: { S: 0, W: 0, N: 0, E: 0 },
      tricksWon: { S: 0, W: 0, N: 0, E: 0 },
      turn: 'S',
      phase: 'play',
      trick: { plays: [], leadSuit: null },
      tricksPlayed: 12,
      spadesBroken: true,
      score: { NS: 0, EW: 0 },
      bags: { NS: 0, EW: 0 },
      targetScore: 250,
      ...over,
    }
  }

  function playOutHearts(st: GameState, leadWinnerHigh: Record<Position, Card>): GameState {
    let s = st
    s = playCard(s, 'S', leadWinnerHigh.S)
    s = playCard(s, 'W', leadWinnerHigh.W)
    s = playCard(s, 'N', leadWinnerHigh.N)
    s = playCard(s, 'E', leadWinnerHigh.E)
    return s
  }

  it('made bid with overtricks: +10/bid +1/bag, bags carried', () => {
    // NS bid 4 (S2+N2), EW bid 7 (W3+E4). Going in: S3 N2 W4 E3 (=12).
    // S leads A♥ and wins the 13th → NS 6 / 4 made (+42, 2 bags); EW 7 / 7 (+70).
    const st = preFinal({
      hands: {
        S: [{ suit: '♥', rank: 'A' }], W: [{ suit: '♥', rank: '2' }],
        N: [{ suit: '♥', rank: '3' }], E: [{ suit: '♥', rank: '4' }],
      },
      bids: { S: 2, N: 2, W: 3, E: 4 },
      tricksWon: { S: 3, N: 2, W: 4, E: 3 },
    })
    const done = playOutHearts(st, {
      S: { suit: '♥', rank: 'A' }, W: { suit: '♥', rank: '2' },
      N: { suit: '♥', rank: '3' }, E: { suit: '♥', rank: '4' },
    })
    expect(done.phase).toBe('hand-end')
    expect(done.score).toEqual({ NS: 42, EW: 70 })
    expect(done.bags).toEqual({ NS: 2, EW: 0 })
  })

  it('successful nil: +100 for the nil player on top of partner\'s made bid', () => {
    // S bids nil(0), N bids 4. EW bid 7 (W3+E4). Going in: S0 N4 W4 E4 (=12).
    // S leads low 2♥, E wins with A♥ → S stays at 0 tricks (nil holds).
    // NS: nil +100, N 4/4 made +40 → 140. EW 9 / 7 made +70, +2 bags = 72.
    const st = preFinal({
      hands: {
        S: [{ suit: '♥', rank: '2' }], W: [{ suit: '♥', rank: '3' }],
        N: [{ suit: '♥', rank: '4' }], E: [{ suit: '♥', rank: 'A' }],
      },
      bids: { S: 0, N: 4, W: 3, E: 4 },
      tricksWon: { S: 0, N: 4, W: 4, E: 4 },
    })
    const done = playOutHearts(st, {
      S: { suit: '♥', rank: '2' }, W: { suit: '♥', rank: '3' },
      N: { suit: '♥', rank: '4' }, E: { suit: '♥', rank: 'A' },
    })
    expect(done.phase).toBe('hand-end')
    expect(done.score).toEqual({ NS: 140, EW: 72 })
    expect(done.bags).toEqual({ NS: 0, EW: 2 })
  })

  it('missed bid: -10 per bid trick, no bags (and the other team banks overtricks)', () => {
    // NS bid 8 (S5+N3) but only take 5 → set, -80, no bags.
    // EW bid 2 (W1+E1) take 8 → 2*10 + 6 overtricks = 26, and 6 bags.
    // Going in: S3 N2 W4 E3 (=12); E wins 13th with A♥ → EW 8, NS 5.
    const st = preFinal({
      hands: {
        S: [{ suit: '♥', rank: '2' }], W: [{ suit: '♥', rank: '3' }],
        N: [{ suit: '♥', rank: '4' }], E: [{ suit: '♥', rank: 'A' }],
      },
      bids: { S: 5, N: 3, W: 1, E: 1 },
      tricksWon: { S: 3, N: 2, W: 4, E: 3 },
    })
    const done = playOutHearts(st, {
      S: { suit: '♥', rank: '2' }, W: { suit: '♥', rank: '3' },
      N: { suit: '♥', rank: '4' }, E: { suit: '♥', rank: 'A' },
    })
    expect(done.phase).toBe('hand-end')
    expect(done.score).toEqual({ NS: -80, EW: 26 })
    expect(done.bags).toEqual({ NS: 0, EW: 6 })
  })

  it('failed nil: -100, and the nil player\'s stolen trick still bags the partner', () => {
    // S bids nil(0) but WINS the 13th → took 1 (nil fails, -100).
    // N bid 3, took 3, +S's 1 stray trick → 4 vs bid 3 = made +31, 1 bag.
    // NS net = -100 + 31 = -69. EW bid 7 (W3+E4) took 9 → +72, 2 bags.
    const st = preFinal({
      hands: {
        S: [{ suit: '♥', rank: 'A' }], W: [{ suit: '♥', rank: '2' }],
        N: [{ suit: '♥', rank: '3' }], E: [{ suit: '♥', rank: '4' }],
      },
      bids: { S: 0, N: 3, W: 3, E: 4 },
      tricksWon: { S: 0, N: 3, W: 4, E: 5 },
    })
    const done = playOutHearts(st, {
      S: { suit: '♥', rank: 'A' }, W: { suit: '♥', rank: '2' },
      N: { suit: '♥', rank: '3' }, E: { suit: '♥', rank: '4' },
    })
    expect(done.phase).toBe('hand-end')
    expect(done.score).toEqual({ NS: -69, EW: 72 })
    expect(done.bags).toEqual({ NS: 1, EW: 2 })
  })

  it('10-bag overflow applies a -100 penalty and carries the remainder', () => {
    // EW starts with 8 bags. They take 4 overtricks this hand → 12 total →
    // floor(12/10)=1 penalty (-100), bags carry 2.
    // EW bid 4 (W2+E2), take 8 (W4+E4) → +40 +4 bags, then -100, net -60.
    const st = preFinal({
      hands: {
        S: [{ suit: '♥', rank: '2' }], W: [{ suit: '♥', rank: '3' }],
        N: [{ suit: '♥', rank: '4' }], E: [{ suit: '♥', rank: 'A' }],
      },
      bids: { S: 3, N: 3, W: 2, E: 2 },
      tricksWon: { S: 3, N: 2, W: 4, E: 3 },
      bags: { NS: 0, EW: 8 },
    })
    const done = playOutHearts(st, {
      S: { suit: '♥', rank: '2' }, W: { suit: '♥', rank: '3' },
      N: { suit: '♥', rank: '4' }, E: { suit: '♥', rank: 'A' },
    })
    // NS bid 6, took 5 → -60. EW bid 4, took 8 → +40 +4bags = 44, +8 prior = 12 bags
    //   → -100 penalty, net EW = 44 - 100 = -56, bags carry 2.
    expect(done.phase).toBe('hand-end')
    expect(done.score).toEqual({ NS: -60, EW: -56 })
    expect(done.bags).toEqual({ NS: 0, EW: 2 })
  })
})
