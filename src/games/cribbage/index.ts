// Cribbage — Game module obeying the even-card-platform contract.
//
// Phases: discard (pick 2 for the crib) → play (pegging) → show (count
// non-dealer, dealer, crib) → hand-end → next hand (dealer swaps). The engine
// owns all scoring; the wrapper drives selection, pegging turns (auto-"go"
// when you have no legal card), and steps through the show.

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import { renderCard, renderHand, sortBySuit } from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiDiscard, aiPeg, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  advanceShow, discardToCrib, gameWinner, legalPeg, mustGo, newGame, other,
  pegGo, pegPlay, startNewHand,
  type Card, type GameState, type Position,
} from './engine'

const HUMAN: Position = 'S'
const AI_STEP_MS = 800

export const cribbageGame: Game = {
  id: 'cribbage',
  name: 'Cribbage',
  shortDesc: 'Peg to 121 — 15s, runs, crib',
  category: 'pegging',
  glyph: 'C',
  init: (ctx: PlatformContext): GameHandle => new CribbageHandle(ctx),
  renderPhoneRules: () => CRIBBAGE_RULES_HTML,
}

class CribbageHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private selected: Card[] = []
  private difficulty: Difficulty
  private ctx: PlatformContext
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (s.phase === 'show') return this.renderShow()
    if (s.phase === 'discard') return this.renderDiscard()
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
        this.cursor = 0; this.selected = []
        this.ctx.requestRender()
      }
      return
    }
    if (s.phase === 'show') {
      if (g.kind === 'double-tap') { this.state = advanceShow(s); this.cursor = 0; this.ctx.requestRender() }
      return
    }
    if (s.phase === 'discard') { this.handleDiscard(g); return }
    // play
    if (s.pegTurn !== HUMAN || mustGo(s, HUMAN)) return
    this.handlePlay(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.state = newGame()
      this.cursor = 0; this.selected = []
      this.ctx.requestRender()
      return
    }
    if (ev.kind === 'set-difficulty') {
      const v = ev.payload
      if (v === 'easy' || v === 'medium' || v === 'hard') this.difficulty = v
    }
  }

  destroy(): void { this.cancelPendingTimer() }

  // ── discard ──────────────────────────────────────────────────────────

  private handleDiscard(g: GlassesGesture): void {
    const sorted = sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    const count = sorted.length + (this.selected.length === 2 ? 1 : 0)
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + count) % count; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % count; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap': {
        if (this.selected.length === 2 && this.cursor === sorted.length) { this.submitDiscard(); return }
        const card = sorted[this.cursor]
        if (!card) return
        const at = this.selected.findIndex(c => c.suit === card.suit && c.rank === card.rank)
        if (at >= 0) this.selected.splice(at, 1)
        else if (this.selected.length < 2) this.selected.push(card)
        this.ctx.requestRender()
        return
      }
    }
  }

  private submitDiscard(): void {
    this.state = discardToCrib(this.state, HUMAN, this.selected)
    const aiCards = aiDiscard(this.state.hands.N, this.state.dealer === 'N', this.difficulty)
    this.state = discardToCrib(this.state, 'N', aiCards) // triggers the cut
    this.selected = []; this.cursor = 0
    if (this.state.phase === 'play') this.pumpPeg()
    else this.ctx.requestRender() // his-heels could have won the game on the cut
  }

  // ── pegging ──────────────────────────────────────────────────────────

  private handlePlay(g: GlassesGesture): void {
    const sorted = this.sortedPeg()
    const legal = legalPeg(this.state, HUMAN)
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + sorted.length) % sorted.length; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % sorted.length; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap': {
        const card = sorted[this.cursor]
        if (!card || !legal.some(l => l.suit === card.suit && l.rank === card.rank)) return
        this.state = pegPlay(this.state, HUMAN, card)
        this.cursor = 0
        this.pumpPeg()
        return
      }
    }
  }

  /** Advance pegging: auto-"go" for the human when stuck, schedule the AI's
   *  paced play, or stop and wait for the human's choice. */
  private pumpPeg(): void {
    let guard = 0
    while (this.state.phase === 'play' && guard++ < 24) {
      if (this.state.pegTurn === HUMAN) {
        if (mustGo(this.state, HUMAN)) { this.state = pegGo(this.state, HUMAN); continue }
        break // human has a legal play — wait for input
      }
      // Opponent's turn — render and schedule one paced AI action.
      this.ctx.requestRender()
      this.scheduleAiPeg()
      return
    }
    this.ctx.requestRender()
  }

  private scheduleAiPeg(): void {
    this.cancelPendingTimer()
    this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.runAiPeg() }, AI_STEP_MS)
  }

  private runAiPeg(): void {
    if (this.state.phase !== 'play' || this.state.pegTurn === HUMAN) return
    this.state = mustGo(this.state, 'N')
      ? pegGo(this.state, 'N')
      : pegPlay(this.state, 'N', aiPeg(this.state, 'N', this.difficulty))
    this.pumpPeg()
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) { clearTimeout(this.pendingTimer); this.pendingTimer = null }
  }

  // ── render helpers ──────────────────────────────────────────────────

  private renderDiscard(): GlassesFrame {
    const s = this.state
    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    const onConfirm = this.selected.length === 2 && this.cursor === sorted.length
    const picked = this.selected.length ? this.selected.map(c => renderCard(c)).join(' ') : '—'
    return {
      score: this.scoreString(),
      body: [
        `Lay 2 to ${s.dealer === HUMAN ? 'your' : "opp's"} crib`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: onConfirm ? -1 : this.cursor }),
        `Picked: ${picked}${this.selected.length === 2 ? (onConfirm ? '   ▶ CONFIRM' : '   ⤓ CONFIRM') : ''}`,
      ],
      controlHint: this.selected.length === 2 ? '[swipe] pick/confirm  [2x] go' : '[swipe] move  [2x] pick (need 2)',
    }
  }

  private renderPlay(): GlassesFrame {
    const s = this.state
    const yourTurn = s.pegTurn === HUMAN
    const sorted = this.sortedPeg()
    const legal = yourTurn ? legalPeg(s, HUMAN) : []
    const pile = s.pegSeq.length ? s.pegSeq.map(c => renderCard(c)).join(' ') : '—'
    const head = `Cut ${s.starter ? renderCard(s.starter) : '?'}  count ${s.pegCount}`
    const line2 = s.message ?? `Pile: ${pile}`
    return {
      score: this.scoreString(),
      body: [
        head,
        line2,
        ...renderHand({
          hand: sorted as readonly PlatformCard[],
          cursorIdx: yourTurn && !mustGo(s, HUMAN) ? this.cursor : -1,
          legal: legal as readonly PlatformCard[],
        }),
      ],
      controlHint: yourTurn
        ? (mustGo(s, HUMAN) ? '(no card — go)' : '[swipe] sel  [2x] play')
        : 'Opp pegging…',
    }
  }

  private renderShow(): GlassesFrame {
    const s = this.state
    if (!s.lastShow) {
      return {
        score: this.scoreString(),
        body: ['The show', `Cut: ${s.starter ? renderCard(s.starter) : '?'}`, '[2x] count hands'],
        controlHint: '[2x] count',
      }
    }
    const ls = s.lastShow
    const parts = ls.parts.length ? ls.parts.map(p => `${p.label} ${p.points}`).join('  ') : 'nothing'
    return {
      score: this.scoreString(),
      body: [`${ls.who}: +${ls.total}`, parts, this.scoreString()],
      controlHint: s.showStage === 'done' ? '[2x] finish hand' : '[2x] next',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    return {
      score: this.scoreString(),
      body: ['Hand done', this.scoreString(), `${seat(other(s.dealer))} deals next`],
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

  private sortedPeg(): Card[] {
    return sortBySuit(this.state.pegHands[HUMAN] as readonly PlatformCard[]) as Card[]
  }
}

function seat(p: Position): string { return p === 'S' ? 'You' : 'Opponent' }

// HTML for the phone-side "How to play" disclosure.
const CRIBBAGE_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">Be first to <strong>121 points</strong>, scored by pegging during play and counting your hand afterward.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Each hand</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Both players get 6 cards and <strong>lay 2 away to the crib</strong> (an extra hand that belongs to the dealer).</li>
    <li>A <strong>starter</strong> card is cut. If it's a Jack, the dealer pegs 2 ("his heels").</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">The play (pegging)</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Alternate playing cards, adding to a running count that can't pass 31.</li>
    <li>Score: make the count <strong>15</strong> = 2, <strong>31</strong> = 2, a <strong>pair</strong> = 2 (three = 6), a <strong>run</strong> of 3+ = its length.</li>
    <li>Can't play without busting 31? You "go" — the last to play pegs 1. Last card of the round also pegs 1.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">The show</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Count each hand (then the crib) with the starter: every combo summing to <strong>15</strong> = 2, each <strong>pair</strong> = 2, each <strong>run</strong> = its length, a <strong>flush</strong> = 4 (5 with the starter), and a <strong>Jack matching the starter's suit</strong> ("nobs") = 1.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Discard</strong>: swipe to a card, double-tap to pick (pick 2), then swipe to CONFIRM and double-tap.</li>
    <li><strong>Play</strong>: swipe through your cards, double-tap to play a legal one (illegal cards show in parens). No card to play? You go automatically.</li>
    <li><strong>Show</strong>: double-tap to step through each hand's count.</li>
    <li><strong>Single tap</strong> does nothing mid-game.</li>
  </ul>
`
