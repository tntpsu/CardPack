// Oh Hell GameHandle wrapper tests + engine sanity.
// Heaviest on the signature rules: trump trick-winner, the dealer hook, and
// exact-bid scoring.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStorage, PlatformContext } from 'even-card-platform'
import { ohHellGame } from '../../src/games/ohhell'
import {
  forbiddenDealerBid, legalPlays, MAX_ROUND, newGame, placeBid, playCard,
  trickWinner, wouldWinTrick,
  type Card, type GameState, type Position,
} from '../../src/games/ohhell/engine'

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
    async get<T>(k: string, f: T): Promise<T> { const r = mem.get(k); if (!r) return f; try { return JSON.parse(r) as T } catch { return f } },
    async set(k, v) { mem.set(k, JSON.stringify(v)) }, async remove(k) { mem.delete(k) },
  }
}
function makeCtx(): PlatformContext & { endGame: ReturnType<typeof vi.fn>; requestRender: ReturnType<typeof vi.fn> } {
  return { storage: makeStorage(), difficulty: 'medium', endGame: vi.fn(), requestRender: vi.fn() }
}
const get = <T>(h: object, k: string): T => (h as Record<string, T>)[k]
const set = <T>(h: object, k: string, v: T): void => { (h as Record<string, T>)[k] = v }

// ── engine ───────────────────────────────────────────────────────────────

describe('ohhell engine — trump + winner', () => {
  it('newGame: round 1, one card each, trump turned, dealer E so S bids first', () => {
    const s = newGame(mulberry32(4), 'E')
    expect(s.round).toBe(1)
    for (const p of ['S', 'W', 'N', 'E'] as Position[]) expect(s.hands[p].length).toBe(1)
    expect(s.trump).toBe(s.trumpCard.suit)
    expect(s.turn).toBe('S') // left of dealer E
    expect(s.phase).toBe('bid')
  })

  it('trump beats a higher non-trump; highest trump wins', () => {
    const trick = {
      leadSuit: '♥' as const,
      plays: [
        { pos: 'S' as Position, card: C('A', '♥') },   // high lead
        { pos: 'W' as Position, card: C('2', '♠') },   // low trump
        { pos: 'N' as Position, card: C('K', '♥') },
        { pos: 'E' as Position, card: C('5', '♠') },   // higher trump
      ],
    }
    expect(trickWinner(trick, '♠')).toBe('E')
  })

  it('no trump in trick → highest of the lead suit wins', () => {
    const trick = {
      leadSuit: '♦' as const,
      plays: [
        { pos: 'S' as Position, card: C('9', '♦') },
        { pos: 'W' as Position, card: C('K', '♦') },
        { pos: 'N' as Position, card: C('A', '♣') }, // off-suit, not trump
        { pos: 'E' as Position, card: C('J', '♦') },
      ],
    }
    expect(trickWinner(trick, '♠')).toBe('W')
  })

  it('must follow the lead suit when able', () => {
    const base = newGame(mulberry32(4), 'E')
    const s: GameState = {
      ...base, phase: 'play', turn: 'S',
      trick: { plays: [{ pos: 'W', card: C('5', '♦') }], leadSuit: '♦' },
      hands: { ...base.hands, S: [C('9', '♦'), C('A', '♠')] },
    }
    expect(legalPlays(s, 'S')).toEqual([C('9', '♦')])
  })

  it('wouldWinTrick reflects trump/lead correctly', () => {
    const base = newGame(mulberry32(4), 'E')
    const s: GameState = {
      ...base, trump: '♠', phase: 'play', turn: 'S',
      trick: { plays: [{ pos: 'W', card: C('K', '♥') }], leadSuit: '♥' },
      hands: { ...base.hands, S: [C('2', '♠'), C('3', '♥')] },
    }
    expect(wouldWinTrick(s, C('2', '♠'))).toBe(true)  // trump beats the K♥
    expect(wouldWinTrick(s, C('3', '♥'))).toBe(false) // lower heart
  })
})

