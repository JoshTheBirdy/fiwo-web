/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/deck.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* deck.js — turning the content bundle into a study queue.
 *
 * Pure: no DOM, no storage. Imported by study.js and by the tests.
 *
 * THE ONE STRUCTURAL DECISION (Fiwo app.md Q9). Categories are FILTERS over a
 * single card pool, not separate decks. Every card has exactly one FSRS history
 * whether you meet it under "Verbs", under "Tier 1", or from a story. Separate
 * decks would mean the same word arriving on two different days with two
 * different intervals — the precise failure FSRS exists to prevent.
 */

// Local day, shared with stats.js. Using UTC here and local there would mean a
// late-night session counted against yesterday's new-card budget while still
// extending today's streak.
import { dayKey } from './stats.js';

export const CARD_TYPES = { RECOGNITION: 'word', PRODUCTION: 'production', SENTENCE: 'sentence' };

export const DEFAULT_STUDY_SETTINGS = {
  /* 30, not the 80 this started with. 80 was Josh's own Fiwo-Study setting,
   * carried over as the default — but a default is what a NEW learner meets,
   * and 80 new cards is a first session of roughly forty minutes before a
   * single one comes back for review. Both surfaces keep the number editable,
   * and anyone who has already set their own is unaffected: the app reads it
   * from settings.json and the website from `deck.newPerDay`. */
  newCardsPerDay: 30,
  production: true,        // English → Fiwo. Q11: on, with a real off switch
  sentences: false,        // Q12: included but not uninvited
};

/**
 * Flatten the bundle into study cards.
 *
 * Each word yields TWO cards sharing one audio recording but keeping separate
 * FSRS histories — recognition is the easy direction, production is the one
 * that fails when you try to speak.
 */
/* Tiers 0 and 1 are ONE band; 2 and 3 follow it in order.
 *
 * They used to be four separate bands, strictly ordered, which meant every one
 * of the 135 grammar-core words — all 270 of their cards — arrived before a
 * single content word. Josh's report, and it is right: the affixes and
 * particles are the hardest thing in the language to hold on to in isolation,
 * because there is nothing to use them ON. `-dyq` means nothing until there is
 * a verb to put it on.
 *
 * Mixing them also brings the deck CLOSER to the course rather than further
 * from it: the workbook introduces grammar and vocabulary together, lesson by
 * lesson, and has since v4. */
const BAND = { 0: 0, 1: 0, 2: 1, 3: 2 };

export function buildCards(content) {
  const cards = [];

  /* `rank` restarts at 1 inside each tier, so it cannot order two tiers against
   * each other — grammar rank 1 and core rank 1 are both "first". Dividing by
   * the tier's own size turns it into a position from 0 to 1, which interleaves
   * the two IN PROPORTION to how many of each there are: 135 grammar against
   * 328 core comes out at roughly one affix per two-and-a-half words, all the
   * way down. No ratio is hard-coded and it re-balances itself if either tier
   * grows. */
  const tierMax = {};
  for (const w of content.words) {
    if (w.tier == null || w.rank == null) continue;
    tierMax[w.tier] = Math.max(tierMax[w.tier] ?? 0, w.rank);
  }

  for (const w of content.words) {
    const common = {
      pos: w.pos, tier: w.tier, rank: w.rank, set: w.deck,
      band: BAND[w.tier] ?? 3,
      order: (w.rank != null && tierMax[w.tier]) ? w.rank / tierMax[w.tier] : 1,
      audioId: w.id, audioText: w.word,
    };
    cards.push({
      id: w.id, type: CARD_TYPES.RECOGNITION,
      front: w.word, back: w.english, note: w.def,
      speak: w.word, frontIsFiwo: true, ...common,
    });
    cards.push({
      id: w.prodId, type: CARD_TYPES.PRODUCTION,
      front: w.english, back: w.word, note: w.def,
      // Audio must never play on a production FRONT — the front is the English
      // prompt, so speaking the Fiwo would hand over the answer (Fiwo-Study
      // README). Hence frontIsFiwo: false, checked by the player in phase 7.
      speak: w.word, frontIsFiwo: false, ...common,
    });
  }

  for (const s of content.sentences) {
    cards.push({
      id: s.id, type: CARD_TYPES.SENTENCE,
      front: s.fiwo, back: s.english, note: (s.notes || [])[0] || null,
      speak: s.fiwo, frontIsFiwo: true,
      pos: null, tier: null, rank: null, set: 'sentences',
      // Last, behind every word: a sentence is only useful once its words are.
      band: 3, order: 1,
      audioId: s.id, audioText: s.fiwo,
    });
  }

  return cards;
}

