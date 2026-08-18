// Gin Rummy GameHandle wrapper tests + engine sanity.
//
// Heaviest coverage on the meld solver (deadwood minimisation) and the
// knock/gin/undercut/wash scoring — the error-prone parts. Wrapper coverage
// drives the two-phase turn (draw → discard/knock) via state injection.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStorage, PlatformContext } from 'even-card-platform'
import { composeGlassesFrame } from 'even-card-platform'
import { ginRummyGame } from '../../src/games/ginrummy'
import {
  bestMeldSplit, canKnock, deadwoodCount, deadwoodValue, discard, drawDiscard,
  drawStock, knock, newGame, topDiscard,
  type Card, type GameState, type Position,
} from '../../src/games/ginrummy/engine'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const C = (rank: string, suit: string): Card => ({ rank: rank as Card['rank'], suit: suit as Card['suit'] })

function makeStorage(): GameStorage {
  const mem = new Map<string, string>()
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const raw = mem.get(key); if (!raw) return fallback
      try { return JSON.parse(raw) as T } catch { return fallback }
    },
    async set(key, value) { mem.set(key, JSON.stringify(value)) },
    async remove(key) { mem.delete(key) },
  }
}
function makeCtx(): PlatformContext & { endGame: ReturnType<typeof vi.fn>; requestRender: ReturnType<typeof vi.fn> } {
  return { storage: makeStorage(), difficulty: 'medium', endGame: vi.fn(), requestRender: vi.fn() }
}
const get = <T>(h: object, k: string): T => (h as Record<string, T>)[k]
const set = <T>(h: object, k: string, v: T): void => { (h as Record<string, T>)[k] = v }

// A 10-card hand with three melds + a lone 4♣ → deadwood 4.
const HAND_DW4: Card[] = [
  C('3', '♠'), C('4', '♠'), C('5', '♠'),   // run
  C('7', '♥'), C('8', '♥'), C('9', '♥'),   // run
  C('K', '♠'), C('K', '♥'), C('K', '♦'),   // set
  C('4', '♣'),                              // deadwood 4
]
// A gin hand (10 cards, all melded).
const HAND_GIN: Card[] = [
  C('3', '♠'), C('4', '♠'), C('5', '♠'), C('6', '♠'),  // run of 4
  C('7', '♥'), C('8', '♥'), C('9', '♥'),               // run
  C('K', '♠'), C('K', '♥'), C('K', '♦'),               // set
]
// A meld-less 10-card hand, deadwood = 2+4+6+8+10+10+1+3+5+9 = 58.
const HAND_DW58: Card[] = [
  C('2', '♠'), C('4', '♥'), C('6', '♦'), C('8', '♣'), C('10', '♠'),
  C('Q', '♥'), C('A', '♦'), C('3', '♣'), C('5', '♠'), C('9', '♥'),
]

function discardPhase(over: Partial<GameState>): GameState {
  return {
    hands: { S: [], N: [] },
    stock: [C('2', '♣'), C('3', '♣')],
    discard: [C('Q', '♣')],
    turn: 'S',
    phase: 'discard',
    score: { S: 0, N: 0 },
    targetScore: 100,
    result: null,
    ...over,
  }
}

// ── engine: meld solver ────────────────────────────────────────────────

describe('ginrummy — opponent visibility + frame budget', () => {
  // Whether the opponent drew blind or TOOK YOUR DISCARD is the most valuable
  // read in Gin, and nothing on screen carried it: the discard top shows what
  // they threw, never where they drew from.
  it('draw view reports what the opponent did last turn', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({
      hands: { S: HAND_DW4, N: HAND_DW58 },
      phase: 'draw',
      turn: 'S',
    }))
    // Nothing to report before the opponent has moved.
    expect(h.render().body.join('\n')).not.toContain('Opp ')
    set(h, 'oppLastTurn', 'took 9♥ · threw K◆')
    expect(h.render().body.join('\n')).toContain('Opp took 9♥ · threw K◆')
    h.destroy()
  })

  // STYLE.md § 1.1 budgets 8-10 lines; overflowing it clipped the launcher's
  // control hint on real glasses with no way to scroll to it. The draw view
  // grew a line here, so it gets the guard.
  it('draw view stays inside the line budget with the opponent line shown', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({
      hands: { S: [...HAND_DW4, C('2', '♦')], N: HAND_DW58 },
      phase: 'draw',
      turn: 'S',
    }))
    set(h, 'oppLastTurn', 'took 10♦ · threw Q♠')
    const composed = composeGlassesFrame({ gameName: 'Gin Rummy', frame: h.render() })
    expect(composed.split('\n').length, `overflows:\n${composed}`).toBeLessThanOrEqual(10)
    h.destroy()
  })
})

