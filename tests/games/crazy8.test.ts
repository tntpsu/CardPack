// Crazy Eights GameHandle wrapper tests + engine sanity.
//
// Wrapper coverage uses private-state injection (same pattern as the other
// games). Engine tests verify the ported rules: deal shape, legal matching,
// 8-wild suit declaration, draw + reshuffle, and end-of-hand scoring.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStorage, PlatformContext } from 'even-card-platform'
import { crazy8Game } from '../../src/games/crazy8'
import {
  cardPenalty, drawCard, gameWinner, handPenalty, legalPlays, newGame, playCard,
  type Card, type GameState, type Position,
} from '../../src/games/crazy8/engine'

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
  return { storage: makeStorage(), difficulty: 'medium', endGame: vi.fn(), requestRender: vi.fn() }
}

/** Play-phase state with it being South's turn; override as needed. */
function humanPlayState(over: Partial<GameState> = {}): GameState {
  return {
    hands: {
      S: [{ suit: '♥', rank: 'K' }],
      W: [{ suit: '♣', rank: '3' }],
      N: [{ suit: '♦', rank: '4' }],
      E: [{ suit: '♠', rank: '5' }],
    },
    stock: [{ suit: '♣', rank: '9' }, { suit: '♦', rank: '6' }],
    discard: [{ suit: '♥', rank: '2' }],
    currentSuit: '♥',
    turn: 'S',
    phase: 'play',
    score: { S: 0, W: 0, N: 0, E: 0 },
    targetScore: 100,
    winner: null,
    ...over,
  }
}

const get = <T>(h: object, key: string): T => (h as Record<string, T>)[key]
const set = <T>(h: object, key: string, val: T): void => { (h as Record<string, T>)[key] = val }

// ── module metadata ──────────────────────────────────────────────────────

describe('crazy8Game — module metadata', () => {
  it('has the canonical id, name, category, glyph', () => {
    expect(crazy8Game.id).toBe('crazy8')
    expect(crazy8Game.name).toBe('Crazy Eights')
    expect(crazy8Game.category).toBe('shed')
    expect(crazy8Game.glyph).toBe('8')
    expect(crazy8Game.shortDesc.length).toBeGreaterThan(0)
    expect(crazy8Game.shortDesc.length).toBeLessThan(40)
  })

  it('exports renderPhoneRules covering 8s-wild + scoring + draw', () => {
    const html = crazy8Game.renderPhoneRules?.() ?? ''
    expect(html.length).toBeGreaterThan(200)
    expect(html).toContain('wild')
    expect(html).toContain('draw')
    expect(html).toContain('50')   // 8 = 50 points
  })
})

// ── rendering + play input ───────────────────────────────────────────────

