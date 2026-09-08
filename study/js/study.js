/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/study.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* study.js — the full-screen study session.
 *
 * Front only; tap anywhere (or Space) to flip; four buttons showing the interval
 * each would schedule. Full-screen and over the tab bar on purpose: reviewing is
 * the one thing in this app that wants no other affordances on screen.
 */
import { applyRating, previewIntervals, RATING_LABEL } from './scheduler.js';
import { gradeCard } from './deck.js';
import { timeStart, timeStop } from './timer.js';
import { attachSwipe, flingTo, SWIPE_RATING } from './swipe.js';
import * as tts from './tts.js';

let session = null;

/**
 * @param queue    cards to review, in order
 * @param progress current progress object
 * @param onSave   (progress) => Promise — persists after every grade
 * @param onDone   (progress, stats) => void — session finished or exited
 */
export function startSession(queue, progress, onSave, onDone) {
  session = {
    queue: [...queue],
    i: 0,
    progress,
    onSave,
    onDone,
    flipped: false,
    graded: 0,
    // One step of undo. Not a stack: the failure it exists for is "I hit Good
    // when I meant Again", which you notice immediately or not at all.
    undo: null,
    stats: { 1: 0, 2: 0, 3: 0, 4: 0 },
    spokenFor: null,   // "cardId:side" — see autoplay()
  };

  const el = document.createElement('div');
  el.className = 'study';
  el.id = 'study';
  document.body.appendChild(el);
  document.addEventListener('keydown', onKey);
  timeStart('cards');
  render();
}

function current() {
  return session.queue[session.i];
}

function render() {
  const el = document.getElementById('study');
  if (!el) return;

  const card = current();
  if (!card) return renderDone(el);

  const stored = session.progress.cards[card.id]?.fsrs || null;
  const isNew = !stored;
  const intervals = session.flipped ? previewIntervals(stored) : null;
  const remaining = session.queue.length - session.i;

  el.innerHTML = `
    <div class="swipe-glow" id="swipe-glow"></div>
    <div class="swipe-hint" id="swipe-hint"></div>
    <header class="study-bar">
      <button class="study-exit" aria-label="End session">✕</button>
      <div class="study-progress">
        <div class="study-progress-fill" style="width:${(session.i / session.queue.length) * 100}%"></div>
      </div>
      ${tts.isEnabled() ? '<button class="study-say" aria-label="Say it again">🔊</button>' : ''}
      <span class="study-count">${remaining}</span>
    </header>

    <div class="study-card ${session.flipped ? 'is-flipped' : ''}" id="study-card">
      <div class="study-meta">
        ${isNew ? '<span class="tag tag-new">New</span>' : ''}
        <span class="tag tag-dim">${labelFor(card)}</span>
      </div>

      <div class="study-face ${card.frontIsFiwo ? 'fiwo' : ''}">${esc(card.front)}</div>

      ${session.flipped ? `
        <hr class="study-rule">
        <div class="study-face back ${card.frontIsFiwo ? '' : 'fiwo'}">${esc(card.back)}</div>
        ${card.note ? `<p class="study-note">${esc(card.note)}</p>` : ''}
      ` : '<p class="study-hint">Tap to reveal</p>'}
    </div>

    ${session.flipped ? `
      <div class="grades">
        ${[1, 2, 3, 4].map(r => `
          <button class="grade grade-${r}" data-rating="${r}">
            <span class="grade-label">${RATING_LABEL[r]}</span>
            <span class="grade-when">${esc(intervals[r])}</span>
          </button>`).join('')}
      </div>
    ` : `
      <div class="study-foot">
        ${session.undo ? '<button class="study-undo">↺ Undo last</button>' : ''}
        ${hasKeyboard() ? `<span class="study-keys">
          <kbd>Space</kbd> flip · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> grade
        </span>` : ''}
      </div>
    `}`;

  el.querySelector('.study-exit').addEventListener('click', () => finish());
  el.querySelector('.study-undo')?.addEventListener('click', undoLast);
  // Absent entirely when audio is off, rather than present and silent — a
  // speaker icon that does nothing is a bug report waiting to happen, and on
  // the website audio is switched off for the whole build.
  el.querySelector('.study-say')?.addEventListener('click', () => say(card));
  for (const b of el.querySelectorAll('.grade')) {
    b.addEventListener('click', () => grade(Number(b.dataset.rating)));
  }
  bindSwipe(el);
  autoplay(card);
}

