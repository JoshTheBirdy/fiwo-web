/*
 * THE FIWO LANGUAGE INTERFACE
 * Copyright (c) 2026 Joshua Leon Arkema Barends
 * This code is part of the Fiwo Language project.
 * Source Code License: CC BY 4.0 (Attribution Required)
 */

// Toggle side navigation
const menuBtn = document.getElementById('menu-btn');
const sideNav = document.getElementById('side-nav');
const navLinks = document.querySelectorAll('.side-nav a');
const pages = document.querySelectorAll('.page');

menuBtn.addEventListener('click', () => {
    sideNav.classList.toggle('active');
});

// Show side nav on hover over menu button
menuBtn.addEventListener('mouseenter', () => {
    sideNav.classList.add('active');
});

// Auto-hide side nav when mouse leaves
sideNav.addEventListener('mouseleave', () => {
    sideNav.classList.remove('active');
});

// Handle navigation links for SPA feel
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        pages.forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(targetId).classList.add('active');
        if (targetId === 'dictionary') {
            renderDictionary();
        }
        sideNav.classList.remove('active'); // Close nav after selection
    });
});

// Set home as default active page
document.getElementById('home').classList.add('active');

// Dictionary functionality
function renderDictionary() {
    const searchBar = document.getElementById('search-bar');
    const sortBy = document.getElementById('sort-by');
    const wordCount = document.getElementById('word-count');
    const grid = document.getElementById('dictionary-grid');

    function updateDisplay() {
        let filteredData = dictionaryData.filter(item =>
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
            card.className = 'card';
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
        });
    }

    updateDisplay();
    searchBar.addEventListener('input', updateDisplay);
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

// ============================================
// TRANSLATOR FEATURE
// ============================================

// Grammatical suffixes in Fiwo (including compound tenses)
const suffixTranslations = {
    'dyq': 'past continuous',
    'syq': 'future continuous',
    'yq': 'continuous',
    'p': 'specific',
    'd': 'past',
    's': 'future',
    'm': 'nested',
    'q': 'continuous'
};

// 1. MORPHOLOGICAL PARSER: Finds root and suffixes using greedy matching
function parseWord(rawWord) {
    const wordLower = rawWord.toLowerCase();
    let matchedRoot = "";
    let suffixes = "";
    let dictEntry = null;

    // Sort dictionary by longest words first to prevent partial root matches
    const sortedDict = [...dictionaryData].sort((a, b) => b.word.length - a.word.length);

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

// 2. UI TRANSLATION LOGIC
document.addEventListener('DOMContentLoaded', () => {
    const translateTextBtn = document.getElementById('translate-text-btn');
    const translatorInput = document.getElementById('translator-input');
    const translatorOutput = document.getElementById('translator-output');

    if (translateTextBtn && translatorInput && translatorOutput) {
        translateTextBtn.addEventListener('click', () => {
            const text = translatorInput.value.trim();
            if (!text) return;
            
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
});