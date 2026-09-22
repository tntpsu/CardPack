// Guards store-listing.json against drifting from the build it describes.
//
// Exists because the listing shipped for months saying "seven classic card
// games", describing Solitaire (which is not in the pack), omitting Oh Hell
// and Bridge, and citing three screenshot files that did not exist. Nothing
// flagged any of it; a human noticed while filling the store page.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Game } from 'even-card-platform'

const ROOT = resolve(__dirname, '..')
const listing = JSON.parse(readFileSync(resolve(ROOT, 'store-listing.json'), 'utf8'))
const mainTs = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8')

// Every game module, keyed by its export name, via the same source tree main.ts imports.
const modules = import.meta.glob<Record<string, Game>>('../src/games/*/index.ts', { eager: true })
const byExport = new Map<string, Game>()
for (const mod of Object.values(modules)) {
  for (const [k, v] of Object.entries(mod)) if (k.endsWith('Game') && v && typeof v === 'object' && 'name' in v) byExport.set(k, v)
}

/** The games main.ts actually registers with the Runtime, in order. */
function registeredGames(): Game[] {
  const m = /games:\s*\[([^\]]+)\]/.exec(mainTs)
  if (!m) throw new Error('could not find `games: [...]` in src/main.ts')
  return m[1].split(',').map(s => s.trim()).filter(Boolean).map(id => {
    const g = byExport.get(id)
    if (!g) throw new Error(`main.ts registers ${id} but no src/games/*/index.ts exports it`)
    return g
  })
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const CATEGORIES = ['AI', 'Lifestyle', 'Productivity', 'Health', 'Entertainment', 'Education', 'Music', 'Travel', 'Utilities']

function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path)
  expect(b.subarray(0, 8).toString('hex'), `${path} is not a PNG`).toBe('89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('store-listing.json matches the build', () => {
  const games = registeredGames()

  it('registers the games this test expects to find (sanity)', () => {
    expect(games.length).toBeGreaterThanOrEqual(2)
  })

  it('names every registered game in the description', () => {
    const desc = listing.description.toLowerCase()
    const missing = games.map(g => g.name).filter(n => !desc.includes(n.toLowerCase()))
    expect(missing, 'games in main.ts the description never mentions').toEqual([])
  })

  it('states the right number of games in the tagline', () => {
    const word = NUMBER_WORDS[games.length]
    expect(listing.tagline.toLowerCase(), `tagline should say "${word}" games`).toContain(word)
  })

  it('does not describe games that are not in the pack', () => {
    // Solitaire ships standalone (see the main.ts header); it kept creeping in.
    expect(listing.description.toLowerCase()).not.toContain('solitaire')
  })

  it('stays inside the portal field limits', () => {
    expect(listing.name.length).toBeLessThanOrEqual(20)
    expect(listing.tagline.length).toBeLessThanOrEqual(50)
    expect(listing.description.length).toBeLessThanOrEqual(2000)
    expect(listing.tags.length).toBeLessThanOrEqual(5)
    for (const t of listing.tags) expect(t.length, `tag "${t}"`).toBeLessThanOrEqual(20)
    expect(CATEGORIES).toContain(listing.category)
    // Plain text only: markdown renders literally on the portal.
    expect(listing.description).not.toMatch(/\*\*|^- /m)
  })

  it('cites screenshots that exist and are exactly 576x288', () => {
    expect(listing.screenshots.length).toBeGreaterThan(0)
    for (const rel of listing.screenshots) {
      const p = resolve(ROOT, rel)
      expect(existsSync(p), `${rel} is listed but missing`).toBe(true)
      expect(pngSize(p), rel).toEqual({ w: 576, h: 288 })
    }
    expect(listing.cover_screenshot_index).toBeGreaterThanOrEqual(0)
    expect(listing.cover_screenshot_index).toBeLessThan(listing.screenshots.length)
  })
})
