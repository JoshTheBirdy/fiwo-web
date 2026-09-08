/*
 * THE FIWO LANGUAGE INTERFACE
 * Copyright (c) 2026 Joshua Leon Arkema Barends
 * This code is part of the Fiwo Language project.
 * Source Code License: CC BY 4.0 (Attribution Required)
 */

// Toggle side navigation
const menuBtn = document.getElementById('menu-btn');
const sideNav = document.getElementById('side-nav');
const navOverlay = document.getElementById('nav-overlay');
const navLinks = document.querySelectorAll('.side-nav a');
const pages = document.querySelectorAll('.page');

const posColors = {
    "Noun": "#001dab",
    "Biological Noun": "#001dab",
    "Concrete Noun": "#001dab",
    "Abstract Noun": "#001dab",
    "Verb": "#bc0000",
    "Modifier": "#3f9022",
    "Prepositions": "#ff6600",
    "Grammar": "#666666"
};
// Nav open/close helpers
function openNav() {
    sideNav.classList.add('active');
    navOverlay.classList.add('active');
    menuBtn.classList.add('active');
}

function closeNav() {
    sideNav.classList.remove('active');
    navOverlay.classList.remove('active');
    menuBtn.classList.remove('active');
}

// Toggle nav on menu button click
menuBtn.addEventListener('click', () => {
    if (sideNav.classList.contains('active')) {
        closeNav();
    } else {
        openNav();
    }
});

// Close nav when overlay is clicked
navOverlay.addEventListener('click', () => {
    closeNav();
});

// ============================================
// SECTION ROUTING
// ============================================
// The URL fragment is the single source of truth for which section is showing.
// Everything routes through the hash so that a link to `#rules` opens the
// Rulebook, and so Back walks the sections instead of leaving the site.
const SECTION_IDS = new Set(Array.from(pages, page => page.id));
const DEFAULT_SECTION = 'home';

/* The hash is `#section` or `#section/detail` — `#rules/12` is Rule 12.
 *
 * A sub-path rather than a bare `#rule-12` anchor because the sections are
 * tabs: the fragment has to say which tab to open before anything can be
 * scrolled to, and the browser's own anchor jump would fire against a hidden
 * element. */
function parseRoute(hash) {
    const raw = hash.replace(/^#/, '');
    // Split on the FIRST slash only, so the detail keeps any later ones.
    // encodeURIComponent escapes `/` on the way out, so a shared translation
    // normally arrives clean — but a hand-typed or partly-decoded URL does not,
    // and `split('/')` would silently truncate the sentence at that point.
    const cut = raw.indexOf('/');
    if (cut === -1) return { section: raw, detail: null };
    return { section: raw.slice(0, cut), detail: raw.slice(cut + 1) || null };
}

function showSection(targetId, { scroll = true, detail = null } = {}) {
    if (!SECTION_IDS.has(targetId)) return false;

    navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${targetId}`));
    pages.forEach(page => page.classList.toggle('active', page.id === targetId));

    // The Rulebook gets a floating side TOC. The workbook used to as well; its
    // panel is now part of the page rather than bolted to the viewport, because
    // it carries per-lesson progress and has to sit beside the lesson it
    // describes.
    document.body.classList.toggle('rules-active', targetId === 'rules');

    // The dictionary builds its cards lazily, so a deep link has to trigger it
    // too — not just a nav click. Binding inside is already guarded (see below).
    if (targetId === 'dictionary') {
        renderDictionary();
    }

    // The deck fetches a 1.4 MB bundle, so it loads on arrival rather than at
    // page load. `flashcards.js` is a module and therefore evaluates AFTER this
    // script, so on a cold deep link this call finds nothing — the module checks
    // for an already-active section when it publishes itself.
    if (targetId === 'flashcards') {
        window.FiwoFlashcards?.open();
    }

    // `#workbook/L12` — the detail is the lesson, and it is passed straight
    // through rather than handled below with the other details, because the
    // workbook has 46 of them and no lesson means "the one you were last on".
    if (targetId === 'workbook') {
        window.FiwoWorkbook?.open(detail);
        closeNav();
        return true;
    }

    // A detail always wins over the top-of-page scroll: you asked for Rule 12,
    // not for the Rulebook.
    if (detail && targetId === 'rules' && scrollToRule(detail)) {
        closeNav();
        return true;
    }

    if (detail && targetId === 'translator') {
        restoreTranslation(detail);
    }

    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    closeNav();
    return true;
}

/* Scroll to a rule by its REAL number, not its position in the list.
 *
 * The scrollspy already stamps `rule-spy-N` ids, but N there is the index of
 * the heading — insert Rule 12a and every anchor below it silently starts
 * pointing at the wrong rule, which is exactly the property a citable link
 * must not have. `rule-12` is parsed out of the heading text instead, so it
 * survives insertions and reorderings. */
/* The browser restores the previous scroll position after load, which lands
 * on top of a deep link's own scroll and undoes it. We route the fragment
 * ourselves, so there is nothing for the browser's restoration to usefully do. */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function scrollToRule(number) {
    const target = document.getElementById(`rule-${number}`);
    if (!target) return false;

    // On a cold load the scroll has to wait for `load`, not just a frame: the
    // rulebook is ~67,000px of text and web fonts are still swapping in, so a
    // position measured earlier is measured against the wrong layout — and the
    // browser's scroll restoration fires after load and overwrites it anyway.
    const run = () => requestAnimationFrame(() => {
        // Jump, never smooth-scroll. The rulebook is ~67,000px tall and Rule 23
        // sits 36,000px down; a smooth scroll over that distance takes seconds.
        //
        // `html { scroll-behavior: smooth }` is set globally, and a section
        // change kicks off a scroll-to-top that can be 60,000px long — several
        // seconds of animation. Arriving at a rule mid-flight meant that dying
        // animation kept running and dragged the page straight back off it.
        //
        // Passing `behavior: 'auto'` to scrollTo is NOT enough to cancel a
        // smooth scroll already in progress. Suppressing the CSS property for
        // the duration, and using the legacy two-argument form, is.
        const top = window.scrollY + target.getBoundingClientRect().top;
        const html = document.documentElement;
        const previous = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        window.scrollTo(0, top);
        html.style.scrollBehavior = previous;
        target.classList.add('rule-targeted');
        setTimeout(() => target.classList.remove('rule-targeted'), 2200);
    });

    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
    return true;
}

// Handle navigation links for SPA feel. These only write the hash; the
// hashchange listener does the work, so clicking a link and pasting a URL take
// exactly the same path and cannot drift apart.
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        if (location.hash === `#${targetId}`) {
            showSection(targetId);   // same hash fires no event — switch directly
        } else {
            location.hash = targetId;
        }
    });
});

// Back/forward, and any other hash change. The rulebook's scrollspy TOC calls
// preventDefault and scrolls itself, so its `#rule-spy-N` links never land here.
window.addEventListener('hashchange', () => {
    const { section, detail } = parseRoute(location.hash);
    if (!showSection(section, { detail })) showSection(DEFAULT_SECTION);
});

// Open whatever the URL asks for. An unknown fragment falls back to home rather
// than showing nothing, and the initial view is not smooth-scrolled.
//
// Deferred to a microtask ON PURPOSE. This is the first code that can run a
// section's initialiser during script evaluation, and `renderDictionary()`
// reaches `revealObserver` — a `const` declared near the bottom of this file.
// Reading a `const` in its temporal dead zone throws even through `typeof`, so
// a direct call here rendered exactly one card and then died silently, leaving
// the search box unbound. A microtask runs once the whole script has evaluated,
// by which point every top-level binding exists.
queueMicrotask(() => {
    const { section, detail } = parseRoute(location.hash);
    if (!showSection(section, { scroll: false, detail })) {
        showSection(DEFAULT_SECTION, { scroll: false });
    }
});

/* "Start here" steps that do not just navigate — they set the destination up
 * first. Sending someone to a 3,267-entry dictionary sorted A-Z is the problem
 * the step exists to solve, so the button arrives with the filters already on.
 *
 * Delegated from the document because the section is static markup and this
 * runs before the dictionary has ever been rendered. */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    e.preventDefault();
    const target = btn.dataset.goto;

    if (target === 'dictionary') {
        // Written through FiwoStore so the choice sticks — the reader who
        // followed this step gets the same view next visit, rather than being
        // dropped back at A-Z having been shown something better once.
        if (btn.dataset.tier) FiwoStore.setPref('dict.tier', btn.dataset.tier);
        if (btn.dataset.sort) FiwoStore.setPref('dict.sort', btn.dataset.sort);
        const apply = () => {
            const tier = document.getElementById('tier-filter');
            const sort = document.getElementById('sort-order');
            if (btn.dataset.tier && tier) tier.value = btn.dataset.tier;
            if (btn.dataset.sort && sort) sort.value = btn.dataset.sort;
            renderDictionary();
        };
        // showSection() renders the dictionary itself, so set the controls
        // after it has switched tabs and then re-render with them applied.
        if (location.hash === '#dictionary') { apply(); }
        else { location.hash = 'dictionary'; requestAnimationFrame(apply); }
        return;
    }

    if (target === 'story') {
        // "easiest" is whichever story the grader put first, so this keeps
        // pointing at the right one as the library grows.
        if (typeof storyData === 'undefined' || !storyData.length) return;
        location.hash = 'lets-read';
        requestAnimationFrame(() => openStory(storyData[0]));
        return;
    }

    location.hash = target;
});

// ═══════════════════════════════════════════
//   § DICTIONARY
// ═══════════════════════════════════════════

// Bound morphemes (`-p`, `-dyq`, `-e`…) are grammar, not vocabulary. They can
// never stand alone as a token, and the corpus count agrees: all 18 score
// exactly 0 occurrences across 5,171 sentences. Sorting put them first, so they
// were the first sixteen cards anyone ever saw in a 3,267-word lexicon.
//
// They stay in Canon/lexicon.json — the parser, the AI instruction pack and the
// app's flashcards all need them — but they are not dictionary entries here.
// The Rule Book documents every one, and the reader's word panel glosses them
// live via FiwoParser.suffixMeaning().
const isBoundMorpheme = item => item.word.startsWith('-');

const coreEntries = dictionaryData.filter(item => !isBoundMorpheme(item));
const derivedEntries = typeof derivedDictionaryData !== 'undefined' ? derivedDictionaryData : [];

