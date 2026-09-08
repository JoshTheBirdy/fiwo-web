/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/cards.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* cards.js — the update contract, as code.
 *
 * This module is deliberately pure: no DOM, no filesystem, no Capacitor. It is
 * imported unchanged by the app and by test/contract.test.mjs, so the thing that
 * protects Josh's review history is the same thing the tests exercise.
 *
 * THE CONTRACT (Fiwo app.md Part 1, "The update contract")
 *   1. Content ships in the APK. Progress never does.
 *   2. Card identity is sha1(type:fiwoText) — editing English never loses progress.
 *   3. Nothing is ever deleted. Vanished cards are flagged orphaned and kept.
 *   4. An update reports itself.
 *
 * Rule 3 is the one that needs code rather than discipline: the tempting
 * implementation of "sync progress with content" is to drop entries that no
 * longer match, which quietly destroys history the first time a word is renamed.
 */

export const PROGRESS_SCHEMA = 1;

export function emptyProgress() {
  return {
    schema: PROGRESS_SCHEMA,
    cards: {},        // cardId → { fsrs, orphaned, firstSeen, reviews }
    // Cloze is a SEPARATE track, never folded into `cards`: producing a word in
    // a sentence is a different skill from recognising it on a flashcard, and
    // sharing one history would let the easier one mask the harder one.
    cloze: {},        // clozeId → { fsrs, orphaned, kind, firstSeen, reviews }
    stories: {},      // storyId → { read, line }
    provisional: {},  // word → provisional-word record (phase 5)
    time: {},         // 'YYYY-MM-DD' → { cards, stories } in ms (timer.js)
  };
}

const validDate = (v) => v != null && Number.isFinite(new Date(v).getTime());

/**
 * Repair a progress file before anything reads it.
 *
 * progress.json lives in PUBLIC storage (Q8) — the same property that makes it
 * survive an uninstall makes it editable by anything, restorable from an old
 * backup, and writable by earlier versions of this app. So it is untrusted
 * input, and the app must not brick on it.
 *
 * This is not hypothetical: the phase 0-1 capability probe wrote real entries
 * with `reviews: [{ at: 'x' }]` and an `fsrs` object with no `due` to prove the
 * round trip worked. They survived every reinstall, and the phase 6 dashboard —
 * the first code to read `reviews[].at` — died on `new Date('x').toISOString()`
 * with "Invalid time value" before the app could paint.
 *
 * Conservative on purpose. It only removes things that are provably
 * information-free:
 *   - a review whose timestamp does not parse (it cannot be placed on any day)
 *   - an `fsrs` object with no usable `due` (it cannot be scheduled from)
 *   - an entry left with neither — that is not progress, it is noise
 *   - a day of study time that is not a usable number of milliseconds
 * A card keeps its history whenever any part of it is salvageable.
 */
export function sanitizeProgress(progress) {
  const src = progress && typeof progress === 'object' ? progress : emptyProgress();
  const repaired = { droppedReviews: 0, clearedSchedules: 0, droppedCards: 0, droppedTime: 0 };

  /* Both study tracks store the same entry shape, so they get the same repair.
   * Cloze is separate DATA, not a separate contract — a corrupt cloze history
   * would take the app down at boot exactly like a corrupt card history did. */
  function cleanTrack(store) {
    const out = {};
    for (const [id, raw] of Object.entries(store || {})) {
      const entry = raw && typeof raw === 'object' ? raw : {};

      const reviews = (Array.isArray(entry.reviews) ? entry.reviews : [])
        .filter(r => {
          const ok = r && validDate(r.at);
          if (!ok) repaired.droppedReviews++;
          return ok;
        });

      let fsrs = entry.fsrs;
      if (fsrs && !validDate(fsrs.due)) {
        // Unschedulable. Clearing it returns the card to "new" rather than
        // leaving something ts-fsrs will turn into NaN dates on the next grade.
        fsrs = undefined;
        repaired.clearedSchedules++;
      }

      if (!fsrs && !reviews.length) {
        repaired.droppedCards++;
        continue;
      }
      out[id] = { ...entry, ...(fsrs ? { fsrs } : {}), reviews };
      if (!fsrs) delete out[id].fsrs;
    }
    return out;
  }

  const cards = cleanTrack(src.cards);
  const cloze = cleanTrack(src.cloze);

  // Study time. A day is kept only if it is a real, non-negative number of ms
  // under the length of a day — anything else is not a measurement, and the
  // dashboard would render it as a confident "412h".
  const TRACKS = ['cards', 'cloze', 'stories'];
  const time = {};
  for (const [day, raw] of Object.entries(src.time || {})) {
    const v = raw && typeof raw === 'object' ? raw : {};
    const ok = (n) => Number.isFinite(n) && n >= 0 && n <= 86400000;
    const kept = {};
    let bad = false;
    for (const k of TRACKS) {
      kept[k] = ok(v[k]) ? v[k] : 0;
      if (kept[k] !== (v[k] || 0)) bad = true;
    }
    if (bad) repaired.droppedTime++;
    if (TRACKS.some(k => kept[k])) time[day] = kept;
  }

  const clean = { ...emptyProgress(), ...src, cards, cloze, time };
  const changed = repaired.droppedReviews || repaired.clearedSchedules
    || repaired.droppedCards || repaired.droppedTime;
  return { progress: clean, repaired, changed: Boolean(changed) };
}

/** Every card id the bundle can currently produce. */
export function contentCardIds(content) {
  const ids = new Set();
  for (const w of content.words) {
    ids.add(w.id);
    ids.add(w.prodId);
  }
  for (const s of content.sentences) ids.add(s.id);
  return ids;
}

export function contentStoryIds(content) {
  return new Set(content.stories.map(s => s.id));
}