describe('crazy8Game — rendering + play', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('initial render is play phase with per-seat score row', () => {
    const h = crazy8Game.init(makeCtx())
    expect(get<GameState>(h, 'state').phase).toBe('play')
    expect(h.render().score).toBe('You:0  W:0  N:0  E:0')
    h.destroy()
  })

  it('play view shows the top card, active suit, stock count, and the hand', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState())
    const body = h.render().body.join('\n')
    expect(body).toContain('Top 2♥')   // top of discard
    expect(body).toContain('stock 2')
    expect(body).toContain('K♥')        // human's card
    h.destroy()
  })

  it('play view shows each opponent\'s remaining card count', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♥', rank: 'K' }],
        W: [{ suit: '♣', rank: '3' }, { suit: '♣', rank: '4' }, { suit: '♣', rank: '5' }], // 3
        N: [{ suit: '♦', rank: '4' }],                                                       // 1
        E: [{ suit: '♠', rank: '5' }, { suit: '♠', rank: '6' }],                             // 2
      },
    }))
    const body = h.render().body.join('\n')
    expect(body).toContain('W:3')
    expect(body).toContain('N:1')
    expect(body).toContain('E:2')
    h.destroy()
  })

  it('double-tap on a legal card (matches suit) plays it', () => {
    const h = crazy8Game.init(makeCtx())
    // Two cards so playing one advances the turn rather than going out.
    // top 2♥, currentSuit ♥; K♥ matches suit (legal), 3♣ does not.
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♥', rank: 'K' }, { suit: '♣', rank: '3' }],
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
    }))
    set(h, 'cursor', 0)   // sorted ♠♥♦♣ → [K♥, 3♣], cursor 0 = K♥
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = get<GameState>(h, 'state')
    expect(st.discard[st.discard.length - 1]).toEqual({ suit: '♥', rank: 'K' })
    expect(st.hands.S).toEqual([{ suit: '♣', rank: '3' }])
    expect(st.turn).toBe('W')
    h.destroy()
  })

  it('double-tap on an illegal card is a no-op', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♠', rank: '3' }],   // no ♥, no rank-2, not an 8 → illegal
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
    }))
    set(h, 'cursor', 0)
    h.handleGlassesInput({ kind: 'double-tap' })
    // Illegal card means "must draw" mode; double-tap there DRAWS instead of
    // playing — so the hand should have grown, not shrunk, and nothing was discarded.
    const st = get<GameState>(h, 'state')
    expect(st.discard.length).toBe(1)
    expect(st.hands.S.length).toBe(2)   // drew one
    h.destroy()
  })

  it('single-tap mid-play is a no-op', () => {
    const ctx = makeCtx()
    const h = crazy8Game.init(ctx)
    set(h, 'state', humanPlayState())
    ctx.requestRender.mockClear()
    h.handleGlassesInput({ kind: 'tap' })
    expect(get<GameState>(h, 'state').hands.S.length).toBe(1)
    expect(ctx.requestRender).not.toHaveBeenCalled()
    h.destroy()
  })

  it('playing an 8 opens the suit picker, then commits with the chosen suit', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♦', rank: '8' }],
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
    }))
    set(h, 'cursor', 0)
    h.handleGlassesInput({ kind: 'double-tap' })   // play the 8 → suit picker
    expect(h.render().body.join('\n')).toContain('name the suit')
    expect(get<Card | null>(h, 'suitPickCard')).not.toBeNull()
    // suitCursor 0 = ♠; swipe once to ♥, then choose.
    h.handleGlassesInput({ kind: 'swipe-down' })   // ♠ → ♥
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = get<GameState>(h, 'state')
    expect(st.currentSuit).toBe('♥')
    expect(st.discard[st.discard.length - 1]).toEqual({ suit: '♦', rank: '8' })
    expect(get<Card | null>(h, 'suitPickCard')).toBeNull()
    h.destroy()
  })

  it('suit picker shows the hand you are choosing for', () => {
    // Reported from real glasses: after playing an 8 the picker showed only the
    // four suit glyphs. Naming a suit is a decision about the cards you still
    // hold — you want the one you are longest in — so choosing blind is the
    // whole problem.
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [
          { suit: '♦', rank: '8' },
          { suit: '♥', rank: 'K' },
          { suit: '♥', rank: '9' },
          { suit: '♣', rank: '2' },
        ],
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
    }))
    // The cursor indexes the SORTED hand, so find where the 8 actually sits.
    const sorted = (h as unknown as { sortedHand(): Card[] }).sortedHand()
    set(h, 'cursor', sorted.findIndex(c => c.rank === '8'))
    h.handleGlassesInput({ kind: 'double-tap' })   // play the 8 → suit picker
    const body = h.render().body.join('\n')
    expect(body).toContain('name the suit')
    // The three cards still in hand must all be visible.
    expect(body).toContain('K')
    expect(body).toContain('9')
    expect(body).toContain('2')
    h.destroy()
  })

  it('no legal card → "must draw" view; double-tap draws from stock', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♠', rank: '3' }, { suit: '♣', rank: '4' }],  // neither matches 2♥
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
    }))
    expect(h.render().body.join('\n')).toContain('No legal card')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(get<GameState>(h, 'state').hands.S.length).toBe(3)   // drew one
    h.destroy()
  })

  it('no legal card + empty stock → pass advances the turn', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({
      hands: {
        S: [{ suit: '♠', rank: '3' }],
        W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
      },
      stock: [],
      discard: [{ suit: '♥', rank: '2' }],  // only the top → nothing to recycle
    }))
    h.handleGlassesInput({ kind: 'double-tap' })   // can't draw → pass
    expect(get<GameState>(h, 'state').turn).toBe('W')
    h.destroy()
  })
})

