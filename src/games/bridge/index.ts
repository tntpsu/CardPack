// Bridge — Game module obeying the even-card-platform contract.
//
// The wrapper:
//   - Holds GameState (engine.ts) + UI cursors
//   - AUCTION view: a call picker — swipe through the legal calls (pre-seeded
//     to the AI's suggestion), double-tap to make the call
//   - PLAY view: platform renderPlusTrick + the hand the human currently
//     controls (renderHand). Dummy is revealed after the opening lead.
//   - Routes turns by controllerOf(): the declarer plays BOTH their own hand
//     and dummy's; a defender plays their own; if the human is dummy they
//     watch the whole deal.
//   - Paces AI calls/plays via setTimeout and lingers on completed tricks.
//
// Pacing constants match the other trick games (real-glasses-tested May 2026).

import type {
  Game, GameHandle, GlassesFrame, GlassesGesture, PhoneEvent, PlatformContext,
} from 'even-card-platform'
import {
  renderHand, renderPlusTrick, sortBySuit, SUIT_GLYPH,
} from 'even-card-platform'
import type { Card as PlatformCard, Position as PlusPosition } from 'even-card-platform'

import { aiCall, aiPlay, DEFAULT_DIFFICULTY } from './ai'
import type { Difficulty } from './ai'
import {
  controllerOf, dummyOf, gameWinner, legalCalls, legalPlays, newGame, placeCall,
  playCard, startNewHand, teamOf,
  type Call, type Card, type GameState, type Position, type Strain, type Trick,
} from './engine'

const HUMAN: Position = 'S'
const TARGET_SCORE = 500
const AI_STEP_MS = 700
const BID_STEP_MS = 500
const TRICK_LINGER_MS = 1500

export const bridgeGame: Game = {
  id: 'bridge',
  name: 'Bridge',
  shortDesc: 'Bid the auction, make your contract',
  category: 'trick',
  glyph: '♣',
  init: (ctx: PlatformContext): GameHandle => new BridgeHandle(ctx),
  renderPhoneRules: () => BRIDGE_RULES_HTML,
}

function strainGlyph(s: Strain): string {
  return s === 'NT' ? 'NT' : SUIT_GLYPH[s]
}

function callText(call: Call): string {
  switch (call.kind) {
    case 'pass': return 'Pass'
    case 'double': return 'Dbl'
    case 'redouble': return 'Rdbl'
    case 'bid': return `${call.level}${strainGlyph(call.strain)}`
  }
}