// root -> its derived forms, so a root can show the family it heads.
const familyByRoot = derivedEntries.reduce((map, entry) => {
    if (entry.root) (map[entry.root] = map[entry.root] || []).push(entry);
    return map;
}, Object.create(null));

// Any headword -> its record, for following family links in either direction.
const entryByWord = Object.create(null);
for (const entry of [...coreEntries, ...derivedEntries]) entryByWord[entry.word] = entry;

// A derived word carries no tier of its own, but it is exactly as learnable as
// the root it is built on — if you know `gluji`, `glujia` is not new vocabulary.
// So it inherits, rather than being dumped in a default bucket.
function effectiveTier(item) {
    if (typeof item.tier === 'number') return item.tier;
    const root = item.root && entryByWord[item.root];
    return root && typeof root.tier === 'number' ? root.tier : null;
}

const SORTERS = {
    alpha: (a, b) => a.word.localeCompare(b.word),
    // Unattested words (freq 0) fall to the bottom rather than scattering.
    freq: (a, b) => (b.freq || 0) - (a.freq || 0) || a.word.localeCompare(b.word),
    // "Easiest first": learn tier by tier, and inside a tier take the words you
    // will actually meet first.
    tier: (a, b) => (effectiveTier(a) ?? 9) - (effectiveTier(b) ?? 9)
        || (b.freq || 0) - (a.freq || 0)
        || a.word.localeCompare(b.word),
};

function renderDictionary() {
    const searchBar = document.getElementById('search-bar');
    const dictionaryFilter = document.getElementById('dictionary-filter');
    const posFilter = document.getElementById('pos-filter');
    const tierFilter = document.getElementById('tier-filter');
    const sortOrder = document.getElementById('sort-order');
    const wordCount = document.getElementById('word-count');
    const grid = document.getElementById('dictionary-grid');

    function updateDisplay() {
        const scope = dictionaryFilter ? dictionaryFilter.value : 'core';
        let data = scope === 'core' ? coreEntries
            : scope === 'derived' ? derivedEntries
                : [...coreEntries, ...derivedEntries];

        // Searching only the word and the English key meant "boat" missed every
        // entry keyed "Vessel" that says boat in its definition. The definition
        // and the derived senses are where the synonyms actually live.
        const q = searchBar.value.trim().toLowerCase();
        if (q) {
            data = data.filter(item =>
                item.word.toLowerCase().includes(q)
                || (item.english_equiv || '').toLowerCase().includes(q)
                || (item.definition || '').toLowerCase().includes(q)
                || (item.senses || []).some(s => s.toLowerCase().includes(q)));
        }

        if (posFilter.value) {
            data = data.filter(item => {
                const pos = item.part_of_speech || '';
                // "Noun" covers the three noun classes; canon labels prepositions "Prepositions".
                if (posFilter.value === 'Noun') return pos.includes('Noun');
                return pos === posFilter.value || pos === posFilter.value + 's';
            });
        }

        if (tierFilter.value) {
            const want = Number(tierFilter.value);
            data = data.filter(item => effectiveTier(item) === want);
        }

        data = [...data].sort(SORTERS[sortOrder.value] || SORTERS.alpha);
        wordCount.textContent = `Words: ${data.length}`;

        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card reveal-on-scroll';
            const tier = effectiveTier(item);
            card.innerHTML = `
                <div class="pos-dot" style="background-color: ${posColors[item.part_of_speech] || '#c6c6c6'}"></div>
                ${item.freq ? `<span class="card-freq" title="Used ${item.freq} times in the corpus">${item.freq}</span>` : ''}
                <div class="fiwo-word">${esc(item.word)}</div>
                <div class="english-equiv">${esc(item.english_equiv)}</div>
                <div class="part-speech">${esc(item.part_of_speech)}${tier !== null ? ` · T${tier}` : ''}</div>
            `;
            card.addEventListener('click', () => openEntry(item));
            frag.appendChild(card);
            if (typeof revealObserver !== 'undefined') revealObserver.observe(card);
        });
        grid.appendChild(frag);
    }

    // renderDictionary() runs on every visit to the tab — bind the controls, and
    // restore the last-used filters, only once.
    if (!grid.dataset.controlsBound) {
        const PREFS = [
            [dictionaryFilter, 'dict.scope'],
            [posFilter, 'dict.pos'],
            [tierFilter, 'dict.tier'],
            [sortOrder, 'dict.sort'],
        ];
        for (const [control, key] of PREFS) {
            if (!control) continue;
            const saved = FiwoStore.getPref(key, null);
            // Guard against a stale preference naming an option that no longer
            // exists — a removed filter would otherwise render an empty grid.
            if (saved !== null && [...control.options].some(o => o.value === saved)) {
                control.value = saved;
            }
            control.addEventListener('change', () => {
                FiwoStore.setPref(key, control.value);
                updateDisplay();
            });
        }
        // The search box is deliberately NOT remembered: reopening the tab to a
        // filtered-down list with no visible reason is disorienting.
        searchBar.addEventListener('input', updateDisplay);
        grid.dataset.controlsBound = '1';
    }

    updateDisplay();
}

// The headword shows up inflected — `guto` appears as `gutop` — so match the
// stem plus whatever suffix follows it. Escaping runs first and only ever adds
// entity punctuation, so it cannot create a false word boundary.
function highlightHeadword(sentence, word) {
    const stem = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(sentence).replace(new RegExp(`\\b(${stem}[a-z]*)\\b`, 'gi'),
        '<strong>$1</strong>');
}

// `freq` counts uses of a word ANYWHERE EXCEPT the reference sentence written
// to demonstrate it — otherwise every word in the lexicon would score a free
// occurrence and the ranking would flatten. That makes a plain "not attested"
// misleading for a word whose example sits right below the tag, so the two
// cases are named apart.
function attestationTag(item) {
    if (item.freq) {
        return `<span class="entry-tag" title="Times this word is used across the corpus — stories, course and reference material — not counting the example sentence written for it">Used ${item.freq}× · #${item.freq_rank}</span>`;
    }
    if (item.example) {
        return `<span class="entry-tag entry-tag-dim" title="It has a reference sentence, but has not yet been used anywhere else">Only in its own example</span>`;
    }
    return `<span class="entry-tag entry-tag-dim" title="Coined, but not yet used in any story or sentence">Not yet attested</span>`;
}

function familyChip(entry) {
    const arrow = entry.derivation_path ? `<span class="chip-path">${esc(entry.derivation_path)}</span>` : '';
    return `<button class="family-chip" data-word="${esc(entry.word)}"
                    title="${esc(entry.path_gloss || entry.english_equiv || '')}">
                <span class="chip-word">${esc(entry.word)}</span>${arrow}
                <span class="chip-gloss">${esc(entry.english_equiv || '')}</span>
            </button>`;
}

function openEntry(item) {
    const tier = effectiveTier(item);
    const pron = typeof FiwoPronounce !== 'undefined' ? FiwoPronounce.pronounceHtml(item.word) : '';
    const family = familyByRoot[item.word] || [];
    const parent = item.root ? entryByWord[item.root] : null;

    const meta = [
        `<span class="entry-tag">${esc(item.part_of_speech)}</span>`,
        tier !== null ? `<span class="entry-tag" title="How early this word is taught">Tier ${tier}</span>` : '',
        attestationTag(item),
    ].filter(Boolean).join('');

    document.getElementById('definition-modal-title').textContent = item.word;
    document.getElementById('definition-modal-body').innerHTML = `
        <div class="entry-meta">${meta}</div>
        ${pron ? `<p class="entry-row"><strong>Pronunciation:</strong> ${pron}</p>` : ''}
        <p class="entry-row"><strong>English:</strong> ${esc(item.english_equiv)}</p>
        <p class="entry-row"><strong>Definition:</strong> ${esc(item.definition)}</p>
        ${item.usage_note ? `<p class="entry-usage"><strong>Usage:</strong> ${esc(item.usage_note)}</p>` : ''}
        ${item.senses && item.senses.length ? `<p class="entry-row"><strong>Senses:</strong> ${item.senses.map(esc).join(' · ')}</p>` : ''}
        ${item.example ? `
            <div class="entry-example">
                <span class="entry-example-label">In use</span>
                <p class="entry-example-fiwo">${highlightHeadword(item.example.fiwo, item.word)}</p>
                <p class="entry-example-en">${esc(item.example.english)}</p>
            </div>` : ''}
        ${parent ? `
            <div class="entry-family">
                <span class="entry-example-label">Built from</span>
                <div class="family-chips">${familyChip(parent)}</div>
            </div>` : ''}
        ${family.length ? `
            <div class="entry-family">
                <span class="entry-example-label">Derives into ${family.length} form${family.length > 1 ? 's' : ''}</span>
                <div class="family-chips">${family.map(familyChip).join('')}</div>
            </div>` : ''}
    `;
    document.getElementById('definition-modal').style.display = 'block';
}

// One delegated listener: family chips are rebuilt on every open, so binding
// them individually would leak a handler per chip per view.
document.getElementById('definition-modal-body').addEventListener('click', (e) => {
    const chip = e.target.closest('.family-chip');
    if (chip && entryByWord[chip.dataset.word]) openEntry(entryByWord[chip.dataset.word]);
});

// Close definition modal
document.getElementById('close-definition-modal').addEventListener('click', () => {
    document.getElementById('definition-modal').style.display = 'none';
});

// Close definition modal on outside click
window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('definition-modal')) {
        document.getElementById('definition-modal').style.display = 'none';
    }
});

// Close any open modal with Escape key.
//
// The modal is the topmost layer, so it consumes the keypress: the reader has
// its own Escape handler, also on window, and one press must not close the
// entry AND the word panel underneath it. stopImmediatePropagation is what
// makes that hold regardless of which handler ran first — this one closing the
// modal before the reader's handler tested it was exactly the bug.
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const definitionModal = document.getElementById('definition-modal');
        if (definitionModal && definitionModal.style.display === 'block') {
            definitionModal.style.display = 'none';
            e.stopImmediatePropagation();
        }
    }
});



