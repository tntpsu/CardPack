// Card Pack entry point. Wires the Even Hub bridge to the platform
// Runtime, registers each game module, and renders the launcher.
//
// Phase A: Hearts is the only registered game (reference module). Spades,
// Euchre, Solitaire, Crazy Eights, Cribbage, Gin Rummy land in Phase B+.
import { Runtime } from 'even-card-platform';
import { heartsGame } from './games/hearts';
const bridge = null; // wired in Phase A.7
// ─── Phone DOM ────────────────────────────────────────────────────────
const root = document.querySelector('#app');
if (!root)
    throw new Error('App root missing');
root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323; overflow-x: hidden;">
    <h1 style="margin: 0 0 .25rem 0;">Card Pack <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1rem 0;">Seven classic card games. One tap to play.</p>
    <p id="status" style="margin: 0 0 1rem 0;">Loading…</p>

    <section style="background: #f5f5f5; padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1rem;">
      <h3 style="font-size: 1em; margin: 0 0 .5rem 0;">Glasses display</h3>
      <pre id="glasses-mirror" style="font-family: ui-monospace, monospace; margin: 0; white-space: pre-wrap; font-size: .85em;"></pre>
    </section>

    <section>
      <h2 style="font-size: 1.1em; margin: 1rem 0 .5rem 0;">Games (Phase A: Hearts only)</h2>
      <ul style="line-height: 1.6; color: #555;">
        <li><strong>Hearts</strong> — avoid hearts (1 pt each) and Q♠ (13 pts). Lowest score wins.</li>
      </ul>
      <p style="color:#7b7b7b;font-size:.9em;">Spades, Euchre, Solitaire, Crazy Eights, Cribbage, Gin Rummy land in Phase B+.</p>
    </section>
  </main>
`;
const statusEl = document.querySelector('#status');
const glassesMirror = document.querySelector('#glasses-mirror');
// ─── Runtime ──────────────────────────────────────────────────────────
const runtime = new Runtime({
    games: [heartsGame],
    bridge,
    packName: 'CARD PACK',
    difficulty: 'medium',
    onRender: frame => {
        // Mirror to the phone for debugging until bridge.render is wired.
        glassesMirror.textContent = frame;
    },
});
void (async () => {
    await runtime.init();
    statusEl.textContent = bridge
        ? 'Glasses connected.'
        : 'Browser preview (no bridge). Phone-side controls coming.';
})();
window.__cardpack = { runtime, games: [heartsGame] };