// ── terminal phases + phone events ───────────────────────────────────────

describe('crazy8Game — terminal phases + phone events', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hand-end render names who went out; double-tap deals next', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({ phase: 'hand-end', winner: 'W', score: { S: 12, W: 0, N: 8, E: 5 } }))
    const body = h.render().body.join('\n')
    expect(body).toContain('Hand done')
    expect(body).toContain('West went out')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(get<GameState>(h, 'state').phase).toBe('play')
    h.destroy()
  })

  it('game-end YOU WIN when South has the lowest score; double-tap exits', () => {
    const ctx = makeCtx()
    const h = crazy8Game.init(ctx)
    set(h, 'state', humanPlayState({ phase: 'game-end', score: { S: 20, W: 100, N: 80, E: 95 } }))
    expect(h.render().body.join('\n')).toContain('*** YOU WIN ***')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })

  it('game-end names the winning seat when it is not you', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({ phase: 'game-end', score: { S: 100, W: 12, N: 80, E: 95 } }))
    expect(h.render().body.join('\n')).toContain('WEST WINS')
    h.destroy()
  })

  it('phone new-game resets to a fresh play phase with zero scores', () => {
    const h = crazy8Game.init(makeCtx())
    set(h, 'state', humanPlayState({ phase: 'game-end', score: { S: 100, W: 0, N: 0, E: 0 } }))
    h.handlePhoneEvent({ kind: 'new-game' })
    const st = get<GameState>(h, 'state')
    expect(st.phase).toBe('play')
    expect(st.score).toEqual({ S: 0, W: 0, N: 0, E: 0 })
    h.destroy()
  })

  it('set-difficulty updates the tier; unknown phone events are ignored', () => {
    const h = crazy8Game.init(makeCtx())
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    expect(get<string>(h, 'difficulty')).toBe('hard')
    h.handlePhoneEvent({ kind: 'nope' })
    h.destroy()
  })

  it('destroy() does not throw', () => {
    const h = crazy8Game.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })
})

// ── engine sanity ────────────────────────────────────────────────────────

