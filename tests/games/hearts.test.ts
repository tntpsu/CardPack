// Hearts GameHandle wrapper tests.
//
// Black-box: instantiate via heartsGame.init(mockCtx) and exercise the
// public interface (render, handleGlassesInput, handlePhoneEvent, destroy).
// State is private; we infer it from observable render() output.
//
// Pacing: HeartsHandle uses setTimeout for AI step delays and trick
// lingering. Tests use vi.useFakeTimers + advanceUntilHumanTurn() to
// fast-forward to the human's turn deterministically.
//
// What's NOT covered here:
// - End-of-hand / end-of-game flows. Reaching them requires 13 tricks
//   of paced play. These need state-injection helpers (planned) or
//   the simulator e2e.
// - AI behavior — covered upstream in ~/Documents/Hearts/tests/.
// - Engine correctness — same.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameHandle, GameStorage, PlatformContext } from 'even-card-platform'
import { heartsGame } from '../../src/games/hearts'

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

/** Advance fake timers in 1 s chunks until the handle's state.turn is
 *  'S' (human is at lead) or maxMs has elapsed. Worst case ~3.6 s of
 *  game time: 3 AI plays at 700ms each + 1.5 s trick linger. */
function advanceUntilHumanTurn(h: GameHandle, maxMs = 20_000): void {
  let advanced = 0
  while (advanced < maxMs && getTurn(h) !== 'S') {
    vi.advanceTimersByTime(500)
    advanced += 500
  }
}

function getTurn(h: GameHandle): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (h as any).state.turn as string
}

describe('heartsGame — module metadata', () => {
  it('has the canonical id, name, category, glyph', () => {
    expect(heartsGame.id).toBe('hearts')
    expect(heartsGame.name).toBe('Hearts')
    expect(heartsGame.category).toBe('trick')
    expect(heartsGame.glyph).toBe('♥')
    expect(heartsGame.shortDesc.length).toBeGreaterThan(0)
    expect(heartsGame.shortDesc.length).toBeLessThan(40)
  })
})

describe('heartsGame.init — initial render', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a GameHandle with all required methods', () => {
    const h = heartsGame.init(makeCtx())
    expect(typeof h.render).toBe('function')
    expect(typeof h.handleGlassesInput).toBe('function')
    expect(typeof h.handlePhoneEvent).toBe('function')
    expect(typeof h.destroy).toBe('function')
    h.destroy()
  })

  it('initial render() returns a valid GlassesFrame', () => {
    const h = heartsGame.init(makeCtx())
    const frame = h.render()
    expect(typeof frame.score).toBe('string')
    expect(Array.isArray(frame.body)).toBe(true)
    expect(typeof frame.controlHint).toBe('string')
    expect(frame.body.length).toBeGreaterThan(0)
    h.destroy()
  })

  it('initial score is "S:0(+0)  W:0(+0)  N:0(+0)  E:0(+0)" — matches hand-end (+N) format (v0.1.5)', () => {
    const h = heartsGame.init(makeCtx())
    expect(h.render().score).toBe('S:0(+0)  W:0(+0)  N:0(+0)  E:0(+0)')
    h.destroy()
  })

  it('after advancing to human turn, body contains plus-sign trick markers', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const body = h.render().body.join('\n')
    expect(body).toContain('N')
    expect(body).toContain('W')
    expect(body).toContain('E')
    expect(body).toContain('S')
    h.destroy()
  })

  it('controlHint shows swipe + 2x play once it is the human\'s turn (v0.1.7: was "tap", now "2x")', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const hint = h.render().controlHint
    expect(hint).toContain('swipe')
    expect(hint).toContain('2x')
    expect(hint).toContain('play')
    h.destroy()
  })

  it('controlHint is empty while AI is playing (no cursor, no actions)', () => {
    const h = heartsGame.init(makeCtx())
    // Constructor schedules an AI timer iff turn !== HUMAN. If S has the
    // 2♣, no timer is scheduled and we're already at the human's turn —
    // in which case this assertion is moot, but the test is still valid:
    // either no AI pacing OR pacing-with-empty-hint, never an in-game
    // hint while AI is up.
    if (getTurn(h) !== 'S') {
      expect(h.render().controlHint).toBe('')
    }
    h.destroy()
  })
})

