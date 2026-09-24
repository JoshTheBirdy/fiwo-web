/*
 * FIWO DICTIONARY SEARCH
 * Copyright (c) 2026 Joshua Leon Arkema Barends
 *
 * One ranking for every Fiwo dictionary: the website's, and the Android app's,
 * which gets this exact file copied in by Fiwo/Tools/build_app.mjs — the same
 * way it gets the parser and the pronunciation engine. Until 2026-09-23 the two
 * searched differently: the site ranked, the app filtered by raw substring and
 * sorted A–Z, so "go" on the phone listed every word with "go" anywhere in it.
 * The app's test suite covers this file against the real word list.
 *
 * Exposes window.FiwoSearch = {
 *   prepare({ word, gloss, senses, def })  → a record to score (cache it)
 *   compile(query)                         → a compiled query, or null if empty
 *   score(record, compiled)                → 0 = no match; higher = better
 *   hint(query)                            → why an English word has no Fiwo
 *                                            equivalent ("the", "is"…), or null
 *   englishStems(word)                     → candidate base forms of an English word
 *   NOTHING_TO_FIND                        → the table behind hint()
 * }
 * Each consumer maps its own entry shape onto prepare()'s four fields.
 */
(function (root) {
    'use strict';

    // ── Why it is built like this ────────────────────────────────────────────
    //
    // The first website search was a plain substring filter across word + gloss
    // + definition, sorted alphabetically. Two things went wrong, and they
    // compound:
    //
    //   1. A raw substring on the definition matches inside other words.
    //      Searching "go" hit "good", "ago", "gone" and "bigot"; "ear" hit
    //      "year", "hear", "early", "search".
    //   2. Nothing was ranked. `xosi` "to open" sorted below fifty entries that
    //      merely mention opening somewhere in their prose.
    //
    // So: match on word boundaries rather than raw substrings, and score every
    // hit by WHERE it matched. An exact headword beats a gloss beats a
    // definition mention; the caller's own order breaks ties within a band.

    const WORD_BOUNDARY_CACHE = new Map();

    function boundaryRe(term) {
        let re = WORD_BOUNDARY_CACHE.get(term);
        if (!re) {
            const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            re = new RegExp(`(?:^|[^a-z0-9])${safe}(?:$|[^a-z0-9])`, 'i');
            WORD_BOUNDARY_CACHE.set(term, re);
        }
        return re;
    }

    // "Disease / Sickness", "to open (a door)" -> ["disease", "sickness"] /
    // ["to open", "open", "a door"]. A gloss is a list of citation forms, so an
    // exact hit on one of them is as good as an exact hit on the whole field.
    //
    // Two normalisations, both found in the 2026-09-23 audit. 305 glosses end
    // with a full stop ("Move / Go."), which made the term `go.` — so "go" never
    // matched `xali` exactly and lost an alphabetical tie to Goal, good morning
    // and Government. And 415 verbs cite "To participate", so the bare verb is
    // added beside it: nobody searches for the "to".
    function glossTerms(text) {
        const out = [];
        for (const raw of (text || '').toLowerCase().split(/[/,;()]+|\s+-\s+/)) {
            const t = raw.trim().replace(/[.!?:]+$/, '').trim();
            if (!t) continue;
            out.push(t);
            if (t.startsWith('to ') && t.length > 3) out.push(t.slice(3));
        }
        return out;
    }

    // ── English inflection ───────────────────────────────────────────────────
    //
    // Nothing in the lexicon is inflected, so "used" has to become "use" before
    // it can match `zyli` (key "Use."). Crude on purpose: it generates candidate
    // stems and lets the scorer decide, so a wrong guess costs a lower-ranked
    // result rather than a wrong answer. Written for the website's composer; the
    // dictionaries use it too since 2026-09-23, so "ate" finds `nomi`.

    // Suffix-stripping cannot reach these, and they are common enough that
    // missing them makes the whole tool feel broken — "gave" is not a rare way
    // to say give.
    const ENGLISH_IRREGULARS = {
        was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
        had: 'have', has: 'have', did: 'do', does: 'do', done: 'do',
        gave: 'give', given: 'give', went: 'go', gone: 'go', took: 'take', taken: 'take',
        made: 'make', said: 'say', saw: 'see', seen: 'see', came: 'come', got: 'get',
        knew: 'know', known: 'know', thought: 'think', found: 'find', told: 'tell',
        became: 'become', left: 'leave', felt: 'feel', brought: 'bring', began: 'begin',
        kept: 'keep', held: 'hold', wrote: 'write', written: 'write', stood: 'stand',
        heard: 'hear', meant: 'mean', met: 'meet', ran: 'run', paid: 'pay', sat: 'sit',
        spoke: 'speak', spoken: 'speak', led: 'lead', grew: 'grow', lost: 'lose',
        fell: 'fall', sent: 'send', built: 'build', understood: 'understand',
        drew: 'draw', broke: 'break', broken: 'break', spent: 'spend', rose: 'rise',
        drove: 'drive', bought: 'buy', wore: 'wear', chose: 'choose', ate: 'eat',
        eaten: 'eat', slept: 'sleep', drank: 'drink', threw: 'throw', flew: 'fly',
        children: 'child', people: 'person', men: 'man', women: 'woman',
        feet: 'foot', teeth: 'tooth', mice: 'mouse', lives: 'life',
    };

    function englishStems(word) {
        const out = [word];
        const add = s => { if (s.length >= 2 && !out.includes(s)) out.push(s); };
        if (ENGLISH_IRREGULARS[word]) add(ENGLISH_IRREGULARS[word]);
        if (word.endsWith('ies')) add(word.slice(0, -3) + 'y');
        if (word.endsWith('es')) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
        if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
        if (word.endsWith('ed')) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
        if (word.endsWith('ing')) { add(word.slice(0, -3)); add(word.slice(0, -3) + 'e'); }
        // running -> runn -> run; stopped -> stopp -> stop
        for (const stem of [...out]) {
            if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]
                && !'aeiou'.includes(stem[stem.length - 1])) {
                add(stem.slice(0, -1));
            }
        }
        return out;
    }

    // The query as typed, then its stems, then its plural — "boat" should find
    // an entry glossed "boats". Anything but the literal query scores below it,
    // so an exact match always wins. Stems only for a single word: a phrase is
    // handled word by word below.
    //
    // A stem is a guess about ENGLISH, so it is only ever matched against the
    // English side. Matched against headwords too, "went" -> "go" put the Fiwo
    // word `go` (*Word*) above `xali` (*Go*).
    function queryVariants(q) {
        const out = [{ term: q, penalty: 0, english: false }];
        if (!/\s/.test(q)) {
            for (const stem of englishStems(q).slice(1)) out.push({ term: stem, penalty: 60, english: true });
            if (q.length > 2 && !q.endsWith('s')) out.push({ term: q + 's', penalty: 60, english: true });
        }
        return out;
    }

    // How much of the headword the query accounts for. "xos" is most of `xosi`
    // and almost certainly what you meant; "go" is a third of `gofoa` and almost
    // certainly is not. Without this, any two-letter English query drags in
    // every Fiwo word that happens to start with those letters.
    const STRONG_COVERAGE = 0.6;

    function prepare({ word, gloss, senses, def }) {
        const r = {
            word: (word || '').toLowerCase(),
            gloss: (gloss || '').toLowerCase(),
            senses: (senses || []).map(s => s.toLowerCase().replace(/[.!?:]+$/, '').trim()),
            def: (def || '').toLowerCase(),
        };
        r.terms = glossTerms(r.gloss);
        // Every signal below needs the term somewhere in here, so one substring
        // test rules out most of the lexicon before any regex runs — this runs
        // over ~3,300 entries per keystroke on a phone.
        r.all = [r.word, r.gloss, ...r.senses, r.def].join('\n');
        return r;
    }

    /** 0 = no match (drop it). Higher = more relevant. */
    function matchScore(r, variants, perWord) {
        let best = 0;
        for (const { term, penalty, english } of variants) {
            if (!r.all.includes(term)) continue;
            // Every signal is scored and the strongest wins, rather than an
            // if/else chain: a weak Fiwo prefix must be allowed to lose to a
            // solid English gloss prefix, which a chain ordered by field cannot
            // express.
            const strong = r.word.length > 0 && term.length / r.word.length >= STRONG_COVERAGE;
            let s = 0;
            const bid = (n) => { if (n > s) s = n; };

            // One word out of an English phrase: a Fiwo headword that happens
            // to spell it (`go`, *Word*, in "I want to go home") is a
            // coincidence, so it ranks under an English gloss rather than over.
            const fiwo = !english;
            if (fiwo && r.word === term) bid(perWord ? 700 : 1000);
            if (r.terms.includes(term) || r.senses.includes(term)) bid(900);
            if (fiwo && r.word.startsWith(term)) bid(strong ? 800 : 540);
            if (r.terms.some(t => t.startsWith(term))) bid(700);
            if (r.senses.some(t => t.startsWith(term))) bid(620);
            // Inside the headword but not at its start is a spelling coincidence
            // far more often than an intent: "love" found `flove` (*Dirty*).
            if (fiwo && r.word.includes(term)) bid(strong ? 350 : 120);
            // Guarded, because a regex cannot beat a score already won.
            if (s < 400 && boundaryRe(term).test(r.gloss)) bid(400);
            if (s < 300 && r.senses.some(t => boundaryRe(term).test(t))) bid(300);
            if (s < 200 && boundaryRe(term).test(r.def)) bid(200);

            if (s) best = Math.max(best, s - penalty);
        }
        return best;
    }

    // Several words: "thank you" matched nothing, because no gloss contains
    // that phrase. The phrase still wins where it exists (`dez`, *good
    // morning*); failing that, each word is scored on its own — but only on the
    // strong signals, headword or gloss, because every word of an English
    // sentence turns up somewhere in three thousand definitions. Matching more
    // of the words ranks higher, so "thank you" puts `grawi` and `suk` on top.
    const QUERY_STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'am', 'was', 'were', 'be', 'of']);

    function compile(query) {
        const q = (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!q) return null;
        const tokens = q.split(' ');
        return {
            text: q,
            whole: queryVariants(q),
            // A word of one or two letters ("i", "to", "go") is a prefix of
            // hundreds of entries, so it only counts on an exact gloss.
            words: tokens.length > 1
                ? tokens.filter(w => !QUERY_STOPWORDS.has(w))
                    .map(w => ({ variants: queryVariants(w), min: w.length <= 2 ? 900 : 400 }))
                : [],
        };
    }

    function score(record, compiled) {
        if (!compiled) return 0;
        const whole = matchScore(record, compiled.whole, false);
        if (!compiled.words.length) return whole;
        let best = 0, hits = 0;
        for (const { variants, min } of compiled.words) {
            const s = matchScore(record, variants, true);
            if (s >= min) { hits++; best = Math.max(best, s); }
        }
        const perWord = hits ? best - 150 + 40 * (hits - 1) : 0;
        return Math.max(whole ? whole + 100 : 0, perWord);
    }

    // Articles and copulas have no Fiwo word to find: Fiwo marks specificity
    // with -p/-r and drops "is" entirely (Rule 8's zero copula). Saying so is
    // more useful than an empty result — or than 632 entries that merely
    // contain "the".
    const NOTHING_TO_FIND = {
        the: 'use the -p marker on the noun instead',
        a: 'use the -r marker on the noun instead',
        an: 'use the -r marker on the noun instead',
        is: 'Fiwo has no copula — the modifier attaches directly',
        am: 'Fiwo has no copula — the modifier attaches directly',
        are: 'Fiwo has no copula — the modifier attaches directly',
        was: 'no copula; put -d on the modifier-verb instead',
        were: 'no copula; put -d on the modifier-verb instead',
    };

    function hint(query) {
        return NOTHING_TO_FIND[(query || '').trim().toLowerCase()] || null;
    }

    root.FiwoSearch = { prepare, compile, score, hint, englishStems, NOTHING_TO_FIND };
})(typeof window !== 'undefined' ? window : globalThis);
