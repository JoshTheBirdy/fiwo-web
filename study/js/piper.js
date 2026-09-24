/* GENERATED — DO NOT EDIT.
 *
 * Vendored from `Fiwo APP/www/js/piper.js` by Fiwo/Tools/build_web_study.mjs.
 * Edit it THERE: the website and the Android app run the same scheduler on
 * purpose, so that a card behaves identically on both and one test suite
 * covers both. Changes made here are overwritten on the next build.
 */
/* piper.js — the Fiwo voice, spelling to sound, with nothing platform-specific
 * in it.
 *
 * WHY THIS IS ITS OWN FILE. Two products speak Fiwo: this app and the website.
 * Everything below is the part they genuinely share — the phonemiser bridge,
 * the ONNX session, the playback — and Fiwo/Tools/build_web_study.mjs vendors
 * this file to Fiwo-Web verbatim. Its sibling `voices.js` is the part they do
 * NOT share: finding a voice on an Android filesystem through a Capacitor
 * plugin. Keeping those apart is what lets the website run the same inference
 * code rather than a second copy of it that drifts.
 *
 * So: no `Capacitor`, no app settings, no DOM, nothing here that a plain
 * browser page cannot do. The one global it does reach for is
 * `window.FiwoPronounce`, which both products already load — and which is
 * itself vendored from Fiwo-Web in the other direction.
 *
 * The chain, per Fiwo app.md Part 2:
 *   text → fiwo-pronounce.js → IPA → phoneme_id_map → onnxruntime → PCM → speakers
 */

/* ── The voice files ──────────────────────────────────────────────────────────
 *
 * A "Piper voice" is TWO files:
 *
 *   fiwo.onnx        ~60 MB  the VITS network
 *   fiwo.onnx.json   ~7 KB   sample rate + phoneme_id_map + inference scales
 *
 * The .json is what makes the model self-describing: nothing here hardcodes
 * "a is 15", it reads the map from the file. Retrain with a different phoneme
 * set and both products keep working with no code change.
 */

/**
 * Validate a parsed Piper config and reduce it to the shape the rest of this
 * file wants. Throws with a legible reason — this runs when someone taps "use
 * this voice", and "it didn't work" is not a useful answer.
 *
 * @param json  the parsed .onnx.json
 * @param path  where the MODEL (not the json) can be found. What that means
 *              depends on the caller: a fetchable URL here, a Documents-
 *              relative path for the Capacitor override in voices.js.
 */
export function readVoiceConfig(json, path) {
  const map = json?.phoneme_id_map;
  if (!map || typeof map !== 'object') {
    throw new Error(`${path}.json has no phoneme_id_map — is it a Piper config?`);
  }
  return {
    path,
    sampleRate: json.audio?.sample_rate || 22050,
    phonemeIdMap: map,
    numSymbols: Object.keys(map).length,
    raw: json,
  };
}

/**
 * A voice served over HTTP — the app's bundled `tts/fiwo.onnx`, or the copy the
 * website downloads once and leaves in the service worker's cache. The model
 * itself is NOT read here: onnxruntime fetches `config.path` on its own when
 * the session is built, which keeps 60 MB out of a JS variable.
 */
export async function fetchVoiceConfig(modelUrl) {
  const res = await fetch(`${modelUrl}.json`);
  if (!res.ok) throw new Error(`${modelUrl}.json: HTTP ${res.status}`);
  return readVoiceConfig(await res.json(), modelUrl);
}