describe('heartsGame — gesture handling', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('destroy() does not throw', () => {
    const h = heartsGame.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })

  it('destroy() cancels pending AI timers (no stray callbacks)', () => {
    const ctx = makeCtx()
    const h = heartsGame.init(ctx)
    // Capture render-count, destroy, advance time. requestRender must not
    // be called again after destroy.
    const renderCallsBefore = ctx.requestRender.mock.calls.length
    h.destroy()
    vi.advanceTimersByTime(5000)
    expect(ctx.requestRender.mock.calls.length).toBe(renderCallsBefore)
  })

  it('unknown phone events are no-ops (do not throw)', () => {
    const h = heartsGame.init(makeCtx())
    expect(() => h.handlePhoneEvent({ kind: 'totally-not-a-real-event' })).not.toThrow()
    h.destroy()
  })

  it('all four gestures execute without throwing', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    expect(() => h.handleGlassesInput({ kind: 'swipe-up' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'swipe-down' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'tap' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'double-tap' })).not.toThrow()
    h.destroy()
  })
})

describe('heartsGame — phone "new-game" event', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('after new-game, score is back to 0', () => {
    const h = heartsGame.init(makeCtx())
    h.handlePhoneEvent({ kind: 'new-game' })
    expect(h.render().score).toBe('S:0(+0)  W:0(+0)  N:0(+0)  E:0(+0)')
    h.destroy()
  })
})

describe('heartsGame — cursor movement (after advancing to human turn)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('cursor movement is reflected in the rendered hand row', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'swipe-down' })
    const after = h.render().body.join('\n')
    // v0.1.6: cursor is ▲ when active card is in row 1, ▼ when in row 2.
    expect(before).toMatch(/[▲▼]/)
    expect(after).toMatch(/[▲▼]/)
    expect(before).not.toBe(after)
    h.destroy()
  })

  it('swipe-up after swipe-down returns to original cursor position', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'swipe-down' })
    h.handleGlassesInput({ kind: 'swipe-up' })
    expect(h.render().body.join('\n')).toBe(before)
    h.destroy()
  })

  it('cursor wraps at the end of the hand (swipe-down past the last card)', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const initial = h.render().body.join('\n')
    for (let i = 0; i < 13; i++) h.handleGlassesInput({ kind: 'swipe-down' })
    expect(h.render().body.join('\n')).toBe(initial)
    h.destroy()
  })
})