describe('crazy8 engine — core rules', () => {
  it('deals 5 to each seat, flips one to the discard, rest to stock', () => {
    const st = newGame(100, mulberry32(7))
    for (const p of ['S', 'W', 'N', 'E'] as Position[]) expect(st.hands[p].length).toBe(5)
    expect(st.discard.length).toBe(1)
    expect(st.stock.length).toBe(52 - 4 * 5 - 1)   // 31
    expect(st.currentSuit).toBe(st.discard[0]!.suit)
    expect(st.turn).toBe('W')
  })

  it('legal = match suit, match rank, or any 8', () => {
    const st = humanPlayStateForEngine()
    const legal = legalPlays(st, 'S')
    const has = (suit: string, rank: string) => legal.some(c => c.suit === suit && c.rank === rank)
    expect(has('♥', 'K')).toBe(true)   // matches current suit ♥
    expect(has('♠', '2')).toBe(true)   // matches top rank 2
    expect(has('♦', '8')).toBe(true)   // wild 8
    expect(has('♣', '9')).toBe(false)  // no match
  })

  it('playing an 8 sets the declared suit as current', () => {
    const st = humanPlayStateForEngine()
    const next = playCard(st, 'S', { suit: '♦', rank: '8' }, '♣')
    expect(next.currentSuit).toBe('♣')
    expect(next.discard[next.discard.length - 1]).toEqual({ suit: '♦', rank: '8' })
  })

  it('drawCard pulls from the stock without advancing the turn', () => {
    const st = humanPlayStateForEngine()
    const before = st.hands.S.length
    const { state, drew } = drawCard(st, 'S')
    expect(drew).not.toBeNull()
    expect(state.hands.S.length).toBe(before + 1)
    expect(state.turn).toBe('S')
  })

  it('drawCard reshuffles the discard into an empty stock', () => {
    const st: GameState = {
      ...humanPlayStateForEngine(),
      stock: [],
      discard: [{ suit: '♥', rank: '2' }, { suit: '♣', rank: '9' }, { suit: '♦', rank: '7' }],
    }
    const { state, drew } = drawCard(st, 'S', mulberry32(3))
    expect(drew).not.toBeNull()
    // The discard's two non-top cards were recycled into the stock, one drawn.
    expect(state.discard).toEqual([{ suit: '♦', rank: '7' }])
    expect(state.stock.length).toBe(1)
  })

  it('drawCard returns null when stock empty and nothing to recycle', () => {
    const st: GameState = { ...humanPlayStateForEngine(), stock: [], discard: [{ suit: '♥', rank: '2' }] }
    expect(drawCard(st, 'S').drew).toBeNull()
  })

  it('cardPenalty: 8=50, face/10=10, ace=1, pip=face', () => {
    expect(cardPenalty({ suit: '♠', rank: '8' })).toBe(50)
    expect(cardPenalty({ suit: '♠', rank: 'K' })).toBe(10)
    expect(cardPenalty({ suit: '♠', rank: '10' })).toBe(10)
    expect(cardPenalty({ suit: '♠', rank: 'A' })).toBe(1)
    expect(cardPenalty({ suit: '♠', rank: '7' })).toBe(7)
    expect(handPenalty([{ suit: '♠', rank: '8' }, { suit: '♥', rank: 'A' }])).toBe(51)
  })

  it('going out ends the hand and charges everyone else their leftovers', () => {
    const st: GameState = {
      hands: {
        S: [{ suit: '♥', rank: 'K' }],          // S will go out
        W: [{ suit: '♠', rank: '8' }, { suit: '♦', rank: 'Q' }],  // 50 + 10
        N: [{ suit: '♣', rank: 'A' }],          // 1
        E: [{ suit: '♥', rank: '2' }],          // 2
      },
      stock: [], discard: [{ suit: '♥', rank: '9' }], currentSuit: '♥',
      turn: 'S', phase: 'play', score: { S: 0, W: 0, N: 0, E: 0 }, targetScore: 100, winner: null,
    }
    const done = playCard(st, 'S', { suit: '♥', rank: 'K' })  // matches suit ♥, empties S
    expect(done.phase).toBe('hand-end')
    expect(done.winner).toBe('S')
    expect(done.score).toEqual({ S: 0, W: 60, N: 1, E: 2 })
  })

  it('hand that pushes a player to the target ends the whole game', () => {
    const st: GameState = {
      hands: {
        S: [{ suit: '♥', rank: 'K' }],
        W: [{ suit: '♠', rank: '8' }, { suit: '♦', rank: '8' }],  // 100
        N: [{ suit: '♣', rank: 'A' }], E: [{ suit: '♥', rank: '2' }],
      },
      stock: [], discard: [{ suit: '♥', rank: '9' }], currentSuit: '♥',
      turn: 'S', phase: 'play', score: { S: 0, W: 5, N: 0, E: 0 }, targetScore: 100, winner: null,
    }
    const done = playCard(st, 'S', { suit: '♥', rank: 'K' })
    expect(done.phase).toBe('game-end')   // W hits 105 ≥ 100
    expect(gameWinner(done)).toBe('S')    // S has the lowest (0)
  })
})

/** Engine-level play state: top 2♥, current suit ♥; S holds a varied hand. */
function humanPlayStateForEngine(): GameState {
  return {
    hands: {
      S: [
        { suit: '♥', rank: 'K' }, { suit: '♠', rank: '2' },
        { suit: '♦', rank: '8' }, { suit: '♣', rank: '9' },
      ],
      W: [{ suit: '♣', rank: '3' }], N: [{ suit: '♦', rank: '4' }], E: [{ suit: '♠', rank: '5' }],
    },
    stock: [{ suit: '♣', rank: '6' }, { suit: '♦', rank: 'J' }],
    discard: [{ suit: '♥', rank: '2' }],
    currentSuit: '♥',
    turn: 'S',
    phase: 'play',
    score: { S: 0, W: 0, N: 0, E: 0 },
    targetScore: 100,
    winner: null,
  }
}