/** Does this card pass the picker's filters and the type toggles? */
export function inScope(card, filters, settings) {
  if (card.type === CARD_TYPES.SENTENCE) {
    // Sentences have no tier or part of speech, so the content filters cannot
    // apply to them. They are in or out purely by their own toggle.
    return Boolean(settings.sentences);
  }
  if (card.type === CARD_TYPES.PRODUCTION && !settings.production) return false;

  if (filters.pos?.length && !filters.pos.includes(card.pos)) return false;
  if (filters.tiers?.length && !filters.tiers.includes(card.tier)) return false;
  if (filters.set && filters.set !== 'all' && card.set !== filters.set) return false;

  // The "story" tag (Q10/Q18): set when a word is added from the reader. It
  // lives on the PROGRESS entry, not on content — a tag is something you did,
  // not something the language says — so the caller passes the tag lookup in.
  // Both cards of a word match, since the tag is stored against the recognition
  // card and production shares its audioId.
  if (filters.tags?.length) {
    const tags = filters.tagsFor?.(card) || [];
    if (!filters.tags.some(t => tags.includes(t))) return false;
  }
  return true;
}


/* Fisher-Yates. Takes an rng so tests can be deterministic. */
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a session queue: everything due, plus new cards up to the daily limit,
 * PRESENTED IN RANDOM ORDER.
 *
 * Selection and presentation are two different questions, and only the first
 * has a right answer:
 *
 *   WHICH new cards — band → position, the canon's own learning order (Todo
 *   7.1), so the deck never runs ahead of the course even when the filters
 *   would let it. Randomising this would hand out tier-3 long-tail words before
 *   the core. Grammar core and core share a band and interleave — see BAND.
 *
 *   WHAT ORDER they arrive in — shuffled. Insertion order means alphabetical
 *   neighbours and same-root derivations arrive together, so you answer from
 *   the last card's context rather than from memory. Due cards are shuffled in
 *   with the new ones for the same reason: a fixed by-due-date order replays
 *   the same sequence every session.
 */
export function buildQueue(cards, progress, filters, settings, now = new Date(), rng = Math.random) {
  const due = [];
  const fresh = [];
  const today = dayKey(now);
  let introducedToday = 0;

  for (const entry of Object.values(progress.cards)) {
    if (entry.firstSeen === today) introducedToday++;
  }

  for (const card of cards) {
    if (!inScope(card, filters, settings)) continue;
    const entry = progress.cards[card.id];
    if (!entry || !entry.fsrs) { fresh.push(card); continue; }
    if (entry.orphaned) continue;
    const dueAt = new Date(entry.fsrs.due);
    // An unparseable due date compares false against everything, which would
    // silently retire the card from study forever. Treat it as due now so it
    // gets rescheduled on the next grade.
    if (!Number.isFinite(dueAt.getTime())) { due.push({ card, due: now }); continue; }
    if (dueAt <= now) due.push({ card, due: dueAt });
  }

  // Oldest-due first, and band → position for new: these orders decide WHICH
  // cards make the cut, which is a pedagogical question.
  due.sort((a, b) => a.due - b.due);
  fresh.sort((a, b) =>
    (a.band ?? 3) - (b.band ?? 3) ||
    (a.order ?? 1) - (b.order ?? 1) ||
    (a.rank ?? 1e9) - (b.rank ?? 1e9) ||
    a.front.localeCompare(b.front));

  const allowance = Math.max(0, (settings.newCardsPerDay ?? 0) - introducedToday);
  const selected = [...due.map(d => d.card), ...fresh.slice(0, allowance)];

  return {
    // …and then shuffled, which is a memory question. Selection above is
    // untouched, so the daily limit and the learning order still hold.
    queue: shuffle(selected, rng),
    dueCount: due.length,
    newCount: Math.min(fresh.length, allowance),
    newAvailable: fresh.length,
    introducedToday,
  };
}

/** Counts for the category picker, so each chip can show what it is worth. */
export function countBy(cards, progress, filters, settings, now = new Date()) {
  const { dueCount, newCount } = buildQueue(cards, progress, filters, settings, now);
  return { due: dueCount, fresh: newCount };
}

/**
 * Record a grade. Returns a NEW progress object — never mutates.
 *
 * The `reviews` log is append-only and is what the phase 6 dashboard's heatmap
 * and streak are computed from; it is also the only human-readable trace of
 * what actually happened, since the FSRS card itself only holds current state.
 * Shape matches Fiwo-Study's exactly, so an imported history and a new one are
 * indistinguishable.
 */
export function gradeCard(progress, card, fsrsCard, rating, now = new Date()) {
  const prev = progress.cards[card.id];
  const entry = {
    fsrs: fsrsCard,
    orphaned: false,
    firstSeen: prev?.firstSeen || dayKey(now),
    reviews: [...(prev?.reviews || []), { at: now.toISOString(), rating }],
  };
  return {
    ...progress,
    cards: { ...progress.cards, [card.id]: entry },
  };
}