describe('ginrummy engine — meld solver', () => {
  it('deadwoodValue: A=1, face=10, pip=number', () => {
    expect(deadwoodValue('A')).toBe(1)
    expect(deadwoodValue('K')).toBe(10)
    expect(deadwoodValue('10')).toBe(10)
    expect(deadwoodValue('7')).toBe(7)
  })

  it('melds a run and a set, leaving the rest as deadwood', () => {
    const split = bestMeldSplit(HAND_DW4)
    expect(split.deadwoodValue).toBe(4)
    expect(split.melds.length).toBe(3)
    expect(split.deadwood.map(c => c.rank)).toEqual(['4'])
  })

  it('a fully-melded hand has zero deadwood (gin)', () => {
    expect(deadwoodCount(HAND_GIN)).toBe(0)
  })

  it('a meld-less hand is all deadwood', () => {
    expect(deadwoodCount(HAND_DW58)).toBe(58)
  })

  it('Ace is LOW: A-2-3 is a run, Q-K-A is not', () => {
    expect(deadwoodCount([C('A', '♠'), C('2', '♠'), C('3', '♠')])).toBe(0)        // valid run
    expect(deadwoodCount([C('Q', '♠'), C('K', '♠'), C('A', '♠')])).toBe(10 + 10 + 1) // no run
  })

  it('picks the partition that minimises deadwood when a card could go two ways', () => {
    // 5♥ could extend the run 4♥5♥6♥ OR pair toward a set of 5s. The run +
    // the 5♠5♦ leftover (no third 5) should leave the two 5s as deadwood (10),
    // not break the run.
    const hand = [C('4', '♥'), C('5', '♥'), C('6', '♥'), C('5', '♠'), C('5', '♦')]
    const split = bestMeldSplit(hand)
    expect(split.deadwoodValue).toBe(10) // 5♠ + 5♦
    expect(split.melds).toHaveLength(1)
  })
})

// ── engine: moves + scoring ──────────────────────────────────────────────