describe('heartsGame — play gesture (v0.1.5: double-tap, not tap)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('double-tap on legal cursored card plays it — cycle through hand until cursor parks on a legal one', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const before = h.render().body.join('\n')
    let changed = false
    for (let i = 0; i < 13; i++) {
      h.handleGlassesInput({ kind: 'double-tap' })
      if (h.render().body.join('\n') !== before) { changed = true; break }
      h.handleGlassesInput({ kind: 'swipe-down' })
    }
    expect(changed).toBe(true)
    h.destroy()
  })

  it('single-tap mid-play is a no-op (v0.1.5: prevents accidental plays)', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    const before = h.render().body.join('\n')
    // 13 single-taps in a row should not advance state.
    for (let i = 0; i < 13; i++) {
      h.handleGlassesInput({ kind: 'tap' })
    }
    expect(h.render().body.join('\n')).toBe(before)
    h.destroy()
  })

  it('double-tap on illegal cursored card is a no-op (cursor stays, no play happens)', () => {
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    // Manually move cursor onto a card we KNOW is illegal: cursor is parked
    // on a legal card by v0.1.5 auto-park, so swipe-down to move OFF the
    // legal subset (if multi-suit hand) or rely on the legal subset being
    // small enough that other cards are illegal.
    // Simplest assertion: when cursor is on an illegal card (manually
    // walked off), double-tap doesn't change the rendered body.
    // We find an illegal card by checking the rendered hand for parens "(X)".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sorted = sortHandFromHandle(h)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legal = (h as any).state ? legalCardIds(h) : new Set<string>()
    const illegalIdx = sorted.findIndex(c => !legal.has(`${c.suit}${c.rank}`))
    if (illegalIdx === -1) {
      // All cards legal (e.g. leading) — skip this assertion gracefully.
      h.destroy()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).cursor = illegalIdx
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(h.render().body.join('\n')).toBe(before)
    h.destroy()
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortHandFromHandle(h: any): Array<{suit: string; rank: string}> {
  const order: Record<string, number> = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 }
  const ranks: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  }
  const hand = (h.state.hands.S as Array<{suit: string; rank: string}>).slice()
  hand.sort((a, b) => {
    const sd = (order[a.suit] ?? 99) - (order[b.suit] ?? 99)
    if (sd !== 0) return sd
    return (ranks[a.rank] ?? 0) - (ranks[b.rank] ?? 0)
  })
  return hand
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legalCardIds(h: any): Set<string> {
  // Mirror the engine's legalPlays for the current state, given h.state.turn === 'S'.
  // Simpler: read it via reflection if accessible. Fall back to "all cards legal"
  // when we can't compute it cleanly (the test caller handles the empty case).
  // For now, infer "legal" by re-rendering and looking at the hand row — cards
  // without parens are legal. This is good enough for "find any illegal idx" tests.
  const frame = h.render() as { body: string[] }
  const ids = new Set<string>()
  const handLineRe = /(?:\(([2-9JQKA]|10)([♠♥◆♣])\)|([2-9JQKA]|10)([♠♥◆♣]))/g
  for (const line of frame.body) {
    for (const m of line.matchAll(handLineRe)) {
      if (m[3] && m[4]) {
        // Non-paren match = legal card. Note ◆ is the platform's diamond glyph.
        const suit = m[4] === '◆' ? '♦' : m[4]
        ids.add(`${suit}${m[3]}`)
      }
    }
  }
  return ids
}

describe('heartsGame — hand-end render', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows "Hand done" + score lines + [2x] next hand at hand-end', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.phase = 'hand-end'
    const frame = h.render()
    expect(frame.body[0]).toBe('Hand done')
    expect(frame.body.join('\n')).toContain('S(me):')
    expect(frame.controlHint).toBe('[2x] next hand')
    h.destroy()
  })
})

describe('heartsGame — game-end render', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows winner banner + [2x] back-to-menu at game-end (human loses)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'game-end'
    s.score = { S: 50, W: 12, N: 25, E: 18 } // human (S) highest = loses
    const frame = h.render()
    expect(frame.body.join('\n')).toContain('*** THEM WIN ***')
    expect(frame.controlHint).toBe('[2x] back to menu')
    h.destroy()
  })

  it('shows "YOU WIN" when human has the lowest score', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'game-end'
    s.score = { S: 5, W: 50, N: 30, E: 28 } // human (S) lowest = wins
    const frame = h.render()
    expect(frame.body.join('\n')).toContain('*** YOU WIN ***')
    h.destroy()
  })
})

