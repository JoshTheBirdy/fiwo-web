/* fiwo-voice.js — the neural Fiwo voice on the website.
 *
 * The engine itself is NOT here. `study/js/piper.js` is vendored from the
 * Android app by Fiwo/Tools/build_web_study.mjs and does the actual work:
 * IPA → phoneme ids → onnxruntime-web → PCM → speakers. This file is the part
 * the website needs and the app does not — deciding whether a visitor has the
 * 63 MB model yet, getting it for them once, and keeping it.
 *
 * ── WHY IT IS AN EXPLICIT DOWNLOAD ─────────────────────────────────────────
 *
 * The app bundles the voice inside the APK, where 63 MB is free. The website
 * cannot: it is a public page, and some of the people who open it are on a
 * phone on mobile data.
 *
 * The obvious fix — ship a smaller model — was measured and rejected on
 * 2026-09-20. Dynamic int8 quantization gets the file to 19 MB but runs 8x
 * slower AND destroys the audio (−3.7 dB SNR against the fp32 model on
 * identical phoneme ids with sampling noise off — the error is louder than the
 * signal). Almost every weight in a VITS decoder is a Conv kernel, so int8 has
 * to quantize Conv to win anything, and ORT's dynamic ConvInteger path is both
 * the slow one and the lossy one. Float16 halves the file but the converter
 * emits a graph ORT will not load, and the WASM backend has no fp16 kernels to
 * run it with anyway. Gzip buys 8%. A genuinely smaller voice means retraining
 * at Piper's `low` tier, which is a GPU run, not a code change.
 *
 * So: 63 MB, asked for out loud, once per device, then cached forever and
 * fully offline. Until someone says yes, every speaker button on the site keeps
 * working on the old eSpeak voice — see fiwo-pronounce.js. Nothing is worse
 * than it was; some of it gets much better.
 *
 * ── WHY ITS OWN CACHE ──────────────────────────────────────────────────────
 *
 * VOICE_CACHE is deliberately NOT the service worker's cache. sw.js deletes
 * every `fiwo-*` cache that is not the current CACHE_VERSION on activate, so a
 * routine version bump would silently make every visitor re-download 63 MB.
 * sw.js exempts this one by name, and its fetch handler skips MODEL_URL
 * entirely so stale-while-revalidate never re-fetches the model in the
 * background. Change the name here and you must change it there.
 *
 * ── SHIPPING A RETRAINED VOICE ─────────────────────────────────────────────
 *
 * The same property cuts the other way: the cached model is never revalidated,
 * so a new tts/fiwo.onnx reaches nobody who already downloaded the old one.
 * BUMP VOICE_CACHE (here and in sw.js) whenever the model file changes. sw.js
 * then sweeps the old name like any other stale `fiwo-*` cache, isCached()
 * turns false, and the reader is offered the download again instead of being
 * handed 64 MB of mobile data they did not agree to this time.
 *   v1 — e1300, the first voice (2026-09-20)
 *   v2 — e173, retrained on September-only takes (2026-09-24)
 */
import * as piper from './study/js/piper.js';
import * as tts from './study/js/tts.js';

export const MODEL_URL = 'tts/fiwo.onnx';
/* The model as uploaded: pieces under GitHub's 25 MB browser-upload limit. */
const PARTS_URL = 'tts/fiwo.onnx.parts.json';
const VOICE_CACHE = 'fiwo-voice-v2';
const PREF_OPTED_IN = 'voice.optIn';

/* Roughly 63.5 MB. Only ever shown to a human deciding whether to tap, so it is
 * a label, not a checksum — the real figure comes from Content-Length during
 * the download. Update it when the voice is retrained at a different size. */
export const APPROX_MB = 64;

let status = 'absent';        // absent | downloading | loading | ready | failed
let detail = '';              // a human-readable reason when status is failed
let progress = 0;             // 0..1 while downloading
let voice = null;             // { config, bytes } once built
let readyPromise = null;      // in-flight ensure(), so concurrent callers share one

const listeners = new Set();

function set(next, opts = {}) {
  status = next;
  if ('detail' in opts) detail = opts.detail;
  if ('progress' in opts) progress = opts.progress;
  for (const fn of listeners) { try { fn(state()); } catch { /* a bad listener is not our problem */ } }
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  fn(state());
  return () => listeners.delete(fn);
}

export function state() {
  return { status, detail, progress, ready: status === 'ready' };
}

export function isReady() {
  return status === 'ready';
}

/** Has this device already downloaded the voice on some earlier visit? */
export async function isCached() {
  if (!window.caches) return false;
  try {
    const cache = await caches.open(VOICE_CACHE);
    return Boolean(await cache.match(MODEL_URL));
  } catch {
    return false;
  }
}

/* Two different questions, and conflating them is how you end up re-prompting
 * someone who already said yes:
 *   isCached()  — are the bytes on this device right now?
 *   optedIn()   — did this person ever ask for the voice?
 * The pref survives a cache eviction, which is exactly when we want to re-fetch
 * silently rather than ask again. */
export function optedIn() {
  return Boolean(window.FiwoStore?.getPref(PREF_OPTED_IN, false));
}

/**
 * Download the model with progress, and keep it.
 *
 * Streamed rather than a plain `res.arrayBuffer()` so a 63 MB download over a
 * slow connection can show a bar instead of looking frozen for two minutes.
 */
