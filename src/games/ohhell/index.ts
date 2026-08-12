// Oh Hell — Game module obeying the even-card-platform contract.
//
// Structurally like Spades (bid number picker → pegging-free trick play with
// the plus-sign layout) but: individual scoring, a trump card turned each
// round, hand size that grows per round, exact-bid scoring (10 + bid, or 0),
// and the dealer "hook" (the bid that would balance the table is disallowed
// for the human when they deal).

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import { renderCard, renderHand, renderPlusTrick, sortBySuit, SUIT_GLYPH } from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiBid, aiPlay, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  forbiddenDealerBid, gameWinner, legalPlays, MAX_ROUND, newGame, placeBid,
  playCard, startNextHand,
  type Card, type GameState, type Position, type Suit, type Trick,
} from './engine'

const HUMAN: Position = 'S'
const AI_STEP_MS = 700
const BID_STEP_MS = 500
const TRICK_LINGER_MS = 1500

export const ohHellGame: Game = {
  id: 'ohhell',
  name: 'Oh Hell',
  shortDesc: 'Bid your exact tricks',
  category: 'trick',
  glyph: '!',
  init: (ctx: PlatformContext): GameHandle => new OhHellHandle(ctx),
  renderPhoneRules: () => OHHELL_RULES_HTML,
}

class OhHellHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private bidValue = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  private lingerTrick: Trick | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame()
    this.seedBid()
    this.scheduleNextStep()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (s.phase === 'bid') return this.renderBid()
    return this.renderPlay()
  }

  handleGlassesInput(g: GlassesGesture): void {
    const s = this.state
    if (s.phase === 'game-end') { if (g.kind === 'double-tap') this.ctx.endGame(); return }
    if (s.phase === 'hand-end') {
      if (g.kind === 'double-tap') {
        this.cancelPendingTimer()
        this.lingerTrick = null
        this.state = startNextHand(s)
        this.cursor = 0
        this.seedBid()
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    if (s.turn !== HUMAN) return
    if (this.lingerTrick !== null) return
    if (s.phase === 'bid') { this.handleBid(g); return }
    this.handlePlay(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.lingerTrick = null
      this.state = newGame()
      this.cursor = 0
      this.seedBid()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (ev.kind === 'set-difficulty') {
      const v = ev.payload
      if (v === 'easy' || v === 'medium' || v === 'hard') this.difficulty = v
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

  // ── bidding ──────────────────────────────────────────────────────────

  /** Allowed bids 0..round, excluding the hook value when the human deals. */
  private allowedBids(): number[] {
    const full = Array.from({ length: this.state.round + 1 }, (_, i) => i)
    if (this.state.dealer !== HUMAN) return full
    const f = forbiddenDealerBid(this.state)
    return f === null ? full : full.filter(v => v !== f)
  }

  private seedBid(): void {
    const suggestion = aiBid(this.state, HUMAN, this.difficulty)
    const allowed = this.allowedBids()
    this.bidValue = allowed.includes(suggestion)
      ? suggestion
      : allowed.reduce((best, v) => (Math.abs(v - suggestion) < Math.abs(best - suggestion) ? v : best), allowed[0]!)
  }

  private handleBid(g: GlassesGesture): void {
    const allowed = this.allowedBids()
    let idx = allowed.indexOf(this.bidValue)
    if (idx < 0) idx = 0
    switch (g.kind) {
      case 'swipe-up': idx = Math.min(allowed.length - 1, idx + 1); this.bidValue = allowed[idx]!; this.ctx.requestRender(); return
      case 'swipe-down': idx = Math.max(0, idx - 1); this.bidValue = allowed[idx]!; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap':
        this.state = placeBid(this.state, HUMAN, this.bidValue)
        this.parkCursorOnLegal()
        this.ctx.requestRender()
        this.scheduleNextStep()
        return
    }
  }

  // ── play ─────────────────────────────────────────────────────────────

  private handlePlay(g: GlassesGesture): void {
    const sorted = this.sortedHand()
    const len = sorted.length
    if (len === 0) return
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + len) % len; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % len; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap': {
        const c = sorted[this.cursor]
        if (!c) return
        if (!legalPlays(this.state, HUMAN).some(l => l.suit === c.suit && l.rank === c.rank)) return
        this.applyPlay(HUMAN, c)
        return
      }
    }
  }

  // ── pacing ───────────────────────────────────────────────────────────

  private applyPlay(pos: Position, card: Card): void {
    const willComplete = this.state.trick.plays.length === 3
    const preTrickPlays = willComplete ? [...this.state.trick.plays] : null
    const preLeadSuit: Suit | null = this.state.trick.leadSuit
    this.state = playCard(this.state, pos, card)
    if (willComplete && this.state.phase === 'play') {
      this.lingerTrick = { plays: [...preTrickPlays!, { pos, card }], leadSuit: preLeadSuit ?? card.suit }
      this.clampCursor()
      this.ctx.requestRender()
      this.scheduleLingerClear()
      return
    }
    this.clampCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  private scheduleNextStep(): void {
    this.cancelPendingTimer()
    const s = this.state
    if (s.phase !== 'bid' && s.phase !== 'play') return
    if (s.turn === HUMAN) { if (s.phase === 'bid') this.seedBid(); return }
    const delay = s.phase === 'bid' ? BID_STEP_MS : AI_STEP_MS
    this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.runOneAiStep() }, delay)
  }

  private runOneAiStep(): void {
    const s = this.state
    if (s.turn === HUMAN) return
    if (s.phase === 'bid') {
      this.state = placeBid(s, s.turn, aiBid(s, s.turn, this.difficulty))
      if (this.state.phase === 'play') this.parkCursorOnLegal()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (s.phase === 'play') this.applyPlay(s.turn, aiPlay(s, s.turn, this.difficulty))
  }

  private scheduleLingerClear(): void {
    this.cancelPendingTimer()
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.lingerTrick = null
      this.clampCursor()
      this.ctx.requestRender()
      this.scheduleNextStep()
    }, TRICK_LINGER_MS)
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) { clearTimeout(this.pendingTimer); this.pendingTimer = null }
  }

  // ── render ───────────────────────────────────────────────────────────

  private renderBid(): GlassesFrame {
    const s = this.state
    const sorted = this.sortedHand()
    const b = (p: Position) => (s.bids[p] === null ? '-' : String(s.bids[p]))
    const yourTurn = s.turn === HUMAN
    const hookNote = s.dealer === HUMAN && forbiddenDealerBid(s) !== null ? `  (not ${forbiddenDealerBid(s)})` : ''
    return {
      score: this.scoreString(),
      body: [
        `R${s.round}  trump ${renderCard(s.trumpCard)}`,
        `W:${b('W')} N:${b('N')} E:${b('E')}`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: -1 }),
        yourTurn ? `Your bid ▸ ${this.bidValue}${hookNote}` : 'Bidding…',
      ],
      controlHint: yourTurn ? '[swipe] bid  [2x] confirm' : '',
    }
  }

  private renderPlay(): GlassesFrame {
    const s = this.state
    const trick = this.lingerTrick ?? s.trick
    const showCursor = s.turn === HUMAN && this.lingerTrick === null
    const legal = showCursor ? legalPlays(s, HUMAN) : []
    const trickLines = renderPlusTrick({
      plays: (['N', 'W', 'E', 'S'] as Position[]).map(pos => ({ pos, card: trick.plays.find(p => p.pos === pos)?.card ?? null })),
      getMarker: pos => this.markersFor(pos, trick),
    })
    const handLines = renderHand({
      hand: this.sortedHand() as readonly PlatformCard[],
      cursorIdx: showCursor ? this.cursor : -1,
      legal: legal as readonly PlatformCard[],
    })
    return {
      score: this.scoreString(),
      body: [
        `Trump ${SUIT_GLYPH[s.trump]}   you ${s.tricksWon.S}/${s.bids.S ?? 0}`,
        ...trickLines,
        ...handLines,
      ],
      controlHint: showCursor ? '[swipe] sel  [2x] play' : '',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    const got = (p: Position) => `${p === 'S' ? 'You' : p}:${s.tricksWon[p]}/${s.bids[p] ?? 0}`
    return {
      score: this.scoreString(),
      body: [
        `Round ${s.round} done`,
        `${got('S')}  ${got('W')}  ${got('N')}  ${got('E')}`,
        this.scoreString(),
      ],
      controlHint: '[2x] next round',
    }
  }

  private renderGameEnd(): GlassesFrame {
    const winner = gameWinner(this.state)
    const banner = winner === HUMAN ? '*** YOU WIN ***' : `*** ${winner} WINS ***`
    return {
      score: this.scoreString(),
      body: [this.scoreString(), '', banner],
      controlHint: '[2x] back to menu',
    }
  }

  private scoreString(): string {
    const s = this.state.score
    return `S:${s.S} W:${s.W} N:${s.N} E:${s.E}`
  }

  private markersFor(pos: Position, trick: Trick): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    if (trick.plays.length > 0 && trick.plays[0]!.pos === pos) parts.push('led')
    return parts.join(',')
  }

  private sortedHand(): Card[] {
    return sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
  }

  private clampCursor(): void {
    const len = this.state.hands[HUMAN].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
    this.parkCursorOnLegal()
  }

  private parkCursorOnLegal(): void {
    if (this.state.phase !== 'play' || this.state.turn !== HUMAN || this.lingerTrick !== null) return
    const sorted = this.sortedHand()
    if (sorted.length === 0) return
    const legal = legalPlays(this.state, HUMAN)
    const cur = sorted[this.cursor]
    if (cur && legal.some(l => l.suit === cur.suit && l.rank === cur.rank)) return
    const idx = sorted.findIndex(c => legal.some(l => l.suit === c.suit && l.rank === c.rank))
    if (idx !== -1) this.cursor = idx
  }
}

const OHHELL_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">Over ${MAX_ROUND} rounds (hands grow 1, 2, 3 … ${MAX_ROUND} cards), score the most points. You're South vs West, North, East.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Each round</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>A <strong>trump</strong> suit is turned from the deck.</li>
    <li>Everyone bids <strong>exactly</strong> how many tricks they'll take. The <strong>dealer can't</strong> make the bids add up to the number of tricks — so someone always misses.</li>
    <li>Follow the lead suit if you can; trump beats other suits; highest card wins the trick.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Take <strong>exactly</strong> your bid: <strong>10 + your bid</strong> points.</li>
    <li>Miss by any amount (over or under): <strong>0</strong>. Bidding 0 and taking none scores 10.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Bid</strong>: swipe to set your number (the dealer's forbidden bid is skipped automatically), double-tap to confirm.</li>
    <li><strong>Play</strong>: swipe through your hand, double-tap to play. Illegal cards show in parens.</li>
    <li><strong>Single tap</strong> does nothing mid-game.</li>
  </ul>
`