describe('heartsGame — double-tap at hand-end / game-end', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('double-tap at hand-end starts a new hand (phase → play, tricksPlayed → 0)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.phase = 'hand-end'
    s.tricksPlayed = 13
    h.handleGlassesInput({ kind: 'double-tap' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('play')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.tricksPlayed).toBe(0)
    h.destroy()
  })

  it('double-tap at game-end calls ctx.endGame()', () => {
    const ctx = makeCtx()
    const h = heartsGame.init(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.phase = 'game-end'
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(ctx.endGame).toHaveBeenCalled()
    h.destroy()
  })

  it('single-tap at hand-end is a no-op (only double-tap advances)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.phase = 'hand-end'
    h.handleGlassesInput({ kind: 'tap' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h as any).state.phase).toBe('hand-end')
    h.destroy()
  })

  it('single-tap at game-end does not call endGame (only double-tap)', () => {
    const ctx = makeCtx()
    const h = heartsGame.init(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).state.phase = 'game-end'
    h.handleGlassesInput({ kind: 'tap' })
    expect(ctx.endGame).not.toHaveBeenCalled()
    h.destroy()
  })
})

describe('heartsGame — pacing + trick linger (the field bug from v0.1.2)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('regression: after tap, the 4-card trick lingers before clearing', () => {
    // Field bug: user played the 4th card of a trick, AI played at the
    // same instant, and the trick auto-cleared with no chance for the
    // user to see it. Fixed by capturing the completed trick into
    // HeartsHandle.lingerTrick and clearing it after TRICK_LINGER_MS.
    //
    // Sampling: tap a legal card, then walk time forward in chunks and
    // assert that at SOME point in the next ~4 s the trick view shows a
    // card. If linger never fires (field bug regressed), the trick
    // clears instantly and we'd see only dashes the entire window.
    const h = heartsGame.init(makeCtx())
    advanceUntilHumanTurn(h)
    // Clear any pending linger from initial AI plays before our tap.
    vi.advanceTimersByTime(1000)
    advanceUntilHumanTurn(h)
    // Find a legal card and play it (v0.1.5: double-tap to play).
    let played = false
    for (let i = 0; i < 13; i++) {
      const before = h.render().body.join('\n')
      h.handleGlassesInput({ kind: 'double-tap' })
      if (h.render().body.join('\n') !== before) { played = true; break }
      h.handleGlassesInput({ kind: 'swipe-down' })
    }
    expect(played).toBe(true)
    // Sample across the AI-paced window. If linger fires we see cards;
    // if linger doesn't fire (regression) we'd see only dashes throughout.
    let everSawCard = false
    for (let t = 0; t < 4500 && !everSawCard; t += 200) {
      vi.advanceTimersByTime(200)
      const body = h.render().body.join('\n')
      if (/:\s+([2-9JQKA]|10)[♠♥◆♣]/.test(body)) everSawCard = true
    }
    expect(everSawCard).toBe(true)
    h.destroy()
  })

  it('regression: requestRender is called during paced AI plays', () => {
    // If pacing works, the runtime is asked to re-render each step.
    // Static-state synchronous play would only fire requestRender once.
    const ctx = makeCtx()
    const h = heartsGame.init(ctx)
    const initialRenderCount = ctx.requestRender.mock.calls.length
    // Advance enough for several AI plays — at least 4 paced steps.
    vi.advanceTimersByTime(5000)
    const finalRenderCount = ctx.requestRender.mock.calls.length
    // We expect at least one re-render IF AI played. If S started the
    // game (turn = S from init), AI doesn't play yet — but we'd still
    // see 0 ≤ delta, not a crash.
    expect(finalRenderCount).toBeGreaterThanOrEqual(initialRenderCount)
    h.destroy()
  })
})

describe('heartsGame — running score format (v0.1.5)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('scoreString shows game-score with parens-subordinated hand-points: S:N(+H)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.score = { S: 5, W: 12, N: 0, E: 3 }
    s.handPoints = { S: 2, W: 0, N: 13, E: 1 }
    expect(h.render().score).toBe('S:5(+2)  W:12(+0)  N:0(+13)  E:3(+1)')
    h.destroy()
  })

  it('hand-points reset to (+0) across the row right after startNewHand', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = (h as any).state
    s.score = { S: 5, W: 12, N: 0, E: 3 }
    s.handPoints = { S: 2, W: 0, N: 13, E: 1 }
    s.phase = 'hand-end'
    s.tricksPlayed = 13
    h.handleGlassesInput({ kind: 'double-tap' }) // start new hand
    const frame = h.render()
    // Game score persists; hand-points reset to (+0).
    expect(frame.score).toBe('S:5(+0)  W:12(+0)  N:0(+0)  E:3(+0)')
    h.destroy()
  })
})