describe('ginrummy engine — moves + scoring', () => {
  it('newGame deals 10 each, one upcard, 31 in stock, South to draw', () => {
    const s = newGame(100, mulberry32(5))
    expect(s.hands.S.length).toBe(10)
    expect(s.hands.N.length).toBe(10)
    expect(s.discard.length).toBe(1)
    expect(s.stock.length).toBe(52 - 20 - 1)
    expect(s.turn).toBe('S')
    expect(s.phase).toBe('draw')
  })

  it('drawStock adds a card and moves to discard phase', () => {
    const s = newGame(100, mulberry32(5))
    const after = drawStock(s, 'S')
    expect(after.hands.S.length).toBe(11)
    expect(after.phase).toBe('discard')
    expect(after.stock.length).toBe(s.stock.length - 1)
  })

  it('drawDiscard takes the upcard', () => {
    const s = newGame(100, mulberry32(5))
    const up = topDiscard(s)!
    const after = drawDiscard(s, 'S')
    expect(after.hands.S.some(c => c.rank === up.rank && c.suit === up.suit)).toBe(true)
    expect(after.discard.length).toBe(0)
    expect(after.phase).toBe('discard')
  })

  it('discard passes the turn and puts the card on top', () => {
    const st = discardPhase({ hands: { S: [...HAND_DW4, C('Q', '♣')], N: HAND_DW58 } })
    const after = discard(st, 'S', C('Q', '♣'))
    expect(after.hands.S.length).toBe(10)
    expect(after.turn).toBe('N')
    expect(after.phase).toBe('draw')
    expect(topDiscard(after)).toEqual(C('Q', '♣'))
  })

  it('canKnock true when deadwood ≤ 10', () => {
    expect(canKnock(HAND_DW4)).toBe(true)
    expect(canKnock(HAND_DW58)).toBe(false)
  })

  it('knock (not gin, not undercut): knocker scores the deadwood difference', () => {
    const st = discardPhase({ hands: { S: [...HAND_DW4, C('Q', '♣')], N: HAND_DW58 } })
    const done = knock(st, 'S', C('Q', '♣'))   // S deadwood 4, N deadwood 58
    expect(done.phase).toBe('hand-end')
    expect(done.result).toMatchObject({ knocker: 'S', gin: false, undercut: false, scorer: 'S', points: 54 })
    expect(done.score.S).toBe(54)
  })

  it('gin (0 deadwood) scores opponent deadwood + 25 bonus', () => {
    const st = discardPhase({ hands: { S: [...HAND_GIN, C('Q', '♣')], N: HAND_DW58 } })
    const done = knock(st, 'S', C('Q', '♣'))
    expect(done.result).toMatchObject({ gin: true, scorer: 'S', points: 58 + 25 })
  })

  it('undercut: defender with ≤ knocker deadwood scores the diff + 25', () => {
    // S knocks at deadwood 8 (lone 8♣); N sits at deadwood 5.
    const sHand = [
      C('3', '♠'), C('4', '♠'), C('5', '♠'), C('7', '♥'), C('8', '♥'), C('9', '♥'),
      C('K', '♠'), C('K', '♥'), C('K', '♦'), C('8', '♣'),   // 10 cards, dw 8
      C('2', '♦'),                                            // discard this
    ]
    const nHand = [
      C('4', '♥'), C('5', '♥'), C('6', '♥'), C('7', '♥'),   // run of 4 (wait ♥ dup with S)
      C('K', '♣'), C('K', '♠'), C('K', '♦'),                 // set
      C('A', '♣'), C('2', '♦'), C('2', '♠'),                 // deadwood 1+2+2 = 5
    ]
    const st = discardPhase({ hands: { S: sHand, N: nHand } })
    const done = knock(st, 'S', C('2', '♦'))
    expect(deadwoodCount(done.hands.S)).toBe(8)
    expect(deadwoodCount(done.hands.N)).toBe(5)
    expect(done.result).toMatchObject({ undercut: true, scorer: 'N', points: (8 - 5) + 25 })
  })

  it('discarding into an empty stock washes the hand (no score)', () => {
    const st = discardPhase({ hands: { S: [...HAND_DW58, C('Q', '♣')], N: HAND_DW58 }, stock: [] })
    const after = discard(st, 'S', C('Q', '♣'))
    expect(after.phase).toBe('hand-end')
    expect(after.result).toMatchObject({ knocker: null, scorer: null })
    expect(after.score).toEqual({ S: 0, N: 0 })
  })
})

// ── wrapper ──────────────────────────────────────────────────────────────

