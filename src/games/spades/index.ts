// Spades — Game module obeying the even-card-platform contract.
//
// Engine + AI are ported from the standalone ~/Documents/Spades. This file
// is the wrapper that:
//   - Holds GameState
//   - Renders the bid view (number picker) and the play view (platform
//     renderPlusTrick + renderHand)
//   - Translates glasses gestures into engine moves
//   - Paces AI bids/plays via setTimeout so each lands visibly
//   - Lingers on completed tricks so all four cards are seen before clearing
//
// Pacing constants match Hearts/Euchre (real-glasses-tested May 2026):
//   AI_STEP_MS = 700        — between AI plays
//   BID_STEP_MS = 500       — between AI bids (no card animation)
//   TRICK_LINGER_MS = 1500  — completed 4-card trick stays visible

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import {
  renderHand, renderPlusTrick, sortBySuit,
} from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiBid, aiPlay, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  gameWinner, legalPlays, newGame, placeBid, playCard, startNewHand,
  type Card, type GameState, type Position, type Suit, type Team, type Trick,
} from './engine'

const HUMAN: Position = 'S'
const HUMAN_TEAM: Team = 'NS'
const TARGET_SCORE = 250
const AI_STEP_MS = 700
const BID_STEP_MS = 500
const TRICK_LINGER_MS = 1500

export const spadesGame: Game = {
  id: 'spades',
  name: 'Spades',
  shortDesc: 'Bid your tricks, spades trump',
  category: 'trick',
  glyph: '♠',
  init: (ctx: PlatformContext): GameHandle => new SpadesHandle(ctx),
  renderPhoneRules: () => SPADES_RULES_HTML,
}

class SpadesHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  /** The number the human is currently dialing in during the bid phase.
   *  Seeded to the AI's suggestion at deal so a confirm is one double-tap. */
  private bidValue = 1
  private lingerTrick: Trick | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(TARGET_SCORE)
    this.seedBidSuggestion()
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
    if (s.phase === 'game-end') {
      if (g.kind === 'double-tap') this.ctx.endGame()
      return
    }
    if (s.phase === 'hand-end') {
      if (g.kind === 'double-tap') {
        this.cancelPendingTimer()
        this.lingerTrick = null
        this.state = startNewHand(s)
        this.cursor = 0
        this.seedBidSuggestion()
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    if (s.turn !== HUMAN) return
    if (this.lingerTrick !== null) return
    if (s.phase === 'bid') { this.handleBidInput(g); return }
    this.handlePlayInput(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.lingerTrick = null
      this.state = newGame(TARGET_SCORE)
      this.cursor = 0
      this.seedBidSuggestion()
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

  // ── input handlers ──────────────────────────────────────────────────

  private handleBidInput(g: GlassesGesture): void {
    switch (g.kind) {
      case 'swipe-up':
        this.bidValue = Math.min(13, this.bidValue + 1)
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.bidValue = Math.max(0, this.bidValue - 1)
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap':
        this.state = placeBid(this.state, HUMAN, this.bidValue)
        this.parkCursorOnLegal()
        this.ctx.requestRender()
        this.scheduleNextStep()
        return
    }
  }

  private handlePlayInput(g: GlassesGesture): void {
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
        this.applyPlay(HUMAN, c)
        return
      }
    }
  }

  // ── pacing engine ───────────────────────────────────────────────────

  private applyPlay(pos: Position, card: Card): void {
    const willCompleteTrick = this.state.trick.plays.length === 3
    const preTrickPlays = willCompleteTrick ? [...this.state.trick.plays] : null
    const preLeadSuit: Suit | null = this.state.trick.leadSuit
    this.state = playCard(this.state, pos, card)
    if (willCompleteTrick) {
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

  private scheduleNextStep(): void {
    this.cancelPendingTimer()
    const s = this.state
    if (s.phase !== 'bid' && s.phase !== 'play') return
    if (s.turn === HUMAN) return
    const delay = s.phase === 'bid' ? BID_STEP_MS : AI_STEP_MS
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runOneAiStep()
    }, delay)
  }

  private runOneAiStep(): void {
    const s = this.state
    if (s.turn === HUMAN) return
    if (s.phase === 'bid') {
      const bid = aiBid(s, s.turn, this.difficulty)
      this.state = placeBid(s, s.turn, bid)
      if (this.state.phase === 'play') this.parkCursorOnLegal()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (s.phase === 'play') {
      const card = aiPlay(s, s.turn, this.difficulty)
      this.applyPlay(s.turn, card)
    }
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
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  // ── render helpers ──────────────────────────────────────────────────

  private renderBid(): GlassesFrame {
    const s = this.state
    const sorted = this.sortedHand()
    const bidStr = (p: Position): string => {
      const b = s.bids[p]
      return b === null ? '-' : b === 0 ? 'nil' : String(b)
    }
    const yourTurn = s.turn === HUMAN
    const selector = yourTurn
      ? `Your bid ▸ ${this.bidValue === 0 ? 'nil (0)' : this.bidValue}`
      : 'Bidding…'
    return {
      score: this.scoreString(),
      body: [
        `W:${bidStr('W')}  N:${bidStr('N')}  E:${bidStr('E')}`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: -1 }),
        selector,
      ],
      controlHint: yourTurn ? '[swipe] bid 0-13  [2x] confirm' : '',
    }
  }

  private renderPlay(): GlassesFrame {
    const s = this.state
    const trick = this.lingerTrick ?? s.trick
    const trickPlays = trick.plays
    const sorted = this.sortedHand()
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
      hand: sorted as readonly PlatformCard[],
      cursorIdx: showCursor ? this.cursor : -1,
      legal: legal as readonly PlatformCard[],
    })
    return {
      score: this.scoreString(),
      body: [...trickLines, ...handLines],
      controlHint: showCursor ? '[swipe] sel  [2x] play' : '',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    return {
      score: this.scoreString(),
      body: [
        'Hand done',
        `Us ${this.teamTricks('NS')}/${this.teamBid('NS')}  Them ${this.teamTricks('EW')}/${this.teamBid('EW')}`,
        `Score  Us:${s.score.NS}  Them:${s.score.EW}`,
      ],
      controlHint: '[2x] next hand',
    }
  }

  private renderGameEnd(): GlassesFrame {
    const s = this.state
    const banner = gameWinner(s) === HUMAN_TEAM ? '*** YOU WIN ***' : '*** THEM WIN ***'
    return {
      score: this.scoreString(),
      body: [
        `Us:${s.score.NS}  Them:${s.score.EW}`,
        '',
        banner,
      ],
      controlHint: '[2x] back to menu',
    }
  }

  private scoreString(): string {
    const s = this.state
    const ns = s.score.NS
    const ew = s.score.EW
    if (s.phase === 'bid') return `Us:${ns}  Them:${ew}`
    return `Us:${ns} ${this.teamTricks('NS')}/${this.teamBid('NS')}  Them:${ew} ${this.teamTricks('EW')}/${this.teamBid('EW')}`
  }

  private teamBid(team: Team): number {
    const ps: Position[] = team === 'NS' ? ['S', 'N'] : ['W', 'E']
    return ps.reduce((sum, p) => sum + (this.state.bids[p] ?? 0), 0)
  }

  private teamTricks(team: Team): number {
    const ps: Position[] = team === 'NS' ? ['S', 'N'] : ['W', 'E']
    return ps.reduce((sum, p) => sum + this.state.tricksWon[p], 0)
  }

  /** Marker suffix on the (possibly lingered) trick view. Partner sits
   *  across (N over S) by the plus-sign layout, so only me/led need text. */
  private markersFor(pos: Position, trick: Trick): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    if (trick.plays.length > 0 && trick.plays[0]!.pos === pos) parts.push('led')
    return parts.join(',')
  }

  private sortedHand(): Card[] {
    return sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
  }

  private seedBidSuggestion(): void {
    this.bidValue = Math.max(0, Math.min(13, aiBid(this.state, HUMAN, this.difficulty)))
  }

  private clampCursor(): void {
    const len = this.state.hands[HUMAN].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
    this.parkCursorOnLegal()
  }

  /** When it becomes HUMAN's turn and the cursor sits on an illegal card
   *  (wrong suit when must-follow, or a spade that can't lead), advance to
   *  the first legal card in the sorted hand. Mirrors Hearts/Euchre. */
  private parkCursorOnLegal(): void {
    if (this.state.phase !== 'play') return
    if (this.state.turn !== HUMAN) return
    if (this.lingerTrick !== null) return
    const sorted = this.sortedHand()
    if (sorted.length === 0) return
    const legal = legalPlays(this.state, HUMAN)
    const currentCard = sorted[this.cursor]
    if (currentCard && legal.some(l => l.suit === currentCard.suit && l.rank === currentCard.rank)) return
    const firstLegalIdx = sorted.findIndex(c => legal.some(l => l.suit === c.suit && l.rank === c.rank))
    if (firstLegalIdx !== -1) this.cursor = firstLegalIdx
  }
}

