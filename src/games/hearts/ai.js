// Hearts AI. Three difficulty tiers — Easy / Medium / Hard.
// Pure functions of GameState — no internal state, no mutation.
//
// Easy   : random legal play.
// Medium : avoid taking points: when leading, lead low; when following,
//          if forced to take the trick (only matching cards win),
//          play minimum; when off-suit, dump high spades or queen first
//          to "give them" to opponents.
// Hard   : Medium + sticky-Q awareness — when QS is still out, try to
//          force someone else to play it by leading high spades early
//          if you have spade length.
import { isPointCard, legalPlays, playCard, } from './engine';
export const DEFAULT_DIFFICULTY = 'medium';
const RANK_VAL = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, J: 11, Q: 12, K: 13, A: 14,
};
function rankOf(c) {
    return RANK_VAL[c.rank] ?? 0;
}
export function aiPlay(state, pos, difficulty = DEFAULT_DIFFICULTY) {
    const legal = legalPlays(state, pos);
    if (legal.length === 1)
        return legal[0];
    if (difficulty === 'easy')
        return legal[Math.floor(Math.random() * legal.length)];
    const leadSuit = state.trick.leadSuit;
    const isLeading = leadSuit === null;
    if (isLeading) {
        // Lead low. Hard: if QS still out and we have ≥4 spades + low spades,
        // lead a low spade to bleed-out high spades.
        if (difficulty === 'hard') {
            const spadesInHand = legal.filter(c => c.suit === '♠');
            const queenStillOut = state.handPoints.S === 0 && state.handPoints.W === 0 && state.handPoints.N === 0 && state.handPoints.E === 0
                ? false // simplified: only meaningful early; safer to skip
                : !state.trick.plays.some(p => p.card.suit === '♠' && p.card.rank === 'Q');
            if (spadesInHand.length >= 4 && !queenStillOut) {
                const lowSpade = spadesInHand.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
                return lowSpade;
            }
        }
        // Default: lead lowest non-heart non-queen.
        const safe = legal.filter(c => !isPointCard(c));
        const pool = safe.length > 0 ? safe : legal;
        return pool.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
    }
    // Following.
    const matching = legal.filter(c => c.suit === leadSuit);
    // Find current trick leader card.
    const onLead = state.trick.plays.filter(p => p.card.suit === leadSuit);
    const bestLeadRank = onLead.reduce((m, p) => Math.max(m, rankOf(p.card)), 0);
    const trickHasPoints = state.trick.plays.some(p => isPointCard(p.card));
    if (matching.length > 0) {
        // We must follow suit. If we can lose (play below current best),
        // do it — minimum-losing card.
        const losers = matching.filter(c => rankOf(c) < bestLeadRank);
        if (losers.length > 0) {
            // Play highest loser (preserves low cards for later).
            return losers.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
        }
        // Forced to take it: play minimum that wins.
        return matching.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
    }
    // Off-suit dump.
    // Priority: dump QS if we have it, then high hearts, then high spades
    // (above Q-rank, since they could be forced to take QS later), then
    // high anything.
    const qs = legal.find(c => c.suit === '♠' && c.rank === 'Q');
    if (qs && trickHasPoints === false) {
        // Wait — if trick has no points yet, QS is hugely costly to whoever wins.
        // Dumping it is the right move (off-suit means we won't take it back).
        return qs;
    }
    if (qs)
        return qs; // dump it regardless when off-suit
    const hearts = legal.filter(c => c.suit === '♥');
    if (hearts.length > 0) {
        return hearts.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
    }
    // High spades above Q-rank (K, A) are dangerous — dump them.
    const highSpades = legal.filter(c => c.suit === '♠' && rankOf(c) > rankOf({ suit: '♠', rank: 'Q' }));
    if (highSpades.length > 0) {
        return highSpades.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
    }
    // Otherwise dump highest of any suit.
    return legal.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
}
/** Apply ONE AI play action. Caller ensures it isn't the human's turn. */
export function applyOneAiStep(state, difficulty = DEFAULT_DIFFICULTY) {
    if (state.phase !== 'play')
        return state;
    const card = aiPlay(state, state.turn, difficulty);
    return playCard(state, state.turn, card);
}
/** Run AI turns until human's turn or hand/game ends. */
export function autoplayUntilHuman(state, human = 'S', difficulty = DEFAULT_DIFFICULTY) {
    let s = state;
    for (let i = 0; i < 60; i++) {
        if (s.phase !== 'play')
            return s;
        if (s.turn === human)
            return s;
        s = applyOneAiStep(s, difficulty);
    }
    return s;
}
