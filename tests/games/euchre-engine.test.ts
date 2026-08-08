// Mirror of ~/Documents/Euchre/tests/ — runs against CardPack's OWN engine
// copy (src/games/euchre/) so an edit here is caught by `npm test`, not only
// by the sibling repo. Keep in sync if the engine changes.
// Unit tests for the pure Euchre game engine.

import { describe, expect, it } from 'vitest'
import {
  callTrump,
  cardStrength,
  deal,
  effectiveSuit,
  legalPlays,
  newDeck,
  newGame,
  nextPosition,
  orderUp,
  passBid,
  playCard,
  positionsAfter,
  sameColorSuit,
  shuffle,
  startNewHand,
  teamOf,
  trickWinner,
  type Card,
  type GameState,
} from '../../src/games/euchre/engine'

// Deterministic RNG factory for reproducible deals.
function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000
    return s / 0x100000000
  }
}

describe('deck + deal', () => {
  it('newDeck returns 24 unique cards', () => {
    const d = newDeck()
    expect(d).toHaveLength(24)
    const ids = new Set(d.map(c => `${c.rank}${c.suit}`))
    expect(ids.size).toBe(24)
  })
  it('deal hands out 5 cards each + an upcard + 3 in kitty', () => {
    const d = shuffle(newDeck(), seededRng(1))
    const r = deal(d, 'S')
    expect(r.hands.S).toHaveLength(5)
    expect(r.hands.W).toHaveLength(5)
    expect(r.hands.N).toHaveLength(5)
    expect(r.hands.E).toHaveLength(5)
    expect(r.upCard).toBeDefined()
    expect(r.kitty).toHaveLength(3)
  })
  it('deal throws on non-24-card deck', () => {
    expect(() => deal(newDeck().slice(0, 23), 'S')).toThrow()
  })
})

describe('positions + teams', () => {
  it('clockwise rotation', () => {
    expect(nextPosition('S')).toBe('W')
    expect(nextPosition('W')).toBe('N')
    expect(nextPosition('N')).toBe('E')
    expect(nextPosition('E')).toBe('S')
  })
  it('positionsAfter returns 4 in order', () => {
    expect(positionsAfter('S')).toEqual(['W', 'N', 'E', 'S'])
  })
  it('teamOf maps S/N → NS, W/E → EW', () => {
    expect(teamOf('S')).toBe('NS')
    expect(teamOf('N')).toBe('NS')
    expect(teamOf('W')).toBe('EW')
    expect(teamOf('E')).toBe('EW')
  })
})

describe('bowers + trump strength', () => {
  it('right bower beats left bower', () => {
    const right: Card = { suit: '♠', rank: 'J' }
    const left: Card = { suit: '♣', rank: 'J' }  // same color as ♠
    expect(cardStrength(right, '♠', '♠')).toBeGreaterThan(cardStrength(left, '♠', '♠'))
  })
  it('left bower beats trump A', () => {
    const left: Card = { suit: '♣', rank: 'J' }
    const trumpA: Card = { suit: '♠', rank: 'A' }
    expect(cardStrength(left, '♠', '♠')).toBeGreaterThan(cardStrength(trumpA, '♠', '♠'))
  })
  it('any trump beats any non-trump even of same lead suit', () => {
    const trump9: Card = { suit: '♠', rank: '9' }
    const leadA: Card = { suit: '♥', rank: 'A' }
    expect(cardStrength(trump9, '♠', '♥')).toBeGreaterThan(cardStrength(leadA, '♠', '♥'))
  })
  it('lead suit beats off-suit', () => {
    const leadA: Card = { suit: '♥', rank: 'A' }
    const offsuitK: Card = { suit: '♦', rank: 'K' }
    expect(cardStrength(leadA, '♠', '♥')).toBeGreaterThan(cardStrength(offsuitK, '♠', '♥'))
  })
  it('left bower is treated as the trump suit for follow-suit purposes', () => {
    const leftBower: Card = { suit: '♣', rank: 'J' }
    expect(effectiveSuit(leftBower, '♠')).toBe('♠')
  })
  it('jack of NON-same-color is NOT a bower', () => {
    const jack: Card = { suit: '♥', rank: 'J' }
    // ♥ is not same-color as ♠ (red vs black), so this J is not a left bower
    expect(effectiveSuit(jack, '♠')).toBe('♥')
  })
  it('sameColorSuit pairs up correctly', () => {
    expect(sameColorSuit('♠')).toBe('♣')
    expect(sameColorSuit('♣')).toBe('♠')
    expect(sameColorSuit('♥')).toBe('♦')
    expect(sameColorSuit('♦')).toBe('♥')
  })
})

