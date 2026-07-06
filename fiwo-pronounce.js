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

    // --- audio: bundled eSpeak synthesizer (tts/mespeak.bundle.js) ---
    // Browser speechSynthesis is unreliable (Chrome on Linux ships ZERO voices),
    // so the site vendors its own synthesizer and drives it with exact Fiwo
    // phonemes via eSpeak's [[...]] Kirshenbaum phoneme input — true phoneme-level
    // Fiwo TTS, identical on every device, fully offline.
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
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playWav(bytes) {
        if (!audioCtx || !bytes || !bytes.length) return;
        const buf = new Uint8Array(bytes).buffer;
        audioCtx.decodeAudioData(buf).then(decoded => {
            const src = audioCtx.createBufferSource();
            src.buffer = decoded;
            src.connect(audioCtx.destination);
            src.start();
        }).catch(() => {});
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
            const finish = () => {
                if (ttsState !== 'loading') return;
                try {
                    const test = meSpeak.speak("[[t'e]]", { rawdata: 'array' });
                    ttsState = (test && test.length) ? 'ready' : 'failed';
                } catch (e) { ttsState = 'failed'; }
                if (ttsState === 'ready') onReady();
            };
            try {
                meSpeak.loadConfig('tts/mespeak_config.json');
                meSpeak.loadVoice('tts/voice-en.json', finish);
                setTimeout(finish, 4000);   // safety net if the voice callback never fires
            } catch (e) { ttsState = 'failed'; }
        };
        document.head.appendChild(s);
    }

    function speak(word) {
        if (!isTranscribable(word)) return;
        if (ttsState === 'failed') ttsState = 'idle';   // allow retry on a later click
        if (ttsState !== 'ready') {
            pendingWord = word;
            loadTts(() => { if (pendingWord) { const w = pendingWord; pendingWord = null; speak(w); } });
            return;
        }
        // synthesize to raw WAV and play through our own (gesture-unlocked) context
        const wav = meSpeak.speak('[[' + kirshenbaum(word) + ']]',
            { rawdata: 'array', speed: 115, pitch: 55, wordgap: 2, amplitude: 90 });
        playWav(wav);
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
        _debug: () => ({ ttsState, audioCtx: audioCtx ? audioCtx.state : 'none' })
    };
})();