// ============================================
// RULEBOOK SCROLLSPY TOC
// ============================================
function initScrollspy() {
    const rulesSection = document.getElementById('rules');
    if (!rulesSection) return;

    const tocNav = document.createElement('nav');
    tocNav.className = 'toc-nav toc-rules';
    const tocUl = document.createElement('ul');
    tocNav.appendChild(tocUl);

    const ruleHeaders = Array.from(rulesSection.querySelectorAll('h3')).filter(h3 => h3.textContent.startsWith('Rule'));
    if (ruleHeaders.length === 0) return;

    ruleHeaders.forEach((header, index) => {
        // Keyed on the rule's own number, so `#rules/12` is Rule 12 forever.
        // The old `rule-spy-N` was the heading's INDEX: insert a rule and every
        // link below it quietly starts pointing one rule out.
        const numberMatch = header.textContent.match(/Rule (\d+(?:\.\d+)?)/);
        const ruleNumber = numberMatch ? numberMatch[1] : String(index + 1);
        const ruleId = `rule-${ruleNumber}`;
        header.id = ruleId;

        const labelText = numberMatch ? `Rule ${ruleNumber}` : `Rule ${index + 1}`;

        // A citable link on every rule. Copies the absolute URL, because the
        // point is to paste it into a conversation.
        const permalink = document.createElement('button');
        permalink.className = 'rule-permalink';
        permalink.type = 'button';
        permalink.textContent = '#';
        permalink.title = `Copy a link to ${labelText}`;
        permalink.setAttribute('aria-label', `Copy a link to ${labelText}`);
        permalink.addEventListener('click', async (e) => {
            e.stopPropagation();
            const url = `${location.origin}${location.pathname}#rules/${ruleNumber}`;
            try {
                await navigator.clipboard.writeText(url);
                permalink.classList.add('copied');
                permalink.textContent = '✓';
            } catch {
                // Clipboard needs a secure context; putting it in the URL bar
                // is still a usable outcome.
                location.hash = `rules/${ruleNumber}`;
                permalink.classList.add('copied');
            }
            setTimeout(() => {
                permalink.classList.remove('copied');
                permalink.textContent = '#';
            }, 1600);
        });
        header.appendChild(permalink);

        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#rules/${ruleNumber}`;
        // The heading id is `rule-12` but the link is `#rules/12`, so the
        // scrollspy matches on this rather than reconstructing the href.
        a.dataset.rule = ruleId;
        a.textContent = labelText;
        a.title = header.textContent.replace(/#$/, '');

        a.addEventListener('click', (e) => {
            e.preventDefault();
            header.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        li.appendChild(a);
        tocUl.appendChild(li);
    });

    document.body.appendChild(tocNav);

    let activeTocLink = null;
    
    const tocObserverOptions = {
        root: null,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
    };

    const tocObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (activeTocLink) activeTocLink.classList.remove('active');
                const link = tocNav.querySelector(`a[data-rule="${entry.target.id}"]`);
                if (link) {
                    link.classList.add('active');
                    activeTocLink = link;
                    link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });
    }, tocObserverOptions);

    ruleHeaders.forEach(header => tocObserver.observe(header));
}

/* The workbook's side panel used to be built here, by scraping `h2` headings
 * out of the course prose that `update_workbook.mjs` injected into index.html.
 * Both are gone: the course is data now (`workbook.js`), one lesson renders at
 * a time, and the panel is built from the phase/lesson model with mastery on
 * each row. See workbook-page.js.
 *
 * Worth remembering why the old one is not missed. It spent five weeks doing
 * nothing — it matched heading text against "Chapter", which is what v3 called
 * its units, and when the site moved to v4 in 2026-07 they became "Lesson" and
 * the early return fired silently on every load. A panel built from the data
 * cannot drift from the data. */

// Initialize on load
initScrollspy();



// ============================================
// TRANSLATOR FEATURE
// Rendering for the rulebook-accurate parser in fiwo-parser.js
// ============================================

// category -> css class + human label
const catInfo = {
    noun:          { cls: 'tok-noun',    label: 'Noun' },
    proper_noun:   { cls: 'tok-proper',  label: 'Proper Noun' },
    verb:          { cls: 'tok-verb',    label: 'Verb' },
    modifier:      { cls: 'tok-mod',     label: 'Modifier' },
    preposition:   { cls: 'tok-prep',    label: 'Preposition' },
    mood_tag:      { cls: 'tok-mood',    label: 'Mood Tag' },
    clausal_wall:  { cls: 'tok-wall',    label: 'Clausal Wall' },
    condition:     { cls: 'tok-wall',    label: 'Condition (syn)' },
    bracket_open:  { cls: 'tok-bracket', label: 'Open Bracket' },
    bracket_close: { cls: 'tok-bracket', label: 'Close Bracket' },
    passive:       { cls: 'tok-mood',    label: 'Passive Flag' },
    negation:      { cls: 'tok-wall',    label: 'Negation' },
    inline_glue:   { cls: 'tok-glue',    label: 'Inline Glue' },
    list_sep:      { cls: 'tok-glue',    label: 'Separator' },
    math_op:       { cls: 'tok-glue',    label: 'Math Operator' },
    phatic:        { cls: 'tok-mood',    label: 'Phatic (Null Track)' },
    repair:        { cls: 'tok-wall',    label: 'Repair (Rule 39)' },
    variable:      { cls: 'tok-var',     label: 'Question Variable' },
    particle:      { cls: 'tok-glue',    label: 'Particle' },
    error:         { cls: 'tok-err',     label: 'Error' }
};

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// A word rendered as root + highlighted suffix, keeping original casing
function wordHtml(tok) {
    const info = catInfo[tok.cat] || catInfo.particle;
    const suffixLen = (tok.suffix || '').length;
    const rawRoot = suffixLen ? tok.raw.slice(0, tok.raw.length - suffixLen) : tok.raw;
    const rawSuffix = suffixLen ? tok.raw.slice(tok.raw.length - suffixLen) : '';
    return `<span class="tok ${info.cls}${tok.error ? ' tok-has-error' : ''}">${esc(rawRoot)}${rawSuffix ? `<span class="tok-suffix">${esc(rawSuffix)}</span>` : ''}</span>`;
}

function slotChipHtml(tok) {
    if (!tok.slot) return '';
    const structural = ['Mood', 'Wall', 'Then', 'If', 'Passive', 'NullTrack', 'Neg'].includes(tok.slot)
        || tok.slot.startsWith('[') || tok.slot === ']';
    const core = ['Subject', 'Object', 'Time', 'Predicate (Zero Copula)'].includes(tok.slot) || tok.slot.startsWith('Verb');
    const cls = core ? 'slot-core' : (structural ? 'slot-struct' : 'slot-minor');
    return `<span class="slot-chip ${cls}"><span class="slot-name">${esc(tok.slot)}</span>${esc(tok.raw)}</span>`;
}

function glossCardHtml(tok, idx) {
    const info = catInfo[tok.cat] || catInfo.particle;
    const suffixes = [];
    if (tok.suffix) suffixes.push(`<span class="gloss-suffix">-${esc(tok.suffix)}</span> ${esc(FiwoParser.suffixMeaning(tok.suffix, tok.cat))}`);
    // slot label is only interesting for words that fill SVO-T slots — for
    // structural particles the category label already says everything
    const structuralCats = ['mood_tag', 'clausal_wall', 'condition', 'passive', 'phatic', 'repair',
        'negation', 'bracket_open', 'bracket_close', 'inline_glue', 'list_sep', 'math_op', 'particle'];
    const showSlot = tok.slot && !structuralCats.includes(tok.cat)
        && tok.slot.toLowerCase() !== info.label.toLowerCase();
    const pron = (typeof FiwoPronounce !== 'undefined' && !tok.error)
        ? FiwoPronounce.pronounceHtml(tok.raw, { syllables: false }) : '';
    return `
        <div class="gloss-card ${tok.error ? 'gloss-error' : ''}" data-tok="${idx}">
            <div class="gloss-word">${wordHtml(tok)}</div>
            ${pron ? `<div class="gloss-pron">${pron}</div>` : ''}
            <div class="gloss-meaning">${esc(tok.error ? '✗ ' + tok.error : (tok.gloss || '—'))}</div>
            ${suffixes.length ? `<div class="gloss-suffix-row">${suffixes.join('<br>')}</div>` : ''}
            <div class="gloss-footer">
                <span class="gloss-cat ${info.cls}">${info.label}</span>
                ${showSlot ? `<span class="gloss-slot">${esc(tok.slot)}</span>` : ''}
            </div>
            ${tok.note ? `<div class="gloss-note">${esc(tok.note)}</div>` : ''}
        </div>`;
}

const translateTextBtn = document.getElementById('translate-text-btn');
const translatorInput = document.getElementById('translator-input');
const translatorOutput = document.getElementById('translator-output');

function runTranslator() {
    const text = translatorInput.value.trim();
    if (!text) return;

    if (typeof dictionaryData === 'undefined' || typeof FiwoParser === 'undefined') {
        translatorOutput.innerHTML = '<div style="color: #ff6b6b; font-weight: bold;">Error: dictionary.js / fiwo-parser.js missing. Ensure both are uploaded to your live website!</div>';
        return;
    }

    translatorOutput.innerHTML = '';
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

    sentences.forEach(sentenceText => {
        const s = sentenceText.trim();
        if (!s) return;
        const result = FiwoParser.parseSentence(s);
        const words = result.tokens.filter(t => t.kind === 'word');

        const fiwoLine = result.tokens
            .map(t => t.kind === 'punct' ? `<span class="tok-punct">${esc(t.raw)}</span>` : wordHtml(t))
            .join(' ');

        const slotStrip = words.map(slotChipHtml).filter(Boolean).join('');
        const glossCards = words.map((t, i) => glossCardHtml(t, i)).join('');

        const errBanner = result.errors.length
            ? `<div class="trans-errors"><strong>✗ Not a valid Fiwo sentence</strong><ul>${result.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`
            : `<div class="trans-valid">✓ Mathematically valid — single deterministic parse</div>`;

        const rawJson = JSON.stringify({
            sentence: s,
            valid: result.valid,
            errors: result.errors,
            tokens: words.map(t => ({ raw: t.raw, root: t.root, suffix: t.suffix, category: t.cat, slot: t.slot, note: t.note }))
        }, null, 2);

        const wrapper = document.createElement('div');
        wrapper.className = 'trans-sentence-wrapper';
        wrapper.innerHTML = `
            <div class="trans-fiwo-line">${fiwoLine}</div>
            ${errBanner}
            <div class="trans-slot-strip">${slotStrip}</div>
            <div class="trans-gloss-row">${glossCards}</div>
            <details class="trans-raw">
                <summary>Raw parser output</summary>
                <pre>${esc(rawJson)}</pre>
            </details>`;

        // click a gloss card -> open the dictionary definition modal
        wrapper.querySelectorAll('.gloss-card').forEach(card => {
            const tok = words[Number(card.dataset.tok)];
            if (!tok || !tok.entry) return;
            card.classList.add('gloss-clickable');
            card.addEventListener('click', (e) => {
                if (e.target.closest('.pron-speak')) return;
                document.getElementById('definition-modal-title').textContent = tok.entry.word;
                const pron = typeof FiwoPronounce !== 'undefined' ? FiwoPronounce.pronounceHtml(tok.entry.word) : '';
                document.getElementById('definition-modal-body').innerHTML = `
                    ${pron ? `<p><strong>Pronunciation:</strong> ${pron}</p>` : ''}
                    <p><strong>English Equivalent:</strong> ${esc(tok.entry.english_equiv)}</p>
                    <p><strong>Part of Speech:</strong> ${esc(tok.entry.part_of_speech)}</p>
                    <p><strong>Definition:</strong> ${esc(tok.entry.definition)}</p>`;
                document.getElementById('definition-modal').style.display = 'block';
            });
        });

        translatorOutput.appendChild(wrapper);
    });
}

