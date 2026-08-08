// Cribbage GameHandle wrapper tests + engine sanity.
//
// scoreShow (the hand counter) is the crown jewel — covered with isolated,
// component-level assertions plus the famous perfect-29 hand. pegPlayPoints
// covers the pegging scores. A self-play smoke test drives many full hands
// through discard → peg → show to catch state-machine bugs (deadlocks,
// illegal plays, hands that never end).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStorage, PlatformContext } from 'even-card-platform'
import { cribbageGame } from '../../src/games/cribbage'
import {
  advanceShow, discardToCrib, mustGo, newGame, other, pegGo, pegPlay,
  pegPlayPoints, scoreShow,
  type Card, type GameState, type Position,
} from '../../src/games/cribbage/engine'
import { aiDiscard, aiPeg } from '../../src/games/cribbage/ai'

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
const part = (r: { parts: { label: string; points: number }[] }, label: string) => r.parts.find(p => p.label.startsWith(label))

function makeStorage(): GameStorage {
  const mem = new Map<string, string>()
  return {
    async get<T>(k: string, f: T): Promise<T> { const r = mem.get(k); if (!r) return f; try { return JSON.parse(r) as T } catch { return f } },
    async set(k, v) { mem.set(k, JSON.stringify(v)) },
    async remove(k) { mem.delete(k) },
  }
}
function makeCtx(): PlatformContext & { endGame: ReturnType<typeof vi.fn>; requestRender: ReturnType<typeof vi.fn> } {
  return { storage: makeStorage(), difficulty: 'medium', endGame: vi.fn(), requestRender: vi.fn() }
}
const get = <T>(h: object, k: string): T => (h as Record<string, T>)[k]
const set = <T>(h: object, k: string, v: T): void => { (h as Record<string, T>)[k] = v }

// ── the show scorer ────────────────────────────────────────────────────

describe('cribbage — scoreShow', () => {
  it('the perfect 29 hand', () => {
    // J♠ + three 5s, starter 5♠ (matches the Jack's suit).
    const hand = [C('J', '♠'), C('5', '♥'), C('5', '♦'), C('5', '♣')]
    expect(scoreShow(hand, C('5', '♠'), false).total).toBe(29)
  })

  it('a single pair scores 2 and nothing else', () => {
    const r = scoreShow([C('2', '♠'), C('2', '♥'), C('7', '♦'), C('9', '♣')], C('K', '♠'), false)
    expect(r.total).toBe(2)
    expect(part(r, 'Pairs')?.points).toBe(2)
  })

  it('a run of three scores 3', () => {
    const r = scoreShow([C('3', '♠'), C('4', '♥'), C('5', '♦'), C('9', '♣')], C('K', '♠'), false)
    expect(part(r, 'Run')?.points).toBe(3)
  })

  it('double run (run of 3 with a pair) scores 8 + the pair', () => {
    // 3,3,4,5 + starter 9 → double run 3-4-5 ×2 = 6, pair of 3s = 2.
    const r = scoreShow([C('3', '♠'), C('3', '♥'), C('4', '♦'), C('5', '♣')], C('9', '♠'), false)
    expect(part(r, 'Run')?.points).toBe(6)
    expect(part(r, 'Pairs')?.points).toBe(2)
  })

  it('fifteens: 5+5+10+K with a 2 starter → four fifteens + a pair', () => {
    const r = scoreShow([C('5', '♠'), C('5', '♥'), C('10', '♦'), C('K', '♣')], C('2', '♠'), false)
    expect(part(r, 'Fifteen')?.points).toBe(8) // 5+10, 5+10, 5+K, 5+K
    expect(part(r, 'Pairs')?.points).toBe(2)
    expect(r.total).toBe(10)
  })

  it('four-card flush scores 4 in a hand, 0 in a crib', () => {
    const hand = [C('2', '♠'), C('5', '♠'), C('8', '♠'), C('J', '♠')]
    expect(part(scoreShow(hand, C('7', '♥'), false), 'Flush 4')?.points).toBe(4)
    expect(part(scoreShow(hand, C('7', '♥'), true), 'Flush')).toBeUndefined()
  })

  it('five-card flush counts in both hand and crib', () => {
    const hand = [C('2', '♠'), C('5', '♠'), C('8', '♠'), C('J', '♠')]
    expect(part(scoreShow(hand, C('K', '♠'), false), 'Flush 5')?.points).toBe(5)
    expect(part(scoreShow(hand, C('K', '♠'), true), 'Flush 5')?.points).toBe(5)
  })

  it('nobs: a Jack matching the starter suit scores 1', () => {
    const r = scoreShow([C('J', '♥'), C('3', '♠'), C('7', '♦'), C('9', '♣')], C('4', '♥'), false)
    expect(part(r, 'Nobs')?.points).toBe(1)
    expect(r.total).toBe(1)
  })
})

