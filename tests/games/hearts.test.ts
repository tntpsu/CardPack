// Hearts GameHandle wrapper tests.
//
// Black-box: instantiate via heartsGame.init(mockCtx) and exercise the
// public interface (render, handleGlassesInput, handlePhoneEvent, destroy).
// State is private; we infer it from observable render() output.
//
// What's NOT covered here:
// - End-of-hand / end-of-game flows. Reaching game-end requires playing
//   a full hand; reaching hand-end requires 13 tricks. These need either
//   integration tests with synthetic state injection (planned) or the
//   simulator e2e (planned).
// - AI behavior — covered upstream in ~/Documents/Hearts/tests/.
// - Engine correctness — same.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStorage, PlatformContext } from 'even-card-platform'
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

function makeCtx(): PlatformContext & { endGame: ReturnType<typeof vi.fn> } {
  const endGame = vi.fn()
  return {
    storage: makeStorage(),
    difficulty: 'medium',
    endGame,
  }
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
  it('returns a GameHandle with all required methods', () => {
    const h = heartsGame.init(makeCtx())
    expect(typeof h.render).toBe('function')
    expect(typeof h.handleGlassesInput).toBe('function')
    expect(typeof h.handlePhoneEvent).toBe('function')
    expect(typeof h.destroy).toBe('function')
  })

  it('initial render() returns a valid GlassesFrame', () => {
    const h = heartsGame.init(makeCtx())
    const frame = h.render()
    expect(typeof frame.score).toBe('string')
    expect(Array.isArray(frame.body)).toBe(true)
    expect(typeof frame.controlHint).toBe('string')
    expect(frame.body.length).toBeGreaterThan(0)
  })

  it('initial score is "S:0 W:0 N:0 E:0" — fresh game', () => {
    const h = heartsGame.init(makeCtx())
    expect(h.render().score).toBe('S:0 W:0 N:0 E:0')
  })

  it('initial body contains the plus-sign trick layout markers', () => {
    const h = heartsGame.init(makeCtx())
    const body = h.render().body.join('\n')
    // Plus-trick produces N row, W..E row, S row — verify all four labels.
    expect(body).toContain('N')
    expect(body).toContain('W')
    expect(body).toContain('E')
    expect(body).toContain('S')
  })

  it('controlHint always advertises swipe + tap during play (AI plays synchronously)', () => {
    const h = heartsGame.init(makeCtx())
    const hint = h.render().controlHint
    expect(hint).toContain('swipe')
    expect(hint).toContain('tap')
  })
})

describe('heartsGame — gesture handling', () => {
  it('destroy() does not throw', () => {
    const h = heartsGame.init(makeCtx())
    expect(() => h.destroy()).not.toThrow()
  })

  it('unknown phone events are no-ops (do not throw)', () => {
    const h = heartsGame.init(makeCtx())
    expect(() => h.handlePhoneEvent({ kind: 'totally-not-a-real-event' })).not.toThrow()
  })

  it('all four gestures execute without throwing', () => {
    const h = heartsGame.init(makeCtx())
    expect(() => h.handleGlassesInput({ kind: 'swipe-up' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'swipe-down' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'tap' })).not.toThrow()
    expect(() => h.handleGlassesInput({ kind: 'double-tap' })).not.toThrow()
  })
})

describe('heartsGame — phone "new-game" event resets state', () => {
  it('after new-game, score is back to 0', () => {
    const h = heartsGame.init(makeCtx())
    // Note: a fresh game already has zero scores, so this asserts the
    // post-new-game state still has zero scores rather than proving a
    // reset from a non-zero. Real "reset after progress" coverage needs
    // an integration test that plays through to non-zero first.
    h.handlePhoneEvent({ kind: 'new-game' })
    expect(h.render().score).toBe('S:0 W:0 N:0 E:0')
  })
})

describe('heartsGame — cursor movement', () => {
  // autoplayUntilHuman runs inside init(), so render() always shows the
  // human's turn — no flake from random deal order.

  it('cursor movement is reflected in the rendered hand row', () => {
    const h = heartsGame.init(makeCtx())
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'swipe-down' })
    const after = h.render().body.join('\n')
    // Cursor position is rendered as a ▲ on the line below the hand row.
    // After swipe-down the ▲ should be in a different horizontal position.
    expect(before).toContain('▲')
    expect(after).toContain('▲')
    expect(before).not.toBe(after)
  })

  it('swipe-up after swipe-down returns to the original cursor position', () => {
    const h = heartsGame.init(makeCtx())
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'swipe-down' })
    h.handleGlassesInput({ kind: 'swipe-up' })
    expect(h.render().body.join('\n')).toBe(before)
  })

  it('cursor wraps at the end of the hand (swipe-down past the last card)', () => {
    const h = heartsGame.init(makeCtx())
    const initial = h.render().body.join('\n')
    // 13 swipe-downs should wrap fully around a 13-card hand
    for (let i = 0; i < 13; i++) h.handleGlassesInput({ kind: 'swipe-down' })
    expect(h.render().body.join('\n')).toBe(initial)
  })
})

describe('heartsGame — tap behavior', () => {
  it('tap eventually advances state — cycle through the hand until a legal card is found', () => {
    const h = heartsGame.init(makeCtx())
    const before = h.render().body.join('\n')
    // The cursor starts at index 0, which may or may not be a legal play.
    // Walk through the hand (≤13 cards), tap each position; SOME legal
    // card exists by engine invariant (legalPlays returns ≥1). Asserts
    // that AT LEAST one tap-cycle produces a state change.
    let changed = false
    for (let i = 0; i < 13; i++) {
      h.handleGlassesInput({ kind: 'tap' })
      if (h.render().body.join('\n') !== before) { changed = true; break }
      h.handleGlassesInput({ kind: 'swipe-down' })
    }
    expect(changed).toBe(true)
  })

  it('mid-play double-tap is a no-op (only meaningful at hand-end/game-end)', () => {
    const h = heartsGame.init(makeCtx())
    const before = h.render().body.join('\n')
    h.handleGlassesInput({ kind: 'double-tap' })
    expect(h.render().body.join('\n')).toBe(before)
  })
})
