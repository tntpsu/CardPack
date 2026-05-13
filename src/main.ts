// Card Pack — scaffold.
//
// Phase A in progress. Real launcher + Hearts module land next; this stub
// just verifies the platform import path works and the WebView template
// follows STYLE.md § 3 (max-width, overflow-x: hidden, mandatory <select>
// constraints when those land).

import type { Game } from 'even-card-platform'

declare const __APP_VERSION__: string

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('App root missing')

root.innerHTML = `
  <main style="font-family: system-ui; padding: 1rem; max-width: 720px; margin: 0 auto; color: #232323; overflow-x: hidden;">
    <h1 style="margin: 0 0 .25rem 0;">Card Pack <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v${__APP_VERSION__}</span></h1>
    <p style="color: #7b7b7b; margin: 0 0 1rem 0;">Seven classic card games. One tap to play.</p>
    <p>Phase A scaffold — not yet playable. Reference module (Hearts) lands next.</p>
  </main>
`

// Suppress "imported but unused" until the launcher actually registers games.
void ({} as Game | undefined)
