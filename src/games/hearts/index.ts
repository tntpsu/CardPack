// Hearts — Game module obeying the even-card-platform contract.
//
// Engine + AI are copied verbatim from the standalone ~/Documents/Hearts.
// This file is the wrapper that:
//   - Holds GameState
//   - Renders via the platform's renderPlusTrick + renderHand
//   - Translates glasses gestures into engine moves
//   - Paces AI plays via setTimeout so the user can see each card land
//   - Lingers on completed tricks so all four cards are visible before
//     the engine clears them
//
// Pacing constants match the standalone Hearts repo (real-glasses-tested
// in May 2026):
//   AI_STEP_MS = 700   — between AI plays
//   TRICK_LINGER_MS = 1500 — completed 4-card trick stays visible

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import {
  renderHand, renderPlusTrick, sortBySuit,
} from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiPlay, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  legalPlays, newGame, playCard, startNewHand, gameWinner,
  type Card, type GameState, type Position, type Suit, type Trick,
} from './engine'

const HUMAN: Position = 'S'
const AI_STEP_MS = 700
const TRICK_LINGER_MS = 1500

export const heartsGame: Game = {
  id: 'hearts',
  name: 'Hearts',
  shortDesc: 'Avoid hearts + Q♠',
  category: 'trick',
  glyph: '♥',
  init: (ctx: PlatformContext): GameHandle => new HeartsHandle(ctx),
  renderPhoneRules: () => HEARTS_RULES_HTML,
}

class HeartsHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  /** Captured 4-play trick to render INSTEAD of the live (cleared) trick.
   *  Set when an AI or human play completes a trick; cleared after
   *  TRICK_LINGER_MS so the next AI play can start. */
  private lingerTrick: Trick | null = null
  /** Currently-pending paced action (AI step or linger clear). Cancelled
   *  on destroy() so we don't tick into a torn-down handle. */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(50)
    this.clampCursor()
    // If South doesn't hold 2♣, AI leads the first trick. Schedule the
    // first paced AI step instead of fast-forwarding synchronously.
    this.scheduleNextStep()
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
        controlHint: '[2x] next hand',
      }
    }
    // phase === 'play'
    // Use the captured linger trick if one is in effect, so the user
    // sees the completed 4-card trick for TRICK_LINGER_MS before it clears.
    const trick = this.lingerTrick ?? s.trick
    const trickPlays = trick.plays
    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[])
    // Cursor is only meaningful when it's the human's turn AND no linger
    // is suppressing input. Hide cursor during AI plays and trick-linger.
    const showCursor = s.turn === HUMAN && this.lingerTrick === null
    const legal = showCursor ? legalPlays(s, HUMAN) : []
    const trickLines = renderPlusTrick({
      plays: (['N', 'W', 'E', 'S'] as Position[]).map(pos => ({
        pos,
        card: trickPlays.find(p => p.pos === pos)?.card ?? null,
      })),
      getMarker: pos => this.markersFor(pos, trick),
    })
    const handLines = renderHand({
      hand: sorted,
      cursorIdx: showCursor ? this.cursor : -1,
      legal: legal as readonly PlatformCard[],
    })
    return {
      score: this.scoreString(),
      body: [
        ...trickLines,
        ...handLines,
      ],
      controlHint: showCursor ? '[swipe] sel  [2x] play' : '',
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
        this.cancelPendingTimer()
        this.lingerTrick = null
        this.state = startNewHand(s)
        this.clampCursor()
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    // play phase
    if (s.turn !== HUMAN || this.lingerTrick !== null) return
    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    switch (g.kind) {
      case 'swipe-up':
        this.cursor = (this.cursor - 1 + sorted.length) % sorted.length
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.cursor = (this.cursor + 1) % sorted.length
        this.ctx.requestRender()
        return
      case 'tap':
        return  // v0.1.5: tap is a no-op mid-play to prevent accidental plays
      case 'double-tap': {
        const c = sorted[this.cursor]
        if (!c) return
        const legal = legalPlays(s, HUMAN)
        if (!legal.some(l => cardId(l) === cardId(c))) return  // illegal — ignore
        this.applyPlay(HUMAN, c)
        return
      }
    }
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.lingerTrick = null
      this.state = newGame(50)
      this.clampCursor()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (ev.kind === 'set-difficulty') {
      // v0.1.8: phone-side difficulty picker. AI is stateless (pure
      // function of state + difficulty), so the new level applies on the
      // very next AI play — no need to restart the hand.
      const value = ev.payload
      if (value === 'easy' || value === 'medium' || value === 'hard') {
        this.difficulty = value
      }
      return
    }
  }

  destroy(): void {
    this.cancelPendingTimer()
  }

  // ── pacing engine ────────────────────────────────────────────────

  /** Apply a single play (human or AI). If it completes a trick,
   *  capture the trick into lingerTrick and start the linger timer.
   *  Otherwise immediately schedule the next AI step (if any).
   *  Always requests a render. */
  private applyPlay(pos: Position, card: Card): void {
    const willCompleteTrick = this.state.trick.plays.length === 3
    const preTrickPlays = willCompleteTrick ? [...this.state.trick.plays] : null
    const preLeadSuit: Suit | null = this.state.trick.leadSuit
    this.state = playCard(this.state, pos, card)
    if (willCompleteTrick) {
      // Engine cleared the trick. Capture what was there + the just-played card.
      this.lingerTrick = {
        plays: [...preTrickPlays!, { pos, card }],
        leadSuit: preLeadSuit ?? card.suit,
      }
      this.clampCursor()
      this.ctx.requestRender()
      this.scheduleLingerClear()
      return
    }
    this.clampCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  /** If the next play is AI's, schedule an AI step after AI_STEP_MS.
   *  No-op if it's the human's turn or the phase has ended. */
  private scheduleNextStep(): void {
    this.cancelPendingTimer()
    if (this.state.phase !== 'play') return
    if (this.state.turn === HUMAN) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runOneAiStep()
    }, AI_STEP_MS)
  }

  private runOneAiStep(): void {
    if (this.state.phase !== 'play') return
    if (this.state.turn === HUMAN) return
    const aiPos = this.state.turn
    const card = aiPlay(this.state, aiPos, this.difficulty)
    this.applyPlay(aiPos, card)
  }

  private scheduleLingerClear(): void {
    this.cancelPendingTimer()
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.lingerTrick = null
      this.clampCursor()  // re-park if turn is now HUMAN with a new lead suit
      this.ctx.requestRender()
      this.scheduleNextStep()
    }, TRICK_LINGER_MS)
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  // ── render helpers ───────────────────────────────────────────────

  private scoreString(): string {
    const s = this.state.score
    const hp = this.state.handPoints
    return `S:${s.S}(+${hp.S})  W:${s.W}(+${hp.W})  N:${s.N}(+${hp.N})  E:${s.E}(+${hp.E})`
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

  /** Marker suffix for a given position on the current (possibly
   *  lingered) trick view. */
  private markersFor(pos: Position, trick: Trick): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    if (trick.plays.length > 0 && trick.plays[0]!.pos === pos) parts.push('led')
    return parts.join(',')
  }

  private clampCursor(): void {
    const len = this.state.hands[HUMAN].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
    this.parkCursorOnLegal()
  }

  /** When it becomes HUMAN's turn and the current cursor sits on an
   *  illegal card (e.g. wrong suit when must-follow), advance it to the
   *  first legal card in the sorted hand. No-op otherwise — user-driven
   *  cursor movement within legal options is respected. v0.1.5. */
  private parkCursorOnLegal(): void {
    if (this.state.phase !== 'play') return
    if (this.state.turn !== HUMAN) return
    if (this.lingerTrick !== null) return
    const sorted = sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    if (sorted.length === 0) return
    const legal = legalPlays(this.state, HUMAN)
    const currentCard = sorted[this.cursor]
    if (currentCard && legal.some(l => cardId(l) === cardId(currentCard))) return
    const firstLegalIdx = sorted.findIndex(c => legal.some(l => cardId(l) === cardId(c)))
    if (firstLegalIdx !== -1) this.cursor = firstLegalIdx
  }
}

