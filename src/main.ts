// Card Pack entry point. Wires the Even Hub bridge to the platform
// Runtime, registers each game module, and renders the launcher.
//
// Phase A: Hearts is the only registered game (reference module).
// Spades, Euchre, Solitaire, Crazy Eights, Cribbage, Gin Rummy land in
// Phase B+.

import { Runtime } from 'even-card-platform'
import type { GlassesGesture } from 'even-card-platform'

import { connectEvenRuntime, type EvenRuntime } from './even'
import { heartsGame } from './games/hearts'
import { euchreGame } from './games/euchre'

declare const __APP_VERSION__: string

// ─── Phone DOM ────────────────────────────────────────────────────────

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323; overflow-x: hidden;">
    <h1 style="margin: 0 0 .25rem 0;">Card Pack <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1rem 0;">Seven classic card games. One tap to play.</p>
    <p id="status" style="color: #7b7b7b; font-size: .9em; margin: 0 0 1rem 0;">Connecting…</p>

    <section style="margin-top: 1rem; margin-bottom: 1rem;">
      <label for="difficulty" style="display: block; margin-bottom: .35rem; font-weight: 600;">AI difficulty</label>
      <select id="difficulty" style="padding: .5rem .75rem; max-width: 100%; box-sizing: border-box; font-size: 1rem; min-width: 160px;">
        <option value="easy">Easy</option>
        <option value="medium" selected>Medium</option>
        <option value="hard">Hard</option>
      </select>
      <p style="color: #7b7b7b; font-size: .85em; margin: .25rem 0 0;">Changes take effect on the next AI play — no need to restart the hand.</p>
    </section>

    <section style="margin-top: 1rem;">
      <button id="new-game" type="button" style="padding:.5rem 1rem;cursor:pointer;max-width:100%;box-sizing:border-box;">New game</button>
      <button id="end-game" type="button" style="padding:.5rem 1rem;cursor:pointer;margin-left:.5rem;max-width:100%;box-sizing:border-box;">End game (back to menu)</button>
    </section>

    <details id="rules-disclosure" open style="margin-top: 1rem;">
      <summary style="cursor: pointer; font-weight: 600;">How to play</summary>
      <div id="rules-body" style="line-height: 1.55; color: #333; padding: .25rem .25rem 0;">
        <p style="color:#777;">Loading…</p>
      </div>
    </details>

    <section style="margin-top: 1rem;">
      <h2 style="font-size: 1.1em; margin: 1rem 0 .5rem 0;">In the pack</h2>
      <p style="color:#555;">Phase B: Hearts + Euchre. Spades, Solitaire, Crazy Eights, Cribbage, Gin Rummy land in Phase C+.</p>
    </section>
  </main>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const newGameBtn = document.querySelector<HTMLButtonElement>('#new-game')!
const endGameBtn = document.querySelector<HTMLButtonElement>('#end-game')!
const rulesBody = document.querySelector<HTMLDivElement>('#rules-body')!
const difficultySelect = document.querySelector<HTMLSelectElement>('#difficulty')!

const DIFFICULTY_STORAGE_KEY = 'cardpack:difficulty'
type Difficulty = 'easy' | 'medium' | 'hard'
function readSavedDifficulty(): Difficulty {
  const raw = localStorage.getItem(DIFFICULTY_STORAGE_KEY)
  return raw === 'easy' || raw === 'hard' || raw === 'medium' ? raw : 'medium'
}
const initialDifficulty: Difficulty = readSavedDifficulty()
difficultySelect.value = initialDifficulty

// ─── Bootstrap ────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const initial = 'CARD PACK\nLoading…'
  const even = await connectEvenRuntime(initial)

  // Adapter: wrap EvenRuntime's storage methods to match the platform's
  // BridgeStorageRuntime contract (getStorage returns string|null).
  const bridge = even ? {
    async getStorage(key: string): Promise<string | null> { return even.getStorage(key) },
    async setStorage(key: string, value: string): Promise<void> { await even.setStorage(key, value) },
  } : null

  // State-log emission for the regression harness. Format:
  //   [cardpack:state] view=launcher
  //   [cardpack:state] view=hearts
  // Matches the pattern used by Hands Free Lift / Hearts / Spades —
  // scripts/regression.mjs polls the simulator's /api/console and asserts
  // against these lines.
  let lastState = ''
  function emitState(): void {
    const v = runtime.currentGameId() ?? 'launcher'
    const next = `view=${v}`
    if (next === lastState) return
    lastState = next
    // eslint-disable-next-line no-console
    console.log(`[cardpack:state] ${next}`)
  }

  const runtime = new Runtime({
    games: [heartsGame, euchreGame],
    bridge,
    packName: 'CARD PACK',
    difficulty: initialDifficulty,
    onRender: frame => {
      if (even) void even.render(frame)
      emitState()
      updateRulesPanel()
    },
  })

  /** Refresh the "How to play" disclosure to match the currently-cursored
   *  (in launcher) or active (in game) module. v0.1.x has only Hearts;
   *  when Spades/Euchre/etc land in Phase B+, this picks the right one
   *  based on `runtime.currentGameId()` ?? cursored game.
   *
   *  Per-game rules come from each Game module's optional
   *  renderPhoneRules() — static HTML, lives on Game (not GameHandle). */
  const REGISTERED_GAMES = [heartsGame, euchreGame]
  function updateRulesPanel(): void {
    const activeId = runtime.currentGameId()
    const game = REGISTERED_GAMES.find(g => g.id === activeId) ?? REGISTERED_GAMES[0]
    rulesBody.innerHTML = game?.renderPhoneRules?.() ?? '<p>No rules available.</p>'
  }

  await runtime.init()
  statusEl.textContent = even ? 'Glasses connected.' : 'Browser preview — no glasses bridge.'

  if (even) {
    // Forward gestures.
    even.onTap(_src => { runtime.handleGesture({ kind: 'tap' }) })
    even.onDoubleTap(_src => { runtime.handleGesture({ kind: 'double-tap' }) })
    even.onSwipe((dir, _src) => {
      runtime.handleGesture({ kind: dir === 'up' ? 'swipe-up' : 'swipe-down' })
    })
    even.onForeground(() => { runtime.render() })
  }

  // Phone-side buttons.
  newGameBtn.addEventListener('click', () => { runtime.handlePhoneEvent({ kind: 'new-game' }) })
  endGameBtn.addEventListener('click', () => { runtime.exitToMenu() })

  // Difficulty selector: persists in localStorage, takes effect immediately
  // (AI is stateless — no need to restart the hand). v0.1.8.
  difficultySelect.addEventListener('change', () => {
    const value = difficultySelect.value
    if (value === 'easy' || value === 'medium' || value === 'hard') {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, value)
      runtime.handlePhoneEvent({ kind: 'set-difficulty', payload: value })
    }
  })

  // Dev-console handle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__cardpack = { runtime, even }
}

void bootstrap().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[card-pack] bootstrap failed:', err?.message ?? err)
  statusEl.textContent = `Bootstrap error: ${err?.message ?? err}`
})

// Suppress unused-import warning until phone-side game list lands.
void ({} as GlassesGesture | undefined)
