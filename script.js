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
    "Preposition": "#ff6600",
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

// Handle navigation links for SPA feel
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);

        // Update active nav link highlighting
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // Switch active page
        pages.forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(targetId).classList.add('active');

        // Show/hide TOC globally based on rules tab
        document.body.classList.remove('rules-active', 'learn-active');
        if (targetId === 'rules') {
            document.body.classList.add('rules-active');
        } else if (targetId === 'how-to-learn') {
            document.body.classList.add('learn-active');
        }

        if (targetId === 'dictionary') {
            renderDictionary();
        }

        // Smooth scroll to top on section switch
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Close nav after selection
        closeNav();
    });
});

// Set home as default active page
document.getElementById('home').classList.add('active');

// Dictionary functionality
function renderDictionary() {
    const searchBar = document.getElementById('search-bar');
    const dictionaryFilter = document.getElementById('dictionary-filter');
    const sortBy = document.getElementById('sort-by');
    const wordCount = document.getElementById('word-count');
    const grid = document.getElementById('dictionary-grid');

    const combinedData = typeof derivedDictionaryData !== 'undefined' 
        ? [...dictionaryData, ...derivedDictionaryData] 
        : [...dictionaryData];

    function updateDisplay() {
        let activeData = combinedData;
        if (dictionaryFilter && dictionaryFilter.value === 'core') {
            activeData = dictionaryData;
        } else if (dictionaryFilter && dictionaryFilter.value === 'derived' && typeof derivedDictionaryData !== 'undefined') {
            activeData = derivedDictionaryData;
        }

        let filteredData = activeData.filter(item => 
            item.word.toLowerCase().includes(searchBar.value.toLowerCase()) ||
            item.english_equiv.toLowerCase().includes(searchBar.value.toLowerCase())
        );

        filteredData.sort((a, b) => a.word.localeCompare(b.word));
        if (sortBy.value) {
            if (sortBy.value === "Noun") {
                filteredData = filteredData.filter(item => item.part_of_speech.includes("Noun"));
            } else {
                filteredData = filteredData.filter(item => item.part_of_speech === sortBy.value);
            }
        }

        wordCount.textContent = `Words: ${filteredData.length}`;

        grid.innerHTML = '';
        filteredData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card reveal-on-scroll';
            card.innerHTML = `
                <div class="pos-dot" style="background-color: ${posColors[item.part_of_speech] || '#c6c6c6'}"></div>
                <div class="fiwo-word">${item.word}</div>
                <div class="english-equiv">${item.english_equiv}</div>
                <div class="part-speech">${item.part_of_speech}</div>
            `;
            card.addEventListener('click', () => {
                document.getElementById('definition-modal-title').textContent = item.word;
                const pron = typeof FiwoPronounce !== 'undefined' ? FiwoPronounce.pronounceHtml(item.word) : '';
                document.getElementById('definition-modal-body').innerHTML = `
                    ${pron ? `<p><strong>Pronunciation:</strong> ${pron}</p>` : ''}
                    <p><strong>English Equivalent:</strong> ${item.english_equiv}</p>
                    <p><strong>Part of Speech:</strong> ${item.part_of_speech}</p>
                    <p><strong>Definition:</strong> ${item.definition}</p>
                `;
                document.getElementById('definition-modal').style.display = 'block';
            });
            grid.appendChild(card);
            if (typeof revealObserver !== 'undefined') revealObserver.observe(card);
        });
    }

    updateDisplay();
    searchBar.addEventListener('input', updateDisplay);
    if (dictionaryFilter) dictionaryFilter.addEventListener('change', updateDisplay);
    sortBy.addEventListener('change', updateDisplay);
}

// Story read functionality
document.querySelectorAll('.read-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const card = btn.parentElement;
        const title = card.querySelector('h3').textContent;
        const content = card.querySelector('.story-content');
        if (content) {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-body').innerHTML = content.innerHTML;
            document.getElementById('story-modal').style.display = 'block';
        }
    });
});

// Close modal
document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('story-modal').style.display = 'none';
});

// Close modal on outside click
window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('story-modal')) {
        document.getElementById('story-modal').style.display = 'none';
    }
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

// Close any open modal with Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const storyModal = document.getElementById('story-modal');
        const definitionModal = document.getElementById('definition-modal');
        if (storyModal && storyModal.style.display === 'block') {
            storyModal.style.display = 'none';
        }
        if (definitionModal && definitionModal.style.display === 'block') {
            definitionModal.style.display = 'none';
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
        const ruleId = `rule-spy-${index + 1}`;
        header.id = ruleId;
        
        const match = header.textContent.match(/Rule \d+/);
        const labelText = match ? match[0] : `Rule ${index + 1}`;
        
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${ruleId}`;
        a.textContent = labelText;
        a.title = header.textContent;
        
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
                const link = tocNav.querySelector(`a[href="#${entry.target.id}"]`);
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

function initLearnScrollspy() {
    const learnSection = document.getElementById('how-to-learn');
    if (!learnSection) return;

    const tocNav = document.createElement('nav');
    tocNav.className = 'toc-nav toc-learn';
    const tocUl = document.createElement('ul');
    tocNav.appendChild(tocUl);

    const chapterHeaders = Array.from(learnSection.querySelectorAll('h2')).filter(h2 => h2.textContent.includes('Chapter'));
    if (chapterHeaders.length === 0) return;

    chapterHeaders.forEach((header, index) => {
        const chapterId = `chapter-spy-${index + 1}`;
        header.id = chapterId;
        
        const match = header.textContent.match(/Chapter \d+/);
        const labelText = match ? match[0] : `Chapter ${index + 1}`;
        
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${chapterId}`;
        a.textContent = labelText;
        a.title = header.textContent;
        
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
                const link = tocNav.querySelector(`a[href="#${entry.target.id}"]`);
                if (link) {
                    link.classList.add('active');
                    activeTocLink = link;
                    link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });
    }, tocObserverOptions);

    chapterHeaders.forEach(header => tocObserver.observe(header));
}

// Initialize on load
initScrollspy();
initLearnScrollspy();



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
    const structuralCats = ['mood_tag', 'clausal_wall', 'condition', 'passive', 'phatic',
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
    translateTextBtn.addEventListener('click', runTranslator);
    translatorInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            runTranslator();
        }
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