class BridgeHandle implements GameHandle {
  private state: GameState
  private cursor = 0          // index into the human's sorted controllable hand
  private callCursor = 0      // index into the human's legal-call list (auction)
  private difficulty: Difficulty
  private ctx: PlatformContext
  private lingerTrick: Trick | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: PlatformContext) {
    this.ctx = ctx
    this.difficulty = (ctx.difficulty as Difficulty) ?? DEFAULT_DIFFICULTY
    this.state = newGame(TARGET_SCORE)
    this.scheduleNextStep()
  }

  render(): GlassesFrame {
    const s = this.state
    if (s.phase === 'game-end') return this.renderGameEnd()
    if (s.phase === 'hand-end') return this.renderHandEnd()
    if (s.phase === 'auction') return this.renderAuction()
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
        this.ctx.requestRender()
        this.scheduleNextStep()
      }
      return
    }
    if (this.lingerTrick !== null) return
    if (s.phase === 'auction') {
      if (s.turn !== HUMAN) return
      this.handleAuctionInput(g)
      return
    }
    // play: only when the human controls the seat that must act now
    if (controllerOf(s, s.turn) !== HUMAN) return
    this.handlePlayInput(g)
  }

  handlePhoneEvent(ev: PhoneEvent): void {
    if (ev.kind === 'new-game') {
      this.cancelPendingTimer()
      this.lingerTrick = null
      this.state = newGame(TARGET_SCORE)
      this.cursor = 0
      this.ctx.requestRender()
      this.scheduleNextStep()
      return
    }
    if (ev.kind === 'set-difficulty') {
      const v = ev.payload
      if (v === 'easy' || v === 'medium' || v === 'hard') this.difficulty = v
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

  // ── input handlers ──────────────────────────────────────────────────────

  private handleAuctionInput(g: GlassesGesture): void {
    const legal = legalCalls(this.state.calls, HUMAN)
    if (legal.length === 0) return
    switch (g.kind) {
      case 'swipe-up':
        this.callCursor = (this.callCursor - 1 + legal.length) % legal.length
        this.ctx.requestRender()
        return
      case 'swipe-down':
        this.callCursor = (this.callCursor + 1) % legal.length
        this.ctx.requestRender()
        return
      case 'tap':
        return
      case 'double-tap': {
        const call = legal[Math.min(this.callCursor, legal.length - 1)]!
        this.state = placeCall(this.state, HUMAN, call)
        if (this.state.phase === 'play') this.parkCursorOnLegal()
        this.cursor = 0
        this.ctx.requestRender()
        this.scheduleNextStep()
        return
      }
    }
  }

  private handlePlayInput(g: GlassesGesture): void {
    const seat = this.state.turn
    const sorted = this.sortedHand(seat)
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
        const legal = legalPlays(this.state, seat)
        if (!legal.some(l => l.suit === c.suit && l.rank === c.rank)) return
        this.applyPlay(seat, c)
        return
      }
    }
  }

  // ── pacing engine ─────────────────────────────────────────────────────────

  private applyPlay(pos: Position, card: Card): void {
    const willCompleteTrick = this.state.trick.plays.length === 3
    const preTrickPlays = willCompleteTrick ? [...this.state.trick.plays] : null
    const preLeadSuit: Card['suit'] | null = this.state.trick.leadSuit
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
    if (s.phase !== 'auction' && s.phase !== 'play') return
    // It's the human's move — seed the call picker (auction) and wait.
    if (this.isHumanTurn()) {
      if (s.phase === 'auction') this.seedCallSuggestion()
      return
    }
    const delay = s.phase === 'auction' ? BID_STEP_MS : AI_STEP_MS
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.runOneAiStep()
    }, delay)
  }

  private runOneAiStep(): void {
    const s = this.state
    if (this.isHumanTurn()) { this.scheduleNextStep(); return }
    if (s.phase === 'auction') {
      const call = aiCall(s, s.turn, this.difficulty)
      this.state = placeCall(s, s.turn, call)
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

  /** True when the human must act now (their bid, or a seat they control). */
  private isHumanTurn(): boolean {
    const s = this.state
    if (s.phase === 'auction') return s.turn === HUMAN
    if (s.phase === 'play') return controllerOf(s, s.turn) === HUMAN
    return false
  }

  // ── render helpers ──────────────────────────────────────────────────────

  private renderAuction(): GlassesFrame {
    const s = this.state
    const sorted = this.sortedHand(HUMAN)
    const yourTurn = s.turn === HUMAN
    const std = lastBidString(s)
    const vul = s.vulnerable[teamOf(HUMAN)] ? 'V' : '-'
    const legal = legalCalls(s.calls, HUMAN)
    const selCall = legal[Math.min(this.callCursor, legal.length - 1)]
    const selector = yourTurn
      ? `Your call ▸ ${selCall ? callText(selCall) : 'Pass'}`
      : `${s.turn} bidding…`
    return {
      score: `Us:${s.score.NS} Them:${s.score.EW}  Vul:${vul}`,
      body: [
        `Dlr:${s.dealer}  Bid: ${std}`,
        ...renderHand({ hand: sorted as readonly PlatformCard[], cursorIdx: -1 }),
        selector,
      ],
      controlHint: yourTurn ? '[swipe] call  [2x] make call' : '',
    }
  }

  private renderPlay(): GlassesFrame {
    const s = this.state
    const trick = this.lingerTrick ?? s.trick
    const acting = this.actingSeat()
    const showCursor = acting !== null && this.lingerTrick === null
    const dummy = dummyOf(s)
    const focusSeat: Position = acting ?? (s.dummyRevealed && dummy ? dummy : HUMAN)
    const sorted = this.sortedHand(focusSeat)
    const legal = showCursor ? legalPlays(s, focusSeat) : []
    const trickLines = renderPlusTrick({
      plays: (['N', 'W', 'E', 'S'] as PlusPosition[]).map(pos => ({
        pos,
        card: trick.plays.find(p => p.pos === pos)?.card ?? null,
      })),
      getMarker: pos => this.markersFor(pos as Position, trick),
    })
    const handLines = renderHand({
      hand: sorted as readonly PlatformCard[],
      cursorIdx: showCursor ? this.cursor : -1,
      legal: legal as readonly PlatformCard[],
    })
    const hint = showCursor
      ? (focusSeat === HUMAN ? '[swipe] sel  [2x] play' : `[swipe] sel  [2x] play ${focusSeat}`)
      : ''
    return { score: this.playScoreString(), body: [...trickLines, ...handLines], controlHint: hint }
  }

  private renderHandEnd(): GlassesFrame {
    const s = this.state
    const r = s.lastResult
    let line = 'Hand done'
    if (r) {
      if (r.passedOut) line = 'Passed out — no score'
      else if (r.contract) {
        const c = r.contract
        const cs = `${c.level}${strainGlyph(c.strain)}${c.redoubled ? 'XX' : c.doubled ? 'X' : ''} by ${c.declarer}`
        const margin = r.made
          ? `made +${r.declarerTricks - (6 + c.level)}`
          : `down ${(6 + c.level) - r.declarerTricks}`
        const who = r.scoringTeam === 'NS' ? 'Us' : 'Them'
        line = `${cs} ${margin} (${who} +${r.points})`
      }
    }
    return {
      score: `Us:${s.score.NS}  Them:${s.score.EW}`,
      body: [line, '', `Score  Us:${s.score.NS}  Them:${s.score.EW}`],
      controlHint: '[2x] next hand',
    }
  }

  private renderGameEnd(): GlassesFrame {
    const s = this.state
    const banner = gameWinner(s) === teamOf(HUMAN) ? '*** YOU WIN ***' : '*** THEM WIN ***'
    return {
      score: `Us:${s.score.NS}  Them:${s.score.EW}`,
      body: [`Us:${s.score.NS}  Them:${s.score.EW}`, '', banner],
      controlHint: '[2x] back to menu',
    }
  }

  private playScoreString(): string {
    const s = this.state
    const c = s.contract!
    const cs = `${c.level}${strainGlyph(c.strain)}${c.redoubled ? 'XX' : c.doubled ? 'X' : ''} by ${c.declarer}`
    const made = s.tricksWon[teamOf(c.declarer)]
    return `${cs}  ${made}/${6 + c.level} ▸${s.turn}`
  }

  /** The seat the human must play from right now, or null if watching. */
  private actingSeat(): Position | null {
    const s = this.state
    if (s.phase !== 'play') return null
    if (this.lingerTrick !== null) return null
    return controllerOf(s, s.turn) === HUMAN ? s.turn : null
  }

  /** Partner sits across; mark the human seat and whoever led this trick. */
  private markersFor(pos: Position, trick: Trick): string {
    const parts: string[] = []
    if (pos === HUMAN) parts.push('me')
    const dummy = dummyOf(this.state)
    if (dummy && pos === dummy && this.state.dummyRevealed) parts.push('dum')
    if (trick.plays.length > 0 && trick.plays[0]!.pos === pos) parts.push('led')
    return parts.join(',')
  }

  private sortedHand(seat: Position): Card[] {
    return sortBySuit(this.state.hands[seat] as readonly PlatformCard[]) as Card[]
  }

  private seedCallSuggestion(): void {
    const legal = legalCalls(this.state.calls, HUMAN)
    if (legal.length === 0) { this.callCursor = 0; return }
    const suggestion = aiCall(this.state, HUMAN, this.difficulty)
    const idx = legal.findIndex(c => sameCall(c, suggestion))
    this.callCursor = idx >= 0 ? idx : 0
  }

  private clampCursor(): void {
    const acting = this.actingSeat()
    if (acting === null) { this.cursor = 0; return }
    const len = this.state.hands[acting].length
    if (len === 0) { this.cursor = 0; return }
    this.cursor = Math.max(0, Math.min(len - 1, this.cursor))
    this.parkCursorOnLegal()
  }

  /** Park the cursor on the first legal card of the acting seat's hand. */
  private parkCursorOnLegal(): void {
    const acting = this.actingSeat()
    if (acting === null) return
    const sorted = this.sortedHand(acting)
    if (sorted.length === 0) return
    const legal = legalPlays(this.state, acting)
    const cur = sorted[this.cursor]
    if (cur && legal.some(l => l.suit === cur.suit && l.rank === cur.rank)) return
    const firstLegal = sorted.findIndex(c => legal.some(l => l.suit === c.suit && l.rank === c.rank))
    if (firstLegal !== -1) this.cursor = firstLegal
  }
}

function sameCall(a: Call, b: Call): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'bid' && b.kind === 'bid') return a.level === b.level && a.strain === b.strain
  return true
}