/**
 * Every sentence a cloze card can be built from — corpus sentences and story
 * lines alike, both keyed by a hash of their Fiwo text.
 */
export function contentSentenceIds(content) {
  const ids = new Set(content.sentences.map(s => s.id));
  for (const st of content.stories) {
    for (const l of st.lines) if (l.id) ids.add(l.id);
  }
  return ids;
}

/**
 * `cloze_sent_ba260c84a946_3w` → `sent_ba260c84a946`.
 *
 * The sentence id is the part that carries identity: everything after the last
 * underscore is the position and kind within that sentence.
 */
export function clozeSourceId(id) {
  const body = String(id).replace(/^cloze_/, '');
  const cut = body.lastIndexOf('_');
  return cut === -1 ? body : body.slice(0, cut);
}

/**
 * Reconcile stored progress against a newly installed content bundle.
 *
 * Returns a NEW progress object plus a report the app shows after an update
 * ("14 new words · 1 new story · 0 orphaned"). Never mutates its arguments and
 * never removes a key from `cards` or `stories`.
 */
export function mergeProgress(progress, content) {
  const prev = progress && typeof progress === 'object' ? progress : emptyProgress();
  const cardIds = contentCardIds(content);
  const storyIds = contentStoryIds(content);

  const merged = {
    ...emptyProgress(),
    ...prev,
    schema: PROGRESS_SCHEMA,
    cards: { ...(prev.cards || {}) },
    // Cloze ids are derived from sentence ids, which are text hashes, so an
    // edited sentence orphans its cloze cards by the same rule as everything
    // else. Nothing is deleted here either — see the loop below.
    cloze: { ...(prev.cloze || {}) },
    stories: { ...(prev.stories || {}) },
    provisional: { ...(prev.provisional || {}) },
    // Study time is a record of your days, not of the content, so a new bundle
    // has nothing to say about it — carried straight across.
    time: { ...(prev.time || {}) },
  };

  const report = {
    contentVersion: content.version,
    newCards: 0,       // in the bundle, never yet seen — the "N new words" line
    newStories: 0,
    orphaned: 0,       // known to progress, gone from the bundle
    clozeOrphaned: 0,  // cloze cards whose sentence was edited away
    restored: 0,       // orphaned before, back in the bundle (a word un-deleted)
    kept: 0,           // progress entries carried over untouched
    reviewsPreserved: 0,
  };

  // ── Cards: flag, never delete ─────────────────────────────────────────────
  for (const [id, entry] of Object.entries(merged.cards)) {
    const gone = !cardIds.has(id);
    const wasOrphan = Boolean(entry.orphaned);
    if (gone !== wasOrphan) {
      // Copy on write — the caller's object stays untouched.
      merged.cards[id] = { ...entry, orphaned: gone };
      if (gone) report.orphaned++;
      else report.restored++;
    }
    report.kept++;
    report.reviewsPreserved += (entry.reviews || []).length;
  }

  // A card in the bundle with no progress entry is simply new. We do NOT create
  // an entry for it here: an unseen card has no state worth persisting, and
  // writing 8,000 empty records would bloat the file and blur "new" into
  // "reviewed once". The entry appears when it is first graded.
  for (const id of cardIds) {
    if (!(id in merged.cards)) report.newCards++;
  }

  // ── Cloze: same rule, judged by the sentence it came from ─────────────────
  // We cannot enumerate valid cloze ids here without the parser, and merge runs
  // at boot before any screen exists. The sentence id is enough: it is a hash of
  // the Fiwo text, so if the sentence survives unchanged, so do its blanks.
  const sentenceIds = contentSentenceIds(content);
  for (const [id, entry] of Object.entries(merged.cloze)) {
    const gone = !sentenceIds.has(clozeSourceId(id));
    if (Boolean(entry.orphaned) !== gone) {
      merged.cloze[id] = { ...entry, orphaned: gone };
      if (gone) report.clozeOrphaned++;
    }
  }

  // ── Stories: same rule ────────────────────────────────────────────────────
  for (const [id, entry] of Object.entries(merged.stories)) {
    const gone = !storyIds.has(id);
    if (Boolean(entry.orphaned) !== gone) {
      merged.stories[id] = { ...entry, orphaned: gone };
    }
  }
  for (const id of storyIds) {
    if (!(id in merged.stories)) report.newStories++;
  }

  return { progress: merged, report };
}

/** One line for the post-update toast. */
export function describeReport(r) {
  const bits = [];
  if (r.newCards) bits.push(`${r.newCards} new card${r.newCards === 1 ? '' : 's'}`);
  if (r.newStories) bits.push(`${r.newStories} new stor${r.newStories === 1 ? 'y' : 'ies'}`);
  if (r.restored) bits.push(`${r.restored} restored`);
  bits.push(`${r.orphaned} orphaned`);
  return bits.join(' · ');
}

/**
 * Fold a Fiwo-Study progress.json into app progress (Q6, the one-time import).
 *
 * Its shape is `{ version, cards: { id → { fsrs, orphaned, firstSeen, reviews } } }`
 * and the ids are computed with the same scheme, so this is a key-for-key copy.
 * Existing app entries win: importing twice must never roll back newer reviews.
 */
export function importStudyProgress(progress, studyJson) {
  const merged = { ...progress, cards: { ...progress.cards } };
  let imported = 0;
  let skipped = 0;

  for (const [id, entry] of Object.entries(studyJson.cards || {})) {
    if (id in merged.cards) { skipped++; continue; }
    merged.cards[id] = {
      fsrs: entry.fsrs,
      orphaned: Boolean(entry.orphaned),
      firstSeen: entry.firstSeen || null,
      reviews: entry.reviews || [],
    };
    imported++;
  }
  return { progress: merged, imported, skipped };
}