if (translateTextBtn && translatorInput && translatorOutput) {
    const shareBtn = document.getElementById('translate-share-btn');

    translateTextBtn.addEventListener('click', () => {
        runTranslator();
        // Writing the parse into the URL is what makes it shareable, but it must
        // not push a history entry per click — Back would then walk through every
        // sentence you tried instead of leaving the translator.
        const text = translatorInput.value.trim();
        if (text) {
            history.replaceState(null, '', `#translator/${encodeURIComponent(text)}`);
            if (shareBtn) shareBtn.hidden = false;
        }
    });

    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = location.href;
            try {
                await navigator.clipboard.writeText(url);
                shareBtn.textContent = 'Link copied';
            } catch {
                // Clipboard needs a secure context. The URL bar already holds
                // the right link, so say so rather than failing silently.
                shareBtn.textContent = 'Copy it from the address bar';
            }
            setTimeout(() => { shareBtn.textContent = 'Copy link'; }, 2000);
        });
    }
    translatorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            translateTextBtn.click();
        }
    });
}

/* `#translator/<text>` restores the input and runs it, so a parse can be pasted
 * into a conversation and arrive showing its working.
 *
 * Only the FIRST segment is decoded: a Fiwo sentence can legitimately contain a
 * `/` (Rule 25's division operator), and split() would otherwise truncate it. */
function restoreTranslation(encoded) {
    if (!translatorInput || !encoded) return false;
    let text;
    try {
        text = decodeURIComponent(encoded);
    } catch {
        return false;   // hand-mangled percent-escapes; fall through to an empty translator
    }
    // A shared link is always a parse, so make sure that pane is the one showing.
    setComposerMode('parse');
    translatorInput.value = text;
    runTranslator();
    const shareBtn = document.getElementById('translate-share-btn');
    if (shareBtn) shareBtn.hidden = false;
    return true;
}

// ============================================
// COMPOSER — English → Fiwo, built by hand
// ============================================
//
// Deliberately NOT a translator. A black-box English→Fiwo engine would produce
// confident, wrong Fiwo and give the reader no way to see where it went wrong,
// which is the opposite of what this language is for. So this finds candidate
// words, holds the sentence structure, applies the morphology you ask for, and
// then submits the result to the SAME parser as the other tab. Every step is
// visible and every step is yours.

// Rule 3: the final vowel is the category. Rule 5 shifts category by APPENDING
// a vowel — `guto` + `i` -> `gutoi` — never by replacing one, because
// morphology is strictly right-edged (Design decisions R5.4).
const CATEGORY_VOWEL = { bio: 'a', concrete: 'o', abstract: 'u', verb: 'i', modifier: 'e' };

// Suffixes offered per category, mirroring validate_sentence.py's tables. Only
// the ones a learner needs to build a first sentence — the full set is Rule 13
// and following, and the Rulebook is one tab away.
const COMPOSER_SUFFIXES = {
    noun: [['', 'unmarked'], ['p', '-p  the (specific)'], ['r', '-r  a / some (non-specific)']],
    verb: [['', 'present'], ['d', '-d  past'], ['s', '-s  future'],
           ['q', '-q  continuous'], ['k', '-k  perfect']],
    modifier: [['', 'plain'], ['m', '-m  nested'], ['f', '-f  distributive']],
};

const composerEl = document.getElementById('composer');
const composerInput = document.getElementById('composer-input');
const composerCandidates = document.getElementById('composer-candidates');
const composerSlots = document.getElementById('composer-slots');
const composerOutput = document.getElementById('composer-output');
const composerVerdict = document.getElementById('composer-verdict');

// Each picked word: { root, entry, role, suffix }
let composerWords = [];

/* Rank Fiwo candidates for one English word.
 *
 * Scored rather than filtered, because the English key is a lookup handle and
 * not a translation: `guto`'s key is "Tool / Equipment." and `cafi`'s is "Run".
 * An exact key match beats a slash-separated alternative, which beats a word
 * inside the key, which beats a listed sense, which beats a mention anywhere in
 * the definition. Ties break toward the lower tier and then the commoner word,
 * so the first suggestion is the one a learner is most likely to want. */
/* English inflections, stripped back toward the form a dictionary key uses.
 *
 * Without this, "used" matched nothing sensible and the composer offered `hyme`
 * and `zy` for it while missing `zyli` entirely — the dictionary key is "Use.",
 * and nothing in the data is inflected. Crude on purpose: it generates
 * candidate stems and lets the scorer decide, so a wrong guess costs a
 * lower-ranked suggestion rather than a wrong answer. */
// Suffix-stripping cannot reach these, and they are common enough that missing
// them makes the whole tool feel broken — "gave" is not a rare way to say give.
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

