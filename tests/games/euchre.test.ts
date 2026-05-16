// Euchre GameHandle wrapper tests.
//
// Black-box: instantiate via euchreGame.init(mockCtx) and exercise the
// public interface (render, handleGlassesInput, handlePhoneEvent, destroy).
// State is private; we infer it from observable render() output OR mutate
// directly via reflection — same pattern as hearts.test.ts.
//
// Engine + AI are tested upstream in ~/Documents/Euchre/tests/. This file
// covers the platform-wrapper concerns: rendering by phase, gesture wiring,
// and the v0.1.5+ CardPack conventions (double-tap-to-confirm, cursor parking).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameHandle, GameStorage, PlatformContext } from 'even-card-platform'
import { euchreGame } from '../../src/games/euchre'

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
  const endGame = vi.fn()
  const requestRender = vi.fn()
  return {
    storage: makeStorage(),
    difficulty: 'medium',
    endGame,
    requestRender,
  }
}

describe('euchreGame — module metadata', () => {
  it('has the canonical id, name, category, glyph', () => {
    expect(euchreGame.id).toBe('euchre')
    expect(euchreGame.name).toBe('Euchre')
    expect(euchreGame.category).toBe('trick')
    expect(euchreGame.glyph).toBe('◆')
    expect(euchreGame.shortDesc.length).toBeGreaterThan(0)
    expect(euchreGame.shortDesc.length).toBeLessThan(40)
  })

  it('exports renderPhoneRules with non-trivial HTML', () => {
    const html = euchreGame.renderPhoneRules?.() ?? ''
    expect(html.length).toBeGreaterThan(200)
    expect(html).toContain('Bidding')
    expect(html).toContain('Right Bower')
    expect(html).toContain('Trump')
  })
})

describe('euchreGame.init — initial render', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a GameHandle with all required methods', () => {
    const h = euchreGame.init(makeCtx())
    expect(typeof h.render).toBe('function')
    expect(typeof h.handleGlassesInput).toBe('function')
    expect(typeof h.handlePhoneEvent).toBe('function')
    expect(typeof h.destroy).toBe('function')
    h.destroy()
  })

  it('initial frame has team-score "Us:0(+0)  Them:0(+0)" — fresh game', () => {
    const h = euchreGame.init(makeCtx())
    expect(h.render().score).toBe('Us:0(+0)  Them:0(+0)')
    h.destroy()
  })

  it('initial phase is order-up; frame body shows plus-sign view + dealer marker + bracketed upcard', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('order-up')
    const body = h.render().body.join('\n')
    // v0.3.0 plus-sign view: dealer position has (D) marker, upcard is
    // bracketed in the middle of the W↔E row.
    expect(body).toMatch(/\b[NSWE]\([^)]*D[^)]*\)/) // some position has D in its marker
    expect(body).toMatch(/\[([2-9JQKA]|10)[♠♥◆♣]\]/) // bracketed upcard
    h.destroy()
  })
})

describe('euchreGame — order-up bidding (human turn)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeOrderUpHandle() {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.turn = 'S'
    s.phase = 'order-up'
    return h
  }

  it('renders Order/Pass toggle with cursor on Order initially', () => {
    const h = makeOrderUpHandle()
    const frame = h.render()
    const body = frame.body.join('\n')
    expect(body).toContain('▶Order')
    expect(body).toContain(' Pass')
    expect(frame.controlHint).toContain('[2x] confirm')
    h.destroy()
  })

  it('v0.2.1: bidding screen shows your hand below the Order/Pass toggle', () => {
    // Field feedback: in v0.2.0 the bid screen showed Order/Pass without
    // the player's hand, so they couldn't see what they had to bid on.
    const h = makeOrderUpHandle()
    const body = h.render().body.join('\n')
    // Hand rendering: at least one rank+suit combo should appear.
    expect(body).toMatch(/[2-9JQKA][♠♥◆♣]|10[♠♥◆♣]/)
    h.destroy()
  })

  it('swipe-down moves cursor from Order to Pass', () => {
    const h = makeOrderUpHandle()
    h.handleGlassesInput({ kind: 'swipe-down' })
    const body = h.render().body.join('\n')
    expect(body).toContain(' Order')
    expect(body).toContain('▶Pass')
    h.destroy()
  })

  it('single-tap mid-bid is a no-op (v0.1.5 convention)', () => {
    const h = makeOrderUpHandle()
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'tap' })
    h.handleGlassesInput({ kind: 'tap' })
    expect(h.render().body.join('\n')).toBe(before)
    h.destroy()
  })

  it('double-tap on Pass increments state.passes', () => {
    const h = makeOrderUpHandle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = (h as any).state.passes as number
    h.handleGlassesInput({ kind: 'swipe-down' }) // move to Pass
    h.handleGlassesInput({ kind: 'double-tap' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.passes).toBe(before + 1)
    h.destroy()
  })
})