function cardId(c: Card): string { return `${c.suit}${c.rank}` }

// HTML rendered into the phone-side "How to play" disclosure. Plain
// HTML string; main.ts inlines it without further sanitization. Cribbed
// from the standalone Hearts repo's rules text.
const HEARTS_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;"><strong>Lowest score wins.</strong> Game ends when any player reaches 50 points.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Setup</h3>
  <p style="margin: 0 0 .5rem;">Standard 52-card deck dealt out — 13 cards each. No trump suit.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Play</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Whoever holds the <strong>2 of Clubs</strong> leads it on the first trick.</li>
    <li>Must follow lead suit if you can. Otherwise play anything (with caveats below).</li>
    <li>Highest card of the lead suit wins the trick. Trick winner leads the next.</li>
    <li><strong>Hearts can't be led</strong> until they're "broken" (someone played a heart on a non-heart-led trick, or has only hearts left).</li>
    <li><strong>First trick:</strong> no point cards (no hearts, no Queen of Spades) unless that's literally all you have.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Each <strong>Heart</strong> taken in a trick = <strong>1 point</strong> (bad)</li>
    <li><strong>Queen of Spades</strong> = <strong>13 points</strong> (very bad)</li>
    <li>Each hand totals 26 points distributed among the 4 players.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Shoot the Moon</h3>
  <p style="margin: 0 0 .5rem;">If you take <strong>all 26 points</strong> in a single hand: you score 0 for the hand, and every other player scores 26. Risky but powerful.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Swipe up/down</strong> — move the ▲ cursor through your hand</li>
    <li><strong>Double-tap</strong> — play the highlighted card. At hand-end: next hand. At game-end: back to menu.</li>
    <li><strong>Single tap</strong> — does nothing mid-game (so an accidental tap can't play a card you didn't mean to).</li>
    <li>Your cursor parks on a legal card automatically when you must follow suit.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">On-screen markers</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><code>(me)</code> = you (South); <code>(led)</code> = led the current trick</li>
    <li>Suits: <code>♠</code> spades, <code>♥</code> hearts, <code>◆</code> diamonds, <code>♣</code> clubs</li>
    <li>Cards in <code>(parens)</code> in your hand = illegal play right now</li>
    <li>Score row: <code>S:N(+H) W:N(+H) ...</code> where <code>N</code> is cumulative game score and <code>(+H)</code> is points taken this hand (same format the hand-end summary uses)</li>
  </ul>
`

