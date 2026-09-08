/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/swipe.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* swipe.js — grade a flashcard by throwing it off the screen.
 *
 *                        ↑ Good
 *              Hard ←   card   → Easy
 *                       ↓ Again
 *
 * Four buttons at the bottom of the screen means four small targets and a
 * thumb travelling to each one, on every card, forever. A direction is one
 * movement you can make without looking, so the deck stops being a sequence of
 * button hunts.
 *
 * The mapping is Josh's and it has a logic worth keeping: the two you press
 * most — Good straight up, Again straight down — are the two axes your thumb
 * finds without aiming, and they are opposites, which is what they mean.
 *
 * THE PURE PART IS HERE ON PURPOSE. Deciding which direction a drag became is
 * where the bugs live — axis dominance, thresholds, the sign of Y — and none of
 * it needs a DOM. `swipeDirection` and `swipeProgress` are unit-tested;
 * `attachSwipe` below is the thin wiring around them.
 */

import { RATING } from './scheduler.js';

/** Pixels the dominant axis must travel before a drag counts as a throw. */
export const SWIPE_THRESHOLD = 72;

/** Movement under this is a tap, not a drag — fingers are never still. */
export const TAP_SLOP = 8;

export const SWIPE_RATING = {
  up: RATING.GOOD,      // 3
  right: RATING.EASY,   // 4
  down: RATING.AGAIN,   // 1
  left: RATING.HARD,    // 2
};

/**
 * Which way was that, if any?
 *
 * Screen coordinates: +y is DOWN. The dominant axis wins outright rather than
 * both firing — a diagonal has to resolve to exactly one grade, and ties go to
 * the horizontal because a thumb arcs sideways more easily than it travels
 * straight up.
 *
 * @returns 'up' | 'right' | 'down' | 'left' | null
 */
export function swipeDirection(dx, dy, threshold = SWIPE_THRESHOLD) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax >= ay) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * Live state during a drag: which grade it is heading for, and how committed
 * it looks, 0 → 1. Drives the tint, so the colour answers "what will this do"
 * before you let go rather than after.
 *
 * Unlike swipeDirection this always names a direction once the finger has moved
 * at all — the point is to show intent early. `armed` is the one that says
 * whether releasing now would actually grade.
 */
export function swipeProgress(dx, dy, threshold = SWIPE_THRESHOLD) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < TAP_SLOP && ay < TAP_SLOP) return { dir: null, t: 0, armed: false };
  const dir = ax >= ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  const t = Math.min(1, Math.max(ax, ay) / threshold);
  return { dir, t, armed: t >= 1 };
}

/**
 * Wire a card element for dragging.
 *
 * @param el        the card
 * @param onTap     () => void            — moved less than TAP_SLOP
 * @param onDrag    ({dir,t,armed,dx,dy}) — every move, for the tint
 * @param onThrow   (direction) => void   — released past the threshold
 * @param enabled   () => boolean         — false while the card is face down
 * @returns a teardown function
 */
export function attachSwipe(el, { onTap, onDrag, onThrow, enabled = () => true }) {
  let id = null;
  let x0 = 0;
  let y0 = 0;
  let moved = false;

  const down = (e) => {
    if (id !== null) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    moved = false;
    // Keep receiving moves even when the finger leaves the element, which it
    // will — the whole gesture is about leaving.
    el.setPointerCapture?.(id);
  };

  const move = (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) moved = true;
    if (!enabled()) return;
    onDrag({ ...swipeProgress(dx, dy), dx, dy });
  };

  const up = (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    id = null;
    el.releasePointerCapture?.(e.pointerId);

    if (!moved) return onTap();
    if (!enabled()) return onDrag({ dir: null, t: 0, armed: false, dx: 0, dy: 0 });

    const dir = swipeDirection(dx, dy);
    if (dir) onThrow(dir);
    // Short of the threshold: spring back, and say so, so the tint clears.
    else onDrag({ dir: null, t: 0, armed: false, dx: 0, dy: 0 });
  };

  const cancel = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    onDrag({ dir: null, t: 0, armed: false, dx: 0, dy: 0 });
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}

/** Where a thrown card lands — well past any screen edge. */
export function flingTo(dir) {
  // `window.innerWidth || 400` is not enough: with no `window` at all the
  // property access itself throws. The tests import this module in Node.
  const w = (typeof window !== 'undefined' && window.innerWidth) || 400;
  const h = (typeof window !== 'undefined' && window.innerHeight) || 800;
  switch (dir) {
    case 'right': return { x: w * 1.3, y: 40, rot: 22 };
    case 'left': return { x: -w * 1.3, y: 40, rot: -22 };
    case 'up': return { x: 0, y: -h * 1.1, rot: 0 };
    default: return { x: 0, y: h * 1.1, rot: 0 };
  }
}