async function download(signal) {
  /* The live site is uploaded through GitHub's browser uploader, which refuses
   * files over 25 MB, so the model is published as pieces listed in
   * PARTS_URL (written by Fiwo/Tools/build_web_study.mjs). No manifest — a
   * local copy with only the whole file — falls back to MODEL_URL. The
   * manifest is fetched with no-store: a stale one paired with a retrained
   * model's pieces would stitch together garbage, which the checksum below
   * would then catch, but only after 63 MB of someone's data. */
  let manifest = null;
  try {
    const m = await fetch(PARTS_URL, { signal, cache: 'no-store' });
    if (m.ok) manifest = await m.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  const urls = manifest ? manifest.parts.map(p => `tts/${p.file}`) : [MODEL_URL];

  const chunks = [];
  let received = 0;
  let total = manifest?.size || 0;
  for (const url of urls) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`voice: HTTP ${res.status} for ${url}`);
    if (!manifest) total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      // Without a known size there is no honest fraction to report, so the UI
      // is told the byte count and shows that instead of a fake bar.
      set('downloading', { progress: total ? received / total : 0, detail: `${(received / 1e6).toFixed(0)} MB` });
    }
  }

  const bytes = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }

  if (manifest) {
    if (received !== manifest.size) throw new Error(`voice: got ${received} bytes, expected ${manifest.size}`);
    if (crypto?.subtle) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
      if (hex !== manifest.sha256) throw new Error('voice: the downloaded pieces do not match the published model');
    }
  }

  // Kept as a Response so the entry is indistinguishable from one the service
  // worker put there, and a later visit can just res.arrayBuffer() it.
  if (window.caches) {
    try {
      const cache = await caches.open(VOICE_CACHE);
      await cache.put(MODEL_URL, new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(received) },
      }));
    } catch (err) {
      // Out of quota, or a private window. The voice still works this session;
      // it just costs the download again next time.
      console.warn('voice: could not cache the model —', err?.message || err);
    }
  }
  return bytes;
}

/**
 * Make the voice usable, downloading it if this device has not got it yet.
 *
 * Idempotent and concurrency-safe: every caller during a single download awaits
 * the same promise, so three speaker taps in a row do not start three fetches.
 * Resolves to true once speak() will work.
 */
export function ensure() {
  if (status === 'ready') return Promise.resolve(true);
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    try {
      window.FiwoStore?.setPref(PREF_OPTED_IN, true);

      const config = await piper.fetchVoiceConfig(MODEL_URL);

      let bytes = null;
      if (window.caches) {
        const cache = await caches.open(VOICE_CACHE);
        const hit = await cache.match(MODEL_URL);
        if (hit) {
          set('loading', { progress: 1, detail: 'from this device' });
          bytes = new Uint8Array(await hit.arrayBuffer());
        }
      }
      if (!bytes) bytes = await download();

      // Building the session is seconds of WASM work on its own, and it is the
      // step a first-time tapper would otherwise experience as a hang after the
      // progress bar already hit 100%.
      set('loading', { progress: 1, detail: 'warming up' });
      const next = { config, bytes };
      await piper.warm(next);

      voice = next;
      // Hand it to the vendored façade as well, so the flashcard deck — which
      // is the app's study.js running unchanged — switches from the robotic
      // voice to this one without knowing anything happened.
      tts.installPiperVoice(next);
      tts.configure({ fiwoBackend: tts.BACKEND.PIPER });

      set('ready', { progress: 1, detail: '' });
      return true;
    } catch (err) {
      readyPromise = null;   // a failure must be retryable on the next tap
      voice = null;
      set('failed', { progress: 0, detail: err?.message || String(err) });
      return false;
    }
  })();

  return readyPromise;
}

/**
 * Load the voice without asking, but ONLY if this device already has it.
 *
 * Called on page load. Someone who opted in last week should not have to opt in
 * again, and someone who never did must not have 63 MB pulled behind their back
 * — so the bytes being present in the cache is the permission.
 */
export async function resume() {
  if (status !== 'absent') return isReady();
  if (!(await isCached())) return false;
  return ensure();
}

/** Forget the downloaded voice — the undo for the opt-in. */
export async function forget() {
  window.FiwoStore?.setPref(PREF_OPTED_IN, false);
  voice = null;
  readyPromise = null;
  piper.stop();
  tts.installPiperVoice(null);
  tts.configure({ fiwoBackend: tts.BACKEND.ESPEAK });
  if (window.caches) {
    try { await (await caches.open(VOICE_CACHE)).delete(MODEL_URL); } catch { /* nothing to delete */ }
  }
  set('absent', { progress: 0, detail: '' });
}

/** Unlock the AudioContext. Must be called inside a real user gesture. */
export function unlock() {
  piper.unlock();
}

/** Cut off whatever is being said right now. */
export function stop() {
  piper.stop();
}

/**
 * Say it, in the trained voice. Resolves when playback FINISHES — the story
 * reader needs that to know when to advance to the next line.
 *
 * Throws if the voice is not ready. Callers that have a fallback (every
 * speaker button on the site does) should catch and fall back rather than
 * pre-checking, so the race between "ready" and "speaking" cannot lose.
 */
export async function speak(text) {
  if (!voice) throw new Error('the Fiwo voice is not loaded');
  await piper.speak(text, voice);
}

/* The robotic voice is the floor, not the absence of a floor. Configured the
 * moment this module loads so the flashcard deck can speak on a first visit,
 * before anyone has decided about the download; ensure() promotes the backend
 * to Piper later. The production-card rule that keeps an English→Fiwo front
 * silent lives in the vendored tts.js and is pinned by the app's test suite —
 * it is not restated here, on purpose. */
tts.configure({
  enabled: true,
  fiwoBackend: tts.BACKEND.ESPEAK,
  autoplayFront: true,
  autoplayBack: true,
});
