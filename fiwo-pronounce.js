/*
 * FIWO PRONUNCIATION ENGINE
 * Copyright (c) 2026 Joshua Leon Arkema Barends
 * Generates IPA, syllable breakdown, and TTS audio for any Fiwo word,
 * purely from spelling (strict 1:1 phonemic orthography — Rule 1 / Phonetics).
 * Exposes window.FiwoPronounce = { ipa, syllables, pronounceHtml, speak, canSpeak }
 */
(function () {
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

    // Phonetics.md: 1 letter = 1 phoneme, no exceptions
    const IPA_MAP = {
        p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g',
        m: 'm', n: 'n', q: 'ŋ',
        f: 'f', s: 's', x: 'ʃ', h: 'h', c: 'tʃ', z: 'z', v: 'x',
        l: 'l', r: 'r', w: 'w', j: 'j',
        i: 'i', e: 'e', a: 'a', o: 'o', u: 'u', y: 'ʌ'
    };

    // Words we cannot transcribe: proper nouns & the English half of borrowings.
    // Capitalization alone is not disqualifying (sentence starters are capitalized);
    // ask the parser whether the word is actually a Capital-Flag proper noun.
    function isTranscribable(word) {
        const w = word.toLowerCase();
        if (w.includes('-')) return false;                          // Fiwonized borrowing
        if (![...w].every(ch => IPA_MAP[ch])) return false;
        if (typeof FiwoParser !== 'undefined' && FiwoParser.analyze) {
            const tok = FiwoParser.analyze(word);
            if (tok && tok.cat === 'proper_noun') return false;     // native pronunciation
        }
        return true;
    }

    // Syllabify: every vowel is a nucleus; a single intervocalic consonant is
    // the next onset (no-fa); clusters split C1 | rest (kat-sa, far-lo-pa,
    // Rule 2.6); word-initial consonants are all onset; trailing consonants
    // join the final syllable (Rule 1 stress unit).
    // Returns [{text, start}] with start = index in the word.
    function syllabify(word) {
        const w = word.toLowerCase();
        const nuclei = [];
        for (let i = 0; i < w.length; i++) if (VOWELS.has(w[i])) nuclei.push(i);
        if (!nuclei.length) return [{ text: w, start: 0 }];

        const sylls = [];
        let sylStart = 0;
        for (let n = 0; n < nuclei.length; n++) {
            const v = nuclei[n];
            if (n === nuclei.length - 1) {
                sylls.push({ text: w.slice(sylStart), start: sylStart });
                break;
            }
            const nextV = nuclei[n + 1];
            const clusterLen = nextV - v - 1;
            // boundary: 0 consonants -> right after this vowel (hiatus a.i);
            // 1 consonant -> before it; 2+ -> after the first (C1.C2)
            const boundary = clusterLen <= 1 ? v + 1 : v + 2;
            sylls.push({ text: w.slice(sylStart, boundary), start: sylStart });
            sylStart = boundary;
        }
        return sylls;
    }

    // Stress anchor = the root's final functional vowel (Rule 1: xa-li-dyq
    // stresses "lidyq", not the -y- bridge). Uses the parser's morphology when
    // available; falls back to the last vowel.
    function stressAnchor(word) {
        const w = word.toLowerCase();
        let root = null;
        if (typeof FiwoParser !== 'undefined' && FiwoParser.analyze) {
            const tok = FiwoParser.analyze(word);
            if (tok && tok.root && !tok.error && w.startsWith(tok.root)) root = tok.root;
        }
        const searchIn = root || w;
        for (let i = searchIn.length - 1; i >= 0; i--) {
            if (VOWELS.has(searchIn[i])) return i;
        }
        return -1;
    }

    // index of the syllable containing the stress anchor
    function stressedSyllableIndex(sylls, anchor) {
        if (anchor < 0) return -1;
        for (let i = sylls.length - 1; i >= 0; i--) {
            if (sylls[i].start <= anchor) return i;
        }
        return -1;
    }

    function ipa(word) {
        if (!isTranscribable(word)) return null;
        const sylls = syllabify(word);
        const sIdx = stressedSyllableIndex(sylls, stressAnchor(word));
        const parts = sylls.map((s, i) => {
            const seg = [...s.text].map(ch => IPA_MAP[ch]).join('');
            return (i === sIdx ? 'ˈ' : '') + seg;
        });
        return '/' + parts.join('.') + '/';
    }

    // "xa-li-dyq" with the stressed unit (Rule 1: stress stretches from the
    // functional vowel through all trailing suffixes) wrapped in <strong>
    function syllables(word) {
        if (!isTranscribable(word)) return null;
        const sylls = syllabify(word);
        const sIdx = stressedSyllableIndex(sylls, stressAnchor(word));
        if (sIdx < 0) return sylls.map(s => s.text).join('-');
        const before = sylls.slice(0, sIdx).map(s => s.text);
        const unit = sylls.slice(sIdx).map(s => s.text).join('-');
        return (before.length ? before.join('-') + '-' : '') + '<strong>' + unit + '</strong>';
    }

    // --- audio: the fallback synthesizer (tts/mespeak.bundle.js) ---
    // Browser speechSynthesis is unreliable (Chrome on Linux ships ZERO voices),
    // so the site vendors its own synthesizer and drives it with exact Fiwo
    // phonemes via eSpeak's [[...]] Kirshenbaum phoneme input — true phoneme-level
    // Fiwo TTS, identical on every device, fully offline.
    //
    // As of 2026-09-20 this is the FLOOR, not the ceiling: speak() prefers the
    // trained neural voice whenever it has been downloaded (see the neural
    // section further down), and drops to this when it has not. Every 🔊 on the
    // site routes through speak(), so that one switch upgrades the dictionary
    // popups, the translator and reader word panels, the workbook and the
    // pronunciation widget at once, with no call site touched.
    const KIRSHENBAUM = {
        p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g',
        m: 'm', n: 'n', q: 'N',
        f: 'f', s: 's', x: 'S', h: 'h', c: 'tS', z: 'z', v: 'x',
        l: 'l', r: 'r', w: 'w', j: 'j',
        i: 'i:', e: 'e', a: 'a:', o: 'oU', u: 'u:', y: 'V'
    };

    // phoneme string with the stress mark (') before the stressed vowel
    function kirshenbaum(word) {
        const w = word.toLowerCase();
        const anchor = stressAnchor(word);
        let out = '';
        for (let i = 0; i < w.length; i++) {
            if (i === anchor) out += "'";
            out += KIRSHENBAUM[w[i]] || '';
        }
        return out;
    }

    function canSpeak() { return true; }   // we ship our own synthesizer

    let ttsState = 'idle';                 // idle | loading | ready | failed
    let pendingWord = null;
    let audioCtx = null;

    // The AudioContext MUST be created/resumed inside a user gesture (the click),
    // otherwise Chrome autoplay policy leaves it suspended and playback is
    // silently blocked — especially on the first click, where the engine loads
    // asynchronously and the actual playback happens after the gesture ended.
    function ensureAudioCtx() {
        // The neural voice has an AudioContext of its own and the same autoplay
        // problem. Unlocked from here so that every embedder that already calls
        // ensureAudio() inside its click handler — which is all of them, it is
        // the documented contract — keeps working unchanged.
        if (neural) neural.unlock();
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    // Resolves when playback FINISHES, so speak() can be awaited by a caller
    // that is reading a whole story line by line. A decode failure resolves
    // rather than rejects: a sequencer should move on, not stall.
    let roboticSource = null;
    function playWav(bytes) {
        if (!audioCtx || !bytes || !bytes.length) return Promise.resolve();
        const buf = new Uint8Array(bytes).buffer;
        return audioCtx.decodeAudioData(buf).then(decoded => new Promise(resolve => {
            stopRobotic();
            const src = audioCtx.createBufferSource();
            src.buffer = decoded;
            src.connect(audioCtx.destination);
            roboticSource = src;
            src.onended = () => { if (roboticSource === src) roboticSource = null; resolve(); };
            src.start();
        })).catch(() => {});
    }

    function stopRobotic() {
        if (!roboticSource) return;
        try { roboticSource.stop(); } catch (e) { /* already stopped */ }
        roboticSource = null;
    }
    function loadTts(onReady) {
        if (ttsState === 'ready') { onReady(); return; }
        if (ttsState === 'loading' || ttsState === 'failed') return;
        ttsState = 'loading';
        const s = document.createElement('script');
        s.src = 'tts/mespeak.bundle.js?v=1';
        s.onerror = () => { ttsState = 'failed'; };
        s.onload = () => {
            // readiness is proven by an actual test synthesis, not by callbacks —
            // the config ships an embedded default voice that works even when
            // the external voice file is rejected
            // Readiness is proven by an actual test synthesis — but ONLY once the
            // config has finished loading. Judging it earlier marks a perfectly good
            // engine 'failed': meSpeak defers calls made before the config arrives
            // ("No config-data loaded, deferring call") and returns nothing, which
            // looks like a failure. Found 2026-07-26 while porting this file into
            // Fiwo-Study, where it made the Speak button silently do nothing.
            // The external voice file is optional — the config carries an embedded
            // default that synthesizes fine (voiceLoaded stays false, and that is OK).
            let waited = 0;
            const finish = () => {
                if (ttsState !== 'loading') return;
                if (!meSpeak.isConfigLoaded || !meSpeak.isConfigLoaded()) {
                    waited += 120;
                    if (waited > 15000) { ttsState = 'failed'; return; }
                    setTimeout(finish, 120);
                    return;
                }
                try {
                    const test = meSpeak.speak("[[t'e]]", { rawdata: 'array' });
                    ttsState = (test && test.length) ? 'ready' : 'failed';
                } catch (e) { ttsState = 'failed'; }
                if (ttsState === 'ready') onReady();
            };
            try {
                meSpeak.loadConfig('tts/mespeak_config.json');
                try { meSpeak.loadVoice('tts/voice-en.json', () => {}); } catch (e) { /* optional */ }
                finish();
            } catch (e) { ttsState = 'failed'; }
        };
        document.head.appendChild(s);
    }

    /* Every word of `text` that can actually be pronounced, stripped of
     * punctuation and lowercased.
     *
     * speak() used to take a single word, because every caller was a dictionary
     * button. The story reader hands it a whole SENTENCE, and isTranscribable()
     * rejects one out of hand — a space is not in IPA_MAP. That made speak()
     * return silently, which looked from the outside like the voice was broken
     * rather than like the input was the wrong shape. Splitting first is the
     * fix, and it is also what makes a sentence with one proper noun in it
     * speak the rest instead of nothing.
     */
    function speakableWords(text) {
        return String(text).trim().split(/\s+/)
            .map(w => w.replace(/[^A-Za-z'-]/g, '').toLowerCase())
            .filter(w => w && isTranscribable(w));
    }

    function speakRobotic(words) {
        if (ttsState === 'failed') ttsState = 'idle';   // allow retry on a later click
        if (ttsState !== 'ready') {
            return new Promise(resolve => {
                pendingWord = words;
                loadTts(() => {
                    if (!pendingWord) { resolve(); return; }
                    const w = pendingWord; pendingWord = null;
                    resolve(speakRobotic(w));
                });
            });
        }
        // synthesize to raw WAV and play through our own (gesture-unlocked) context.
        // Space-separated inside one [[...]] so eSpeak applies its own word gap
        // rather than us stitching separate clips together.
        const wav = meSpeak.speak('[[' + words.map(kirshenbaum).join(' ') + ']]',
            { rawdata: 'array', speed: 115, pitch: 55, wordgap: 2, amplitude: 90 });
        return playWav(wav);
    }

    /* --- audio: the trained neural voice (website only) ---
     *
     * fiwo-voice.js owns the 63 MB model — the download, the cache, the ONNX
     * session. It is an ES module and this file is a classic script, so it
     * arrives by dynamic import(), lazily, on the first tap.
     *
     * Gated on window.FIWO_VOICE_MODULE, which index.html sets, for one
     * specific reason: Fiwo/Tools/build_app.mjs vendors THIS FILE into the
     * Android app, where fiwo-voice.js does not exist and must not. Probing
     * for it unconditionally would 404 in the app's console on every first tap
     * while the app's own, better-integrated Piper path is sitting right there.
     * So the website declares what it has, rather than this file guessing.
     */
    let neural = null;            // the loaded module, once it resolves
    let neuralPromise = null;
    function loadNeural() {
        if (neuralPromise) return neuralPromise;
        const spec = window.FIWO_VOICE_MODULE;
        if (!spec) { neuralPromise = Promise.resolve(null); return neuralPromise; }
        neuralPromise = import(new URL(spec, document.baseURI).href)
            .then(mod => {
                neural = mod;
                // Only loads if this device downloaded the voice on an earlier
                // visit; it never starts a download on its own.
                mod.resume();
                return mod;
            })
            .catch(err => { console.warn('voice: neural module unavailable —', err && err.message); return null; });
        return neuralPromise;
    }

    /**
     * Say a Fiwo word or phrase. Resolves when playback finishes.
     *
     * The neural voice is preferred whenever it is loaded, and the robotic one
     * is the fallback — including when the neural voice is present but throws,
     * because a phoneme the model has never seen must not become silence.
     */
    function speak(text) {
        const words = speakableWords(text);
        if (!words.length) return Promise.resolve();
        loadNeural();
        if (neural && neural.isReady()) {
            // The neural path gets the ORIGINAL text, not the split words: its
            // phonemiser does its own tokenising and keeps the word boundaries
            // the model was trained with.
            return neural.speak(text).catch(err => {
                console.warn('voice: falling back to the robotic voice —', err && err.message);
                return speakRobotic(words);
            });
        }
        return speakRobotic(words);
    }

    /** Cut off whatever is being said, whichever voice is saying it. */
    function stopSpeaking() {
        stopRobotic();
        if (neural) neural.stop();
    }

    /** Is the trained voice the one that would answer a speak() right now? */
    function usingNeural() {
        return Boolean(neural && neural.isReady());
    }

    // Small reusable HTML block: IPA + syllables + optional speak button.
    // Word must be attached via event delegation by the caller (data-speak).
    function pronounceHtml(word, opts) {
        const o = opts || {};
        const theIpa = ipa(word);
        if (!theIpa) return '';
        const syl = syllables(word);
        return `<span class="pron">
            <span class="pron-ipa">${theIpa}</span>
            ${o.syllables === false ? '' : `<span class="pron-syl">${syl}</span>`}
            ${canSpeak() ? `<button class="pron-speak" data-speak="${word.toLowerCase()}" title="Play approximate audio" aria-label="Pronounce ${word}">🔊</button>` : ''}
        </span>`;
    }

    /* A returning visitor who already downloaded the voice should get it on
     * their FIRST tap, not their second — so the module (a few KB) is imported
     * up front and asked to resume. resume() only touches the network if the
     * 63 MB model is already in this device's cache; it never starts a
     * download on its own.
     *
     * Deferred to DOMContentLoaded so the script-tag order in index.html does
     * not decide whether window.FIWO_VOICE_MODULE has been set yet. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadNeural, { once: true });
    } else {
        loadNeural();
    }

    // one global delegated listener for every speak button
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.pron-speak');
        if (!btn) return;
        e.stopPropagation();
        ensureAudioCtx();          // unlock audio while still inside the gesture
        speak(btn.dataset.speak);
    });

    window.FiwoPronounce = {
        ipa, syllables, pronounceHtml, speak, canSpeak,
        stop: stopSpeaking, usingNeural,
        ensureAudio: ensureAudioCtx,   // embedders calling speak() from their own
                                       // buttons must unlock audio in the same gesture

        _debug: () => ({ ttsState, neural: usingNeural(), audioCtx: audioCtx ? audioCtx.state : 'none' })
    };
})();