describe('euchreGame — call-trump phase (human turn)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeCallTrumpHandle() {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.turn = 'S'
    s.phase = 'call-trump'
    s.forbiddenTrumpRound2 = '♠' // forbid spades (was upcard)
    s.passes = 0
    return h
  }

  it('renders 3 callable suits plus Pass option, cursor on first suit', () => {
    const h = makeCallTrumpHandle()
    const body = h.render().body.join('\n')
    // Callable: ♥ ♦ ♣ (spades forbidden) + Pass.
    // ♦ renders as ◆ on glasses (G2 font has advW=0 for U+2666).
    expect(body).toContain('▶♥')
    expect(body).toContain(' ◆')
    expect(body).toContain(' ♣')
    expect(body).toContain('Pass')
    h.destroy()
  })

  it('v0.2.1: call-trump screen shows your hand below the picker', () => {
    const h = makeCallTrumpHandle()
    const body = h.render().body.join('\n')
    expect(body).toMatch(/[2-9JQKA][♠♥◆♣]|10[♠♥◆♣]/)
    h.destroy()
  })

  it('swipe cycles through suits and Pass', () => {
    const h = makeCallTrumpHandle()
    h.handleGlassesInput({ kind: 'swipe-down' })
    let body = h.render().body.join('\n')
    expect(body).toContain('▶◆') // ♦ renders as ◆ on glasses
    h.handleGlassesInput({ kind: 'swipe-down' })
    h.handleGlassesInput({ kind: 'swipe-down' })
    body = h.render().body.join('\n')
    expect(body).toContain('▶Pass')
    h.destroy()
  })

  it('double-tap on a suit calls trump and transitions to play phase', () => {
    const h = makeCallTrumpHandle()
    h.handleGlassesInput({ kind: 'double-tap' }) // confirm cursor=0 (♥)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('play')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.trump).toBe('♥')
    h.destroy()
  })

  it('stick-the-dealer hides Pass option (must call)', () => {
    const h = makeCallTrumpHandle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.dealer = 'S'
    s.passes = 3
    const frame = h.render()
    const body = frame.body.join('\n')
    expect(body).not.toContain('Pass')
    expect(frame.controlHint).toContain('stuck')
    h.destroy()
  })
})

describe('euchreGame — play phase (with trump set)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makePlayHandle() {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'play'
    s.trump = '♥'
    s.maker = 'S'
    s.turn = 'S'
    s.trick = { plays: [], leadSuit: null }
    return h
  }

  it('renders trick + hand row + control hint when it is your turn', () => {
    const h = makePlayHandle()
    const frame = h.render()
    expect(frame.body.join('\n')).toContain('Trump:♥')
    expect(frame.controlHint).toContain('[2x] play')
    h.destroy()
  })

  it('v0.2.1: play render shows dealer + maker + upcard context line', () => {
    // Field feedback: during play you can't tell who dealt, who made
    // trump, or what the upcard was (which would be in dealer's hand if
    // round 1 was ordered up).
    const h = makePlayHandle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.dealer = 'W'
    s.maker = 'E'
    s.upCard = { rank: 'J', suit: '♥' }
    const body = h.render().body.join('\n')
    expect(body).toContain('D:W')
    expect(body).toContain('Maker:E')
    expect(body).toContain('Up:J♥')
    h.destroy()
  })

  it('v0.3.0: plus-sign bid view shows current bidder with ▶ marker', () => {
    // Force a specific scenario: S is bidding, W is dealer, no passes yet.
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.phase = 'order-up'
    internal.state.dealer = 'W'
    internal.state.turn = 'S'
    internal.state.passes = 0
    const body = h.render().body.join('\n')
    // W has (D), S has (me,▶), N has no marker, E has no marker
    expect(body).toContain('W(D)')
    expect(body).toContain('S(me,▶)')
    h.destroy()
  })

  it('v0.3.0: plus-sign bid view shows passed players with — marker', () => {
    // Dealer = E. Bidding order: S → W → N → E. After 2 passes, S and W have passed.
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.phase = 'order-up'
    internal.state.dealer = 'E'
    internal.state.turn = 'N'
    internal.state.passes = 2
    const body = h.render().body.join('\n')
    expect(body).toContain('S(me,—)')
    expect(body).toContain('W(—)')
    expect(body).toContain('N(▶)')
    expect(body).toContain('E(D)')
    h.destroy()
  })

  it('v0.2.2: diamond suit renders as ◆ (not ♦) on glasses', () => {
    // Field-feedback bug: U+2666 (♦) has advW=0 in G2 firmware font and
    // displays as a blank cell. Platform's SUIT_GLYPH maps ♦ → ◆. Test
    // that the wrapper routes every suit display through it.
    const h = makePlayHandle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.trump = '♦'
    s.upCard = { rank: 'A', suit: '♦' }
    const body = h.render().body.join('\n')
    expect(body).toContain('Trump:◆')
    expect(body).toContain('Up:A◆')
    // No raw ♦ should leak through — that would be invisible on glasses.
    expect(body).not.toContain('Trump:♦')
    expect(body).not.toContain('Up:A♦')
    h.destroy()
  })

  it('single-tap is no-op; double-tap on a legal card advances state', () => {
    const h = makePlayHandle()
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'tap' })
    expect(h.render().body.join('\n')).toBe(before)
    // Cycle until double-tap advances.
    let advanced = false
    for (let i = 0; i < 6; i++) {
      h.handleGlassesInput({ kind: 'double-tap' })
      if (h.render().body.join('\n') !== before) { advanced = true; break }
      h.handleGlassesInput({ kind: 'swipe-down' })
    }
    expect(advanced).toBe(true)
    h.destroy()
  })
})