/** Standing-bid summary for the auction header, e.g. "1♥ X" or "—". */
function lastBidString(s: GameState): string {
  let bid: { level: number; strain: Strain } | null = null
  let dbl = ''
  for (const c of s.calls) {
    if (c.call.kind === 'bid') { bid = { level: c.call.level, strain: c.call.strain }; dbl = '' }
    else if (c.call.kind === 'double') dbl = ' X'
    else if (c.call.kind === 'redouble') dbl = ' XX'
  }
  return bid ? `${bid.level}${strainGlyph(bid.strain)}${dbl}` : '—'
}

// HTML for the phone-side "How to play" disclosure. Plain trusted markup.
const BRIDGE_RULES_HTML = `
  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Goal</h3>
  <p style="margin: 0 0 .5rem;">You + North vs West + East. Win the auction, then take enough
  tricks to make your contract. <strong>First side to 500 points wins.</strong></p>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">The auction</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Each turn you <strong>Pass</strong>, <strong>bid</strong> (a level 1-7 + a strain ♣ ◆ ♥ ♠ or NT),
    <strong>Double</strong> an opponent's bid, or <strong>Redouble</strong>.</li>
    <li>Every bid must outrank the last (level first, then ♣&lt;◆&lt;♥&lt;♠&lt;NT).</li>
    <li>Three passes in a row end the auction. The last bid is the <strong>contract</strong>;
    the partner who first named its strain is the <strong>declarer</strong>.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">The play</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>The player left of declarer leads. Then <strong>dummy</strong> (declarer's partner) is laid
    face-up and the declarer plays both hands.</li>
    <li>Follow the led suit if you can; otherwise play anything. The contract strain is trump
    (NT = no trump). Highest trump wins, else highest of the led suit.</li>
    <li>Declarer needs <strong>6 + the bid level</strong> tricks (so 4♥ = 10 tricks).</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Scoring (per deal)</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li>Make it: trick points (minors 20, majors 30, NT 40 then 30) + bonuses — part-score +50,
    game +300/+500, slam +500–+1500. Overtricks score too.</li>
    <li>Go down: the defenders score 50/100 per undertrick (more if doubled).</li>
    <li><strong>Vulnerability</strong> cycles each deal (none → us → them → both) and raises both
    the bonuses and the penalties.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Glasses controls</h3>
  <ul style="margin: 0 0 .5rem; padding-left: 1.25rem;">
    <li><strong>Auction:</strong> swipe to dial through the legal calls (pre-set to a suggestion),
    double-tap to make it.</li>
    <li><strong>Play:</strong> swipe to move the cursor, double-tap to play. When you're declarer you
    also play dummy's cards — the header shows which seat (<code>▸N</code>) is on lead.</li>
    <li><strong>Single tap</strong> does nothing mid-deal. At hand/game end, double-tap to continue.</li>
  </ul>

  <h3 style="margin: 1rem 0 .25rem; font-size: 1rem;">Note</h3>
  <p style="margin: 0 0 .5rem; color:#666;">The AI uses a simplified Standard American bidding system
  (no Stayman/transfers/Blackwood) — it reaches sensible part-scores and games but isn't a
  tournament partner.</p>
`
