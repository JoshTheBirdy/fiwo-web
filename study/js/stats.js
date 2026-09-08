/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/stats.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* stats.js — everything the dashboard shows (phase 6).
 *
 * Pure: no DOM, no storage, so it can be tested against fabricated histories
 * without a browser.
 *
 * ── A NOTE ON DAYS ──────────────────────────────────────────────────────────
 * "Today" means the LOCAL day, not the UTC one. Reviews are stored with a UTC
 * timestamp (correct — an instant is an instant), but a streak is a claim about
 * a person's days, and at UTC+2 a session at 01:00 belongs to the night the
 * user thinks it does. dayKey() is shared with deck.js so the daily new-card
 * allowance and the streak agree about when a day rolls over; if they used
 * different definitions, studying late would break a streak while still
 * counting against the previous day's new-card budget.
 */

export const MATURE_DAYS = 21; // Anki's convention: an interval of 3 weeks

/**
 * Local-day key, YYYY-MM-DD — or null if the date is unusable.
 *
 * Returns null rather than throwing because progress.json lives in PUBLIC
 * storage: it can be hand-edited, restored from an old backup, or written by an
 * earlier version of this app. `new Date('x').toISOString()` throws
 * "Invalid time value", and one bad timestamp anywhere in the history would
 * otherwise take the whole app down at boot. Callers skip nulls.
 */
export function dayKey(d = new Date()) {
  const t = d instanceof Date ? d.getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * Reviews per local day, over every card.
 * Returns Map<'YYYY-MM-DD', count>.
 */
export function reviewsByDay(progress) {
  const byDay = new Map();
  for (const entry of Object.values(progress.cards || {})) {
    for (const r of entry.reviews || []) {
      const k = dayKey(new Date(r.at));
      if (k === null) continue; // unparseable timestamp — see dayKey()
      byDay.set(k, (byDay.get(k) || 0) + 1);
    }
  }
  return byDay;
}

/**
 * Current and longest run of consecutive days with at least one review.
 *
 * The current streak is allowed to end YESTERDAY as well as today: at 09:00 you
 * have not studied yet, and telling someone their 40-day streak is over because
 * the day is young is both wrong and discouraging.
 */
export function streaks(byDay, now = new Date()) {
  if (!byDay.size) return { current: 0, longest: 0, today: 0 };

  const today = dayKey(now);
  if (today === null) return { current: 0, longest: 0, today: 0 };
  const yesterday = dayKey(addDays(now, -1));

  let current = 0;
  let cursor = byDay.has(today) ? new Date(now)
    : byDay.has(yesterday) ? addDays(now, -1)
    : null;
  while (cursor && byDay.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Longest: walk the sorted distinct days and count consecutive runs.
  const days = [...byDay.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = (prev && dayKey(addDays(new Date(prev + 'T12:00:00'), 1)) === d) ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  return { current, longest, today: byDay.get(today) || 0 };
}

/** The last `weeks` weeks of activity, oldest first, aligned to whole weeks. */
export function heatmap(byDay, weeks = 13, now = new Date()) {
  const cells = [];
  // End on the current week's Saturday so the grid is a clean rectangle and
  // "today" is always in the last column.
  const end = addDays(now, 6 - now.getDay());
  const start = addDays(end, -(weeks * 7 - 1));
  const today = dayKey(now);

  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const k = dayKey(d);
    cells.push({
      date: k,
      count: byDay.get(k) || 0,
      future: k > today,
      isToday: k === today,
    });
  }
  return cells;
}

/**
 * Card counts by FSRS state.
 *
 * `new` is derived, not stored: a card with no progress entry has never been
 * seen, and there are 8,147 of them, so counting them means counting what is
 * absent rather than what is present.
 */
export function cardStates(allCards, progress) {
  const out = { new: 0, learning: 0, young: 0, mature: 0, suspendedOrphans: 0 };
  for (const card of allCards) {
    const e = progress.cards[card.id];
    if (!e || !e.fsrs) { out.new++; continue; }
    if (e.orphaned) { out.suspendedOrphans++; continue; }
    const st = e.fsrs.state;
    if (st === 1 || st === 3) out.learning++;
    else if ((e.fsrs.scheduled_days || 0) >= MATURE_DAYS) out.mature++;
    else out.young++;
  }
  return out;
}

/** Per-tier progress, counted in WORDS (not cards) — one row per tier. */
export function tierProgress(content, progress) {
  const rows = new Map();
  for (const w of content.words) {
    const t = w.tier ?? 3;
    if (!rows.has(t)) rows.set(t, { tier: t, seen: 0, total: 0 });
    const row = rows.get(t);
    row.total++;
    // A word counts as met if EITHER direction has been studied — the point is
    // "have you encountered this word", not "have you done both cards".
    if (progress.cards[w.id]?.fsrs || progress.cards[w.prodId]?.fsrs) row.seen++;
  }
  return [...rows.values()].sort((a, b) => a.tier - b.tier);
}

/**
 * Study time for one local day, and for the 7 days ending on it.
 *
 * Written by timer.js, which is the only thing that may write `progress.time`.
 * Everything here tolerates a missing or malformed map: this file is read at
 * boot on public storage, and the dashboard is the first thing to touch it.
 */
export const TIME_TRACKS = ['cards', 'cloze', 'stories'];

export function timeSpent(progress, now = new Date()) {
  const time = progress?.time || {};
  const day = time[dayKey(now)] || {};
  const today = {};
  const week = {};

  for (const k of TIME_TRACKS) {
    today[k] = Number(day[k]) || 0;
    week[k] = 0;
  }
  for (let i = 0; i < 7; i++) {
    const v = time[dayKey(addDays(now, -i))];
    if (!v) continue;
    for (const k of TIME_TRACKS) week[k] += Number(v[k]) || 0;
  }

  return { today, week };
}

export function storyProgress(content, progress) {
  let read = 0;
  let wordsRead = 0;
  for (const s of content.stories) {
    if (progress.stories[s.id]?.read) { read++; wordsRead += s.wordCount; }
  }
  return {
    read,
    total: content.stories.length,
    wordsRead,
    totalWords: content.stories.reduce((n, s) => n + s.wordCount, 0),
  };
}

/** Everything the Home screen needs, in one pass. */
export function dashboard(content, allCards, progress, now = new Date()) {
  const byDay = reviewsByDay(progress);
  const totalReviews = [...byDay.values()].reduce((a, b) => a + b, 0);
  return {
    byDay,
    streak: streaks(byDay, now),
    heatmap: heatmap(byDay, 13, now),
    states: cardStates(allCards, progress),
    tiers: tierProgress(content, progress),
    stories: storyProgress(content, progress),
    time: timeSpent(progress, now),
    totalReviews,
    provisional: Object.keys(progress.provisional || {}).length,
  };
}