// ── pegging scores ───────────────────────────────────────────────────────

describe('cribbage — pegPlayPoints', () => {
  it('count 15 scores 2', () => {
    expect(pegPlayPoints([C('8', '♠'), C('7', '♥')], 15)).toBe(2)
  })
  it('count 31 scores 2', () => {
    expect(pegPlayPoints([C('K', '♠'), C('Q', '♥'), C('A', '♦')], 31)).toBe(2)
  })
  it('a pair scores 2, three of a kind scores 6', () => {
    expect(pegPlayPoints([C('5', '♠'), C('5', '♥')], 10)).toBe(2)
    expect(pegPlayPoints([C('5', '♠'), C('5', '♥'), C('5', '♦')], 15)).toBe(6 + 2) // trips + the 15
  })
  it('a run of three (any order) scores 3', () => {
    expect(pegPlayPoints([C('4', '♠'), C('6', '♥'), C('5', '♦')], 15)).toBe(3 + 2) // run + the 15
  })
  it('a pair does not count as a run', () => {
    expect(pegPlayPoints([C('4', '♠'), C('5', '♥'), C('5', '♦')], 14)).toBe(2) // just the pair
  })
})

// ── lifecycle ──────────────────────────────────────────────────────────

describe('cribbage — lifecycle', () => {
  it('newGame deals 6 each, dealer N, non-dealer S leads, discard phase', () => {
    const s = newGame(mulberry32(3), 'N')
    expect(s.hands.S.length).toBe(6)
    expect(s.hands.N.length).toBe(6)
    expect(s.dealer).toBe('N')
    expect(s.pegTurn).toBe('S')
    expect(s.phase).toBe('discard')
  })

  it('both discards trigger the cut and move to play with 4-card hands + a crib', () => {
    let s = newGame(mulberry32(3), 'N')
    s = discardToCrib(s, 'S', s.hands.S.slice(0, 2), mulberry32(9))
    expect(s.phase).toBe('discard')        // waiting on the dealer
    expect(s.crib.length).toBe(2)
    s = discardToCrib(s, 'N', s.hands.N.slice(0, 2), mulberry32(9))
    expect(s.crib.length).toBe(4)
    expect(s.starter).not.toBeNull()
    expect(['play', 'game-end']).toContain(s.phase)
    expect(s.hands.S.length).toBe(4)
    expect(s.hands.N.length).toBe(4)
  })

  it('advanceShow walks non-dealer → dealer → crib → hand-end', () => {
    // Build a play-finished state by hand: empty peg hands, set up show.
    const base = newGame(mulberry32(3), 'N')
    const s: GameState = {
      ...base,
      hands: {
        S: [C('5', '♠'), C('5', '♥'), C('4', '♦'), C('6', '♣')],
        N: [C('2', '♠'), C('3', '♥'), C('9', '♦'), C('K', '♣')],
      },
      crib: [C('A', '♠'), C('A', '♥'), C('7', '♦'), C('8', '♣')],
      starter: C('5', '♦'),
      phase: 'show',
      showStage: 'non-dealer',
      lastShow: null,
    }
    const s1 = advanceShow(s)       // non-dealer (S) hand
    expect(s1.lastShow?.who).toContain('You')
    expect(s1.showStage).toBe('dealer')
    const s2 = advanceShow(s1)      // dealer (N) hand
    expect(s2.showStage).toBe('crib')
    const s3 = advanceShow(s2)      // crib
    expect(s3.showStage).toBe('done')
    const s4 = advanceShow(s3)
    expect(['hand-end', 'game-end']).toContain(s4.phase)
  })
})

// ── self-play smoke: full hands run to completion ────────────────────────

describe('cribbage — self-play smoke', () => {
  function playFullHand(seed: number): GameState {
    let s = newGame(mulberry32(seed), seed % 2 === 0 ? 'N' : 'S')
    const nd = other(s.dealer)
    s = discardToCrib(s, nd, aiDiscard(s.hands[nd], s.dealer === nd, 'medium'), mulberry32(seed + 1))
    s = discardToCrib(s, s.dealer, aiDiscard(s.hands[s.dealer], true, 'medium'), mulberry32(seed + 1))
    let guard = 0
    while (s.phase === 'play' && guard++ < 60) {
      const p: Position = s.pegTurn
      s = mustGo(s, p) ? pegGo(s, p) : pegPlay(s, p, aiPeg(s, p, 'medium'))
    }
    guard = 0
    while (s.phase === 'show' && guard++ < 10) s = advanceShow(s)
    return s
  }

  it('30 seeded hands all terminate with sane, non-negative scores', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = playFullHand(seed)
      expect(['hand-end', 'game-end']).toContain(s.phase)
      expect(s.score.S).toBeGreaterThanOrEqual(0)
      expect(s.score.N).toBeGreaterThanOrEqual(0)
      // A single hand can't realistically mint 60+ points per side.
      expect(s.score.S).toBeLessThan(80)
      expect(s.score.N).toBeLessThan(80)
    }
  })

  it('every card gets played during pegging (no cards stranded)', () => {
    const s = playFullHand(7)
    expect(s.pegHands.S.length).toBe(0)
    expect(s.pegHands.N.length).toBe(0)
  })
})

