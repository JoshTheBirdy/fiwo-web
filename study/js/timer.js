/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/timer.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* timer.js — how long you actually spent, per day, split by activity.
 *
 * Two clocks, kept apart because they answer different questions: time in the
 * flashcard session, and time with a story open. Both land on the dashboard.
 *
 * ── THE ONLY HARD PROBLEM: A TIMER THAT LIES ────────────────────────────────
 * The naive version — start on screen entry, stop on exit — reports the time
 * the screen was OPEN, not the time you were studying. Put the phone in your
 * pocket with a story open and it will happily bill you four hours. A study
 * timer that inflates is worse than none: it makes the dashboard flattering and
 * useless, and there is no way to tell afterwards which numbers were real.
 *
 * So time accrues only while BOTH of these hold:
 *
 *   1. the app is visible — `document.visibilityState`. Android fires this when
 *      the app is backgrounded AND when the screen locks, which covers the
 *      pocket case and the "put it down mid-sentence" case.
 *   2. you have interacted within the idle limit — a grade, a flip, a scroll,
 *      a tap. Visibility alone misses the phone sitting face-up on the desk.
 *
 * The idle limits differ because the activities do. Grading is a steady pulse
 * every few seconds, so 2 minutes of silence there means you have stopped.
 * Reading a screenful on a 375px phone can genuinely take a couple of minutes
 * with no scroll at all, so its limit is 3 — deliberately generous, because
 * under-counting real reading is the more annoying of the two errors and the
 * visibility check already catches the way reading time actually gets inflated.
 *
 * ── WHY TOTALS ARE ABSOLUTE, NOT DELTAS ─────────────────────────────────────
 * This is what makes the feature safe to bolt onto the existing save path.
 * The tracker holds today's TOTAL in memory, seeded from disk at boot, and
 * every write stamps that total into the progress object on its way out. So a
 * writer holding a slightly stale snapshot — study.js keeps one for its undo
 * step — cannot roll time back: it gets re-stamped with the current total
 * rather than an increment being applied twice or lost. Deltas would need every
 * writer to agree on who had already counted what.
 */

import { dayKey } from './stats.js';

export const TICK_MS = 5000;

/* Milliseconds of no interaction after which we stop believing you.
 *
 * Cloze sits between the other two: you read a whole sentence before answering,
 * which is slower than flipping a flashcard, but you are still answering on a
 * pulse rather than reading continuously. */
export const IDLE_MS = { cards: 120000, cloze: 150000, stories: 180000 };

/* A tick that arrives late is capped rather than trusted.
 *
 * Android throttles and then suspends WebView timers in the background. On
 * resume a single `setInterval` callback can report that twenty minutes
 * elapsed, and crediting that would be the exact failure this module exists to
 * prevent. The visibility check should already have caught it; this is the
 * second line, for the gap between the device waking and the event firing. */
const MAX_CREDIT_MS = TICK_MS * 1.5;

/** One counter per track. Cloze is its own, as Josh asked — it is its own deck. */
const emptyDay = () => ({ cards: 0, cloze: 0, stories: 0 });
const TRACKS = ['cards', 'cloze', 'stories'];

/**
 * The accumulator. Pure apart from the clock, which is injected so the tests
 * can drive hours of activity without waiting for them.
 *
 * @param now      () => epoch ms
 * @param idleMs   per-activity idle limits
 */