/* Is there plausibly a keyboard? Drives whether the key hints are shown at all.
 *
 * `pointer: coarse` is a finger, which is the phone — where these keys cannot
 * be pressed and the hint would be clutter on the one screen that exists to
 * have nothing on it. On a desktop the hint is the difference between a
 * shortcut that gets used and one nobody discovers. */
function hasKeyboard() {
  return window.matchMedia?.('(pointer: fine)').matches === true;
}

function labelFor(card) {
  if (card.type === 'sentence') return 'Sentence';
  if (card.type === 'production') return 'English → Fiwo';
  return 'Fiwo → English';
}

/* ── Audio ────────────────────────────────────────────────────────────────── */

/* What gets spoken is ALWAYS the Fiwo, on either side.
 *
 * On a recognition card the back is English, but the thing worth hearing is the
 * word you were just asked to recall, not its translation — you already speak
 * English. `card.speak` is set to the Fiwo by deck.js for exactly this, on both
 * directions of every word. */
const say = (card) => tts.speak(card.speak, true);

/**
 * Speak this side, if the settings and the production-card rule allow it.
 *
 * Guarded against repeats: render() runs on flip, on grade and on undo, and a
 * card that says its own name twice because something re-rendered is the kind
 * of bug you learn to tune out rather than report.
 */
function autoplay(card) {
  const side = session.flipped ? 'back' : 'front';
  const token = `${card.id}:${side}`;
  if (session.spokenFor === token) return;
  session.spokenFor = token;
  if (tts.shouldAutoplay(card, side)) say(card);
}

/* ── Swipe grading ────────────────────────────────────────────────────────── */

/* The card is only gradeable once it is face up. On the front a drag does
 * nothing and a tap flips — grading a card you have not seen the back of is
 * the one thing the gesture must never make easy. */
const canGrade = () => Boolean(session?.flipped);

function bindSwipe(el) {
  const card = el.querySelector('#study-card');
  const glow = el.querySelector('#swipe-glow');
  const hint = el.querySelector('#swipe-hint');

  attachSwipe(card, {
    enabled: canGrade,
    onTap: flip,
    onDrag: ({ dir, t, armed, dx, dy }) => {
      if (!dir) {
        // Spring back. The transition is only added here so it does not fight
        // the finger during the drag itself.
        card.style.transition = 'transform 180ms var(--ease-out), opacity 180ms linear';
        card.style.transform = '';
        card.style.opacity = '';
        glow.style.opacity = '0';
        hint.style.opacity = '0';
        return;
      }
      card.style.transition = 'none';
      // The card recedes as it goes, which keeps the grade label readable over
      // it — a definition and the word "Again" fighting for the same pixels is
      // exactly the kind of thing that costs a dyslexic reader a card.
      card.style.opacity = String(1 - t * 0.55);
      // Rotate only on the horizontal throws; a card flung straight up that
      // also spins reads as a glitch rather than as a gesture.
      const rot = (dx / 18).toFixed(2);
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      const rating = SWIPE_RATING[dir];
      glow.style.background = `var(--grade-${rating})`;
      // Eases in fast then holds, so "armed" is legible well before the
      // threshold rather than arriving all at once at the end.
      glow.style.opacity = String(0.10 + t * 0.22);
      hint.textContent = RATING_LABEL[rating];
      hint.style.color = `var(--grade-${rating})`;
      hint.style.opacity = String(Math.min(1, t * 1.3));
      hint.classList.toggle('is-armed', armed);
    },
    onThrow: (dir) => throwCard(dir),
  });
}

/**
 * Fling the card off the screen, then grade it.
 *
 * The grade is applied slightly BEFORE the animation ends: the next card is
 * being built while this one is still leaving, so a fast run of swipes never
 * waits on an animation. Nothing about the scheduling depends on the timing —
 * if the session is torn down mid-flight, the guard in grade() catches it.
 */
function throwCard(dir) {
  const card = document.getElementById('study-card');
  const glow = document.getElementById('swipe-glow');
  const hint = document.getElementById('swipe-hint');
  const rating = SWIPE_RATING[dir];
  if (!card) return grade(rating);

  const to = flingTo(dir);
  card.style.transition = 'transform 300ms cubic-bezier(0.32,0,0.67,0), opacity 300ms linear';
  card.style.transform = `translate(${to.x}px, ${to.y}px) rotate(${to.rot}deg)`;
  card.style.opacity = '0';
  if (glow) glow.style.opacity = '0.34';
  if (hint) hint.style.opacity = '0';

  setTimeout(() => grade(rating), 190);
}