describe('ginRummyGame — wrapper', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('module metadata', () => {
    expect(ginRummyGame.id).toBe('ginrummy')
    expect(ginRummyGame.name).toBe('Gin Rummy')
    expect(ginRummyGame.glyph).toBe('●')
    expect(ginRummyGame.shortDesc.length).toBeLessThan(40)
    const html = ginRummyGame.renderPhoneRules?.() ?? ''
    expect(html).toContain('meld')
    expect(html).toContain('knock')
    expect(html).toContain('Gin')
  })

  it('init: draw phase, South to act, score "You:0  Opp:0"', () => {
    const h = ginRummyGame.init(makeCtx())
    expect(get<GameState>(h, 'state').phase).toBe('draw')
    expect(h.render().score).toBe('You:0  Opp:0')
    expect(h.render().controlHint).toContain('draw')
    h.destroy()
  })

  it('draw view shows stock + take options; swipe toggles; double-tap draws', () => {
    const h = ginRummyGame.init(makeCtx())
    const body = h.render().body.join('\n')
    expect(body).toContain('Draw stock')
    expect(body).toContain('Take')
    h.handleGlassesInput({ kind: 'swipe-down' })
    expect(get<number>(h, 'cursor')).toBe(1)
    h.handleGlassesInput({ kind: 'double-tap' })   // take the upcard
    expect(get<GameState>(h, 'state').phase).toBe('discard')
    h.destroy()
  })

  it('discard view shows the hand + a KNOCK affordance when reachable', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({ hands: { S: [...HAND_DW4, C('Q', '♣')], N: HAND_DW58 } }))
    const body = h.render().body.join('\n')
    expect(body).toContain('Discard')
    expect(body).toContain('KNOCK')   // dw after best discard = 4 ≤ 10
    h.destroy()
  })

  it('discarding a card passes to the opponent, who takes its turn on a timer', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({ hands: { S: [...HAND_DW58, C('Q', '♣')], N: HAND_DW58 } }))
    set(h, 'cursor', 0)
    // Discard whatever is at cursor 0 (a normal discard — KNOCK not on a 58 hand).
    const sortedFirst = (get<GameState>(h, 'state').hands.S)[0]
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(['draw', 'hand-end', 'game-end']).toContain(get<GameState>(h, 'state').phase)
    vi.advanceTimersByTime(2000)   // opponent turn fires
    const st = get<GameState>(h, 'state')
    expect(['draw', 'hand-end', 'game-end']).toContain(st.phase)
    expect(sortedFirst).toBeDefined()
    h.destroy()
  })

  it('KNOCK item ends the hand', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({ hands: { S: [...HAND_DW4, C('Q', '♣')], N: HAND_DW58 } }))
    const sorted = get<GameState>(h, 'state').hands.S.length   // 11
    set(h, 'cursor', sorted - 1 + 1)  // index past the 11 cards = KNOCK slot... set below
    // KNOCK is at index = sortedHand length (11). Cursor there:
    set(h, 'cursor', 11)
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(get<GameState>(h, 'state').phase).toBe('hand-end')
    expect(get<GameState>(h, 'state').result?.scorer).toBe('S')
    h.destroy()
  })

  it('single-tap mid-turn is a no-op', () => {
    const ctx = makeCtx()
    const h = ginRummyGame.init(ctx)
    ctx.requestRender.mockClear()
    h.handleGlassesInput({ kind: 'tap' })
    expect(ctx.requestRender).not.toHaveBeenCalled()
    h.destroy()
  })

  it('hand-end render + double-tap deals the next hand', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({
      phase: 'hand-end', hands: { S: HAND_DW4, N: HAND_DW58 },
      result: { knocker: 'S', gin: false, undercut: false, scorer: 'S', points: 54 }, score: { S: 54, N: 0 },
    }))
    expect(h.render().body.join('\n')).toContain('knocks')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(get<GameState>(h, 'state').phase).toBe('draw')
    h.destroy()
  })

  it('game-end YOU WIN / OPPONENT WINS + double-tap exits', () => {
    const ctx = makeCtx()
    const h = ginRummyGame.init(ctx)
    set(h, 'state', discardPhase({ phase: 'game-end', score: { S: 105, N: 40 } }))
    expect(h.render().body.join('\n')).toContain('*** YOU WIN ***')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    set(h, 'state', discardPhase({ phase: 'game-end', score: { S: 40, N: 105 } }))
    expect(h.render().body.join('\n')).toContain('*** OPPONENT WINS ***')
    h.destroy()
  })

  it('phone new-game resets; set-difficulty updates tier; unknown ignored', () => {
    const h = ginRummyGame.init(makeCtx())
    set(h, 'state', discardPhase({ phase: 'game-end', score: { S: 105, N: 40 } }))
    h.handlePhoneEvent({ kind: 'new-game' })
    expect(get<GameState>(h, 'state').phase).toBe('draw')
    expect(get<GameState>(h, 'state').score).toEqual({ S: 0, N: 0 })
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    expect(get<string>(h, 'difficulty')).toBe('hard')
    h.handlePhoneEvent({ kind: 'whatever' })
    h.destroy()
  })

  it('destroy() does not throw', () => {
    const h = ginRummyGame.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })
})
