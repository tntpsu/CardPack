// Gin Rummy — Game module obeying the even-card-platform contract.
//
// Two players (you = South, opponent = North). A turn is DRAW then DISCARD;
// after drawing you may KNOCK (deadwood ≤ 10). The engine's meld solver
// computes deadwood; the wrapper just drives the two-step turn:
//   - draw phase:    cursor toggles Stock / face-up Discard, double-tap draws
//   - discard phase: cursor over your 11-card hand (+ a KNOCK item when your
//                    best discard gets you to ≤10), double-tap commits
// AI turns (draw + discard/knock) resolve in one paced step.

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import { renderCard, renderHand, sortBySuit, selectionPrefix } from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiDiscardChoice, aiDrawFromDiscard, bestDiscard, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  canKnock, discard, drawDiscard, drawStock, gameWinner, knock,
  newGame, startNewHand, topDiscard,
  type Card, type GameState, type Position,
} from './engine'

const HUMAN: Position = 'S'
const TARGET_SCORE = 100
const AI_STEP_MS = 800

export const ginRummyGame: Game = {
  id: 'ginrummy',
  name: 'Gin Rummy',
  shortDesc: 'Meld sets/runs, knock to win',
  category: 'shed',
  glyph: '●',
  init: (ctx: PlatformContext): GameHandle => new GinRummyHandle(ctx),
  renderPhoneRules: () => GINRUMMY_RULES_HTML,
}

class GinRummyHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(TARGET_SCORE)
    // Human (South) always starts in the draw phase — no AI step to schedule.
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (s.turn !== HUMAN) return this.renderWaiting()
    if (s.phase === 'draw') return this.renderDraw()
    return this.renderDiscard()
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
        this.state = startNewHand(s)
        this.cursor = 0
        this.ctx.requestRender()
      }
      return
    }
    if (s.turn !== HUMAN) return
    if (s.phase === 'draw') { this.handleDraw(g); return }
    this.handleDiscard(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.state = newGame(TARGET_SCORE)
      this.cursor = 0
      this.ctx.requestRender()
      return
    }
    if (ev.kind === 'set-difficulty') {
      const value = ev.payload
      if (value === 'easy' || value === 'medium' || value === 'hard') this.difficulty = value
      return
    }
  }

  destroy(): void { this.cancelPendingTimer() }

  /** Progress token for the e2e harness: changes when play actually advances
   *  (a bid taken, a card moved, a score credited) and not when the cursor
   *  merely moves. See GameHandle.progressLabel in the platform. */
  progressLabel(): string {
    const s = this.state as {
      phase: string
      turn: string
      hands: Record<string, unknown[]>
      score: Record<string, number>
    }
    const cards = Object.values(s.hands).reduce((a, h) => a + h.length, 0)
    const score = Object.values(s.score).reduce((a, n) => a + n, 0)
    return `${s.phase}:${s.turn}:c${cards}:s${score}`
  }

  // ── input handlers ──────────────────────────────────────────────────

  private handleDraw(g: GlassesGesture): void {
    switch (g.kind) {
      case 'swipe-up':
      case 'swipe-down':
        this.cursor = (this.cursor + 1) % 2
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap':
        this.state = this.cursor === 1 && topDiscard(this.state)
          ? drawDiscard(this.state, HUMAN)
          : drawStock(this.state, HUMAN)
        this.cursor = 0
        this.ctx.requestRender()
        return
    }
  }

  private handleDiscard(g: GlassesGesture): void {
    const sorted = this.sortedHand()
    const knockAvail = bestDiscard(sorted).deadwood <= 10
    const count = sorted.length + (knockAvail ? 1 : 0)
    switch (g.kind) {
      case 'swipe-up':
        this.cursor = (this.cursor - 1 + count) % count
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.cursor = (this.cursor + 1) % count
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap': {
        if (knockAvail && this.cursor === sorted.length) {
          // KNOCK — discard the optimal card and settle.
          this.state = knock(this.state, HUMAN, bestDiscard(sorted).card)
          this.ctx.requestRender()
          return
        }
        const card = sorted[this.cursor]
        if (!card) return
        this.state = discard(this.state, HUMAN, card)
        this.cursor = 0
        this.ctx.requestRender()
        this.scheduleAiTurn()
        return
      }
    }
  }

  // ── AI turn ──────────────────────────────────────────────────────────

  private scheduleAiTurn(): void {
    this.cancelPendingTimer()
    const s = this.state
    if (s.phase !== 'draw' && s.phase !== 'discard') return
    if (s.turn === HUMAN) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runAiTurn()
    }, AI_STEP_MS)
  }

  private runAiTurn(): void {
    const pos = this.state.turn
    if (pos === HUMAN) return
    if (this.state.phase !== 'draw') return

    // Draw.
    this.state = aiDrawFromDiscard(this.state, pos, this.difficulty)
      ? drawDiscard(this.state, pos)
      : drawStock(this.state, pos)
    if (this.state.phase === 'hand-end' || this.state.phase === 'game-end') {
      this.ctx.requestRender()
      return // stock exhausted → wash
    }

    // Discard or knock.
    const choice = aiDiscardChoice(this.state.hands[pos], this.difficulty)
    if (choice.knock && canKnock(this.state.hands[pos].filter(c => !(c.suit === choice.card.suit && c.rank === choice.card.rank)))) {
      this.state = knock(this.state, pos, choice.card)
    } else {
      this.state = discard(this.state, pos, choice.card)
    }
    this.cursor = 0
    this.ctx.requestRender()
    // After a normal discard it's the human's draw — nothing more to schedule.
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  // ── render helpers ──────────────────────────────────────────────────

  private renderDraw(): GlassesFrame {
    const s = this.state
    const top = topDiscard(s)
    const sorted = this.sortedHand()
    return {
      score: this.scoreString(),
      body: [
        `${selectionPrefix(this.cursor === 0)} Draw stock (${s.stock.length})`,
        `${selectionPrefix(this.cursor === 1)} Take ${top ? renderCard(top) : '—'}`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: -1 }),
      ],
      controlHint: '[swipe] choose  [2x] draw',
    }
  }

  private renderDiscard(): GlassesFrame {
    const s = this.state
    const top = topDiscard(s)
    const sorted = this.sortedHand()
    const best = bestDiscard(sorted)
    const knockAvail = best.deadwood <= 10
    const onKnock = knockAvail && this.cursor === sorted.length
    const knockLine = knockAvail
      ? (onKnock ? `▶ KNOCK (deadwood ${best.deadwood})` : `  ⤓ swipe past hand to KNOCK (dw ${best.deadwood})`)
      : `  best deadwood ${best.deadwood} (need ≤10 to knock)`
    return {
      score: this.scoreString(),
      body: [
        `Discard ${top ? renderCard(top) : '—'}   stock ${s.stock.length}`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: onKnock ? -1 : this.cursor }),
        knockLine,
      ],
      controlHint: onKnock ? '[swipe] pick  [2x] knock' : '[swipe] pick  [2x] discard',
    }
  }

  private renderWaiting(): GlassesFrame {
    const s = this.state
    const top = topDiscard(s)
    return {
      score: this.scoreString(),
      body: [
        `Discard ${top ? renderCard(top) : '—'}   stock ${s.stock.length}`,
        'Opponent thinking…',
        ...renderHand({ hand: this.sortedHand() as readonly PlatformCard[], cursorIdx: -1 }),
      ],
      controlHint: '',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    const r = s.result
    let line = 'Hand done'
    if (r) {
      if (r.knocker === null) line = 'Wash — stock ran out'
      else if (r.gin) line = `${seat(r.knocker)} GIN! +${r.points}`
      else if (r.undercut) line = `Undercut! ${seat(r.scorer!)} +${r.points}`
      else line = `${seat(r.knocker)} knocks, +${r.points}`
    }
    return {
      score: this.scoreString(),
      body: ['Hand done', line, this.scoreString()],
      controlHint: '[2x] next hand',
    }
  }

  private renderGameEnd(): GlassesFrame {
    const winner = gameWinner(this.state)
    const banner = winner === HUMAN ? '*** YOU WIN ***' : '*** OPPONENT WINS ***'
    return {
      score: this.scoreString(),
      body: [this.scoreString(), '', banner],
      controlHint: '[2x] back to menu',
    }
  }

  private scoreString(): string {
    return `You:${this.state.score.S}  Opp:${this.state.score.N}`
  }

  private sortedHand(): Card[] {
    return sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
  }
}