function composerLookup(query) {
    const raw = query.toLowerCase().trim();
    if (!raw) return [];
    const tokens = text => (text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    const stems = englishStems(raw);
    const best = new Map();   // word -> score, keeping the highest

    stems.forEach((q, depth) => {
        // A match on the word as typed outranks one found by guessing a stem.
        const penalty = depth === 0 ? 0 : 0.25;
        for (const entry of coreEntries) {
            const key = (entry.english_equiv || '').toLowerCase();
            const alternatives = key.split(/\s*[/,]\s*/).map(s => s.trim().replace(/\.$/, ''));
            let score = 0;
            if (key === q || key.replace(/\.$/, '') === q) score = 4;
            else if (alternatives.includes(q)) score = 3;
            else if (tokens(key).includes(q)) score = 2;
            else if ((entry.senses || []).some(s => tokens(s).includes(q))) score = 1.5;
            else if (tokens(entry.definition).includes(q)) score = 0.6;
            if (!score) continue;
            score -= penalty;
            const prior = best.get(entry.word);
            if (!prior || score > prior.score) best.set(entry.word, { entry, score });
        }
    });

    return [...best.values()]
        .sort((a, b) => b.score - a.score
            || (effectiveTier(a.entry) ?? 9) - (effectiveTier(b.entry) ?? 9)
            || (b.entry.freq || 0) - (a.entry.freq || 0))
        .slice(0, 5)
        .map(r => r.entry);
}

/* Closed-class words — pronouns, walls, mood tags, prepositions — are outside
 * the functional-vowel system (Rule 3 applies to content roots). Offering to
 * turn `bef` into a verb would be offering to produce nonsense. */
function isClosedClass(entry) {
    const pos = entry.part_of_speech || '';
    return pos === 'Grammar' || pos.startsWith('Preposition');
}

function baseCategory(entry) {
    const pos = entry.part_of_speech || '';
    if (pos === 'Verb') return 'verb';
    if (pos === 'Modifier') return 'modifier';
    if (pos.includes('Noun')) return 'noun';
    return 'other';
}

/** Apply the chosen role and suffix. Append-only, per Rule 5. */
function composerSurface(word) {
    let form = word.root;
    if (word.role) {
        const vowel = CATEGORY_VOWEL[word.role];
        // A root that already ends in the target vowel IS that category —
        // appending again would coin a different word.
        if (vowel && form[form.length - 1] !== vowel) form += vowel;
    }
    return form + (word.suffix || '');
}

/** Which suffix menu applies to a word in its current role. */
function composerSuffixSet(word) {
    const role = word.role;
    if (role === 'verb') return COMPOSER_SUFFIXES.verb;
    if (role === 'modifier') return COMPOSER_SUFFIXES.modifier;
    if (role) return COMPOSER_SUFFIXES.noun;
    const base = baseCategory(word.entry);
    return COMPOSER_SUFFIXES[base] || null;
}

function composerSentence() {
    if (!composerWords.length) return '';
    const words = composerWords.map(composerSurface);
    // Rule 4: an utterance starts with a capital and ends with a stop. Adding
    // them here means the parser sees a real sentence rather than a fragment,
    // so its verdict is the one the reader would get by typing it out.
    const joined = words.join(' ');
    return joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
}

function renderComposer() {
    if (!composerSlots) return;

    composerSlots.innerHTML = composerWords.length ? composerWords.map((word, i) => {
        const closed = isClosedClass(word.entry);
        const suffixes = closed ? null : composerSuffixSet(word);
        const roleOptions = [
            ['', `as written (${(word.entry.part_of_speech || '').toLowerCase()})`],
            ['bio', 'living thing  -a'],
            ['concrete', 'object  -o'],
            ['abstract', 'concept  -u'],
            ['verb', 'action  -i'],
            ['modifier', 'description  -e'],
        ];
        return `
            <div class="slot-card" data-index="${i}">
                <div class="slot-head">
                    <span class="slot-form">${esc(composerSurface(word))}</span>
                    <button class="slot-remove" data-remove="${i}" aria-label="Remove ${esc(word.root)}">&times;</button>
                </div>
                <span class="slot-gloss">${esc(word.entry.english_equiv)}</span>
                ${closed ? `<span class="slot-note">closed class — no derivation</span>` : `
                    <select class="slot-select" data-role="${i}">
                        ${roleOptions.map(([v, label]) =>
                            `<option value="${v}"${word.role === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}
                    </select>
                    ${suffixes ? `<select class="slot-select" data-suffix="${i}">
                        ${suffixes.map(([v, label]) =>
                            `<option value="${v}"${word.suffix === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}
                    </select>` : ''}`}
            </div>`;
    }).join('') : `<p class="composer-empty">Pick a word below and it will appear here. Subject
        first, then the verb, then the object.</p>`;

    const sentence = composerSentence();
    composerOutput.textContent = sentence;

    if (!sentence || typeof FiwoParser === 'undefined') {
        composerVerdict.innerHTML = '';
        return;
    }
    const result = FiwoParser.parseSentence(sentence);
    composerVerdict.innerHTML = result.valid
        ? `<div class="trans-valid">✓ Valid Fiwo — one deterministic parse</div>`
        : `<div class="trans-errors"><strong>Not valid yet</strong><ul>${
            result.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

function renderComposerCandidates(englishWords) {
    // Articles and copulas have no Fiwo word to find: Fiwo marks specificity
    // with -p/-r and drops "is" entirely (Rule 8's zero copula). Saying so is
    // more useful than showing an empty result.
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

    composerCandidates.innerHTML = englishWords.map(w => {
        const skip = NOTHING_TO_FIND[w];
        if (skip) {
            return `<div class="cand-row"><span class="cand-word">${esc(w)}</span>
                <span class="cand-none">${esc(skip)}</span></div>`;
        }
        const hits = composerLookup(w);
        if (!hits.length) {
            return `<div class="cand-row"><span class="cand-word">${esc(w)}</span>
                <span class="cand-none">no Fiwo word found — try a simpler synonym</span></div>`;
        }
        return `<div class="cand-row">
            <span class="cand-word">${esc(w)}</span>
            <div class="cand-chips">${hits.map(e => `
                <button class="cand-chip" data-pick="${esc(e.word)}" title="${esc(e.definition || '')}">
                    <span class="chip-word">${esc(e.word)}</span>
                    <span class="chip-gloss">${esc(e.english_equiv)}</span>
                </button>`).join('')}</div>
        </div>`;
    }).join('');
}

function runComposerFind() {
    const words = composerInput.value.toLowerCase()
        .replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) { composerCandidates.innerHTML = ''; return; }
    renderComposerCandidates([...new Set(words)]);
}

if (composerEl && composerInput) {
    document.getElementById('composer-find-btn').addEventListener('click', runComposerFind);
    composerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runComposerFind(); }
    });

    composerCandidates.addEventListener('click', (e) => {
        const chip = e.target.closest('.cand-chip');
        if (!chip) return;
        const entry = entryByWord[chip.dataset.pick];
        if (!entry) return;
        composerWords.push({ root: entry.word, entry, role: '', suffix: '' });
        renderComposer();
    });

    composerSlots.addEventListener('click', (e) => {
        const remove = e.target.closest('[data-remove]');
        if (!remove) return;
        composerWords.splice(Number(remove.dataset.remove), 1);
        renderComposer();
    });

    composerSlots.addEventListener('change', (e) => {
        const sel = e.target.closest('.slot-select');
        if (!sel) return;
        if (sel.dataset.role !== undefined) {
            const word = composerWords[Number(sel.dataset.role)];
            word.role = sel.value;
            // The old suffix may be illegal in the new category — a `-p` on a
            // verb is not a tense. Drop it rather than emitting a broken word.
            const allowed = (composerSuffixSet(word) || []).map(([v]) => v);
            if (!allowed.includes(word.suffix)) word.suffix = '';
        } else if (sel.dataset.suffix !== undefined) {
            composerWords[Number(sel.dataset.suffix)].suffix = sel.value;
        }
        renderComposer();
    });

    document.getElementById('composer-undo').addEventListener('click', () => {
        composerWords.pop();
        renderComposer();
    });
    document.getElementById('composer-clear').addEventListener('click', () => {
        composerWords = [];
        composerCandidates.innerHTML = '';
        renderComposer();
    });
    document.getElementById('composer-open').addEventListener('click', () => {
        const sentence = composerSentence();
        if (!sentence) return;
        location.hash = `translator/${encodeURIComponent(sentence)}`;
        setComposerMode('parse');
    });

    // Mode switch between the two directions.
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setComposerMode(btn.dataset.mode));
    });

    renderComposer();
}

function setComposerMode(mode) {
    const parsePane = document.getElementById('parser-pane');
    if (!parsePane || !composerEl) return;
    const composing = mode === 'compose';
    composerEl.hidden = !composing;
    parsePane.hidden = composing;
    document.querySelectorAll('.mode-btn').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
    });
}

// ============================================
// LET'S READ — full-screen bilingual reader
// ============================================
// Stories come from stories.js (GENERATED from Language material/Translations.md
// by Tools/update_stories.mjs). Every line is parsed once on open so word
// breakdowns and colour coding share the translator's parser output.

const readerEl = document.getElementById('reader');
const readerBody = document.getElementById('reader-body');
const readerTitle = document.getElementById('reader-title');
const readerLegend = document.getElementById('reader-legend');
const storiesGrid = document.getElementById('stories-grid');
const wordPanel = document.getElementById('word-panel');
const wordPanelBody = document.getElementById('word-panel-body');

// tokens of the line currently open, keyed by line index
let readerLines = [];
let lastScrollY = 0;

// ── What is actually new in this story ──────────────────────────────────────
//
// Tier 0-1 is the ~460-word core the course teaches, so a root at Tier 2 or
// above is one a course graduate has genuinely not met. That is the list worth
// previewing before a story.
//
// The ordering is the part that decides whether this is useful or just a word
// dump: sorted by how often the root occurs IN THIS STORY, not alphabetically.
// `Fatop skagie` has 30 unfamiliar roots, but `fato` alone accounts for 9 of
// the hits — learning the top five removes most of the friction, and an
// alphabetical list would bury that fact completely.
const NEW_WORD_TIER = 2;

function rootEntry(root) {
    return entryByWord[root] || null;
}

// A word met in a story resolves to the dictionary headword it inflects:
// `gutop` to `guto`. The parser keys its own lexicon off the same two files, so
// its `entry` is the reliable route in, and `root` catches the derived forms it
// reaches by stripping a suffix.
//
// Returns null for proper nouns, Fiwonized borrowings and bound morphemes —
// none of them are dictionary entries. That is deliberate and is what keeps the
// link off names: across all 37 stories this resolves 18,064 of 19,050 word
// tokens, and every one of the 986 misses is a proper noun.
function readerEntryFor(tok) {
    if (!tok || tok.kind === 'punct') return null;
    return (tok.entry && entryByWord[tok.entry.word]) || entryByWord[tok.root] || null;
}

function isNewRoot(root) {
    const entry = rootEntry(root);
    if (!entry) return true;             // outside both lexicons: certainly new
    const tier = effectiveTier(entry);
    return tier === null || tier >= NEW_WORD_TIER;
}

/** -> [{ root, count, entry }] for the open story, commonest first. */
function newWordsIn(lines) {
    const counts = new Map();
    for (const line of lines) {
        for (const tok of line.tokens) {
            if (tok.kind !== 'word') continue;
            if (tok.cat === 'proper_noun' || String(tok.cat || '').startsWith('error')) continue;
            const root = (tok.root || tok.raw || '').toLowerCase();
            if (!root || !isNewRoot(root)) continue;
            counts.set(root, (counts.get(root) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([root, count]) => ({ root, count, entry: rootEntry(root) }))
        .sort((a, b) => b.count - a.count || a.root.localeCompare(b.root));
}

function renderNewWords(words) {
    const panel = document.getElementById('reader-newwords');
    if (!panel) return;
    if (!words.length) {
        panel.innerHTML = `<p class="newwords-empty">Nothing new here — every root in this
            story is part of the Tier 0–1 core the course teaches.</p>`;
        return;
    }
    panel.innerHTML = `
        <div class="newwords-head">
            <p class="newwords-lede">${words.length} root${words.length > 1 ? 's' : ''} above the
                course core, commonest in this story first. The first few are worth knowing before
                you start — they are the ones you will keep meeting.</p>
            <button id="reader-focus-new" class="reader-toggle" aria-pressed="false"
                    title="Fade the core vocabulary so these roots stand out in the text">Highlight in text</button>
        </div>
        <div class="newwords-list">
            ${words.map(w => `
                <button class="newword" data-word="${esc(w.root)}"
                        title="${esc(w.entry ? w.entry.definition || '' : 'Not in the dictionary')}">
                    <span class="newword-root">${esc(w.root)}</span>
                    <span class="newword-gloss">${esc(w.entry ? w.entry.english_equiv : '—')}</span>
                    <span class="newword-count">×${w.count}</span>
                </button>`).join('')}
        </div>`;
}

function readerWordHtml(tok, lineIdx, wordIdx) {
    const info = catInfo[tok.cat] || catInfo.particle;
    const suffixLen = (tok.suffix || '').length;
    const rawRoot = suffixLen ? tok.raw.slice(0, tok.raw.length - suffixLen) : tok.raw;
    const rawSuffix = suffixLen ? tok.raw.slice(tok.raw.length - suffixLen) : '';
    const root = (tok.root || tok.raw || '').toLowerCase();
    const fresh = tok.cat !== 'proper_noun' && !String(tok.cat || '').startsWith('error')
        && root && isNewRoot(root);
    return `<span class="tok rw ${info.cls}${tok.error ? ' tok-has-error' : ''}${fresh ? ' rw-new' : ''}"` +
        ` data-line="${lineIdx}" data-word="${wordIdx}" role="button" tabindex="0"` +
        ` title="${esc(tok.gloss || tok.raw)}">${esc(rawRoot)}` +
        `${rawSuffix ? `<span class="tok-suffix">${esc(rawSuffix)}</span>` : ''}</span>`;
}

// Several parser categories share one colour (every clausal wall is tok-wall,
// every particle is tok-glue), so the key is written per COLOUR, not per category.
const legendLabels = {
    'tok-noun':    'Noun',
    'tok-proper':  'Proper noun',
    'tok-verb':    'Verb',
    'tok-mod':     'Modifier',
    'tok-prep':    'Preposition',
    'tok-mood':    'Mood tag / passive / phatic',
    'tok-wall':    'Clausal wall · condition · negation',
    'tok-bracket': 'tep…tel bracket',
    'tok-glue':    'Glue · separator · particle',
    'tok-var':     'Question variable',
    'tok-err':     'Unparsed'
};

// Built from the colours actually used by THIS story, so the key never lists a
// category the reader cannot see on the page — and never silently drops one.
function buildLegend(lines) {
    const present = new Set();
    lines.forEach(line => line.tokens.forEach(t => {
        if (t.kind === 'punct') return;
        present.add((catInfo[t.cat] || catInfo.particle).cls);
    }));
    return Object.keys(legendLabels)
        .filter(cls => present.has(cls))
        .map(cls => `<span class="legend-item"><span class="tok ${cls}">Aa</span>${esc(legendLabels[cls])}</span>`)
        .join('');
}

// Name what the entry actually holds rather than promising a fixed list. Most
// of the panel's value-add is the material the panel has no room for, but not
// every word has all of it — a button that offers examples for a word with none
// spends the reader's attention for nothing.
function entryHint(entry) {
    const bits = [];
    if (entry.example) bits.push('example');
    const family = (familyByRoot[entry.word] || []).length;
    if (family) bits.push(`${family} derived form${family > 1 ? 's' : ''}`);
    else if (entry.root && entryByWord[entry.root]) bits.push('what it is built from');
    if (entry.freq) bits.push(`used ${entry.freq}×`);
    return bits.length ? esc(bits.join(' · ')) : 'definition and senses';
}

function showWordPanel(tok, wordEl) {
    const info = catInfo[tok.cat] || catInfo.particle;
    const pron = (typeof FiwoPronounce !== 'undefined' && !tok.error)
        ? FiwoPronounce.pronounceHtml(tok.raw, { syllables: true }) : '';
    const suffixRow = tok.suffix
        ? `<div class="wp-row"><span class="wp-label">Suffix</span><span><span class="gloss-suffix">-${esc(tok.suffix)}</span> ${esc(FiwoParser.suffixMeaning(tok.suffix, tok.cat))}</span></div>`
        : '';
    const structuralCats = ['mood_tag', 'clausal_wall', 'condition', 'passive', 'phatic', 'repair',
        'negation', 'bracket_open', 'bracket_close', 'inline_glue', 'list_sep', 'math_op', 'particle'];
    const showSlot = tok.slot && !structuralCats.includes(tok.cat)
        && tok.slot.toLowerCase() !== info.label.toLowerCase();
    const entry = tok.entry;
    const full = readerEntryFor(tok);

    wordPanelBody.innerHTML = `
        <div class="wp-head">
            <span class="wp-word">${readerWordHtml(tok, -1, -1)}</span>
            <span class="gloss-cat ${info.cls}">${esc(info.label)}</span>
            ${showSlot ? `<span class="gloss-slot">${esc(tok.slot)}</span>` : ''}
        </div>
        ${pron ? `<div class="wp-row"><span class="wp-label">Say it</span><span>${pron}</span></div>` : ''}
        <div class="wp-row"><span class="wp-label">Means</span><span class="wp-meaning">${esc(tok.error ? '✗ ' + tok.error : (tok.gloss || '—'))}</span></div>
        ${tok.root && tok.root !== tok.raw ? `<div class="wp-row"><span class="wp-label">Root</span><span>${esc(tok.root)}</span></div>` : ''}
        ${suffixRow}
        ${entry && entry.definition ? `<div class="wp-row"><span class="wp-label">Definition</span><span>${esc(entry.definition)}</span></div>` : ''}
        ${tok.note ? `<div class="wp-note">${esc(tok.note)}</div>` : ''}
        ${full ? `
            <button class="wp-entry" data-word="${esc(full.word)}">
                <span class="wp-entry-label">Full entry for <strong>${esc(full.word)}</strong></span>
                <span class="wp-entry-hint">${entryHint(full)}</span>
            </button>` : ''}`;
    wordPanel.hidden = false;

    // The panel is docked to the bottom, so a word low on the screen would end up
    // behind it — nudge the text up just enough to keep the word you tapped visible.
    if (wordEl) {
        const gap = wordEl.getBoundingClientRect().bottom - wordPanel.getBoundingClientRect().top;
        if (gap > -8) readerBody.scrollBy({ top: gap + 24, behavior: 'smooth' });
    }
}

// Delegated, because the panel's contents are rebuilt on every word tapped.
// The panel stays open behind the modal: closing the entry should put you back
// on the word you were reading, not back at the story with your place lost.
wordPanelBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.wp-entry');
    if (btn && entryByWord[btn.dataset.word]) openEntry(entryByWord[btn.dataset.word]);
});

function hideWordPanel() {
    wordPanel.hidden = true;
    readerBody.querySelectorAll('.rw.rw-active').forEach(el => el.classList.remove('rw-active'));
}

let currentStory = null;

function openStory(story) {
    if (typeof FiwoParser === 'undefined') return;

    currentStory = story;
    readerTitle.textContent = story.title;
    readerLines = story.lines.map(line => {
        const result = FiwoParser.parseSentence(line.fiwo);
        return { ...line, tokens: result.tokens };
    });

    readerBody.innerHTML = readerLines.map((line, i) => {
        let w = -1;
        // Spaces go BEFORE words but never before punctuation, so the line reads
        // as prose rather than as the translator's spaced-out token stream.
        const fiwoHtml = line.tokens.map((t, ti) => {
            if (t.kind === 'punct') return `<span class="tok-punct">${esc(t.raw)}</span>`;
            w++;
            return (ti > 0 ? ' ' : '') + readerWordHtml(t, i, w);
        }).join('');
        return `
            <article class="reader-line" data-line="${i}">
                <div class="reader-line-row">
                    <span class="reader-num" aria-hidden="true">${i + 1}</span>
                    <p class="reader-fiwo">${fiwoHtml}</p>
                    <button class="reader-en-toggle" data-line="${i}" aria-expanded="false"
                            aria-label="Show translation of line ${i + 1}" title="Show translation">EN</button>
                </div>
                <p class="reader-en" id="reader-en-${i}" hidden>${esc(line.english)}</p>
            </article>`;
    }).join('');

    readerLegend.innerHTML = buildLegend(readerLines);

    const fresh = newWordsIn(readerLines);
    renderNewWords(fresh);
    const newWordsBtn = document.getElementById('reader-new-words');
    newWordsBtn.textContent = fresh.length ? `New words (${fresh.length})` : 'New words';
    // Collapsed on open — the story is what you came for. It is one tap away.
    document.getElementById('reader-newwords').hidden = true;
    newWordsBtn.setAttribute('aria-expanded', 'false');
    newWordsBtn.classList.remove('is-on');
    // The highlight is per-story: what counts as new changes with the story, so
    // carrying the mode across would be showing the last one's answer.
    readerBody.classList.remove('focus-new');

    lastScrollY = window.scrollY;
    readerEl.hidden = false;
    document.body.classList.add('reader-open');
    document.getElementById('reader-close').focus({ preventScroll: true });

    // Pick up where you left off. A finished story reopens at the top — you
    // asked to read it again, not to be dropped at the last line.
    const saved = FiwoStore.getStory(story.title);
    const resumeAt = saved.read ? 0 : saved.line;
    readerBody.scrollTop = 0;
    if (resumeAt > 0) {
        const target = readerBody.querySelector(`.reader-line[data-line="${resumeAt}"]`);
        if (target) {
            target.scrollIntoView({ block: 'center' });
            target.classList.add('reader-line-resumed');
            setTimeout(() => target.classList.remove('reader-line-resumed'), 2200);
        }
    }
}

/* Which line is the reader actually looking at?
 *
 * The topmost line whose bottom edge is still below the top of the viewport —
 * i.e. the first one not yet scrolled past. Cheaper and steadier than an
 * IntersectionObserver over hundreds of lines, and it degrades sensibly on a
 * short story that does not scroll at all. */
function currentReaderLine() {
    const lines = readerBody.querySelectorAll('.reader-line');
    const top = readerBody.getBoundingClientRect().top;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].getBoundingClientRect().bottom > top + 8) return i;
    }
    return lines.length ? lines.length - 1 : 0;
}

let scrollSaveTimer = null;

function recordReadingPosition() {
    if (!currentStory) return;
    const line = currentReaderLine();
    const total = currentStory.lines.length;
    // Reaching the last line counts as finishing it. Anything short of that
    // just moves the bookmark.
    if (line >= total - 1) {
        FiwoStore.setStoryRead(currentStory.title, true);
        FiwoStore.setStoryLine(currentStory.title, 0);
    } else {
        FiwoStore.setStoryLine(currentStory.title, line);
    }
}

function closeReader() {
    recordReadingPosition();
    currentStory = null;
    readerEl.hidden = true;
    hideWordPanel();
    document.body.classList.remove('reader-open');
    window.scrollTo({ top: lastScrollY });
}

const BAND_LABELS = {
    starter: { label: 'Starter', hint: 'Gentlest reading — fewest words per line outside the core vocabulary' },
    building: { label: 'Building', hint: 'A step up in density; most of the running text is still core vocabulary' },
    fluent: { label: 'Fluent', hint: 'Dense: you will meet unfamiliar roots on most lines' },
};

function renderStoryLibrary() {
    if (!storiesGrid || typeof storyData === 'undefined') return;

    // storyData arrives already sorted by band, then by length within the band
    // (Tools/update_stories.mjs). Rendering just follows that order and inserts
    // a heading whenever the band changes.
    let lastBand = null;
    const html = storyData.map((s, i) => {
        const progress = FiwoStore.getStory(s.title);
        const pct = progress.line > 0 ? Math.round((progress.line / s.lines.length) * 100) : 0;
        const started = !progress.read && progress.line > 0;

        let heading = '';
        const band = s.grade && s.grade.band;
        if (band && band !== lastBand) {
            lastBand = band;
            const meta = BAND_LABELS[band] || { label: band, hint: '' };
            const n = storyData.filter(x => x.grade && x.grade.band === band).length;
            heading = `<h3 class="band-heading" title="${esc(meta.hint)}">
                    ${esc(meta.label)} <span class="band-count">${n} stories</span>
                </h3>`;
        }

        return heading + `
        <div class="story-card${progress.read ? ' story-read' : ''}">
            ${progress.read ? '<span class="story-tick" title="You have finished this one">✓</span>' : ''}
            <h4>${esc(s.title)}</h4>
            <p class="story-meta">${s.lines.length} lines · ${s.wordCount} words</p>
            ${s.grade ? `<p class="story-grade">
                    <span title="Share of the running text that is Tier 0-1 vocabulary — the core the course teaches">${s.grade.coverage}% known words</span>
                    <span title="Distinct roots above the course core. The reader lists them, commonest first, before you start.">${s.grade.newRoots ?? s.grade.roots} new roots</span>
                </p>` : ''}
            ${started ? `<div class="story-progress" title="You stopped at line ${progress.line + 1}">
                    <div class="story-progress-bar" style="width:${pct}%"></div>
                </div>` : ''}
            <button class="read-btn" data-story="${i}">${started ? `Continue · ${pct}%` : progress.read ? 'Read again' : 'Read'}</button>
            ${(progress.read || started) ? `<button class="story-clear" data-clear="${i}" title="Forget my progress on this story">Clear</button>` : ''}
        </div>`;
    }).join('');

    // No reveal-on-scroll class here — initScrollReveals() runs later in this file
    // and picks up every .story-card, including these.
    storiesGrid.innerHTML = html;

    storiesGrid.querySelectorAll('.read-btn').forEach(btn => {
        btn.addEventListener('click', () => openStory(storyData[Number(btn.dataset.story)]));
    });
    storiesGrid.querySelectorAll('.story-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            FiwoStore.clearStory(storyData[Number(btn.dataset.clear)].title);
        });
    });
}

/* ── Storage health: say the true thing, in one place ────────────────────────
 *
 * Layer 5 of the plan in Extras/Saving progress in a browser.md. This replaced
 * a single sentence describing the storage mode, which was honest but not
 * actionable: knowing that a browser "may clear it" tells a reader nothing
 * about what to do next.
 *
 * Two rules hold this together:
 *
 *   1. ONE concrete instruction, named for the browser you are actually in.
 *      Generic warnings get ignored; "Tap Share → Add to Home Screen" does not.
 *   2. NEVER render a control that does nothing. `action: 'install'` still has
 *      no button of its own, because the browser's own Install button appears
 *      when the browser means it and a fake one would not work. `action: 'file'`
 *      HAD no button until step 5 built the thing it promises; now it does.
 *
 * Written to be mounted anywhere: the same block is on the flashcards home,
 * where the data actually worth protecting lives.
 */
const HEALTH_ACTIONS = {
    'persist':        'Keep my progress',
    'file':           'Back up to a file',
    'file-reconnect': 'Reconnect backup file',
};

/* A one-off reply to a click — "your browser said no", "read that file first".
 * Held here rather than in the DOM because the block re-renders on every store
 * change, and a message that vanishes the instant it becomes true is no use. */
let healthNotice = null;

function setHealthNotice(text) {
    healthNotice = text ? { text, until: Date.now() + 12000 } : null;
    remountStorageHealth();
}

function remountStorageHealth() {
    document.querySelectorAll('.storage-health').forEach(el => mountStorageHealth(el));
}

function agoText(iso) {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const d = Math.floor(hr / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
}

function mountStorageHealth(el) {
    if (!el) return;
    const h = FiwoStore.storageHealth();

    el.className = 'storage-health';
    el.dataset.risk = h.risk;
    el.replaceChildren();

    const add = (tag, cls, text) => {
        const node = document.createElement(tag);
        node.className = cls;
        if (text) node.textContent = text;
        el.appendChild(node);
        return node;
    };

    add('p', 'sh-headline', h.headline);

    const row = document.createElement('div');
    row.className = 'sh-actions';

    const button = (action, label, cls) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.dataset.storageAction = action;
        btn.textContent = label;
        row.appendChild(btn);
    };

    if (h.advice) {
        add('p', 'sh-advice', h.advice.text);
        if (HEALTH_ACTIONS[h.advice.action]) {
            button(h.advice.action, HEALTH_ACTIONS[h.advice.action], 'progress-btn progress-btn-accent');
        }
    }

    /* The file line, and the honest part of it: WHEN it was last written. A
     * backup you cannot date is a backup you have to take on faith. */
    if (h.file.linked && h.file.permission === 'granted' && !h.file.error) {
        const ago = agoText(h.lastExportAt);
        add('p', 'sh-file', `Writing to ${h.file.name}${ago ? ` · saved ${ago}` : ''}.`);
        button('file-unlink', 'Stop', 'progress-btn sh-quiet');
    } else if (h.file.supported && !h.file.linked) {
        // The recovery door. After "Clear site data" the remembered handle is
        // gone too, so the only way back to an existing file is to point at it.
        button('file-open', 'Use an existing backup file', 'progress-btn sh-quiet');
    }

    if (row.childElementCount) el.appendChild(row);

    if (h.backup.due) {
        const backup = add('p', 'sh-backup', h.backup.text);
        backup.dataset.level = h.backup.level;
    }

    if (healthNotice && Date.now() < healthNotice.until) {
        add('p', 'sh-notice', healthNotice.text);
    }
}

// ── Progress panel: what is saved, and how to get it out ────────────────────

function renderProgressPanel() {
    const summary = document.getElementById('progress-summary');
    const storage = document.getElementById('progress-storage');
    if (!summary || typeof storyData === 'undefined') return;

    const entries = Object.entries(FiwoStore.stories());
    const finished = entries.filter(([, e]) => e.read).length;
    const inProgress = entries.filter(([, e]) => !e.read && e.line > 0).length;

    summary.textContent = finished === 0 && inProgress === 0
        ? 'No stories started yet'
        : `${finished} of ${storyData.length} finished`
          + (inProgress ? ` · ${inProgress} in progress` : '');

    mountStorageHealth(storage);
}

/* Every storage control, in one delegated listener.
 *
 * They all share a hard requirement: each one MUST run inside the click that
 * triggered it. `navigator.storage.persist()`, `showSaveFilePicker()` and
 * `FileSystemHandle.requestPermission()` are all gated on user activation, and
 * an await before them spends it — so nothing here does any preparatory work
 * first, and the disable-the-button courtesy happens synchronously.
 *
 * Layer 1 is the ask that fiwo-store.js deliberately no longer makes on load:
 * Firefox is the only browser that shows a prompt, and a permission popup
 * during the first paint of a site you have never used is one people dismiss
 * reflexively. Chrome decides silently and, measured on 2026-09-07, decides
 * "no"; the reply is reported either way rather than quietly swallowed.
 */
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-storage-action]');
    if (!btn) return;
    const action = btn.dataset.storageAction;
    btn.disabled = true;

    if (action === 'persist') {
        const granted = await FiwoStore.requestPersistence();
        setHealthNotice(granted
            ? 'Done — your browser has agreed not to clear this to reclaim space. Only you can remove it now.'
            : 'Your browser said no, and does not explain why — Chrome decides this silently. '
              + 'A backup file is the answer that does not depend on the browser agreeing to anything.');
        return;
    }

    if (!window.FiwoBackup) { btn.disabled = false; return; }

    // Layer 3. `link` and `linkExisting` are the same operation reached through
    // the two dialogs a browser offers; which one a reader needs depends only on
    // whether the file already exists, which they know and we do not.
    if (action === 'file' || action === 'file-open' || action === 'file-reconnect') {
        const run = action === 'file' ? FiwoBackup.link
                  : action === 'file-open' ? FiwoBackup.linkExisting
                  : FiwoBackup.reconnect;
        const result = await run();
        btn.disabled = false;
        // A null message is a cancelled dialog. Saying "cancelled" back to
        // someone who just pressed Escape is noise.
        if (result.message) setHealthNotice(result.message);
        else remountStorageHealth();
        return;
    }

    if (action === 'file-unlink') {
        await FiwoBackup.unlink();
        setHealthNotice('Stopped. The file itself is untouched — it still holds everything up to now, '
            + 'and you can point at it again whenever you like.');
    }
});

// The file layer changes state on its own — a boot-time reconnect, a write that
// failed — and the readout has to follow it, not just follow the store.
document.addEventListener('fiwo-backup-changed', remountStorageHealth);

function flashProgressMessage(text) {
    const el = document.getElementById('progress-message');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flashProgressMessage.timer);
    flashProgressMessage.timer = setTimeout(() => { el.hidden = true; }, 6000);
}

/* Install prompt.
 *
 * Chrome fires `beforeinstallprompt` once it considers the site installable and
 * lets us defer it; the event does not exist in Safari, where installing is a
 * manual Share > Add to Home Screen. So the button appears only where it can
 * actually do something, and the panel's storage line is what tells everyone
 * else why they might want to.
 *
 * This is not decoration: an installed app is exempt from Safari's 7-day
 * storage cap and is granted persistent storage outright by Chrome, which is
 * the difference between progress that survives and progress that evaporates.
 */
let deferredInstall = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.getElementById('progress-install');
    if (btn) btn.hidden = false;
});

window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const btn = document.getElementById('progress-install');
    if (btn) btn.hidden = true;
    flashProgressMessage('Installed. Your progress is now stored like an app\'s — '
        + 'your browser will not clear it to reclaim space.');
});

function initProgressPanel() {
    const installBtn = document.getElementById('progress-install');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredInstall) return;
            deferredInstall.prompt();
            const { outcome } = await deferredInstall.userChoice;
            if (outcome !== 'accepted') {
                flashProgressMessage('No problem — everything still works in the browser. '
                    + 'Export a copy now and then if you want to be certain of keeping it.');
            }
            deferredInstall = null;
            installBtn.hidden = true;
        });
    }

    const exportBtn = document.getElementById('progress-export');
    const importInput = document.getElementById('progress-import-input');
    const resetBtn = document.getElementById('progress-reset');
    if (!exportBtn) return;

    exportBtn.addEventListener('click', () => {
        const blob = new Blob([FiwoStore.exportJSON()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fiwo-progress-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        // Resets the nag. Deliberately after the click rather than before: if
        // the download never happened we would have cleared a warning about
        // data that is still unprotected.
        FiwoStore.noteExported();
        flashProgressMessage('Downloaded. That file is the only copy your browser cannot clear — keep it somewhere safe.');
    });

    importInput.addEventListener('change', async () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        try {
            const result = FiwoStore.importJSON(await file.text());
            flashProgressMessage(
                `Imported ${result.total} stories: ${result.added} new, ${result.advanced} moved forward. `
                + 'Nothing was moved backwards.');
        } catch {
            flashProgressMessage('That file could not be read as Fiwo progress. Nothing was changed.');
        }
        importInput.value = '';
    });

    /* Clearing unlinks the backup file first, and must.
     *
     * Otherwise the next thing you did would write an empty store over the file,
     * and the visit after that would read it back — so "forget everything here"
     * would quietly destroy the one copy the browser cannot touch. Unlinking
     * leaves the file exactly as it is, which is the only sane reading of the
     * button: it says forget it on THIS DEVICE. */
    resetBtn.addEventListener('click', async () => {
        const linked = window.FiwoBackup?.status().linked;
        const warning = 'Forget all progress on this device? This cannot be undone — export first if you want a copy.'
            + (linked ? '\n\nYour backup file will be left alone and disconnected, not emptied.' : '');
        if (!confirm(warning)) return;
        if (linked) await FiwoBackup.unlink();
        FiwoStore.reset();
        flashProgressMessage(linked
            ? 'Progress cleared, and the backup file disconnected. The file still holds everything up to now.'
            : 'Progress cleared.');
    });
}

// One listener keeps every progress-aware view in step, so nothing has to
// remember to refresh anything else after a write.
document.addEventListener('fiwo-store-changed', () => {
    renderStoryLibrary();
    renderProgressPanel();
});

if (readerEl && storiesGrid) {
    renderStoryLibrary();
    renderProgressPanel();
    initProgressPanel();

    // The bookmark is written while reading, not only on close: a reader who
    // closes the tab outright still keeps their place.
    readerBody.addEventListener('scroll', () => {
        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(recordReadingPosition, 500);
    }, { passive: true });
    // Belt and braces on the way out. `pagehide` is the documented hook but iOS
    // Safari skips it often enough to matter, and backgrounding an app is
    // exactly how reading sessions end on a phone — `visibilitychange` is the
    // one that reliably fires there.
    window.addEventListener('pagehide', () => { if (currentStory) recordReadingPosition(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && currentStory) recordReadingPosition();
    });

    document.getElementById('reader-close').addEventListener('click', closeReader);
    document.getElementById('word-panel-close').addEventListener('click', hideWordPanel);

    // The new-words list for this story
    const newWordsBtn = document.getElementById('reader-new-words');
    const newWordsPanel = document.getElementById('reader-newwords');
    newWordsBtn.addEventListener('click', () => {
        const open = newWordsPanel.hidden;
        newWordsPanel.hidden = !open;
        newWordsBtn.setAttribute('aria-expanded', String(open));
        newWordsBtn.classList.toggle('is-on', open);
    });
    // Any word in that list opens its full dictionary entry — definition,
    // family, example — rather than just a gloss.
    newWordsPanel.addEventListener('click', (e) => {
        const btn = e.target.closest('.newword');
        if (btn && entryByWord[btn.dataset.word]) openEntry(entryByWord[btn.dataset.word]);
    });

    /* "Highlight in text": fade the core vocabulary so the unfamiliar roots
     * stand out.
     *
     * Deliberately the inverse of colour coding, which highlights the grammar.
     * Once you know the core, highlighting it is noise — what you want to see is
     * the handful of words that are actually going to stop you. The two are
     * mutually exclusive because running both at once produces a page where
     * everything is emphasised, i.e. nothing is.
     *
     * It lives inside the new-words panel rather than the reader bar: it is what
     * you reach for having just looked at the list, and a fifth control in the
     * bar pushed the header to a quarter of a phone screen. The button is
     * rebuilt with the panel on every story, so the handler is delegated. */
    newWordsPanel.addEventListener('click', (e) => {
        if (!e.target.closest('#reader-focus-new')) return;
        const btn = e.target.closest('#reader-focus-new');
        const on = readerBody.classList.toggle('focus-new');
        btn.setAttribute('aria-pressed', String(on));
        btn.classList.toggle('is-on', on);
        if (on && readerBody.classList.contains('colors-on')) {
            readerBody.classList.remove('colors-on');
            const cb = document.getElementById('reader-colors');
            cb.setAttribute('aria-pressed', 'false');
            cb.classList.remove('is-on');
            readerLegend.hidden = true;
        }
    });

    // Colour coding on/off (requirement: toggle in the reader's top bar)
    const colorsBtn = document.getElementById('reader-colors');
    colorsBtn.addEventListener('click', () => {
        const on = readerBody.classList.toggle('colors-on');
        colorsBtn.setAttribute('aria-pressed', String(on));
        colorsBtn.classList.toggle('is-on', on);
        readerLegend.hidden = !on;
        if (on && readerBody.classList.contains('focus-new')) {
            readerBody.classList.remove('focus-new');
            const fb = document.getElementById('reader-focus-new');
            if (fb) { fb.setAttribute('aria-pressed', 'false'); fb.classList.remove('is-on'); }
        }
    });

    // Reveal/hide every translation at once
    const allEnBtn = document.getElementById('reader-all-en');
    allEnBtn.addEventListener('click', () => {
        const on = allEnBtn.getAttribute('aria-pressed') !== 'true';
        allEnBtn.setAttribute('aria-pressed', String(on));
        allEnBtn.classList.toggle('is-on', on);
        readerBody.querySelectorAll('.reader-line').forEach(lineEl => {
            lineEl.querySelector('.reader-en').hidden = !on;
            const t = lineEl.querySelector('.reader-en-toggle');
            t.setAttribute('aria-expanded', String(on));
            t.classList.toggle('is-on', on);
        });
    });

    // One delegated handler for both per-line toggles and word clicks
    readerBody.addEventListener('click', (e) => {
        const toggle = e.target.closest('.reader-en-toggle');
        if (toggle) {
            const lineEl = toggle.closest('.reader-line');
            const en = lineEl.querySelector('.reader-en');
            const show = en.hidden;
            en.hidden = !show;
            toggle.setAttribute('aria-expanded', String(show));
            toggle.classList.toggle('is-on', show);
            return;
        }
        const word = e.target.closest('.rw');
        if (!word) return;
        const line = readerLines[Number(word.dataset.line)];
        if (!line) return;
        const tok = line.tokens.filter(t => t.kind !== 'punct')[Number(word.dataset.word)];
        if (!tok) return;
        readerBody.querySelectorAll('.rw.rw-active').forEach(el => el.classList.remove('rw-active'));
        word.classList.add('rw-active');
        showWordPanel(tok, word);
    });

    // Keyboard: Enter/Space activates a word, Escape backs out one layer
    readerBody.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('rw')) {
            e.preventDefault();
            e.target.click();
        }
    });
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || readerEl.hidden) return;
        // The definition modal can now open ON TOP of the reader, and it has its
        // own Escape handler. Both listeners are on window and both would fire,
        // so without this one Escape would close the entry AND the word panel
        // underneath it — two layers for one keypress.
        if (document.getElementById('definition-modal').style.display === 'block') return;
        if (!wordPanel.hidden) hideWordPanel();
        else closeReader();
    });
}

// ============================================
// SCROLL REVEAL ANIMATIONS
// ============================================
const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, {
    rootMargin: '0px 0px -40px 0px'
});

function initScrollReveals() {
    // Select static elements that should reveal
    const revealElements = document.querySelectorAll('.content-block, .directory-card, h2, .rule-block, .story-card');
    revealElements.forEach(el => {
        el.classList.add('reveal-on-scroll');
        revealObserver.observe(el);
    });
}

document.addEventListener('DOMContentLoaded', initScrollReveals);
// Since DOM is likely already loaded in SPA mode
initScrollReveals();
// ============================================
// PRONUNCIATION WIDGET (Phonetics page)
// ============================================
const pronInput = document.getElementById('pron-input');
const pronOutput = document.getElementById('pron-output');

if (pronInput && pronOutput && typeof FiwoPronounce !== 'undefined') {
    const renderPron = () => {
        const word = pronInput.value.trim().split(/\s+/)[0] || '';
        if (!word) { pronOutput.innerHTML = ''; return; }
        const ipa = FiwoPronounce.ipa(word);
        if (!ipa) {
            pronOutput.innerHTML = '<div class="pron-widget-note">Proper nouns and hyphenated borrowings keep their native pronunciation — try a native Fiwo word.</div>';
            return;
        }
        const analysis = (typeof FiwoParser !== 'undefined') ? FiwoParser.analyze(word) : null;
        const known = analysis && analysis.entry ? `<div class="pron-widget-meaning">${analysis.entry.english_equiv}</div>` : '';
        pronOutput.innerHTML = `
            <div class="pron-widget-word">${word.toLowerCase()}
                ${FiwoPronounce.canSpeak() ? `<button class="pron-speak" data-speak="${word.toLowerCase()}" title="Play approximate audio" aria-label="Pronounce ${word}">🔊</button>` : ''}
            </div>
            <div class="pron-widget-row"><span class="pron-widget-label">IPA</span><span class="pron-ipa">${ipa}</span></div>
            <div class="pron-widget-row"><span class="pron-widget-label">Syllables</span><span class="pron-syl">${FiwoPronounce.syllables(word)}</span></div>
            <div class="pron-widget-row"><span class="pron-widget-label">Stress</span><span>the bold unit — final functional vowel + all trailing suffixes (Rule 1)</span></div>
            ${known}`;
    };
    pronInput.addEventListener('input', renderPron);
}

// ============================================
// SERVICE WORKER
// ============================================
// Registered last and after `load`, so it never competes with the first paint.
// See sw.js for what it caches and why — the short version is that it makes the
// site installable, and an installed app is the only place browser storage is
// genuinely safe from eviction.
//
// Requires a secure context (https, or localhost). Opened from a file:// URL
// there is no service worker and no install — which is worth knowing, because
// "download it to the desktop" is the intuitive thing to try and is the one
// approach that makes storage LESS durable, not more.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('[fiwo] service worker did not register:', err.message);
        });
    });
}