// HTML for the phone-side "How to play" disclosure. Plain trusted markup.
const SPADES_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">You + North vs West + East. <strong>First team to 250 points wins.</strong></p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Setup</h3>
  <p style="margin: 0 0 .5rem;">Standard 52-card deck, 13 each. <strong>Spades are always trump.</strong></p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Bidding</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Before play, every player bids how many tricks they expect to take.</li>
    <li>Your team's contract is the sum of you + your partner's bids.</li>
    <li>A bid of <strong>nil (0)</strong> means you'll take no tricks — worth +100 if you pull it off, −100 if you don't.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Play</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Follow the lead suit if you can; otherwise play anything.</li>
    <li>Highest spade wins the trick; if no spade, highest of the lead suit.</li>
    <li><strong>Spades can't be led</strong> until "broken" — a spade played on a non-spade-led trick (or it's all you hold).</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Make your team's bid: <strong>+10 per bid trick</strong>, +1 per extra (a "bag").</li>
    <li>Miss it: <strong>−10 per bid trick</strong>.</li>
    <li>Collect <strong>10 bags</strong> and you lose 100 points — don't overtake too much.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Bid phase:</strong> swipe up/down to set your number (it's pre-filled with a suggestion), double-tap to confirm.</li>
    <li><strong>Play phase:</strong> swipe up/down to move the cursor through your hand, double-tap to play the highlighted card.</li>
    <li><strong>Single tap</strong> does nothing mid-game (so an accidental tap can't play a card).</li>
    <li>At hand-end / game-end: double-tap to continue.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">On-screen markers</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Plus-sign trick: North (partner) across the top, you (<code>me</code>) at the bottom, West/East on the sides.</li>
    <li><code>(led)</code> = led the current trick. Cards in <code>(parens)</code> in your hand are illegal right now.</li>
    <li>Score row: <code>Us:N t/b</code> = team score, tricks taken / tricks bid this hand.</li>
  </ul>
`
