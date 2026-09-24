/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/tts.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* tts.js — the speech façade (Fiwo app.md Q14-16).
 *
 * Two languages, two completely different mechanisms:
 *
 *   English → the phone's own voice. No file, no download. Android ships a TTS
 *             engine and the WebView exposes it through speechSynthesis.
 *   Fiwo    → the trained Piper voice, through onnxruntime-web, run entirely
 *             on-device. The old eSpeak test voice still exists as a fallback
 *             (`audio.testVoice` in settings) in case the real one ever needs
 *             to be ruled out as the cause of a bug.
 *
 * WHY A FAÇADE. Every back-end is a different implementation of `speak(text)`:
 * eSpeak, Piper via WASM, possibly a native sherpa-onnx plugin later if WASM
 * turns out too slow on a real phone for a full story. Routing all of it
 * through one registry means that swap is a one-file change made when there
 * is something to measure, rather than a rewrite.
 *
 * This file is APP-ONLY — it reads app settings and drives Android's own TTS
 * engine. The Piper inference it delegates to lives in `piper.js`, which is
 * platform-free and vendored to the website, so both products speak Fiwo with
 * the same code.
 */
import * as piper from './piper.js';

export const BACKEND = { OFF: 'off', ESPEAK: 'espeak', PIPER: 'piper' };

let settings = {
  enabled: false, fiwoBackend: BACKEND.OFF, englishVoice: '', rate: 1, pitch: 1,
  autoplayFront: false, autoplayBack: true,
};
// { config } for the bundled voice — config.path is a fetchable relative URL
// (tts/fiwo.onnx) — or { config, bytes } for a Documents/Fiwo/voices override,
// whose path only means anything to the Filesystem plugin.
let piperVoice = null;

export function configure(patch) {
  settings = { ...settings, ...patch };
}

export function isEnabled() {
  return Boolean(settings.enabled);
}

/* Browsers refuse to start an AudioContext outside a user gesture, and a
 * synthesiser that "succeeds" into a suspended context is silent with no error.
 * Fiwo-Study's README calls this out as one of the two things that will bite
 * you; unlocking on the first pointerdown is the fix. */
let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try { window.FiwoPronounce?.ensureAudio?.(); } catch { /* nothing to unlock yet */ }
  piper.unlock();
}

/* ── Fiwo back-ends ───────────────────────────────────────────────────────── */

const backends = {
  [BACKEND.OFF]: {
    label: 'None',
    available: () => true,
    speak: () => { /* silence, on purpose */ },
  },

  // The website's bundled eSpeak. `FiwoPronounce.speak()` lazy-loads the 1.9 MB
  // bundle on first call and synthesises from exact Fiwo phonemes, so there is
  // nothing to do here but pass the word through.
  [BACKEND.ESPEAK]: {
    label: 'Test voice (robotic)',
    available: () => Boolean(window.FiwoPronounce?.speak),
    speak: (text) => window.FiwoPronounce.speak(text),
  },

  // Your voice. The chain, per Fiwo app.md Part 2:
  //   fiwo-pronounce.js → phonemes → phoneme_id_map → onnxruntime → audio
  [BACKEND.PIPER]: {
    label: 'Fiwo neural voice',
    available: () => Boolean(piperVoice),
    speak: async (text) => {
      if (!piperVoice) throw new Error('no Fiwo voice installed');
      await piper.speak(text, piperVoice);
    },
  },
};

export function backendLabel(name) {
  return backends[name]?.label || name;
}

export function availableBackends() {
  return Object.entries(backends)
    .filter(([, b]) => b.available())
    .map(([name, b]) => ({ name, label: b.label }));
}

export function installPiperVoice(voice) {
  piperVoice = voice;
}

export function hasPiperVoice() {
  return Boolean(piperVoice);
}

/**
 * Cut off whatever is speaking right now, immediately — not the same as
 * disabling audio. The story reader uses this for pause: it stops the current
 * line's audio and, because that resolves the speak() promise the sequencer
 * is awaiting, lets the sequencer's own loop notice and exit rather than
 * needing a second signalling path.
 */
export function stop() {
  piper.stop();
  try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
}

/* ── English ──────────────────────────────────────────────────────────────── */

export function englishVoices() {
  if (!window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices()
    .filter(v => v.lang?.toLowerCase().startsWith('en'))
    .map(v => ({ name: v.name, lang: v.lang }));
}

function speakEnglish(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  const match = window.speechSynthesis.getVoices()
    .find(v => v.name === settings.englishVoice);
  if (match) u.voice = match;
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* ── The one entry point ──────────────────────────────────────────────────── */

/**
 * Speak a card side.
 *
 * @param text   what to say
 * @param isFiwo which language it is — the CALLER knows, because a card knows
 *               which of its faces is Fiwo. Guessing from the string would get
 *               proper nouns and short words wrong.
 */
export async function speak(text, isFiwo) {
  if (!settings.enabled || !text) return;
  unlockAudio();
  try {
    if (isFiwo) await backends[settings.fiwoBackend]?.speak(text);
    else speakEnglish(text);
  } catch (err) {
    // Audio failing must never interrupt a review.
    console.warn('tts:', err.message || err);
  }
}

/**
 * Should this card side be spoken automatically?
 *
 * The rule that outlives every back-end: a production card (English → Fiwo)
 * stays SILENT on the front. Speaking the Fiwo there would hand over the answer
 * (Fiwo-Study README). `frontIsFiwo` is set on every card by deck.js precisely
 * so this decision needs no string inspection.
 *
 * `opts` defaults to the configured settings, so a caller that has no opinion
 * gets the user's. It stays an explicit parameter because the tests pin the
 * production-card rule by passing both switches on — that rule must hold no
 * matter what anything else is set to.
 */
export function shouldAutoplay(card, side, opts = settings) {
  if (!settings.enabled) return false;
  if (side === 'front') {
    if (!card.frontIsFiwo) return false; // the production-card rule
    return Boolean(opts.autoplayFront);
  }
  return Boolean(opts.autoplayBack);
}