describe('trickWinner', () => {
  it('picks the strongest follower of lead suit when no trump played', () => {
    const trick = {
      plays: [
        { pos: 'S' as const, card: { suit: '♥' as const, rank: '10' as const } },
        { pos: 'W' as const, card: { suit: '♥' as const, rank: 'A' as const } },
        { pos: 'N' as const, card: { suit: '♦' as const, rank: 'K' as const } },
        { pos: 'E' as const, card: { suit: '♥' as const, rank: 'Q' as const } },
      ],
      leadSuit: '♥' as const,
    }
    expect(trickWinner(trick, '♣')).toBe('W')
  })
  it('trumps beat lead suit', () => {
    const trick = {
      plays: [
        { pos: 'S' as const, card: { suit: '♥' as const, rank: 'A' as const } },
        { pos: 'W' as const, card: { suit: '♣' as const, rank: '9' as const } }, // trumped
        { pos: 'N' as const, card: { suit: '♥' as const, rank: 'K' as const } },
        { pos: 'E' as const, card: { suit: '♥' as const, rank: 'Q' as const } },
      ],
      leadSuit: '♥' as const,
    }
    expect(trickWinner(trick, '♣')).toBe('W')
  })
  it('right bower wins over any other trump', () => {
    const trick = {
      plays: [
        { pos: 'S' as const, card: { suit: '♣' as const, rank: 'A' as const } }, // trump A
        { pos: 'W' as const, card: { suit: '♣' as const, rank: 'J' as const } }, // right bower
        { pos: 'N' as const, card: { suit: '♠' as const, rank: 'J' as const } }, // left bower
        { pos: 'E' as const, card: { suit: '♣' as const, rank: 'K' as const } }, // trump K
      ],
      leadSuit: '♣' as const,
    }
    expect(trickWinner(trick, '♣')).toBe('W')
  })
})

describe('legal plays — must follow suit', () => {
  it('forces lead-suit follow when possible', () => {
    const state: Partial<GameState> = {
      hands: {
        S: [{ suit: '♥', rank: 'A' }, { suit: '♥', rank: 'K' }, { suit: '♦', rank: '9' }],
        W: [], N: [], E: [],
      },
      trump: '♣',
      trick: {
        plays: [{ pos: 'W', card: { suit: '♥', rank: '9' } }],
        leadSuit: '♥',
      },
    }
    const legal = legalPlays(state as GameState, 'S')
    expect(legal).toHaveLength(2)
    expect(legal.every(c => c.suit === '♥')).toBe(true)
  })
  it('allows any card when player is void in lead suit', () => {
    const state: Partial<GameState> = {
      hands: {
        S: [{ suit: '♣', rank: 'A' }, { suit: '♦', rank: '9' }],
        W: [], N: [], E: [],
      },
      trump: '♣',
      trick: {
        plays: [{ pos: 'W', card: { suit: '♥', rank: '9' } }],
        leadSuit: '♥',
      },
    }
    const legal = legalPlays(state as GameState, 'S')
    expect(legal).toHaveLength(2)
  })
  it('treats left bower as trump for follow-suit', () => {
    // Lead is trump (♣). Left bower is J♠ (same color). Player has the
    // left bower + a non-trump — must play the left bower.
    const state: Partial<GameState> = {
      hands: {
        S: [{ suit: '♠', rank: 'J' }, { suit: '♥', rank: 'A' }],
        W: [], N: [], E: [],
      },
      trump: '♣',
      trick: {
        plays: [{ pos: 'W', card: { suit: '♣', rank: '9' } }],
        leadSuit: '♣',
      },
    }
    const legal = legalPlays(state as GameState, 'S')
    expect(legal).toHaveLength(1)
    expect(legal[0]!.suit).toBe('♠')
    expect(legal[0]!.rank).toBe('J')
  })
})

