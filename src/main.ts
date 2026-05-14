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

declare const __APP_VERSION__: string

// ─── Phone DOM ────────────────────────────────────────────────────────

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323; overflow-x: hidden;">
    <h1 style="margin: 0 0 .25rem 0;">Card Pack <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1rem 0;">Seven classic card games. One tap to play.</p>
    <p id="status" style="margin: 0 0 1rem 0;">Connecting…</p>

    <section style="background: #f5f5f5; padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1rem;">
      <h3 style="font-size: 1em; margin: 0 0 .5rem 0;">Now (mirror)</h3>
      <pre id="glasses-mirror" style="font-family: ui-monospace, monospace; margin: 0; white-space: pre-wrap; font-size: .85em;"></pre>
    </section>

    <section style="margin-top: 1rem;">
      <h2 style="font-size: 1.1em; margin: 1rem 0 .5rem 0;">Glasses controls</h2>
      <ul style="line-height: 1.6; color: #555;">
        <li><strong>Launcher</strong>: swipe up/down to choose a game, tap to launch.</li>
        <li><strong>Hearts</strong> (in-game): swipe up/down moves the hand cursor, tap plays the card, double-tap continues at end-of-hand / returns to menu at game-end.</li>
        <li><strong>Swipe down twice</strong> to exit the app from the Even Hub launcher view.</li>
      </ul>
    </section>

    <section style="margin-top: 1rem;">
      <button id="new-game" type="button" style="padding:.5rem 1rem;cursor:pointer;max-width:100%;box-sizing:border-box;">New Hearts game</button>
      <button id="end-game" type="button" style="padding:.5rem 1rem;cursor:pointer;margin-left:.5rem;max-width:100%;box-sizing:border-box;">End game (back to menu)</button>
    </section>

    <section style="margin-top: 1rem;">
      <h2 style="font-size: 1.1em; margin: 1rem 0 .5rem 0;">Games</h2>
      <p style="color:#555;">Phase A: Hearts only. Spades, Euchre, Solitaire, Crazy Eights, Cribbage, Gin Rummy land in Phase B+.</p>
    </section>
  </main>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const glassesMirror = document.querySelector<HTMLPreElement>('#glasses-mirror')!
const newGameBtn = document.querySelector<HTMLButtonElement>('#new-game')!
const endGameBtn = document.querySelector<HTMLButtonElement>('#end-game')!

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
    games: [heartsGame],
    bridge,
    packName: 'CARD PACK',
    difficulty: 'medium',
    onRender: frame => {
      glassesMirror.textContent = frame
      if (even) void even.render(frame)
      emitState()
    },
  })

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
