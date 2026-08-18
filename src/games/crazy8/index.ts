// Crazy Eights — Game module obeying the even-card-platform contract.
//
// Each-for-themselves shedding game (no teams), so the score line is the
// Hearts-style per-seat row and "lowest wins". Wrapper responsibilities:
//   - Hold GameState
//   - Render the play view (top card + active suit + stock + your hand) and
//     the suit-pick sub-view (after you play an 8)
//   - Translate gestures: swipe = move cursor, double-tap = play / draw /
//     pick suit depending on sub-state
//   - Pace AI turns via setTimeout so each play is visible
//
// Pacing matches the sibling games: AI_STEP_MS = 700 between AI turns. No
// trick-linger (there's no 4-card trick to hold).

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import { renderCard, renderHand, sortBySuit, SUIT_GLYPH, selectionPrefix } from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiChooseCard, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  canPlay, drawCard, endStuckHand, gameWinner, legalPlays, newGame, passTurn,
  playCard, startNewHand, topCard,
  type Card, type GameState, type Position, type Suit,
} from './engine'

const HUMAN: Position = 'S'
const TARGET_SCORE = 100
const AI_STEP_MS = 700
const SUIT_LIST: Suit[] = ['♠', '♥', '♦', '♣']
const SEAT_LABEL: Record<Position, string> = { S: 'You', W: 'West', N: 'North', E: 'East' }

export const crazy8Game: Game = {
  id: 'crazy8',
  name: 'Crazy Eights',
  shortDesc: 'Match suit/rank, 8s are wild',
  category: 'shed',
  glyph: '8',
  init: (ctx: PlatformContext): GameHandle => new Crazy8Handle(ctx),
  renderPhoneRules: () => CRAZY8_RULES_HTML,
}