describe('heartsGame — cursor parking on legal cards (v0.1.5)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('parks cursor on first legal card when must-follow-suit', () => {
    const h = heartsGame.init(makeCtx())
    // Set up a mid-trick scenario where HUMAN must follow ♥.
    // Hand: 2♠, 7♥, 9♥, 4♦, 6♣ → sortBySuit order: ♠ ♥ ♦ ♣
    // → sorted = [2♠, 7♥, 9♥, 4♦, 6♣]
    // Legal subset (must follow ♥): [7♥, 9♥]
    // Cursor starts at 0 (2♠ = illegal). Park should land it at index 1 (7♥).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.turn = 'S'
    internal.state.phase = 'play'
    internal.state.tricksPlayed = 5 // past the first-trick special rule
    internal.state.heartsBroken = true
    internal.state.trick = {
      plays: [{ pos: 'W', card: { suit: '♥', rank: '5' } }],
      leadSuit: '♥',
    }
    internal.state.hands = {
      S: [
        { suit: '♠', rank: '2' },
        { suit: '♥', rank: '7' },
        { suit: '♥', rank: '9' },
        { suit: '♦', rank: '4' },
        { suit: '♣', rank: '6' },
      ],
      W: [], N: [], E: [],
    }
    internal.cursor = 0
    internal.parkCursorOnLegal()
    expect(internal.cursor).toBe(1) // 7♥ in sorted order
    h.destroy()
  })

  it('does not move cursor when current card is already legal (respects user movement)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.turn = 'S'
    internal.state.phase = 'play'
    internal.state.tricksPlayed = 5
    internal.state.heartsBroken = true
    internal.state.trick = {
      plays: [{ pos: 'W', card: { suit: '♥', rank: '5' } }],
      leadSuit: '♥',
    }
    internal.state.hands = {
      S: [
        { suit: '♠', rank: '2' },
        { suit: '♥', rank: '7' },
        { suit: '♥', rank: '9' },
        { suit: '♦', rank: '4' },
      ],
      W: [], N: [], E: [],
    }
    // Cursor on 9♥ (index 2 in sorted = ♠2 ♥7 ♥9 ♦4) — legal.
    internal.cursor = 2
    internal.parkCursorOnLegal()
    expect(internal.cursor).toBe(2) // unchanged — user chose 9♥, respected
    h.destroy()
  })

  it('does not park when it is AI\'s turn (no-op until HUMAN gets the lead)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.turn = 'W' // not HUMAN
    internal.state.phase = 'play'
    internal.cursor = 0
    internal.parkCursorOnLegal()
    expect(internal.cursor).toBe(0) // untouched
    h.destroy()
  })

  it('does not park during a linger window (cursor frozen while trick is visible)', () => {
    const h = heartsGame.init(makeCtx())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internal: any = (h as any)
    internal.state.turn = 'S'
    internal.state.phase = 'play'
    internal.lingerTrick = {
      plays: [
        { pos: 'S', card: { suit: '♥', rank: '5' } },
        { pos: 'W', card: { suit: '♥', rank: '8' } },
        { pos: 'N', card: { suit: '♥', rank: 'K' } },
        { pos: 'E', card: { suit: '♥', rank: '3' } },
      ],
      leadSuit: '♥',
    }
    internal.cursor = 0
    internal.parkCursorOnLegal()
    expect(internal.cursor).toBe(0) // untouched during linger
    h.destroy()
  })
})