describe('euchreGame — hand-end + game-end', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hand-end shows "Hand done" + tricks + trump + maker', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'hand-end'
    s.trump = '♠'
    s.maker = 'S'
    s.tricks = { NS: 3, EW: 2 }
    const frame = h.render()
    const body = frame.body.join('\n')
    expect(body).toContain('Hand done')
    expect(body).toContain('us 3 - 2 them')
    expect(body).toContain('Trump was ♠')
    expect(frame.controlHint).toBe('[2x] next hand')
    h.destroy()
  })

  it('game-end shows winner banner', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'game-end'
    s.score = { NS: 10, EW: 6 }
    const frame = h.render()
    expect(frame.body.join('\n')).toContain('*** US WIN ***')
    expect(frame.controlHint).toBe('[2x] back to menu')
    h.destroy()
  })

  it('game-end double-tap calls ctx.endGame()', () => {
    const ctx = makeCtx()
    const h = euchreGame.init(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.phase = 'game-end'
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })

  it('hand-end double-tap deals a new hand', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'hand-end'
    s.dealer = 'S' // so next dealer is W (clockwise)
    h.handleGlassesInput({ kind: 'double-tap' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('order-up')
    h.destroy()
  })
})

describe('euchreGame — phone events', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('phone "new-game" resets to order-up with fresh deal', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.score = { NS: 8, EW: 4 }
    h.handlePhoneEvent({ kind: 'new-game' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('order-up')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.score).toEqual({ NS: 0, EW: 0 })
    h.destroy()
  })

  it('phone "set-difficulty" updates this.difficulty', () => {
    const h = euchreGame.init(makeCtx())
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'hard' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).difficulty).toBe('hard')
    h.handlePhoneEvent({ kind: 'set-difficulty', payload: 'easy' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).difficulty).toBe('easy')
    h.destroy()
  })

  it('unknown phone events are no-ops (do not throw)', () => {
    const h = euchreGame.init(makeCtx())
    expect(() => h.handlePhoneEvent({ kind: 'totally-not-a-real-event' })).not.toThrow()
    h.destroy()
  })

  it('destroy() does not throw', () => {
    const h = euchreGame.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })

  it('destroy() cancels pending AI timers (no stray callbacks)', () => {
    const ctx = makeCtx()
    const h = euchreGame.init(ctx)
    const renderCallsBefore = ctx.requestRender.mock.calls.length
    h.destroy()
    vi.advanceTimersByTime(5000)
    expect(ctx.requestRender.mock.calls.length).toBe(renderCallsBefore)
  })
})

describe('euchreGame — cursor parking on legal cards (v0.1.5+ convention)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('parks cursor on first legal card when must-follow-suit (♥ trump, lead ♣)', () => {
    const h = euchreGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.phase = 'play'
    internal.state.trump = '♥'
    internal.state.turn = 'S'
    internal.state.trick = {
      plays: [{ pos: 'W', card: { suit: '♣', rank: '10' } }],
      leadSuit: '♣',
    }
    // Hand sorted: ♠ ♥ ♦ ♣ → [9♠, J♥(=right bower), Q♦, 10♣, K♣]
    internal.state.hands = {
      S: [
        { suit: '♠', rank: '9' },
        { suit: '♥', rank: 'J' },
        { suit: '♦', rank: 'Q' },
        { suit: '♣', rank: '10' },
        { suit: '♣', rank: 'K' },
      ],
      W: [], N: [], E: [],
    }
    internal.cursor = 0 // on 9♠ (illegal — must follow ♣)
    internal.parkPlayCursor()
    // sortBySuit: ♠ ♥ ♦ ♣ → [9♠, J♥, Q♦, 10♣, K♣]
    // First legal (♣) is at index 3.
    expect(internal.cursor).toBe(3)
    h.destroy()
  })
})
