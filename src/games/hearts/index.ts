// Hearts — Game module obeying the even-card-platform contract.
//
// Engine + AI are copied verbatim from the standalone ~/Documents/Hearts.
// This file is the wrapper that:
//   - Holds GameState
//   - Renders via the platform's renderPlusTrick + renderHandRow
//   - Translates glasses gestures into engine moves
//   - Runs AI turns between human plays
//
// Phase A scope: hard-coded target score 50, medium difficulty. Settings UI
// lands in Phase B when more than one game's settings are visible.

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import {
  renderHand, renderPlusTrick, sortBySuit,
} from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { applyOneAiStep, autoplayUntilHuman, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  legalPlays, newGame, playCard, startNewHand, gameWinner,
  type Card, type GameState, type Position,
} from './engine'

const HUMAN: Position = 'S'

export const heartsGame: Game = {
  id: 'hearts',
  name: 'Hearts',
  shortDesc: 'Avoid hearts + Q♠',
  category: 'trick',
  glyph: '♥',
  init: (ctx: PlatformContext): GameHandle => new HeartsHandle(ctx),
}

class HeartsHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(50)
    // First trick of the hand: AI may need to lead before South plays.
    this.state = autoplayUntilHuman(this.state, HUMAN, this.difficulty)
    this.clampCursor()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') {
      const winner = gameWinner(s)
      const banner = winner === HUMAN ? '*** YOU WIN ***' : '*** THEM WIN ***'
      return {
        score: this.scoreString(),
        body: [
          ...this.scoreLines(),
          '',
          banner,
        ],
        controlHint: '[2x] back to menu',
      }
    }
    if (s.phase === 'hand-end') {
      return {
        score: this.scoreString(),
        body: [
          'Hand done',
          ...this.scoreLines(),
        ],
        banner: '',
        controlHint: '[2x] next hand',
      }
    }
    // phase === 'play' — autoplayUntilHuman is invoked after every state
    // transition (init, tap, new-game), so by the time render runs the
    // turn is always HUMAN. AI plays through synchronously between
    // human moves; there's no "AI thinking" state the user ever sees.
    //
    // Hand is sorted by suit + rank so cursor movement feels predictable
    // (rank groups cluster visually). With 13 cards the platform's
    // renderHand splits into two rows so the layout fits the 576 px
    // display — see regression test in tests/hand.test.ts.
    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[])
    const legal = legalPlays(s, HUMAN)
    const trickLines = renderPlusTrick({
      plays: (['N', 'W', 'E', 'S'] as Position[]).map(pos => ({
        pos,
        card: s.trick.plays.find(p => p.pos === pos)?.card ?? null,
      })),
      getMarker: pos => this.markersFor(pos),
    })
    const handLines = renderHand({
      hand: sorted,
      cursorIdx: this.cursor,
      legal: legal as readonly PlatformCard[],
    })
    const body = [
      ...trickLines,
      ...handLines,
    ]
    return {
      score: this.scoreString(),
      body,
      controlHint: '[swipe] sel  [tap] play',
    }
  }

  handleGlassesInput(g: GlassesGesture): void {
    const s = this.state

    if (s.phase === 'game-end') {
      if (g.kind === 'double-tap') this.ctx.endGame()
      return
    }
    if (s.phase === 'hand-end') {
      if (g.kind === 'double-tap') {
        this.state = startNewHand(s)
        this.state = autoplayUntilHuman(this.state, HUMAN, this.difficulty)
        this.clampCursor()
      }
      return
    }
    // play phase
    if (s.turn !== HUMAN) return  // ignore input while AI thinks

    // The cursor walks the SORTED view (same view the user sees on
    // glasses). Tap fetches the cursored card from the sorted view and
    // plays THAT card; the engine doesn't care about display order.
    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    const legal = legalPlays(s, HUMAN)
    const legalKeys = new Set(legal.map(cardId))
    switch (g.kind) {
      case 'swipe-up':
        this.cursor = (this.cursor - 1 + sorted.length) % sorted.length
        return
      case 'swipe-down':
        this.cursor = (this.cursor + 1) % sorted.length
        return
      case 'tap': {
        const c = sorted[this.cursor]
        if (!c || !legalKeys.has(cardId(c))) return  // illegal — ignore
        this.state = playCard(s, HUMAN, c)
        this.state = autoplayUntilHuman(this.state, HUMAN, this.difficulty)
        this.clampCursor()
        return
      }
      case 'double-tap':
        return  // unused mid-play
    }
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.state = newGame(50)
      this.state = autoplayUntilHuman(this.state, HUMAN, this.difficulty)
      this.clampCursor()
    }
  }

  destroy(): void { /* no resources to release */ }

  // ── helpers ──────────────────────────────────────────────────────

  private scoreString(): string {
    const s = this.state.score
    return `S:${s.S} W:${s.W} N:${s.N} E:${s.E}`
  }

  private scoreLines(): string[] {
    const s = this.state.score
    const hp = this.state.handPoints
    return [
      `S(me): ${s.S} (+${hp.S})`,
      `W: ${s.W} (+${hp.W})`,
      `N: ${s.N} (+${hp.N})`,
      `E: ${s.E} (+${hp.E})`,
    ]
  }

  private markersFor(pos: Position): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    // (led) on whoever started the current trick
    if (this.state.trick.plays.length > 0 && this.state.trick.plays[0]!.pos === pos) {
      parts.push('led')
    }
    return parts.join(',')
  }

  private clampCursor(): void {
    const len = this.state.hands[HUMAN].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
  }
}

function cardId(c: Card): string { return `${c.suit}${c.rank}` }