class Crazy8Handle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  /** Non-null while the human is choosing a suit after playing an 8. */
  private suitPickCard: Card | null = null
  private suitCursor = 0
  /** Consecutive passes; 4 in a row = deadlock → resolve the hand. */
  private passesInARow = 0
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(TARGET_SCORE)
    this.clampCursor()
    this.scheduleNextStep()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (this.suitPickCard !== null) return this.renderSuitPick()
    return this.renderPlay()
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
        this.suitPickCard = null
        this.passesInARow = 0
        this.clampCursor()
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    if (s.turn !== HUMAN) return
    if (this.suitPickCard !== null) { this.handleSuitPick(g); return }
    if (!canPlay(s, HUMAN)) { this.handleMustDraw(g); return }
    this.handlePlay(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.state = newGame(TARGET_SCORE)
      this.cursor = 0
      this.suitPickCard = null
      this.passesInARow = 0
      this.clampCursor()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (ev.kind === 'set-difficulty') {
      const value = ev.payload
      if (value === 'easy' || value === 'medium' || value === 'hard') {
        this.difficulty = value
      }
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

  private handlePlay(g: GlassesGesture): void {
    const sorted = this.sortedHand()
    const len = sorted.length
    if (len === 0) return
    switch (g.kind) {
      case 'swipe-up':
        this.cursor = (this.cursor - 1 + len) % len
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.cursor = (this.cursor + 1) % len
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap': {
        const c = sorted[this.cursor]
        if (!c) return
        const legal = legalPlays(this.state, HUMAN)
        if (!legal.some(l => l.suit === c.suit && l.rank === c.rank)) return
        if (c.rank === '8') {
          // Defer the play until the suit is chosen.
          this.suitPickCard = c
          this.suitCursor = 0
          this.ctx.requestRender()
          return
        }
        this.commitPlay(c)
        return
      }
    }
  }

  private handleMustDraw(g: GlassesGesture): void {
    const sorted = this.sortedHand()
    switch (g.kind) {
      case 'swipe-up':
        if (sorted.length) this.cursor = (this.cursor - 1 + sorted.length) % sorted.length
        this.ctx.requestRender()
        return
      case 'swipe-down':
        if (sorted.length) this.cursor = (this.cursor + 1) % sorted.length
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap': {
        const { state, drew } = drawCard(this.state, HUMAN)
        if (drew === null) {
          // Stock exhausted and nothing to recycle — pass.
          this.doPass(HUMAN)
          return
        }
        this.state = state
        this.passesInARow = 0
        this.clampCursor()
        this.ctx.requestRender()
        // If the draw produced a legal card, control returns to normal mode
        // automatically (canPlay() is now true); the user navigates + plays.
        return
      }
    }
  }

  private handleSuitPick(g: GlassesGesture): void {
    switch (g.kind) {
      case 'swipe-up':
        this.suitCursor = (this.suitCursor - 1 + 4) % 4
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.suitCursor = (this.suitCursor + 1) % 4
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap': {
        const card = this.suitPickCard!
        this.suitPickCard = null
        this.commitPlay(card, SUIT_LIST[this.suitCursor]!)
        return
      }
    }
  }

  // ── moves ───────────────────────────────────────────────────────────

  private commitPlay(card: Card, declaredSuit?: Suit): void {
    this.state = playCard(this.state, HUMAN, card, declaredSuit)
    this.passesInARow = 0
    this.clampCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  private doPass(pos: Position): void {
    this.state = passTurn(this.state, pos)
    this.passesInARow += 1
    if (this.passesInARow >= 4) {
      this.state = endStuckHand(this.state)
      this.passesInARow = 0
    }
    this.clampCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  // ── pacing engine ───────────────────────────────────────────────────

  private scheduleNextStep(): void {
    this.cancelPendingTimer()
    const s = this.state
    if (s.phase !== 'play') return
    if (s.turn === HUMAN) return
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runOneAiStep()
    }, AI_STEP_MS)
  }

  private runOneAiStep(): void {
    const pos = this.state.turn
    if (this.state.phase !== 'play' || pos === HUMAN) return

    // Draw until the AI can play (bounded; the deck is finite).
    let guard = 0
    while (!canPlay(this.state, pos) && guard < 60) {
      const { state, drew } = drawCard(this.state, pos)
      if (drew === null) { this.doPass(pos); return }
      this.state = state
      guard++
    }
    if (!canPlay(this.state, pos)) { this.doPass(pos); return }

    const { card, declaredSuit } = aiChooseCard(this.state, pos, this.difficulty)
    this.state = playCard(this.state, pos, card, declaredSuit)
    this.passesInARow = 0
    this.clampCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  // ── render helpers ──────────────────────────────────────────────────

  private renderPlay(): GlassesFrame {
    const s = this.state
    const top = topCard(s)
    const yourTurn = s.turn === HUMAN
    const stuck = yourTurn && !canPlay(s, HUMAN)
    const sorted = this.sortedHand()
    const legal = yourTurn ? legalPlays(s, HUMAN) : []
    const topLine = `Top ${renderCard(top)} →${SUIT_GLYPH[s.currentSuit]}   stock ${s.stock.length}`
    // Public info: how many cards each opponent holds. Knowing someone is down
    // to 1 is the key signal — switch suit with an 8, shed your high cards.
    const oppLine = `Left  W:${s.hands.W.length}  N:${s.hands.N.length}  E:${s.hands.E.length}`
    const statusLine = yourTurn
      ? (stuck ? 'No legal card — [2x] draw' : 'Your turn')
      : `${SEAT_LABEL[s.turn]} playing…`
    return {
      score: this.scoreString(),
      body: [
        topLine,
        oppLine,
        statusLine,
        ...renderHand({
          hand: sorted as readonly PlatformCard[],
          cursorIdx: yourTurn ? this.cursor : -1,
          legal: legal as readonly PlatformCard[],
        }),
      ],
      controlHint: yourTurn
        ? (stuck ? '[2x] draw a card' : '[swipe] sel  [2x] play')
        : '',
    }
  }

  private renderSuitPick(): GlassesFrame {
    const row = SUIT_LIST
      .map((suit, i) => `${selectionPrefix(i === this.suitCursor)}${SUIT_GLYPH[suit]}`)
      .join('  ')
    // Show the hand you are choosing FOR. Naming a suit is a decision about the
    // cards you still hold — you want the suit you are longest in — and this
    // view used to hide them, so the choice was made blind. cursorIdx -1
    // because the cursor is on the suit row, not on a card.
    const sorted = this.sortedHand()
    return {
      score: this.scoreString(),
      body: [
        'Played an 8 — name the suit:',
        row,
        ...renderHand({
          hand: sorted as readonly PlatformCard[],
          cursorIdx: -1,
          legal: sorted as readonly PlatformCard[],
        }),
      ],
      controlHint: '[swipe] suit  [2x] choose',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    const who = s.winner ? `${SEAT_LABEL[s.winner]} went out` : 'Stuck — nobody out'
    return {
      score: this.scoreString(),
      body: [
        'Hand done',
        who,
        this.scoreString(),
      ],
      controlHint: '[2x] next hand',
    }
  }

  private renderGameEnd(): GlassesFrame {
    const s = this.state
    const winner = gameWinner(s)
    const banner = winner === HUMAN ? '*** YOU WIN ***' : `*** ${SEAT_LABEL[winner].toUpperCase()} WINS ***`
    return {
      score: this.scoreString(),
      body: [this.scoreString(), '', banner],
      controlHint: '[2x] back to menu',
    }
  }

  private scoreString(): string {
    const s = this.state.score
    return `You:${s.S}  W:${s.W}  N:${s.N}  E:${s.E}`
  }

  private sortedHand(): Card[] {
    return sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
  }

  private clampCursor(): void {
    const len = this.state.hands[HUMAN].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
  }
}

// HTML for the phone-side "How to play" disclosure. Plain trusted markup.
const CRAZY8_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">Be the first to get rid of all your cards each hand. <strong>Lowest total score wins</strong> when someone hits 100.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Setup</h3>
  <p style="margin: 0 0 .5rem;">Four players, 5 cards each. The rest is the stock; the top card starts the discard pile.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Play</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Play a card that matches the <strong>suit</strong> or the <strong>rank</strong> of the top of the discard pile.</li>
    <li><strong>8s are wild</strong> — play one any time and name the suit the next player must follow.</li>
    <li>If you can't play, draw until you can. If the stock runs out, you pass.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>When someone goes out, everyone else adds up the cards still in their hand:</li>
    <li>each <strong>8 = 50</strong>, each <strong>K/Q/J/10 = 10</strong>, each <strong>Ace = 1</strong>, everything else = its number.</li>
    <li>Those points are bad — first to 100 ends the game and the <strong>lowest</strong> score wins.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Swipe up/down</strong> — move the cursor through your hand.</li>
    <li><strong>Double-tap</strong> — play the highlighted card. Play an 8 and you'll pick a suit next.</li>
    <li>When you have no legal card, <strong>double-tap to draw</strong> one.</li>
    <li><strong>Single tap</strong> does nothing mid-game (no accidental plays).</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">On-screen</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><code>Top K♥ →♥</code> = top card and the suit you must match (the arrow suit changes after an 8).</li>
    <li>Cards in <code>(parens)</code> in your hand are illegal to play right now.</li>
    <li>Score row <code>You:n W:n N:n E:n</code> — running penalty points, lowest wins.</li>
  </ul>
`
