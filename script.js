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
                document.getElementById('definition-modal-body').innerHTML = `
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
// ============================================

// Grammatical suffixes in Fiwo (including compound tenses and structural markers)
const suffixTranslations = {
    'f': 'distributive flag',
    'dyq': 'past continuous',
    'syq': 'future continuous',
    'dyk': 'past perfect',
    'syk': 'future perfect',
    'p': 'specific',
    'r': 'non-specific',
    'd': 'past',
    's': 'future',
    'q': 'continuous',
    'k': 'perfect',
    'm': 'nested',
    't': 'stacker'
};

// 1. MORPHOLOGICAL PARSER: Finds root and suffixes using greedy matching
function parseWord(rawWord) {
    const wordLower = rawWord.toLowerCase();
    let matchedRoot = "";
    let suffixes = "";
    let dictEntry = null;

    // Safety check just in case dictionaryData hasn't loaded
    let sortedDict = [];
    if (typeof dictionaryData !== 'undefined') {
        const combinedData = typeof derivedDictionaryData !== 'undefined'
            ? [...dictionaryData, ...derivedDictionaryData]
            : [...dictionaryData];
        // Sort dictionary by longest words first to prevent partial root matches
        sortedDict = combinedData.sort((a, b) => b.word.length - a.word.length);
    }

    for (const entry of sortedDict) {
        if (wordLower.startsWith(entry.word.toLowerCase())) {
            matchedRoot = entry.word;
            suffixes = wordLower.slice(entry.word.length);
            dictEntry = entry;
            break;
        }
    }

    // Fallback for words not in the dictionary (Splits after the last vowel)
    if (!matchedRoot) {
        const match = wordLower.match(/^(.*[aeiouy])([^aeiouy]*)$/i);
        if (match) {
            matchedRoot = match[1];
            suffixes = match[2];
        } else {
            matchedRoot = wordLower;
            suffixes = "";
        }
    }

    // Format output strings
    let codeStr = matchedRoot;
    let rootStr = dictEntry ? dictEntry.english_equiv : "???";
    
    if (suffixes) {
        let remaining = suffixes;
        let parsedSuffixes = [];
        let translatedSuffixesList = [];

        // Sort suffix dictionary by length descending to catch 'dyq' before 'd'
        const knownSuffixKeys = Object.keys(suffixTranslations).sort((a, b) => b.length - a.length);

        while (remaining.length > 0) {
            let matched = false;
            for (const key of knownSuffixKeys) {
                if (remaining.startsWith(key)) {
                    parsedSuffixes.push(key);
                    translatedSuffixesList.push(suffixTranslations[key]);
                    remaining = remaining.slice(key.length);
                    matched = true;
                    break;
                }
            }
            // Fallback: if no known suffix matches, split off one character
            if (!matched) {
                parsedSuffixes.push(remaining[0]);
                translatedSuffixesList.push(remaining[0]);
                remaining = remaining.slice(1);
            }
        }

        codeStr += " + " + parsedSuffixes.join(' + ');
        rootStr += " + " + translatedSuffixesList.join(' + ');
    }

    return {
        word: rawWord,
        code: codeStr,
        root: rootStr
    };
}

// 2. UI TRANSLATION LOGIC (Removed DOMContentLoaded wrapper to prevent race conditions)
const translateTextBtn = document.getElementById('translate-text-btn');
const translatorInput = document.getElementById('translator-input');
const translatorOutput = document.getElementById('translator-output');

if (translateTextBtn && translatorInput && translatorOutput) {
    translateTextBtn.addEventListener('click', () => {
        const text = translatorInput.value.trim();
        if (!text) return;
        
        // Explicitly warn the user on the screen if the dictionary file is missing
        if (typeof dictionaryData === 'undefined') {
            translatorOutput.innerHTML = '<div style="color: #ff6b6b; font-weight: bold;">Error: dictionaryData is missing. Ensure dictionary.js is uploaded to your live website!</div>';
            return;
        }
        
        translatorOutput.innerHTML = '';
        
        // Split into sentences based on punctuation
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        
        sentences.forEach(sentenceText => {
            const words = sentenceText.trim().split(/\s+/);
            
            let combinedOriginal = [];
            let combinedCode = [];
            let combinedRoot = [];

            words.forEach(word => {
                const cleanWord = word.replace(/[.,!?]/g, '');
                if (!cleanWord) return;
                
                const parsed = parseWord(cleanWord);
                
                // Maintain original casing for display
                const displayWord = parsed.word; 
                
                combinedOriginal.push(displayWord);
                combinedCode.push(parsed.code);
                combinedRoot.push(parsed.root);
            });
            
            const sentenceWrapper = document.createElement('div');
            sentenceWrapper.className = 'trans-sentence-wrapper';
            
            sentenceWrapper.innerHTML = `
                <div class="trans-header">
                    <div class="trans-header-original">${combinedOriginal.join(' ')}</div>
                    <div class="trans-header-code">(${combinedCode.join(' | ')})</div>
                    <div class="trans-header-root">[${combinedRoot.join(' | ')}]</div>
                </div>
            `;
            
            translatorOutput.appendChild(sentenceWrapper);
        });
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