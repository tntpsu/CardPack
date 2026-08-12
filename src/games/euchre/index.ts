// Euchre — Game module obeying the even-card-platform contract.
//
// Engine + AI are copied verbatim from the standalone ~/Documents/Euchre.
// This file is the wrapper that:
//   - Holds GameState
//   - Renders by phase: order-up (incl. dealer discard sub-state),
//     call-trump, play, hand-end, game-end
//   - Translates glasses gestures into engine moves
//   - Paces AI plays via setTimeout so the user can see each card land
//   - Lingers on completed tricks so all four cards are visible before
//     the engine clears them
//
// v0.1.5+ CardPack conventions applied (different from standalone Euchre):
//   - Double-tap = play / confirm; single-tap = no-op (prevents accidental)
//   - Auto-park cursor on first legal card (must-follow-suit / must-follow-trump)
//   - Score format S(me):N (+H) style — adapted to NS/EW teams
//
// Pacing constants match Hearts:
//   AI_STEP_MS = 700
//   TRICK_LINGER_MS = 1500
//   BID_STEP_MS = 500 — slightly faster, no card-on-screen to absorb

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import {
  renderCard as platformRenderCard,
  renderHand, renderPlusBid, renderPlusTrick, sortBySuit, SUIT_GLYPH,
} from 'even-card-platform'
import type { Card as PlatformCard } from 'even-card-platform'

import { aiBidRound1, aiBidRound2, aiPlay, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  callTrump, legalPlays, newGame, orderUp, passBid, playCard, positionsAfter, startNewHand,
  teamOf,
  type Card, type GameState, type Position, type Suit, type Team, type Trick,
} from './engine'

const HUMAN: Position = 'S'
const HUMAN_TEAM: Team = 'NS'
const AI_STEP_MS = 700
const BID_STEP_MS = 500
const TRICK_LINGER_MS = 1500

/** Sub-state for the order-up phase when South orders up while being the
 *  dealer — needs to pick which card to discard. */
type DiscardSubState = 'none' | 'pending'

const SUIT_LIST: Suit[] = ['♠', '♥', '♦', '♣']

class EuchreHandle implements GameHandle {
  private state: GameState
  private cursor = 0
  private difficulty: Difficulty
  private ctx: PlatformContext
  private discardMode: DiscardSubState = 'none'
  private lingerTrick: Trick | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame()
    this.scheduleNextStep()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (s.phase === 'order-up') return this.renderOrderUp()
    if (s.phase === 'call-trump') return this.renderCallTrump()
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
        this.discardMode = 'none'
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    if (s.turn !== HUMAN) return
    if (this.lingerTrick !== null) return

    if (s.phase === 'order-up') { this.handleOrderUpInput(g); return }
    if (s.phase === 'call-trump') { this.handleCallTrumpInput(g); return }
    if (s.phase === 'play') this.handlePlayInput(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.lingerTrick = null
      this.state = newGame()
      this.cursor = 0
      this.discardMode = 'none'
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

  // ── per-phase render ────────────────────────────────────────────────

  private renderGameEnd(): GlassesFrame {
    const winnerTeam: Team = this.state.score.NS >= 10 ? 'NS' : 'EW'
    const banner = winnerTeam === HUMAN_TEAM ? '*** US WIN ***' : '*** THEM WIN ***'
    return {
      score: this.scoreString(),
      body: ['', banner],
      controlHint: '[2x] back to menu',
    }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    const trumpDisplay = s.trump ? SUIT_GLYPH[s.trump] : '?'
    return {
      score: this.scoreString(),
      body: [
        'Hand done',
        `Tricks: us ${s.tricks.NS} - ${s.tricks.EW} them`,
        `Trump was ${trumpDisplay} (maker: ${s.maker ?? '?'})`,
      ],
      controlHint: '[2x] next hand',
    }
  }

  private renderOrderUp(): GlassesFrame {
    const s = this.state

    if (this.discardMode === 'pending') {
      // Dealer (S) ordered up — pick a discard from hand+upcard.
      // Keep the linear layout here; the plus-sign isn't useful when
      // bidding is decided and we're choosing a discard.
      const header = `Dealer:${s.dealer}  Up:${platformRenderCard(s.upCard)}`
      const handPlusUp = [...s.hands[HUMAN] as readonly PlatformCard[], s.upCard as PlatformCard]
      const handLines = renderHand({ hand: handPlusUp, cursorIdx: this.cursor })
      return {
        score: this.scoreString(),
        body: [header, 'Pick a card to discard:', ...handLines],
        controlHint: '[swipe] sel  [2x] discard',
      }
    }

    // Plus-sign bid view: who's at the table, who's dealer, who's bidding
    // now, who's passed. Upcard in the middle. v0.3.0.
    const plusLines = renderPlusBid({
      upCard: s.upCard,
      getMarker: pos => this.bidMarkerFor(pos),
    })
    const sortedHand = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[])
    const handLines = renderHand({ hand: sortedHand, cursorIdx: -1 })

    if (s.turn !== HUMAN) {
      return {
        score: this.scoreString(),
        body: [...plusLines, ...handLines],
        controlHint: '',
      }
    }

    // Human's turn — Order / Pass toggle below the plus-sign.
    const role = s.dealer === HUMAN ? 'you are dealer — pick up' : 'tell dealer to'
    const orderLabel = this.cursor === 0 ? '▶Order' : ' Order'
    const passLabel = this.cursor === 1 ? '▶Pass' : ' Pass'
    return {
      score: this.scoreString(),
      body: [
        ...plusLines,
        `Order up ${SUIT_GLYPH[s.upCard.suit]}? (${role})`,
        `${orderLabel}    ${passLabel}`,
        ...handLines,
      ],
      controlHint: '[swipe] sel  [2x] confirm',
    }
  }