function flip() {
  if (!session || session.flipped) return;
  session.flipped = true;
  render();
}

async function grade(rating) {
  // A thrown card grades on a timer, which can outlive the session if you hit
  // ✕ mid-flight.
  if (!session) return;
  const card = current();
  if (!card || !session.flipped) return;

  const stored = session.progress.cards[card.id]?.fsrs || null;
  const before = session.progress;
  const next = applyRating(stored, rating);

  session.progress = gradeCard(session.progress, card, next, rating);
  session.undo = { progress: before, index: session.i };
  session.stats[rating]++;
  session.graded++;
  session.i++;
  session.flipped = false;

  render();
  // Persist after every grade. A study session that loses its last ten reviews
  // to a phone call is worse than one that writes a small file eleven times.
  try {
    await session.onSave(session.progress);
  } catch (err) {
    console.warn('study: save failed', err);
  }
}

function undoLast() {
  if (!session.undo) return;
  session.progress = session.undo.progress;
  session.i = session.undo.index;
  session.flipped = true; // put you back where you were: looking at the answer
  session.graded = Math.max(0, session.graded - 1);
  session.undo = null;
  render();
  session.onSave(session.progress).catch(err => console.warn('study: save failed', err));
}

function renderDone(el) {
  const s = session.stats;
  el.innerHTML = `
    <div class="study-done">
      <h2>Done</h2>
      <p class="study-done-sub">${session.graded} card${session.graded === 1 ? '' : 's'} reviewed</p>
      <div class="study-tally">
        ${[1, 2, 3, 4].map(r => `
          <div class="tally">
            <div class="tally-n grade-${r}-fg">${s[r]}</div>
            <div class="tally-l">${RATING_LABEL[r]}</div>
          </div>`).join('')}
      </div>
      <button class="btn-primary study-finish">Finish</button>
    </div>`;
  el.querySelector('.study-finish').addEventListener('click', () => finish());
}

/** End the session from outside — the same path ✕ and Escape take.
 *
 * Exists because the shell owns navigation and the session does not: on the
 * website, browser Back changes the section underneath a full-screen overlay,
 * which would otherwise leave you studying on top of the wrong page. Safe to
 * call when nothing is running. */
export function endSession() {
  finish();
}

function finish() {
  if (!session) return;
  document.removeEventListener('keydown', onKey);
  document.getElementById('study')?.remove();
  // Stops the clock and flushes. Before onDone, so the dashboard it triggers is
  // rendered from a progress object that already has this session's time in it.
  timeStop().catch(err => console.warn('study: time flush failed', err));
  // Read everything off the session BEFORE clearing it, so the callback can
  // safely start another session.
  const { progress, stats, graded, onDone } = session;
  session = null;
  onDone(progress, { ...stats, graded });
}

// Keyboard is for desk use; the phone never sees it, but it makes the thing
// testable and costs four lines.
//
// WASD grades in the SAME DIRECTIONS as the swipe — W is up is Good, A is left
// is Hard, S is down is Again, D is right is Easy. It routes through
// SWIPE_RATING rather than restating the numbers so the two input methods can
// never drift apart; changing the gesture map changes the keys with it.
const KEY_DIRECTION = { w: 'up', a: 'left', s: 'down', d: 'right' };

/* A key press only means "grade" when nothing is expecting text. The card
 * session has no inputs today, but this handler lives on `document` for as long
 * as the session does, and a future search box or tag field would otherwise
 * grade a card on every `a` typed into it. */
function isTyping(target) {
  const el = target;
  if (!el || !el.tagName) return false;
  return el.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function onKey(e) {
  if (!session) return;
  if (isTyping(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const dir = KEY_DIRECTION[e.key.toLowerCase()];

  if (e.key === ' ') {
    e.preventDefault();
    if (!session.flipped) flip();
    else grade(3); // Space on the back = Good, matching Fiwo-Study
  } else if (dir && session.flipped) {
    e.preventDefault();
    // Thrown rather than graded outright, so the card leaves the way it would
    // under a finger. The keyboard is a second way to make the same gesture.
    throwCard(dir);
  } else if (['1', '2', '3', '4'].includes(e.key) && session.flipped) {
    grade(Number(e.key));
  } else if (e.key === 'Enter' && !session.flipped) {
    e.preventDefault();
    flip();
  } else if (e.key === 'Escape') {
    finish();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