export function createTracker({ now = () => Date.now(), idleMs = IDLE_MS } = {}) {
  /** dayKey → { cards, stories }, in ms. Seeded from disk, only ever grows. */
  let totals = new Map();
  let activity = null;
  let lastTickAt = 0;
  let lastActivityAt = 0;
  let dirty = false;

  const dayOf = (at) => dayKey(new Date(at));

  function bucket(day) {
    if (!totals.has(day)) totals.set(day, emptyDay());
    return totals.get(day);
  }

  /** Load what previous sessions recorded, so our totals are absolute. */
  function seed(progress) {
    totals = new Map();
    for (const [day, v] of Object.entries(progress?.time || {})) {
      if (!v || typeof v !== 'object') continue;
      const row = emptyDay();
      for (const k of TRACKS) row[k] = Number.isFinite(v[k]) && v[k] > 0 ? v[k] : 0;
      totals.set(day, row);
    }
    dirty = false;
  }

  /** Progress was replaced wholesale (Settings → Reset). Forget everything. */
  function reset() {
    totals = new Map();
    activity = null;
    dirty = false;
  }

  function start(kind, at = now()) {
    if (activity === kind) return;
    if (activity) stop(at, true);
    activity = kind;
    lastTickAt = at;
    lastActivityAt = at;
  }

  /** An interaction: this is what separates studying from leaving it open. */
  function note(at = now()) {
    lastActivityAt = at;
  }

  /**
   * Credit the interval since the last tick, if it was earned.
   * Returns the ms credited, which the tests assert on.
   */
  function tick(at = now(), visible = true) {
    if (!activity) return 0;
    const elapsed = at - lastTickAt;
    lastTickAt = at;
    if (elapsed <= 0) return 0;                                  // clock went backwards
    if (!visible) return 0;                                      // backgrounded or screen off
    if (at - lastActivityAt > (idleMs[activity] ?? 0)) return 0;  // idle

    const day = dayOf(at);
    if (day === null) return 0;
    const credit = Math.min(elapsed, MAX_CREDIT_MS);
    bucket(day)[activity] += credit;
    dirty = true;
    return credit;
  }

  function stop(at = now(), visible = true) {
    if (!activity) return 0;
    const credited = tick(at, visible);
    activity = null;
    return credited;
  }

  /**
   * Stamp the in-memory totals into a progress object. Returns a NEW object, or
   * the same one when there is nothing to say — callers use that to skip a
   * pointless write.
   */
  function applyTo(progress) {
    if (!totals.size) return progress;
    const time = { ...(progress?.time || {}) };
    let changed = false;
    for (const [day, v] of totals) {
      const cur = time[day];
      if (!cur || TRACKS.some(k => cur[k] !== v[k])) {
        time[day] = { ...v };
        changed = true;
      }
    }
    if (!changed) return progress;
    dirty = false;
    return { ...progress, time };
  }

  return {
    seed, reset, start, note, tick, stop, applyTo,
    isDirty: () => dirty,
    current: () => activity,
    totalsFor: (at = now()) => ({ ...emptyDay(), ...(totals.get(dayOf(at)) || {}) }),
  };
}

/* ── The app's single tracker, and its wiring ─────────────────────────────── */

/* One instance, reached directly by study.js and stories.js.
 *
 * It lives here rather than in app.js so that the two screens can start and
 * stop a clock without importing app.js, which imports them — a cycle that
 * happens to work in ES modules and is a trap for the next person to touch it. */
export const tracker = createTracker();

/* How often accrued time is written to disk during a session.
 *
 * Reading is the case that needs this. A card session saves after every grade,
 * so time rides along for free; you can read for twenty minutes without the app
 * writing anything at all. 60s trades a crash losing at most a minute against
 * writing the file for no reason — and it is still rarer than the write-per-grade
 * study.js has always done. */
const FLUSH_MS = 60000;

let hooks = null;      // { persist, getProgress, onChange }
let lastFlush = 0;

const visible = () => document.visibilityState === 'visible';

async function flush(force = false) {
  if (!hooks || !tracker.isDirty()) return;
  if (!force && Date.now() - lastFlush < FLUSH_MS) return;
  lastFlush = Date.now();
  try {
    await hooks.persist(hooks.getProgress());
    hooks.onChange?.();
  } catch (err) {
    console.warn('timer: flush failed', err);
  }
}

/**
 * @param persist    (progress) => Promise<progress> — the app's single write
 *                   path, which stamps `applyTo` on the way out
 * @param getProgress current authoritative progress
 * @param onChange   re-render hook, so the dashboard is not stale behind you
 */
export function attachTimekeeping({ persist, getProgress, onChange }) {
  hooks = { persist, getProgress, onChange };
  lastFlush = Date.now();

  setInterval(() => {
    if (!tracker.current()) return;
    tracker.tick(Date.now(), visible());
    flush();
  }, TICK_MS);

  // Leaving the app is both the moment the clock must stop and the moment
  // Android is most likely to kill the process. In that order.
  document.addEventListener('visibilitychange', () => {
    if (visible()) {
      // Whatever happened while hidden was not study: restart the idle window
      // rather than letting the gap immediately trip it.
      tracker.note();
      return;
    }
    tracker.tick(Date.now(), false);
    flush(true);
  });

  // Any interaction anywhere means you are still here. Capture phase, so it is
  // seen even where a handler below stops propagation.
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'wheel']) {
    document.addEventListener(ev, () => tracker.note(), { capture: true, passive: true });
  }
}

/** Called by the study session and the story reader as they open. */
export function timeStart(kind) {
  tracker.start(kind);
}

/** …and as they close. Always flushes: this may be the last event of the day. */
export async function timeStop() {
  tracker.stop(Date.now(), visible());
  await flush(true);
}

/* ── Presentation ─────────────────────────────────────────────────────────── */

/**
 * `0m` · `<1m` · `12m` · `1h 04m`.
 *
 * `<1m` rather than `0m` for a real but tiny amount: the difference between
 * "you have not started" and "you have barely started" is the one a dashboard
 * should be honest about, and it is the state you are in for the first minute
 * of every session.
 */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s === 0) return '0m';
  if (s < 60) return '<1m';
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