function seat(p: Position): string { return p === 'S' ? 'You' : 'Opponent' }

// HTML for the phone-side "How to play" disclosure.
const GINRUMMY_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">You vs one opponent. Arrange your 10 cards into <strong>melds</strong> and knock when your leftover cards ("deadwood") are worth 10 points or less. <strong>First to 100 wins.</strong></p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Melds</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Set</strong> — 3 or 4 of the same rank (e.g. 7♠ 7♥ 7♣).</li>
    <li><strong>Run</strong> — 3+ in sequence, same suit (e.g. 4♥ 5♥ 6♥). Aces are low.</li>
    <li>Each card counts in at most one meld; the rest is your deadwood.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">A turn</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Draw</strong> the top of the stock or the face-up discard.</li>
    <li><strong>Discard</strong> one card. If your deadwood is now ≤ 10, you may <strong>knock</strong>.</li>
    <li>Deadwood values: Ace = 1, face cards = 10, others = their number.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Knock: score the difference between the two players' deadwood.</li>
    <li><strong>Gin</strong> (0 deadwood): +25 bonus, and you can't be undercut.</li>
    <li><strong>Undercut</strong>: if the defender's deadwood is ≤ the knocker's, the defender scores the difference + 25.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Draw phase</strong>: swipe to choose stock or the face-up card, double-tap to draw.</li>
    <li><strong>Discard phase</strong>: swipe through your hand, double-tap to discard. When you can knock, swipe past the last card to the <strong>KNOCK</strong> option and double-tap — it discards the best card and ends the hand.</li>
    <li><strong>Single tap</strong> does nothing mid-game.</li>
  </ul>
`