describe('ohhell engine — bidding + dealer hook + scoring', () => {
  it('bidding advances left-of-dealer → dealer, then play led by left-of-dealer', () => {
    let s = newGame(mulberry32(4), 'E') // order S,W,N,E
    s = placeBid(s, 'S', 1); expect(s.turn).toBe('W')
    s = placeBid(s, 'W', 0)
    s = placeBid(s, 'N', 0)
    expect(s.phase).toBe('bid')
    s = placeBid(s, 'E', 1) // dealer; round 1 trick → bids total 2 ≠ 1, allowed
    expect(s.phase).toBe('play')
    expect(s.turn).toBe('S')
  })

  it('the dealer is hooked: cannot bid the value that balances the table', () => {
    // Round 1 (1 trick). Others bid 0,0,0 → forbidden dealer bid = 1.
    let s = newGame(mulberry32(4), 'E')
    s = placeBid(s, 'S', 0); s = placeBid(s, 'W', 0); s = placeBid(s, 'N', 0)
    expect(forbiddenDealerBid(s)).toBe(1)
    expect(() => placeBid(s, 'E', 1)).toThrow()
    expect(() => placeBid(s, 'E', 0)).not.toThrow()
  })

  it('exact bid scores 10 + bid; a miss scores 0', () => {
    // Round 2, end the hand by playing the final trick from a crafted state.
    const base = newGame(mulberry32(4), 'E')
    const s: GameState = {
      ...base, round: 2, trump: '♠', phase: 'play', turn: 'S',
      bids: { S: 1, W: 0, N: 1, E: 0 },
      tricksWon: { S: 1, W: 1, N: 0, E: 0 }, // one trick already played
      tricksPlayed: 1,
      trick: { plays: [], leadSuit: null },
      hands: { S: [C('A', '♥')], W: [C('2', '♥')], N: [C('K', '♥')], E: [C('3', '♥')] },
    }
    let g = playCard(s, 'S', C('A', '♥'))
    g = playCard(g, 'W', C('2', '♥'))
    g = playCard(g, 'N', C('K', '♥'))
    g = playCard(g, 'E', C('3', '♥')) // S wins → S tricks 2
    expect(g.phase).toBe('hand-end')
    // Final tricks: S2 W1 N0 E0. Bids S1 W0 N1 E0.
    // S bid1 got2 → miss → 0. W bid0 got1 → miss → 0. N bid1 got0 → miss → 0.
    // E bid0 got0 → exact → 10.
    expect(g.score).toEqual({ S: 0, W: 0, N: 0, E: 10 })
  })

  it('the last round ends the game', () => {
    const base = newGame(mulberry32(4), 'E')
    const s: GameState = {
      ...base, round: MAX_ROUND, trump: '♠', phase: 'play', turn: 'S',
      bids: { S: 0, W: 0, N: 0, E: 0 },
      tricksWon: { S: MAX_ROUND - 1, W: 0, N: 0, E: 0 },
      tricksPlayed: MAX_ROUND - 1,
      trick: { plays: [], leadSuit: null },
      hands: { S: [C('A', '♥')], W: [C('2', '♥')], N: [C('K', '♥')], E: [C('3', '♥')] },
    }
    let g = playCard(s, 'S', C('A', '♥'))
    g = playCard(g, 'W', C('2', '♥')); g = playCard(g, 'N', C('K', '♥')); g = playCard(g, 'E', C('3', '♥'))
    expect(g.phase).toBe('game-end')
  })
})

// ── wrapper ──────────────────────────────────────────────────────────────

describe('ohHellGame — wrapper', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('metadata + rules', () => {
    expect(ohHellGame.id).toBe('ohhell')
    expect(ohHellGame.name).toBe('Oh Hell')
    expect(ohHellGame.category).toBe('trick')
    expect(ohHellGame.shortDesc.length).toBeLessThan(40)
    const html = ohHellGame.renderPhoneRules?.() ?? ''
    expect(html).toContain('trump')
    expect(html).toContain('exactly')
  })

  it('init: bid phase, S bids first (dealer E), per-seat score row', () => {
    const h = ohHellGame.init(makeCtx())
    expect(get<GameState>(h, 'state').phase).toBe('bid')
    expect(get<GameState>(h, 'state').turn).toBe('S')
    expect(h.render().score).toBe('S:0 W:0 N:0 E:0')
    expect(h.render().body.join('\n')).toContain('trump')
    h.destroy()
  })

  it('bid view shows trump + selector; confirm advances past S', () => {
    const h = ohHellGame.init(makeCtx())
    const body = h.render().body.join('\n')
    expect(body).toContain('Your bid ▸')
    h.handleGlassesInput({ kind: 'double-tap' }) // confirm S's bid
    expect(get<GameState>(h, 'state').bids.S).not.toBeNull()
    h.destroy()
  })

  it('the bid picker skips the dealer-hook value when the human deals', () => {
    const h = ohHellGame.init(makeCtx())
    // Force human-dealer state, round 1, others bid 0,0,0 → forbidden = 1.
    const base = get<GameState>(h, 'state')
    set(h, 'state', { ...base, dealer: 'S', round: 1, turn: 'S', bids: { S: null, W: 0, N: 0, E: 0 } })
    const allowed = (h as unknown as { allowedBids(): number[] }).allowedBids()
    expect(allowed).not.toContain(1) // hooked
    expect(allowed).toContain(0)
    h.destroy()
  })

  it('AI bids run on a timer until the human leads play', () => {
    const h = ohHellGame.init(makeCtx())
    h.handleGlassesInput({ kind: 'double-tap' }) // S bids
    vi.advanceTimersByTime(4000)                 // W, N, E bid
    const st = get<GameState>(h, 'state')
    expect(st.phase).toBe('play')
    expect(st.turn).toBe('S') // left of dealer E leads
    h.destroy()
  })

  it('hand-end → next round increments round + swaps dealer; game-end exits', () => {
    const ctx = makeCtx()
    const h = ohHellGame.init(ctx)
    const base = get<GameState>(h, 'state')
    set(h, 'state', { ...base, phase: 'hand-end', round: 1, dealer: 'E' })
    h.handleGlassesInput({ kind: 'double-tap' })
    const st = get<GameState>(h, 'state')
    expect(st.round).toBe(2)
    expect(st.dealer).toBe('S')
    set(h, 'state', { ...st, phase: 'game-end', score: { S: 40, W: 10, N: 5, E: 0 } })
    expect(h.render().body.join('\n')).toContain('*** YOU WIN ***')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })

  it('single-tap no-op; phone new-game + set-difficulty; destroy', () => {
    const ctx = makeCtx()
    const h = ohHellGame.init(ctx)
    ctx.requestRender.mockClear()
    h.handleGlassesInput({ kind: 'tap' })
    expect(ctx.requestRender).not.toHaveBeenCalled()
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    expect(get<string>(h, 'difficulty')).toBe('hard')
    h.handlePhoneEvent({ kind: 'new-game' })
    expect(get<GameState>(h, 'state').round).toBe(1)
    h.handlePhoneEvent({ kind: 'unknown' })
    expect(() => h.destroy()).not.toThrow()
  })
})