/* ── Text → phoneme ids ───────────────────────────────────────────────────────
 *
 * The step that makes Fiwo unusually safe for neural TTS. `fiwo-pronounce.js`
 * computes IPA purely from spelling (Rule 1), and it is verified to agree with
 * Tools/espeak-fiwo — the phonemiser Piper TRAINED with — on 400/400 corpus
 * words, phonemes and stress. Normally the runtime and training phonemisers
 * drift and the model mispronounces things no amount of retraining can fix.
 *
 * The Piper token convention below (BOS/EOS, padding between phonemes) is the
 * standard one, and it has been checked against the real model: fiwo.onnx.json's
 * phoneme_id_map has `^`→1 (BOS), `_`→0 (PAD), `$`→2 (EOS), 159 symbols total,
 * confirmed 2026-09-20. If a future retrain ever changes that convention the ids
 * will be valid and the audio will be nonsense — a failure that looks like a bad
 * model rather than a bad client — so re-check here first if a new voice ever
 * mispronounces everything.
 */
const BOS = '^';
const EOS = '$';
const PAD = '_';

/** Split an ipa() string like "/no.ˈfa/" into its phoneme symbols. */
export function ipaSymbols(text) {
  const P = window.FiwoPronounce;
  if (!P) throw new Error('FiwoPronounce not loaded');

  const out = [];
  for (const word of String(text).trim().split(/\s+/)) {
    const bare = word.replace(/[^A-Za-z'-]/g, '');
    if (!bare) continue;
    const ipa = P.ipa(bare);
    if (!ipa) continue;
    // Strip the delimiters and the syllable dots; keep the stress mark, which
    // Piper treats as a symbol of its own.
    for (const ch of ipa.replace(/^\/|\/$/g, '').replace(/\./g, '')) {
      out.push(ch);
    }
    out.push(' '); // word boundary
  }
  if (out[out.length - 1] === ' ') out.pop();
  return out;
}

/** Phoneme ids for a Fiwo utterance, ready for the model's input tensor. */
export function phonemeIds(text, config) {
  const map = config.phonemeIdMap;
  const ids = [];
  const push = (sym) => {
    const v = map[sym];
    if (v === undefined) return false;
    ids.push(...(Array.isArray(v) ? v : [v]));
    return true;
  };

  push(BOS);
  push(PAD);
  const missing = new Set();
  for (const sym of ipaSymbols(text)) {
    if (!push(sym)) missing.add(sym);
    push(PAD);
  }
  push(EOS);

  // Surfaced rather than swallowed: a symbol the model has never seen means the
  // phonemisers have diverged, which is exactly the failure this design exists
  // to prevent.
  return { ids, missing: [...missing] };
}

/* ── Audio ────────────────────────────────────────────────────────────────────
 *
 * Browsers refuse to start an AudioContext outside a user gesture, and a
 * synthesiser that "succeeds" into a suspended context is silent with no error.
 * Fiwo-Study's README calls this out as one of the two things that will bite
 * you; unlocking on the first pointerdown is the fix.
 */
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedAudioCtx;
}

export function unlock() {
  try { getAudioCtx().resume(); } catch { /* nothing to resume yet */ }
}

// So a story reader and rapid taps never overlap two utterances: a new speak()
// always cuts off whatever the last one was playing. `onended` is left attached
// on purpose — a sequencer awaits each speak() call to know when to advance,
// including when it's cut short by pause/stop, so that await must still
// resolve. Its own `current === src` guard keeps a late-firing old handler from
// clobbering whatever now-current source this stop() is about to make room for.
let currentSource = null;

export function stop() {
  if (!currentSource) return;
  try { currentSource.stop(); } catch { /* already stopped */ }
  currentSource = null;
}

/* ── onnxruntime ──────────────────────────────────────────────────────────────
 *
 * Loaded once, lazily — not at boot, so a session that never taps a speaker
 * never pays for it. Vendored as plain files under `../vendor/ort/` (no
 * bundler, per Q4) rather than pulled from node_modules at runtime. That
 * relative path is why this file must stay one directory deep beside a
 * `vendor/` sibling in BOTH products; build_web_study.mjs mirrors the layout
 * for exactly this reason. See each product's .gitignore for why the runtime
 * files are not committed.
 */
let ortPromise = null;
function loadOrt() {
  if (!ortPromise) {
    ortPromise = import('../vendor/ort/ort.wasm.min.mjs').then((ort) => {
      // Must be an absolute URL: ORT resolves this by dynamic import(), which
      // treats a bare relative string like 'vendor/ort/' as a package name (an
      // import-map lookup) rather than a path, and throws "failed to resolve
      // module specifier". Anchoring it to this module's own URL sidesteps
      // ever having to know what the document's URL is.
      ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
      // Neither a WebView nor GitHub Pages is cross-origin-isolated, and ORT's
      // own fallback for that (single-threaded, with a console warning) is
      // exactly what we get anyway — setting it up front just skips the warning.
      ort.env.wasm.numThreads = 1;
      // Run the model in a worker. Synthesising one sentence is seconds of
      // solid WASM arithmetic, and on the main thread that is seconds of a
      // frozen page: no scrolling, and — the one that actually matters — no
      // way to hit pause on a story that is reading itself to you.
      ort.env.wasm.proxy = true;
      return ort;
    });
  }
  return ortPromise;
}

/* One InferenceSession per installed voice, built on first use and cached on
 * the voice object itself — installing a different voice replaces the whole
 * object, which naturally drops the old session with it.
 *
 * `voice.bytes` is the escape hatch for a model no URL can reach (the app's
 * Documents/Fiwo/voices override). Everything else lets ORT fetch the path. */
async function getSession(voice) {
  if (voice.session) return voice.session;
  if (!voice.sessionPromise) {
    voice.sessionPromise = loadOrt()
      .then(ort => ort.InferenceSession.create(voice.bytes || voice.config.path,
        { executionProviders: ['wasm'] }))
      .then((session) => { voice.session = session; return session; });
  }
  return voice.sessionPromise;
}

/** Has this voice's session already been built? Callers use it to decide
 *  whether to show a "warming up the voice…" state before the first tap. */
export function isWarm(voice) {
  return Boolean(voice?.session);
}

/** Build the session without speaking, so the first real tap is not the slow one. */
export async function warm(voice) {
  await getSession(voice);
}

/**
 * Say it.
 *
 * Piper's ONNX graph (confirmed against fiwo.onnx itself) takes `input` (int64
 * phoneme ids), `input_lengths` (int64, one value) and `scales` (float32:
 * noise_scale, length_scale, noise_w) and returns raw float32 PCM at the
 * model's sample rate. No `sid` input — this voice is single-speaker. Raw PCM
 * goes straight into an AudioBuffer; there is no WAV header to write.
 *
 * Resolves when playback FINISHES, not when synthesis does — a story sequencer
 * needs that to know when to advance.
 *
 * @param voice  { config, bytes? } — mutated to cache its session.
 */
export async function speak(text, voice) {
  const { ids, missing } = phonemeIds(text, voice.config);
  if (missing.length) {
    // A symbol the model has never seen means the runtime and training
    // phonemisers have diverged. Speaking anyway would produce confident
    // nonsense that looks like a bad model rather than a bad client — better to
    // fail loudly than teach Josh a wrong pronunciation.
    throw new Error(`phonemiser disagrees with the model — missing ${missing.join(' ')}`);
  }

  const ort = await loadOrt();
  const session = await getSession(voice);
  const inference = voice.config.raw?.inference || {};
  const results = await session.run({
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([
      inference.noise_scale ?? 0.667, inference.length_scale ?? 1, inference.noise_w ?? 0.8,
    ]), [3]),
  });
  const pcm = results.output.data;

  const ctx = getAudioCtx();
  const buffer = ctx.createBuffer(1, pcm.length, voice.config.sampleRate);
  buffer.copyToChannel(Float32Array.from(pcm), 0);

  stop();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  currentSource = src;
  await new Promise((resolve) => {
    src.onended = () => { if (currentSource === src) currentSource = null; resolve(); };
    src.start();
  });
}
