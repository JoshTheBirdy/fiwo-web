/*
 * FIWO REFERENCE PARSER (browser port)
 * Copyright (c) 2026 Joshua Leon Arkema Barends
 * JS port of Fiwo/Tools/validate_sentence.py — keep the two in sync.
 * Exposes window.FiwoParser.parseSentence(sentence) -> {tokens, errors, valid}
 */
(function () {
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

    // --- Closed-class rosters (Rule book) ---
    const MOOD_TAGS = new Set(['kup', 'kop', 'kep', 'hap', 'hop', 'hyp', 'bip', 'xap', 'sep', 'sop', 'nop', 'rop']);
    const CLAUSAL_WALLS = new Set(['bef', 'bul', 'rot', 'kad', 'vel', 'zol', 'can', 'pen', 'vax', 'pov', 'kof', 'xom']);
    const PHATIC = new Set(['sal', 'tex', 'ak', 'wox', 'jo', 'ha', 'jas', 'cef']);
    const PRONOUNS = new Set(['mik', 'suk', 'suv', 'dal', 'das', 'daq', 'ram', 'nak', 'muk']);
    const NO_JE_PRONOUNS = new Set(['mik', 'nak', 'muk']);
    const DEICTICS = new Set(['sil', 'tan']);
    const INLINE_GLUE = new Set(['lan', 'ron']);
    const MATH_OPS = new Set(['ap', 'mux', 'mis', 'pot']);
    const VARIABLES = new Set(['wun', 'wat', 'wer', 'wiq', 'wis', 'wug', 'wal']);
    const PREP_TARGET_VARS = new Set(['wer', 'wiq']);
    const NUMBER_WORDS = new Set(['noze', 'bime', 'dewe', 'tafe', 'gloke', 'raje', 'sluqe', 'rete', 'marte', 'zewe', 'lere']);
    const TEMPORAL_ROOTS = new Set(['nudu', 'fitydu', 'wecdu', 'nu', 'du', 'dugu', 'dionu', 'bafu', 'dumu', 'gomu',
        'cihu', 'fohu', 'vivu', 'retadu', 'rugoxu', 'jaru', 'tequ', 'getsu', 'fituru', 'wedacu',
        'bimedu', 'dewedu', 'tafedu', 'glokedu', 'rajedu', 'sluqedu', 'retedu']);

    const NOUN_SUFFIXES = new Set(['p', 'r']);
    const VERB_SUFFIXES = new Set(['d', 's', 'q', 'k', 't', 'dyq', 'dyk', 'syq', 'syk']);
    const MODIFIER_SUFFIXES = new Set(['m', 'f', 't']);
    const SUFFIX_TRY = ['dyq', 'dyk', 'syq', 'syk', 'p', 'r', 'd', 's', 'q', 'k', 't', 'm', 'f'];

    const SUFFIX_MEANINGS = {
        'p': 'specific (the)', 'r': 'non-specific (a/some)',
        'd': 'past', 's': 'future', 'q': 'continuous', 'k': 'perfect',
        'dyq': 'past continuous', 'dyk': 'past perfect',
        'syq': 'future continuous', 'syk': 'future perfect',
        'm': 'nested-modifier flag', 'f': 'distributive flag', 't': 'stacker / infinitive linker'
    };

    // dictionary lookup: word -> entry
    let lexicon = null;
    function getLexicon() {
        if (lexicon) return lexicon;
        lexicon = new Map();
        if (typeof dictionaryData !== 'undefined') {
            dictionaryData.forEach(e => lexicon.set(e.word.toLowerCase(), e));
        }
        if (typeof derivedDictionaryData !== 'undefined') {
            derivedDictionaryData.forEach(e => {
                if (!lexicon.has(e.word.toLowerCase())) lexicon.set(e.word.toLowerCase(), e);
            });
        }
        return lexicon;
    }

    function vowelCat(v) {
        return { a: 'noun', o: 'noun', u: 'noun', i: 'verb', e: 'modifier', y: 'preposition' }[v];
    }

    function suffixMeaning(s, cat) {
        if (s === 't') return cat === 'verb' ? 'infinitive linker' : 'stacker';
        return SUFFIX_MEANINGS[s] || s;
    }

    function checkSuffix(cat, suffix) {
        if (!suffix) return null;
        if (cat === 'noun' && !NOUN_SUFFIXES.has(suffix))
            return `'-${suffix}' is not a legal noun suffix (nouns take only -p / -r, Rule 7)`;
        if (cat === 'verb' && !VERB_SUFFIXES.has(suffix))
            return `'-${suffix}' is not a legal verb suffix (Rule 14)`;
        if (cat === 'modifier' && !MODIFIER_SUFFIXES.has(suffix))
            return `'-${suffix}' is not a legal modifier suffix (-m / -f / -t, Rules 19/22/23)`;
        if (cat === 'preposition')
            return 'prepositions cannot take suffixes (Rule 13)';
        return null;
    }

    function classifyExact(w, entry) {
        if (MOOD_TAGS.has(w)) return 'mood_tag';
        if (CLAUSAL_WALLS.has(w)) return 'clausal_wall';
        if (w === 'syn') return 'condition';
        if (w === 'tep') return 'bracket_open';
        if (w === 'tel') return 'bracket_close';
        if (w === 'fap') return 'passive';
        if (w === 'nes') return 'negation';
        if (INLINE_GLUE.has(w)) return 'inline_glue';
        if (MATH_OPS.has(w)) return 'math_op';
        if (w === 'sek') return 'list_sep';
        if (PHATIC.has(w)) return 'phatic';
        if (PRONOUNS.has(w) || DEICTICS.has(w)) return 'noun';
        if (VARIABLES.has(w)) return 'variable';
        const pos = entry.part_of_speech;
        if (pos === 'Verb') return 'verb';
        if (pos === 'Modifier') return 'modifier';
        if (pos === 'Prepositions' || pos === 'Preposition') return 'preposition';
        if (pos.endsWith('Noun')) return 'noun';
        return 'particle';
    }

    function tryDerivation(lower, lex) {
        // Rule 5: a legal derivation of a known root is valid even without a
        // dictionary entry (double derivations are rare but legal).
        const tries = SUFFIX_TRY.concat(['']);
        for (const cand of tries) {
            if (cand && !lower.endsWith(cand)) continue;
            const stem = cand ? lower.slice(0, -cand.length) : lower;
            for (const peel of [1, 2]) {
                if (stem.length <= peel) continue;
                const appended = stem.slice(-peel);
                const base = stem.slice(0, -peel);
                if (![...appended].every(ch => VOWELS.has(ch))) continue;
                if (appended.includes('y')) continue;                 // Rule 5.3 preposition ban
                if (!lex.has(base)) continue;
                if (!VOWELS.has(base[base.length - 1])) continue;     // only open-class roots derive
                let trailing = 0;
                for (let k = stem.length - 1; k >= 0 && VOWELS.has(stem[k]); k--) trailing++;
                if (trailing > 3) continue;                           // Rule 5.2
                return {
                    root: stem, suffix: cand, base,
                    note: `legal Rule 5 derivation of '${base}' (+${[...appended].join('+')}) — not yet in the derived dictionary`
                };
            }
        }
        return null;
    }

    // Analyze one word -> token object
    function morph(token, isFirst) {
        const lex = getLexicon();
        const lower = token.toLowerCase();
        const capitalized = token[0] === token[0].toUpperCase() && /[A-Z]/.test(token[0]);
        const T = (o) => Object.assign({ raw: token, kind: 'word', suffix: '', note: null, entry: null, slot: null }, o);

        // Hyphenated Fiwonized borrowing (FiwoNize Tier 2)
        if (token.includes('-')) {
            const idx = token.lastIndexOf('-');
            const head = token.slice(0, idx), tail = token.slice(idx + 1).toLowerCase();
            if (!head || !tail) return T({ root: lower, cat: 'error', error: "dangling hyphen (Tier 2 words need '-' + functional vowel)" });
            const m = tail.match(/^([aeiouy]{1,3})([a-z]*)$/);
            if (!m) return T({ root: lower, cat: 'error', error: 'hyphen must be followed by 1-3 functional vowels' });
            const cat = vowelCat(m[1][m[1].length - 1]);
            const err = checkSuffix(cat, m[2]);
            if (err) return T({ root: head + '-' + m[1], suffix: m[2], cat: 'error', error: err });
            return T({ root: head + '-' + m[1], suffix: m[2], cat, gloss: head + ' (borrowed)', note: 'Fiwonized borrowing (not in lexicon by design)' });
        }

        // Exact lexicon match
        if (lex.has(lower)) {
            const entry = lex.get(lower);
            const cat = classifyExact(lower, entry);
            if (capitalized && !isFirst && cat !== 'mood_tag')
                return T({ root: token, cat: 'proper_noun', gloss: 'proper noun' });
            if (cat === 'verb' && lower === 'hi')
                return T({ root: lower, cat: 'error', error: "naked copula 'hi' is banned (Rule 10.7) — it must carry a suffix" });
            return T({ root: lower, cat, entry, gloss: entry.english_equiv });
        }

        // Strip a known grammatical suffix (longest first: xalidyq -> xali + dyq)
        let root = null, suffix = null, derivNote = null, baseEntry = null;
        for (const cand of SUFFIX_TRY) {
            if (lower.endsWith(cand) && lex.has(lower.slice(0, -cand.length))) {
                root = lower.slice(0, -cand.length);
                suffix = cand;
                baseEntry = lex.get(root);
                break;
            }
        }
        if (root === null) {
            const d = tryDerivation(lower, lex);
            if (d) {
                root = d.root; suffix = d.suffix; derivNote = d.note;
                baseEntry = lex.get(d.base);
            }
        }
        if (root === null) {
            // fall back to last-vowel split for a useful error / proper noun
            let lastV = -1;
            for (let k = lower.length - 1; k >= 0; k--) if (VOWELS.has(lower[k])) { lastV = k; break; }
            if (lastV === -1) {
                if (capitalized) return T({ root: token, cat: 'proper_noun', gloss: 'proper noun' });
                return T({ root: lower, cat: 'error', error: 'no functional vowel' });
            }
            root = lower.slice(0, lastV + 1); suffix = lower.slice(lastV + 1);
            if (!lex.has(root)) {
                if (capitalized) return T({ root: token, cat: 'proper_noun', gloss: 'proper noun' });
                return T({ root, suffix, cat: 'error', error: `root '${root}' not in lexicon` });
            }
            baseEntry = lex.get(root);
            // root known, suffix dirty -> falls through to checkSuffix below
        }
        if (capitalized && !isFirst) return T({ root: token, cat: 'proper_noun', gloss: 'proper noun' });

        const cat = vowelCat(root[root.length - 1]);
        if (lex.has(root) && lex.get(root).part_of_speech === 'Grammar' && !PRONOUNS.has(root) && !DEICTICS.has(root))
            return T({ root, suffix, cat: 'error', error: `grammar particle '${root}' cannot take suffixes` });
        if (cat === 'verb' && root === 'hi' && !suffix)
            return T({ root, cat: 'error', error: "naked copula 'hi' is banned (Rule 10.7)" });
        const err = checkSuffix(cat, suffix);
        if (err) return T({ root, suffix, cat: 'error', error: err });
        const gloss = baseEntry ? baseEntry.english_equiv + (derivNote ? ' (derived)' : '') : '???';
        return T({ root, suffix, cat, entry: baseEntry, gloss, note: derivNote });
    }

    // --- Syntax: SVO-T state machine with bracket stack ---
    function newCtx(opts) {
        return Object.assign({
            state: 'fresh', tagsOk: true, question: false, passive: false,
            ghost: null, openedAs: null, lastWall: null, synPending: false, zcTimeUsed: false
        }, opts || {});
    }

    function parseSentence(sentence) {
        const errors = [];
        const rawTokens = sentence.match(/[A-Za-z][\w'-]*|[.,!?;]/g) || [];
        const tokens = [];
        let isFirst = true;
        rawTokens.forEach(t => {
            if ('.,!?;'.includes(t)) {
                tokens.push({ raw: t, kind: 'punct' });
                if ('.!?'.includes(t)) isFirst = true;
            } else {
                const tok = morph(t, isFirst);
                if (tok.cat === 'error') errors.push(`[${t}] ${tok.error}`);
                tokens.push(tok);
                isFirst = false;
            }
        });
        if (errors.length) return { tokens, errors, valid: false };

        const stack = [newCtx()];
        let pendingPrep = null, pendingGlue = null, pendingNeg = null, lastRoot = null;
        const ctx = () => stack[stack.length - 1];
        const fail = (tok, msg) => { errors.push(`[${tok ? tok.raw : '∅'}] ${msg}`); if (tok) tok.error = msg; };
        const openBrackets = () => stack.filter(c => c.openedAs).length + stack.filter(c => c.synPending).length;

        function closeBracket(tok) {
            const child = stack.pop();
            if (child.synPending) fail(tok, "conditional 'syn' was never resolved by can/pen (Rule 32)");
            const parent = ctx();
            if (child.openedAs === 'complement' && parent.state === 'await_object') parent.state = 'await_time';
        }
        function endSentence(tok) {
            if (pendingPrep) fail(pendingPrep, 'dangling preposition at sentence end — a bridge needs a target (Rule 13.2 / 30.6)');
            if (pendingGlue) fail(pendingGlue[0], 'inline glue (lan/ron) at sentence end has nothing to bind (Rule 27)');
            if (pendingNeg) fail(pendingNeg, "'nes' at sentence end negates nothing (Rule 26)");
            while (stack.length > 1) closeBracket(tok);
            if (ctx().synPending) fail(tok, "conditional 'syn' was never resolved by can/pen (Rule 32)");
            stack.length = 0; stack.push(newCtx());
            pendingPrep = pendingGlue = pendingNeg = lastRoot = null;
        }

        let i = 0;
        while (i < tokens.length) {
            const t = tokens[i];
            const c = ctx();
            if (t.kind === 'punct') { if ('.!?'.includes(t.raw)) endSentence(t); i++; continue; }
            const cat = t.cat;

            // resolve pending preposition target
            if (pendingPrep) {
                const isNum = cat === 'modifier' && NUMBER_WORDS.has(t.root.replace(/t$/, ''));
                if (cat === 'noun' || cat === 'proper_noun' || isNum || (cat === 'variable' && PREP_TARGET_VARS.has(t.root))) {
                    t.slot = 'PrepTarget';
                    if (PREP_TARGET_VARS.has(t.root) && !c.question)
                        fail(t, `interrogative variable '${t.root}' requires the sentence to open with Kup (Rule 12.1)`);
                    pendingPrep = null; pendingNeg = null;
                    if (cat === 'noun' || cat === 'proper_noun') lastRoot = t;
                    i++; continue;
                } else if (cat === 'bracket_close') {
                    if (stack.length > 1) {
                        if (!ctx().ghost) fail(pendingPrep, 'dangling preposition, but the bracket has no ghost target');
                        t.slot = 'GhostMirror';
                        pendingPrep = null; closeBracket(t); i++; continue;
                    }
                    fail(t, "'tel' with no open bracket"); pendingPrep = null; i++; continue;
                } else {
                    fail(pendingPrep, `preposition must be immediately followed by its target — found '${t.raw}' (${cat}) instead (Rule 13.2)`);
                    pendingPrep = null; continue;
                }
            }

            // resolve pending inline glue
            if (pendingGlue) {
                const [glueTok, expected] = pendingGlue;
                if (cat === expected || (expected === 'noun' && cat === 'proper_noun')) {
                    t.slot = glueTok.slot;
                    pendingGlue = null; pendingNeg = null; lastRoot = t;
                    i++; continue;
                } else if (cat === 'negation') {
                    pendingNeg = t; t.slot = 'Neg'; i++; continue;
                } else {
                    fail(glueTok, `inline glue must bind same-category elements — expected ${expected}, found '${t.raw}' (${cat}) (Rule 27)`);
                    pendingGlue = null; continue;
                }
            }

            if (cat === 'mood_tag') {
                if (c.state !== 'fresh' || !c.tagsOk)
                    fail(t, 'mid-sentence mood tags do not exist — a mood tag must be sentence-initial, bracket-initial, or follow a Null-Track reset (Rule 11.1)');
                else { t.slot = 'Mood'; if (t.root === 'kup') c.question = true; }
                i++; continue;
            }
            if (cat === 'passive') {
                if (c.state !== 'fresh') fail(t, "'fap' must sit at clause start, before the SVO track (Rule 16)");
                else { c.passive = true; c.tagsOk = false; t.slot = 'Passive'; }
                i++; continue;
            }
            if (cat === 'phatic' || (t.root === 'suv' && c.state === 'fresh' && tokens[i + 1] && tokens[i + 1].cat === 'proper_noun')) {
                if (cat === 'phatic' && c.state !== 'fresh') {
                    fail(t, `phatic particle '${t.root}' must stand alone on the Null Track — it may not trail inside a clause (Rule 33.3)`);
                    i++; continue;
                }
                t.slot = 'NullTrack';
                if ((t.root === 'jo' || t.root === 'suv') && tokens[i + 1] && tokens[i + 1].cat === 'proper_noun') {
                    i++;
                    while (i < tokens.length && tokens[i].cat === 'proper_noun') { tokens[i].slot = 'NullTrack'; i++; }
                    continue;
                }
                i++; continue;
            }
            if (cat === 'condition') {
                if (c.state !== 'fresh') fail(t, "'syn' must sit at the absolute beginning of its clause (Rule 32.1)");
                else if (openBrackets() >= 2) fail(t, 'depth limit: max 2 open brackets (tep/syn) (Rule 30.5)');
                else { c.synPending = true; c.tagsOk = false; t.slot = 'If'; }
                i++; continue;
            }
            if (cat === 'clausal_wall') {
                let resolved = false;
                for (const cx of stack) {
                    if (cx.synPending && (t.root === 'can' || t.root === 'pen')) { cx.synPending = false; resolved = true; break; }
                }
                t.slot = resolved ? 'Then' : 'Wall';
                c.state = 'fresh'; c.tagsOk = false; c.passive = false; c.lastWall = t.root; lastRoot = null;
                i++; continue;
            }
            if (cat === 'negation') {
                const nxt = tokens[i + 1];
                if (!nxt || nxt.kind === 'punct') {
                    if (c.state === 'fresh') t.slot = 'NullTrack';
                    else fail(t, "'nes' negates what follows it — nothing follows (Rule 26)");
                } else { pendingNeg = t; t.slot = 'Neg'; }
                i++; continue;
            }
            if (cat === 'inline_glue' || cat === 'list_sep') {
                if (!lastRoot) fail(t, 'inline glue/separator needs a completed element to its left (Rule 27/29)');
                else {
                    const expected = (lastRoot.cat === 'verb' || lastRoot.cat === 'modifier') ? lastRoot.cat : 'noun';
                    t.slot = lastRoot.slot;
                    pendingGlue = [t, expected];
                }
                i++; continue;
            }
            if (cat === 'math_op') { t.slot = 'Math'; i++; continue; }
            if (cat === 'particle') { i++; continue; }

            if (pendingNeg) pendingNeg = null;

            if (cat === 'bracket_open') {
                if (openBrackets() >= 2) { fail(t, 'depth limit: max 2 open brackets (tep/syn) in active memory (Rule 30.5)'); i++; continue; }
                let ghost = null, openedAs;
                if (lastRoot && (lastRoot.cat === 'noun' || lastRoot.cat === 'proper_noun')) { ghost = lastRoot; openedAs = 'relative'; }
                else if (c.state === 'await_object') openedAs = 'complement';
                else { openedAs = 'relative'; fail(t, "'tep' must follow a noun (relative clause) or a verb awaiting its object (Rule 30)"); }
                t.slot = openedAs === 'complement' ? '[ object clause' : '[ relative clause';
                stack.push(newCtx({ question: c.question, ghost, openedAs }));
                lastRoot = null;
                i++; continue;
            }
            if (cat === 'bracket_close') {
                if (stack.length === 1) fail(t, "'tel' with no open bracket (Rule 30)");
                else { t.slot = ']'; closeBracket(t); lastRoot = null; }
                i++; continue;
            }
            if (cat === 'modifier') {
                if (t.root === 'je' && lastRoot && NO_JE_PRONOUNS.has(lastRoot.root)) {
                    fail(t, `'je' on first-person pronoun '${lastRoot.root}' — redundancy ban (Rule 6.5)`);
                    i++; continue;
                }
                if (!lastRoot && c.state === 'fresh') {
                    if (NUMBER_WORDS.has(t.root.replace(/t$/, ''))) { t.slot = 'Number'; lastRoot = t; }
                    else fail(t, 'modifier at clause start has nothing to its left to modify (Rule 18)');
                    i++; continue;
                }
                t.slot = '↰ modifies ' + (lastRoot ? lastRoot.raw : '?');
                i++; continue;
            }
            if (cat === 'preposition') {
                if (!lastRoot && c.state === 'fresh') {
                    fail(t, 'preposition at clause start has no root to its left to anchor to (Rule 13)');
                    i++; continue;
                }
                pendingPrep = t;
                t.slot = 'Bridge';
                i++; continue;
            }
            if (cat === 'variable') {
                if (!c.question) fail(t, `interrogative variable '${t.root}' requires the sentence/clause to open with Kup (Rule 12.1)`);
                if (t.root === 'wun') {
                    if (c.state === 'fresh') { t.slot = 'Subject'; c.state = 'await_verb'; lastRoot = t; }
                    else fail(t, "'wun' is the Subject variable — it must sit in Slot 1 (no wh-movement, Rule 12)");
                } else if (t.root === 'wat') {
                    if (c.state === 'await_object') { t.slot = 'Object'; c.state = 'await_time'; lastRoot = t; }
                    else fail(t, "'wat' is the Object variable — it must sit in Slot 3, in situ (no wh-movement, Rule 12)");
                } else if (t.root === 'wis') {
                    if (c.state === 'await_object' || c.state === 'await_time') t.slot = 'Manner';
                    else fail(t, "'wis' must directly follow the verb it questions (Rule 12.5)");
                } else if (t.root === 'wug') {
                    if (lastRoot && (lastRoot.cat === 'noun' || lastRoot.cat === 'proper_noun')) t.slot = 'Quantity';
                    else fail(t, "'wug' must directly follow the noun it quantifies (Rule 12)");
                } else if (t.root === 'wal') {
                    if (c.state === 'fresh' && c.lastWall === 'kad') { t.slot = 'Reason'; c.state = 'closed'; }
                    else fail(t, "'wal' may only appear immediately after the wall 'kad' (Rule 12.5)");
                } else {
                    fail(t, `'${t.root}' is a prepositional-target variable — it must follow a preposition (Rule 12)`);
                }
                i++; continue;
            }
            if (cat === 'proper_noun' && lastRoot && lastRoot.cat === 'proper_noun' && tokens[i - 1] === lastRoot) {
                t.slot = lastRoot.slot; lastRoot = t; i++; continue;   // Rule 4.5 grouping
            }
            if (cat === 'noun' || cat === 'proper_noun') {
                if (c.state === 'fresh') { t.slot = 'Subject'; c.state = 'await_verb'; }
                else if (c.state === 'await_verb') { t.slot = 'Predicate (Zero Copula)'; c.state = 'closed_zc'; }
                else if (c.state === 'await_object') {
                    if (TEMPORAL_ROOTS.has(t.root)) { t.slot = 'Time'; c.state = 'closed'; }
                    else { t.slot = 'Object'; c.state = 'await_time'; }
                } else if (c.state === 'await_time') {
                    if (t.root.endsWith('u')) { t.slot = 'Time'; c.state = 'closed'; }
                    else fail(t, 'SVO-T overflow: only a temporal Abstract Noun (-u) may follow the Object (Rule 10)');
                } else if (c.state === 'closed_zc') {
                    if (t.root.endsWith('u') && !c.zcTimeUsed) { t.slot = 'Time'; c.zcTimeUsed = true; }
                    else fail(t, 'clause already closed by Zero Copula — a new noun needs a clausal wall (Rule 10.5)');
                } else fail(t, 'SVO track closed — an additional noun needs a clausal wall or bracket (Rule 28/30)');
                lastRoot = t; i++; continue;
            }
            if (cat === 'verb') {
                if (c.state === 'fresh') { t.slot = 'Verb (implied subject)'; c.state = 'await_object'; }
                else if (c.state === 'await_verb') { t.slot = 'Verb'; c.state = 'await_object'; }
                else if (c.state === 'await_object') {
                    if (t.suffix === 't') t.slot = 'Verb (serial)';
                    else fail(t, "two consecutive verbs — the secondary verb needs the '-t' infinitive linker (Rule 15)");
                } else if (c.state === 'closed_zc') {
                    fail(t, 'Zero Copula already closed this clause — a verb here is the classic parser crash (Rule 10.5)');
                } else fail(t, 'SVO track closed — a new verb needs a clausal wall or bracket (Rule 28/30)');
                lastRoot = t; i++; continue;
            }
            i++;
        }
        if (!tokens.some(t => t.kind === 'punct' && '.!?'.includes(t.raw))) endSentence(tokens[tokens.length - 1] || null);

        return { tokens, errors, valid: errors.length === 0 };
    }

    window.FiwoParser = { parseSentence, suffixMeaning, analyze: (w) => morph(w, true) };
})();