describe('newGame + bidding', () => {
  it('newGame deals out 5/5/5/5 + sets phase to order-up', () => {
    const g = newGame(seededRng(42))
    expect(g.phase).toBe('order-up')
    expect(g.hands.S).toHaveLength(5)
    expect(g.dealer).toBe('S')
    expect(g.turn).toBe('W')  // dealer's left
    expect(g.bidRound).toBe(1)
  })

  it('orderUp sets trump + maker + transitions to play', () => {
    const g0 = newGame(seededRng(7))
    // Make S the dealer's hand have a known card we can discard.
    const upCard = g0.upCard
    const dealerHand = g0.hands[g0.dealer]
    const discard = dealerHand[0]! // any card to discard
    const g1 = orderUp(g0, discard)
    expect(g1.trump).toBe(upCard.suit)
    expect(g1.maker).toBe(g0.turn)
    expect(g1.phase).toBe('play')
    expect(g1.turn).toBe('W') // dealer's left leads (dealer is S)
  })

  it('passing 4 times moves to round 2', () => {
    let g = newGame(seededRng(11))
    g = passBid(g) // W passes
    g = passBid(g) // N passes
    g = passBid(g) // E passes
    g = passBid(g) // S (dealer) passes — moves to round 2
    expect(g.bidRound).toBe(2)
    expect(g.phase).toBe('call-trump')
    expect(g.passes).toBe(0)
    expect(g.forbiddenTrumpRound2).toBe(g.upCard.suit)
  })

  it('callTrump rejects the upcard suit in round 2', () => {
    let g = newGame(seededRng(13))
    g = passBid(g); g = passBid(g); g = passBid(g); g = passBid(g)
    expect(() => callTrump(g, g.upCard.suit)).toThrow()
  })
})

describe('full hand flow with seeded deal', () => {
  it('runs a full hand to scoring', () => {
    let g = newGame(seededRng(99))
    // Force the simplest path: dealer (S) orders up.
    // First pass through bidding — let everyone pass except a synthetic
    // path: order-up by S directly via the engine.
    g = passBid(g); g = passBid(g); g = passBid(g) // W,N,E pass
    // S as dealer must order or pass — we order
    const dealerHand = g.hands[g.dealer]
    const handPlusUp = [...dealerHand, g.upCard]
    const discard = handPlusUp[0]!
    g = orderUp(g, discard)
    expect(g.phase).toBe('play')
    expect(g.trump).toBe(g.upCard.suit)
    // Play out the hand by always playing the first legal card per turn
    let safety = 50
    while (g.phase === 'play' && safety-- > 0) {
      const legal = legalPlays(g, g.turn)
      g = playCard(g, g.turn, legal[0]!)
    }
    expect(g.phase === 'hand-end' || g.phase === 'game-end').toBe(true)
    // Total tricks should be 5
    expect(g.tricks.NS + g.tricks.EW).toBe(5)
    // Some team got points
    expect(g.score.NS + g.score.EW).toBeGreaterThan(0)
  })
})

describe('startNewHand rotates dealer + reshuffles', () => {
  it('rotates dealer clockwise after hand-end', () => {
    const g = { ...newGame(seededRng(1)), phase: 'hand-end' as const }
    const next = startNewHand(g, seededRng(2))
    expect(next.dealer).toBe(nextPosition(g.dealer))
    expect(next.tricks.NS + next.tricks.EW).toBe(0)
    expect(next.bidRound).toBe(1)
    expect(next.phase).toBe('order-up')
  })
})
