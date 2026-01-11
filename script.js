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
            filteredData = filteredData.filter(item => item.part_of_speech === sortBy.value);
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
                <div class="definition">${item.definition}</div>
            `;
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