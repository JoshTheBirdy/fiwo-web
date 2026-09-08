/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/scheduler.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* scheduler.js — FSRS, ported from Fiwo-Study/server/scheduler.js.
 *
 * Same library (ts-fsrs 5.4.1, vendored), same retention (0.9), same rating
 * scale, so a card imported from Fiwo-Study keeps behaving the way it did.
 * Never hand-roll the scheduling maths.
 *
 * Stored FSRS cards are plain JSON — dates arrive as ISO strings and must be
 * rehydrated to Date objects before ts-fsrs touches them. Skipping that does
 * not throw; it produces silently wrong intervals.
 */
import { fsrs, generatorParameters, createEmptyCard } from '../vendor/ts-fsrs.mjs';

export const DESIRED_RETENTION = 0.9;

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const RATING_LABEL = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

const f = fsrs(generatorParameters({ request_retention: DESIRED_RETENTION }));

function rehydrate(card) {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

/** Store as JSON: Dates back to ISO strings. */
function dehydrate(card) {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : undefined,
  };
}

const usable = (c) => c && Number.isFinite(new Date(c.due).getTime());

/**
 * rating: 1 Again · 2 Hard · 3 Good · 4 Easy
 *
 * A stored card with an unparseable `due` is treated as new rather than fed to
 * ts-fsrs, which would happily compute from NaN and then throw "Invalid time
 * value" on the way back out — reporting the failure at the wrong end of the
 * pipeline. sanitizeProgress() clears these at boot; this is the second guard,
 * for state that arrives some other way.
 */
export function applyRating(storedCard, rating, now = new Date()) {
  const card = usable(storedCard) ? rehydrate(storedCard) : createEmptyCard(now);
  return dehydrate(f.next(card, now, rating).card);
}

export function humanize(ms) {
  const m = ms / 60000;
  if (m < 1) return '<1m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30.44).toFixed(1)}mo`;
  return `${(d / 365.25).toFixed(1)}y`;
}

/**
 * What each grade would schedule: { 1: '<1m', 2: '6m', 3: '10m', 4: '4d' }.
 * Shown on the buttons — it costs nothing and it makes grading honest, because
 * you can see what "Easy" is actually claiming before you press it.
 */
export function previewIntervals(storedCard, now = new Date()) {
  const out = {};
  for (const rating of [1, 2, 3, 4]) {
    const next = applyRating(storedCard, rating, now);
    out[rating] = humanize(new Date(next.due).getTime() - now.getTime());
  }
  return out;
}

export function isDue(storedCard, now = new Date()) {
  return !storedCard || new Date(storedCard.due) <= now;
}