// ── wrapper ──────────────────────────────────────────────────────────────

describe('cribbageGame — wrapper', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('module metadata + rules', () => {
    expect(cribbageGame.id).toBe('cribbage')
    expect(cribbageGame.name).toBe('Cribbage')
    expect(cribbageGame.category).toBe('pegging')
    expect(cribbageGame.shortDesc.length).toBeLessThan(40)
    const html = cribbageGame.renderPhoneRules?.() ?? ''
    expect(html).toContain('crib')
    expect(html).toContain('nobs')
    expect(html).toContain('121')
  })

  it('init: discard phase, score "You:0  Opp:0", lay-2 prompt', () => {
    const h = cribbageGame.init(makeCtx())
    expect(get<GameState>(h, 'state').phase).toBe('discard')
    expect(h.render().score).toBe('You:0  Opp:0')
    expect(h.render().body.join('\n')).toContain('Lay 2')
    h.destroy()
  })

  it('picking 2 cards + confirming lays away, cuts, and enters play', () => {
    const h = cribbageGame.init(makeCtx())
    h.handleGlassesInput({ kind: 'double-tap' })   // pick card at cursor 0
    h.handleGlassesInput({ kind: 'swipe-down' })
    h.handleGlassesInput({ kind: 'double-tap' })   // pick a 2nd card
    expect(get<Card[]>(h, 'selected').length).toBe(2)
    // Swipe to the CONFIRM slot (index = hand length 6) and commit.
    set(h, 'cursor', 6)
    h.handleGlassesInput({ kind: 'double-tap' })
    vi.advanceTimersByTime(3000)                   // let any AI pegging settle
    const st = get<GameState>(h, 'state')
    expect(['play', 'show', 'hand-end', 'game-end']).toContain(st.phase)
    expect(st.starter).not.toBeNull()
    h.destroy()
  })

  it('single-tap is a no-op in discard', () => {
    const ctx = makeCtx()
    const h = cribbageGame.init(ctx)
    ctx.requestRender.mockClear()
    h.handleGlassesInput({ kind: 'tap' })
    expect(ctx.requestRender).not.toHaveBeenCalled()
    h.destroy()
  })

  it('show view steps on double-tap', () => {
    const h = cribbageGame.init(makeCtx())
    const base = get<GameState>(h, 'state')
    set(h, 'state', {
      ...base,
      hands: { S: [C('5', '♠'), C('5', '♥'), C('4', '♦'), C('6', '♣')], N: [C('2', '♠'), C('3', '♥'), C('9', '♦'), C('K', '♣')] },
      crib: [C('A', '♠'), C('A', '♥'), C('7', '♦'), C('8', '♣')],
      starter: C('5', '♦'), phase: 'show', showStage: 'non-dealer', lastShow: null,
    })
    expect(h.render().body.join('\n')).toContain('The show')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(get<GameState>(h, 'state').lastShow).not.toBeNull()
    h.destroy()
  })

  it('hand-end → next hand swaps the dealer', () => {
    const h = cribbageGame.init(makeCtx())
    const base = get<GameState>(h, 'state') // dealer N
    set(h, 'state', { ...base, phase: 'hand-end' })
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = get<GameState>(h, 'state')
    expect(st.phase).toBe('discard')
    expect(st.dealer).toBe('S') // swapped from N
    h.destroy()
  })

  it('game-end banner + double-tap exits; phone events; destroy', () => {
    const ctx = makeCtx()
    const h = cribbageGame.init(ctx)
    set(h, 'state', { ...get<GameState>(h, 'state'), phase: 'game-end', score: { S: 121, N: 90 } })
    expect(h.render().body.join('\n')).toContain('*** YOU WIN ***')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    expect(get<string>(h, 'difficulty')).toBe('hard')
    h.handlePhoneEvent({ kind: 'new-game' })
    expect(get<GameState>(h, 'state').phase).toBe('discard')
    h.handlePhoneEvent({ kind: 'unknown' })
    expect(() => h.destroy()).not.toThrow()
  })
})