  private renderCallTrump(): GlassesFrame {
    const s = this.state

    // Plus-sign bid view: same as order-up but round 2 (upcard's suit
    // is no longer eligible — but the upcard still sits in the middle
    // as visual reference for what was passed on).
    const plusLines = renderPlusBid({
      upCard: s.upCard,
      getMarker: pos => this.bidMarkerFor(pos),
    })
    const sortedHand = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[])
    const handLines = renderHand({ hand: sortedHand, cursorIdx: -1 })

    if (s.turn !== HUMAN) {
      return {
        score: this.scoreString(),
        body: [...plusLines, ...handLines],
        controlHint: '',
      }
    }

    const callable = SUIT_LIST.filter(x => x !== s.forbiddenTrumpRound2)
    const isStickDealer = s.dealer === HUMAN && s.passes === 3
    const options: Array<{ kind: 'suit'; suit: Suit } | { kind: 'pass' }> = []
    for (const suit of callable) options.push({ kind: 'suit', suit })
    if (!isStickDealer) options.push({ kind: 'pass' })
    const cursor = ((this.cursor % options.length) + options.length) % options.length
    const labels = options.map((opt, i) => {
      const text = opt.kind === 'suit' ? SUIT_GLYPH[opt.suit] : 'Pass'
      return i === cursor ? `▶${text}` : ` ${text}`
    })
    return {
      score: this.scoreString(),
      body: [
        ...plusLines,
        'Call trump?',
        labels.join('  '),
        ...handLines,
      ],
      controlHint: isStickDealer
        ? '[swipe] sel  [2x] call  (stuck — must call)'
        : '[swipe] sel  [2x] confirm',
    }
  }

  private renderPlay(): GlassesFrame {
    const s = this.state
    // v0.2.2: route every glasses-side suit display through SUIT_GLYPH /
    // renderCard — the G2 firmware font has advW=0 for U+2666 (♦), so
    // raw ♦ renders as a blank cell.
    const trump = s.trump ? SUIT_GLYPH[s.trump] : '?'
    const upDisplay = platformRenderCard(s.upCard)
    const contextLine = `D:${s.dealer}  Maker:${s.maker ?? '?'}  Up:${upDisplay}`
    const tricksLine = `Trump:${trump}  Tricks ${s.tricks.NS}-${s.tricks.EW}`

    const trick = this.lingerTrick ?? s.trick
    const trickPlays = trick.plays

    const sorted = sortBySuit(s.hands[HUMAN] as readonly PlatformCard[])
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
      body: [contextLine, tricksLine, ...trickLines, ...handLines],
      controlHint: showCursor ? '[swipe] sel  [2x] play' : '',
    }
  }

  // ── per-phase input ─────────────────────────────────────────────────

  private handleOrderUpInput(g: GlassesGesture): void {
    if (this.discardMode === 'pending') {
      // Pick discard from hand+upcard (6 options).
      const handPlusUp = [...this.state.hands[HUMAN], this.state.upCard]
      const len = handPlusUp.length
      switch (g.kind) {
        case 'swipe-up': this.cursor = (this.cursor - 1 + len) % len; this.ctx.requestRender(); return
        case 'swipe-down': this.cursor = (this.cursor + 1) % len; this.ctx.requestRender(); return
        case 'tap': return
        case 'double-tap': {
          const discard = handPlusUp[this.cursor]
          if (!discard) return
          this.state = orderUp(this.state, discard)
          this.discardMode = 'none'
          this.cursor = 0
          this.parkPlayCursor()
          this.ctx.requestRender()
          this.scheduleNextStep()
          return
        }
      }
      return
    }

    // Bidding — toggle Order(0) / Pass(1).
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + 2) % 2; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % 2; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap': {
        if (this.cursor === 1) {
          // Pass
          this.state = passBid(this.state)
          this.cursor = 0
          this.ctx.requestRender()
          this.scheduleNextStep()
          return
        }
        // Order up.
        if (this.state.dealer === HUMAN) {
          // South is dealer — transition to discard pick.
          this.discardMode = 'pending'
          this.cursor = 0
          this.ctx.requestRender()
          return
        }
        // Non-dealer ordering: engine needs dealer's discard. Ask AI.
        const dealerHand = this.state.hands[this.state.dealer]
        const decision = aiBidRound1({ ...this.state, turn: this.state.dealer }, this.state.dealer, this.difficulty)
        const discard = decision.action === 'order' && 'discard' in decision
          ? decision.discard
          : dealerHand[0]!
        this.state = orderUp(this.state, discard)
        this.cursor = 0
        this.parkPlayCursor()
        this.ctx.requestRender()
        this.scheduleNextStep()
        return
      }
    }
  }

  private handleCallTrumpInput(g: GlassesGesture): void {
    const callable = SUIT_LIST.filter(x => x !== this.state.forbiddenTrumpRound2)
    const isStickDealer = this.state.dealer === HUMAN && this.state.passes === 3
    const options: Array<{ kind: 'suit'; suit: Suit } | { kind: 'pass' }> = []
    for (const suit of callable) options.push({ kind: 'suit', suit })
    if (!isStickDealer) options.push({ kind: 'pass' })
    const len = options.length
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + len) % len; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % len; this.ctx.requestRender(); return
      case 'tap': return
      case 'double-tap': {
        const selected = options[this.cursor]
        if (!selected) return
        if (selected.kind === 'pass') {
          this.state = passBid(this.state)
        } else {
          this.state = callTrump(this.state, selected.suit)
          this.parkPlayCursor()
        }
        this.cursor = 0
        this.ctx.requestRender()
        this.scheduleNextStep()
        return
      }
    }
  }

  private handlePlayInput(g: GlassesGesture): void {
    const sorted = sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    const len = sorted.length
    if (len === 0) return
    switch (g.kind) {
      case 'swipe-up': this.cursor = (this.cursor - 1 + len) % len; this.ctx.requestRender(); return
      case 'swipe-down': this.cursor = (this.cursor + 1) % len; this.ctx.requestRender(); return
      case 'tap': return
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

  // ── pacing engine ────────────────────────────────────────────────

  private applyPlay(pos: Position, card: Card): void {
    const willCompleteTrick = this.state.trick.plays.length === 3
    const preTrickPlays = willCompleteTrick ? [...this.state.trick.plays] : null
    const preLeadSuit: Suit | null = this.state.trick.leadSuit
    this.state = playCard(this.state, pos, card)
    if (willCompleteTrick && this.state.phase !== 'hand-end' && this.state.phase !== 'game-end') {
      this.lingerTrick = {
        plays: [...preTrickPlays!, { pos, card }],
        leadSuit: preLeadSuit ?? card.suit,
      }
      this.ctx.requestRender()
      this.scheduleLingerClear()
      return
    }
    this.parkPlayCursor()
    this.ctx.requestRender()
    this.scheduleNextStep()
  }

  private scheduleNextStep(): void {
    this.cancelPendingTimer()
    const s = this.state
    if (s.phase === 'hand-end' || s.phase === 'game-end') return
    if (s.turn === HUMAN) return
    // Bid phases run a hair faster (no card animation to absorb).
    const delay = s.phase === 'play' ? AI_STEP_MS : BID_STEP_MS
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runOneAiStep()
    }, delay)
  }

  private runOneAiStep(): void {
    const s = this.state
    if (s.turn === HUMAN) return
    if (s.phase === 'order-up') {
      const decision = aiBidRound1(s, s.turn, this.difficulty)
      if (decision.action === 'order') {
        const dealerHand = [...s.hands[s.dealer], s.upCard]
        const trumpSuit = s.upCard.suit
        const discard = pickAiDiscard(dealerHand, trumpSuit)
        this.state = orderUp(s, discard)
      } else {
        this.state = passBid(s)
      }
      this.parkPlayCursor()
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (s.phase === 'call-trump') {
      const decision = aiBidRound2(s, s.turn, this.difficulty)
      if (decision.action === 'call') {
        this.state = callTrump(s, decision.suit)
        this.parkPlayCursor()
      } else {
        this.state = passBid(s)
      }
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
      this.parkPlayCursor()
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

  // ── render + cursor helpers ─────────────────────────────────────────

  private scoreString(): string {
    // Team-based score: "Us:N(+T)  Them:N(+T)" where +T is tricks-this-hand.
    const s = this.state
    const usGame = s.score.NS
    const themGame = s.score.EW
    const usTricks = s.tricks.NS
    const themTricks = s.tricks.EW
    return `Us:${usGame}(+${usTricks})  Them:${themGame}(+${themTricks})`
  }

  private markersFor(pos: Position, trick: Trick): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    if (trick.plays.length > 0 && trick.plays[0]!.pos === pos) parts.push('led')
    return parts.join(',')
  }

  /** Marker for the plus-sign bid view. v0.3.0.
   *  (D)  — dealer
   *  (▶)  — currently bidding
   *  (—)  — passed in this round
   *  (me) — South (you); always shown for identity
   *  Combinations are comma-joined: S(me,D,▶) etc. */
  private bidMarkerFor(pos: Position): string {
    const s = this.state
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    if (pos === s.dealer) parts.push('D')
    if (pos === s.turn) parts.push('▶')
    else if (this.hasPassedThisRound(pos)) parts.push('—')
    return parts.join(',')
  }

  /** Has `pos` already passed in the current bidding round? Derived
   *  from engine's `passes` count and the clockwise bidding order
   *  starting at dealer+1. */
  private hasPassedThisRound(pos: Position): boolean {
    const s = this.state
    if (s.passes === 0) return false
    const order = positionsAfter(s.dealer) // [W,N,E,S] if dealer=S etc.
    return order.slice(0, s.passes).includes(pos)
  }

  /** Reposition cursor to a legal card in the sorted hand. Idempotent;
   *  no-op when current cursor is already on a legal card or when it's
   *  not the human's turn / not in play phase. Used after AI plays. */
  private parkPlayCursor(): void {
    if (this.state.phase !== 'play') return
    if (this.state.turn !== HUMAN) return
    if (this.lingerTrick !== null) return
    const sorted = sortBySuit(this.state.hands[HUMAN] as readonly PlatformCard[]) as Card[]
    if (sorted.length === 0) return
    const legal = legalPlays(this.state, HUMAN)
    this.cursor = Math.max(0, Math.min(this.cursor, sorted.length - 1))
    const currentCard = sorted[this.cursor]
    if (currentCard && legal.some(l => l.suit === currentCard.suit && l.rank === currentCard.rank)) return
    const firstLegalIdx = sorted.findIndex(c => legal.some(l => l.suit === c.suit && l.rank === c.rank))
    if (firstLegalIdx !== -1) this.cursor = firstLegalIdx
  }
}

// Local helper, mirrors ai.ts/pickDiscard but kept here so we don't
// export an extra symbol from the AI module.
function pickAiDiscard(hand: readonly Card[], trumpSuit: Suit): Card {
  // Find the weakest non-trump if any, else the weakest trump.
  const nonTrump = hand.filter(c => !(c.suit === trumpSuit
    || (c.rank === 'J' && sameColor(c.suit) === trumpSuit)))
  const pool = nonTrump.length > 0 ? nonTrump : hand
  // Pure-rank ordering (9 < 10 < J < Q < K < A). Engine's cardStrength
  // gives identical answers for non-trump off-suit comparison.
  const RV: Record<string, number> = { '9': 0, '10': 1, J: 2, Q: 3, K: 4, A: 5 }
  return pool.slice().sort((a, b) => (RV[a.rank] ?? 0) - (RV[b.rank] ?? 0))[0]!
}

function sameColor(suit: Suit): Suit {
  switch (suit) {
    case '♠': return '♣'
    case '♣': return '♠'
    case '♥': return '♦'
    case '♦': return '♥'
  }
}

const EUCHRE_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">Partnered trick-taking. <strong>You</strong> (S) and <strong>your partner</strong> (N) are team <strong>Us</strong>; W and E are <strong>Them</strong>. First team to 10 wins.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Setup</h3>
  <p style="margin: 0 0 .5rem;">24-card deck (9, 10, J, Q, K, A). Each player gets 5 cards. The dealer flips one card up — its suit is offered as trump in round 1.</p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Bidding</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Round 1:</strong> Each player in turn can <em>Order up</em> (make the upcard's suit trump) or <em>Pass</em>. If you order up, dealer picks up the upcard and discards a card. Order up if you have 3+ trumps in hand (4+ on Easy).</li>
    <li><strong>Round 2:</strong> If everyone passes, the upcard is set aside and each player can <em>Call</em> any of the other 3 suits as trump, or pass. If the first 3 players pass round 2, the dealer must call (stuck-the-dealer).</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Trump</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Right Bower</strong> — J of trump suit. Highest trump.</li>
    <li><strong>Left Bower</strong> — J of same color as trump. Second-highest trump. Treated as trump for follow-suit rules.</li>
    <li>Other trumps rank A &gt; K &gt; Q &gt; 10 &gt; 9.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Play</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Must follow lead suit (treating left bower as trump) if you can. Otherwise play anything.</li>
    <li>Highest card of the lead suit wins; trump beats non-trump.</li>
    <li>Trick winner leads next.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Maker team wins 3 or 4 tricks → <strong>1 point</strong>.</li>
    <li>Maker team wins all 5 tricks (a sweep / march) → <strong>2 points</strong>.</li>
    <li>Maker team wins 0–2 tricks → defenders are <strong>euchred</strong> and get <strong>2 points</strong>.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Swipe up/down</strong> — move the ▲/▼ cursor through options or your hand</li>
    <li><strong>Double-tap</strong> — confirm bid / order up / call suit / discard / play card. At hand-end: next hand. At game-end: back to menu.</li>
    <li><strong>Single tap</strong> — does nothing mid-game (so an accidental tap can't commit something you didn't mean to).</li>
    <li>Your cursor parks on a legal card automatically when you must follow suit.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">On-screen markers</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><code>Us:N(+T)  Them:N(+T)</code> — game score and tricks-this-hand</li>
    <li><code>Trump:♠</code> — current trump suit; <code>?</code> until bidding completes</li>
    <li>Cards in <code>(parens)</code> in your hand = illegal play right now</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Plus-sign bid view (markers)</h3>
  <p style="margin: 0 0 .5rem;">During bidding, the four seats sit at a table with the upcard in the middle:</p>
  <pre style="margin: 0 0 .5rem; padding: .5rem .75rem; background: #f5f5f5; border-radius: 4px; font-family: ui-monospace, monospace; font-size: .9em;">           N
   W(D)   [J◆]   E(▶)
           S(me)</pre>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><code>(D)</code> — dealer</li>
    <li><code>(▶)</code> — currently bidding (this marker migrates around the table)</li>
    <li><code>(—)</code> — passed in this round</li>
    <li><code>(me)</code> — you (always South)</li>
    <li>North is always your partner; West and East are opponents.</li>
  </ul>
`

export const euchreGame: Game = {
  id: 'euchre',
  name: 'Euchre',
  shortDesc: 'Trump trick-taking w/ partner',
  category: 'trick',
  glyph: '◆',
  init: (ctx: PlatformContext): GameHandle => new EuchreHandle(ctx),
  renderPhoneRules: () => EUCHRE_RULES_HTML,
}
