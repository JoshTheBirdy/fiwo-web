/* workbook-page.js — the course you answer instead of read.
 *
 * HAND-WRITTEN. `workbook.js` beside it is GENERATED from Workbook_v4.md by
 * Fiwo/Tools/update_workbook.mjs and holds 46 sections, 457 exercises, and the
 * answer to every one of them. This file is the page around that data: the side
 * panel, one lesson at a time, the five answer widgets, and the score.
 *
 * ── WHY THE GRADING IS NOT ONE THING ────────────────────────────────────────
 *
 * Roadmap D1, and it is the decision the whole page hangs off. A Fiwo answer is
 * machine-checkable: the key states it exactly, so `Mik nofa.` is right and
 * anything else is not. An English answer is not. Fuzzy-matching "You are a
 * person" against "you're a person" either marks a correct answer wrong or
 * accepts a wrong one, and on a course Josh wrote by hand the first of those is
 * worse than not grading it at all.
 *
 * So Fiwo output is auto-graded, English and prose are typed-then-self-graded,
 * and closed lists are tap-to-answer. Self-grading scores 6 where machine
 * grading scores 10 — it is the cheaper claim and the total should say so.
 *
 * ── WHAT A WRONG ANSWER SAYS ────────────────────────────────────────────────
 *
 * A miss on a Fiwo item is re-run through `fiwo-parser.js`, because *"that
 * parses, but it is not the answer"* and *"that does not parse: two verbs in
 * one clause"* are different lessons and the second one is the useful one. The
 * parser is the same code the translator and the corpus validator use.
 */
(function () {
    'use strict';

    const POINTS = { first: 10, retry: 5, self: 6, revealed: 2, cloze: 4, spoken: 4 };

    let data = null;
    let currentId = null;
    let tocBuilt = false;

    const $ = (sel, root = document) => root.querySelector(sel);
    const esc = (s) => String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* Backticks and *italics* inside a prompt or a key, which the markdown kept
     * and the reader should see as code and emphasis rather than as punctuation.
     * Escaped FIRST, so a key containing `<` cannot inject anything. */
    const rich = (s) => esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // ── Scoring ─────────────────────────────────────────────────────────────

    /* Two different questions, and conflating them is what made the spoken
     * drills disappear.
     *
     * `counts` — is this an item you have to do before the lesson is finished?
     * Every item is: each one renders a widget you can act on. It used to be
     * `points > 0`, which quietly meant "and oral drills are not items", so
     * Lesson 1 — eight of whose thirteen exercises are *Say it aloud* — stayed
     * on "Not started" no matter how many of them you said.
     *
     * `gradeable` — can this item come out right or wrong? An oral one cannot;
     * nothing heard it. So it counts towards finishing the lesson and towards
     * the points, and stays out of the mastery fraction, which would otherwise
     * cap a perfect Lesson 1 at 5/13. */
    const counts = (ex) => ex.points > 0 || ex.type === 'oral';
    const gradeable = (ex) => ex.type !== 'oral';

    /* Cloze items are generated from the lesson's own examples, so they live
     * beside the authored exercises rather than among them, and their ids are
     * strings (`c0`, `c1`) so they can share one `items` map with the numbered
     * ones without ever colliding. */
    const clozeItems = (lesson) => (lesson.cloze || []).map((c, i) => ({
        ...c, n: `c${i}`, type: 'cloze', points: POINTS.cloze, answers: [c.answer],
        // The reveal shows the whole sentence, not the bare word — seeing the
        // gap filled in place is the thing worth reading.
        key: `\`${c.fiwo}\``,
    }));

    const allItems = (lesson) => [...lesson.exercises, ...clozeItems(lesson)];

    /* What a stored answer is worth NOW.
     *
     * Straight from the record, except for a spoken drill, whose value was never
     * anything the reader did — clicking *Said it* is the only way to make one,
     * so its points are decided entirely by the scoring model. Drills answered
     * while that model said 0 are re-valued rather than stranded at zero, which
     * is the difference between fixing the scoring and asking Josh to redo
     * Lesson 1 to collect on it. */
    const earned = (ex, rec) =>
        rec.spoken ? (rec.points || ex.points || POINTS.spoken) : (rec.points || 0);

    /** What a lesson is worth, and what has been got out of it so far. */
    function tally(lesson) {
        const saved = FiwoStore.lesson(lesson.id);
        const items = allItems(lesson).filter(counts);
        const max = items.reduce((n, ex) => n + ex.points, 0);
        const spoken = items.filter(ex => !gradeable(ex)).length;
        const marked = items.length - spoken;
        let score = 0, correct = 0, answered = 0, said = 0;
        for (const ex of items) {
            const rec = saved.items[ex.n];
            if (!rec) continue;
            answered++;
            score += earned(ex, rec);
            if (rec.correct) correct++;
            if (!gradeable(ex)) said++;
        }
        return {
            score, max, answered, correct, total: items.length, marked, spoken, said,
            /* Mastery is the share of the CHECKED items you got right. With no
             * checked items at all it falls back to how much of the lesson has
             * been done, so an all-spoken lesson can still fill its ring. */
            mastery: marked ? Math.round((correct / marked) * 100)
                : items.length ? Math.round((answered / items.length) * 100) : 0,
            done: items.length > 0 && answered === items.length,
        };
    }

    function totals() {
        let score = 0, max = 0, done = 0, started = 0;
        for (const lesson of data.lessons) {
            const t = tally(lesson);
            score += t.score; max += t.max;
            if (t.done) done++;
            else if (t.answered) started++;
        }
        return { score, max, done, started, lessons: data.lessons.length };
    }

    // ── Answer checking ─────────────────────────────────────────────────────

    /* Normalise, never fuzz.
     *
     * Case, a trailing stop and curly quotes are noise — nobody means a
     * different sentence by them. Word order and spelling are NOT noise and are
     * left alone, which is the difference between marking an answer and
     * guessing at one. */
    const normalise = (s) => String(s)
        .trim().toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/[.?!]+$/, '');

    const matches = (typed, answers) =>
        answers.some(a => normalise(a) === normalise(typed));

    /* The types the machine can mark. Everything else is typed, revealed and
     * judged by the reader — see D1 at the top of the file. */
    const AUTO_GRADED = new Set(['type-fiwo', 'cloze']);

    /** Why a Fiwo answer was rejected — a grammar fault, or just the wrong one. */
    function diagnose(typed) {
        const parser = window.FiwoParser;
        if (!parser || !/[.?!]$/.test(typed.trim())) return null;
        try {
            const result = parser.parseSentence(typed.trim());
            if (result.valid) return 'That is a legal Fiwo sentence — but it is not the answer to this one.';
            const first = (result.errors || [])[0];
            return first ? `That does not parse: ${first}` : null;
        } catch {
            return null;
        }
    }

    // ── The side panel ──────────────────────────────────────────────────────

    /* Phases as groups, lessons under them, and the real titles — not the bare
     * numbers the Rulebook's TOC shows with the title hidden in a `title`
     * attribute a phone can never display. A lesson is findable by what it
     * teaches or it is not findable. */
    function buildToc() {
        const toc = $('#wb-toc');
        if (!toc) return;
        const byId = new Map(data.lessons.map(l => [l.id, l]));

        toc.innerHTML = `
            <div class="wb-toc-head">
                <div id="wb-totals" class="wb-totals"></div>
            </div>
            ${data.phases.map(ph => `
                <div class="wb-phase">
                    <h4>${esc(ph.title)}</h4>
                    ${ph.ability ? `<p class="wb-ability">${esc(ph.ability)}</p>` : ''}
                    <ul>
                        ${ph.lessons.map(id => {
                            const l = byId.get(id);
                            if (!l) return '';
                            const label = l.kind === 'review' ? `★ ${l.name}` : l.name;
                            return `<li><a href="#workbook/${id}" data-wb-link="${id}">
                                <b>${esc(label)}</b><span>${esc(l.title)}</span>
                                <i class="wb-ring" data-ring="${id}"></i>
                            </a></li>`;
                        }).join('')}
                    </ul>
                </div>`).join('')}`;
        tocBuilt = true;
    }

    /* Progress is repainted on its own rather than by rebuilding the panel:
     * answering one item must not scroll the list or drop the reader's place in
     * a 46-entry menu. */
    function paintToc() {
        const toc = $('#wb-toc');
        if (!toc) return;
        for (const lesson of data.lessons) {
            const ring = toc.querySelector(`[data-ring="${lesson.id}"]`);
            if (!ring) continue;
            const t = tally(lesson);
            ring.style.setProperty('--pct', `${t.mastery}%`);
            ring.dataset.state = t.done ? 'done' : t.answered ? 'part' : 'none';
            ring.title = t.answered
                ? `${t.answered} of ${t.total} done · ${t.correct} of ${t.marked} right · ${t.score}/${t.max} points`
                : 'Not started';
        }
        toc.querySelectorAll('[data-wb-link]').forEach(a =>
            a.classList.toggle('is-current', a.dataset.wbLink === currentId));

        const tot = totals();
        const streak = FiwoStore.streak();
        const el = $('#wb-totals');
        if (el) {
            el.innerHTML = `
                <b>${tot.score.toLocaleString('en')}</b> points
                <span>${tot.done} of ${tot.lessons} lessons finished${tot.started ? ` · ${tot.started} started` : ''}</span>
                ${streak.current ? `<span>${streak.current}-day streak${streak.today ? '' : ' — nothing today yet'}</span>` : ''}`;
        }
    }

    // ── The exercises ───────────────────────────────────────────────────────

    const TYPE_LABEL = {
        'type-fiwo': 'Write it in Fiwo',
        'type-en': 'Write it in English',
        'explain': 'Answer, then mark yourself',
        'choice': 'Pick one',
        'oral': 'Say it aloud',
    };

    /* Four outcomes, not two. "I showed myself the answer" is neither right nor
     * wrong, and colouring it as either is a small lie the reader will notice
     * before the score does.
     *
     * A spoken drill used to share that muted grey, on the reasoning that
     * nothing checked either of them. But grey is the colour of *giving up* on
     * an item, and saying a word aloud is the opposite — it is the whole point
     * of the lesson. It gets its own colour: done and credited, not verified. */
    const outcomeClass = (rec) =>
        !rec ? '' : rec.spoken ? 'is-spoken' : rec.revealed ? 'is-shown'
            : rec.correct ? 'is-right' : 'is-wrong';

    /* ── The word bank ───────────────────────────────────────────────────────
     *
     * Tap a word to place it, tap a placed word to take it back, and drag to
     * reorder. Tapping is the primary interaction and drag is the enhancement,
     * not the other way round: HTML5 drag-and-drop does not fire on touch at
     * all, and a phone is where "produce this sentence from nothing" is hardest
     * and the bank is most wanted. So the drag below is pointer-events, which
     * work the same on both, and everything it does is reachable by tapping.
     */
    const bankHtml = (ex, rec) => `
        <div class="wb-bank" data-bank>
            <div class="wb-slot" data-slot aria-label="Your answer"></div>
            <div class="wb-tiles">${ex.bank.map((w, i) =>
                `<button type="button" class="wb-tile" data-tile="${i}">${esc(w)}</button>`).join('')}</div>
            <p class="wb-hint">Tap to place, tap again to take back, drag to reorder.
            Worth ${POINTS.retry} rather than ${POINTS.first} — the words are given.</p>
            <div class="wb-entry-actions">
                <button type="button" class="wb-btn wb-btn-go" data-check>Check</button>
                <button type="button" class="wb-btn wb-quiet" data-bank-clear>Start over</button>
                <button type="button" class="wb-btn wb-quiet" data-bank-off>Type it instead</button>
            </div>
        </div>`;

    const clozeHtml = (ex, rec) => {
        const done = Boolean(rec);
        const gap = done
            ? `<span class="wb-gap is-filled">${esc(ex.answer)}</span>`
            : `<input type="text" class="wb-gap-input" data-answer size="${Math.max(4, ex.answer.length)}"
                 autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="the missing word">`;
        return `
            <p class="wb-cloze-line">${ex.tokens.map((t, i) => i === ex.blank
                ? `${esc(ex.pre)}${gap}${esc(ex.post)}` : esc(t)).join(' ')}</p>
            <p class="wb-cloze-en">${esc(ex.english)}</p>
            ${done ? '' : '<div class="wb-entry-actions"><button type="button" class="wb-btn wb-btn-go" data-check>Check</button></div>'}`;
    };

    /* The typed-answer block, on its own so that "Type it instead" can put it
     * back after the word bank has replaced it. */
    function exerciseEntry(ex, rec) {
        const done = Boolean(rec);
        const multiline = ex.type !== 'type-fiwo';
        return `
            <div class="wb-entry">
                ${multiline
                    ? `<textarea class="wb-input" rows="2" data-answer ${done ? 'disabled' : ''}
                         placeholder="Your answer">${done ? esc(rec.answer || '') : ''}</textarea>`
                    : `<input type="text" class="wb-input" data-answer ${done ? 'disabled' : ''}
                         autocomplete="off" autocapitalize="off" spellcheck="false"
                         placeholder="Your answer" value="${done ? esc(rec.answer || '') : ''}">`}
                ${done ? '' : `<div class="wb-entry-actions">
                    <button type="button" class="wb-btn wb-btn-go" data-check>${
                        ex.type === 'type-fiwo' ? 'Check' : 'Reveal answer'}</button>
                    ${ex.bank ? '<button type="button" class="wb-btn wb-quiet" data-bank-on>Use the word bank</button>' : ''}
                    ${ex.type === 'type-fiwo' ? '<button type="button" class="wb-btn wb-quiet" data-give-up>Show me</button>' : ''}
                </div>`}
            </div>`;
    }

    function exerciseHtml(ex, rec) {
        const done = Boolean(rec);
        const state = outcomeClass(rec);

        if (ex.type === 'cloze') {
            return `<li class="wb-item wb-item-cloze ${state}" data-n="${ex.n}">
                ${clozeHtml(ex, rec)}
                <div class="wb-feedback" data-feedback>${done ? verdictHtml(ex, rec) : ''}</div>
            </li>`;
        }

        let control = '';
        if (ex.type === 'choice') {
            control = `<div class="wb-options">${(ex.options || []).map(o =>
                `<button type="button" class="wb-option${done && normalise(o) === normalise(rec.answer) ? ' is-picked' : ''}"
                    data-pick="${esc(o)}" ${done ? 'disabled' : ''}><code>${esc(o)}</code></button>`).join('')}</div>`;
        } else if (ex.type === 'oral') {
            control = done ? '' : '<button type="button" class="wb-btn" data-oral>Said it</button>';
        } else {
            control = exerciseEntry(ex, rec);
        }

        return `
        <li class="wb-item ${state}" data-n="${ex.n}">
            <div class="wb-q">
                <span class="wb-n">${ex.n}</span>
                <div class="wb-q-text">${rich(ex.text)}</div>
            </div>
            ${control}
            <div class="wb-feedback" data-feedback>${done ? verdictHtml(ex, rec) : ''}</div>
        </li>`;
    }

    function verdictHtml(ex, rec) {
        const pts = earned(ex, rec);
        /* A spoken drill is not marked "Right" — nothing checked it, so it is
         * never counted towards mastery. It does count towards finishing the
         * lesson and towards the points, because a course whose first lesson is
         * eight-thirteenths spoken cannot treat speaking as not-work. */
        const word = rec.spoken ? 'Said it' : rec.revealed ? 'Answer shown' : rec.correct ? 'Right' : 'Not yet';
        return `<p class="wb-verdict">${word}${pts ? ` · +${pts}` : ''}</p>
                ${ex.key ? `<p class="wb-key"><span>Answer</span> ${rich(ex.key)}</p>` : ''}`;
    }

    /* The self-graded pair. Deliberately asked AFTER the answer is on screen and
     * deliberately not defaulted: the reader is the grader here, and a button
     * that is already selected is not a judgement. */
    const selfGradeHtml = (ex) => `
        <p class="wb-key"><span>Answer</span> ${rich(ex.key)}</p>
        <div class="wb-self">
            <button type="button" class="wb-btn wb-btn-go" data-self="1">I got it</button>
            <button type="button" class="wb-btn wb-quiet" data-self="0">I didn't</button>
        </div>`;

    // ── Rendering a lesson ──────────────────────────────────────────────────

    function lessonIndex(id) { return data.lessons.findIndex(l => l.id === id); }

    function render() {
        const main = $('#wb-main');
        const lesson = data.lessons.find(l => l.id === currentId);
        if (!main || !lesson) return;

        const t = tally(lesson);
        const i = lessonIndex(currentId);
        const prev = data.lessons[i - 1];
        const next = data.lessons[i + 1];
        const groups = [];
        for (const ex of lesson.exercises) {
            const last = groups[groups.length - 1];
            if (last && last.part === ex.part) last.items.push(ex);
            else groups.push({ part: ex.part, prompt: ex.prompt, note: ex.note, type: ex.type, items: [ex] });
        }
        const saved = FiwoStore.lesson(lesson.id);
        const cloze = clozeItems(lesson);

        main.innerHTML = `
            <div class="wb-head">
                <h3>${lesson.kind === 'review' ? '★ ' : ''}${esc(lesson.name)}</h3>
                <p class="wb-subtitle">${esc(lesson.title)}</p>
                <div class="wb-score" data-score>${scoreLine(t)}</div>
            </div>

            <div class="wb-teach">${lesson.html}</div>

            ${lesson.exercises.length ? `
            <div class="wb-exercises">
                <h3>Exercises</h3>
                ${groups.map(g => `
                    <section class="wb-part">
                        <h4>${esc(g.prompt || 'Practice')}
                            <span class="wb-part-type">${esc(TYPE_LABEL[g.type] || '')}</span></h4>
                        ${g.note ? `<p class="wb-part-note">${rich(g.note)}</p>` : ''}
                        <ol class="wb-items">
                            ${g.items.map(ex => exerciseHtml(ex, saved.items[ex.n])).join('')}
                        </ol>
                    </section>`).join('')}
            </div>` : ''}

            ${cloze.length ? `
            <div class="wb-exercises">
                <h3>Fill the gaps</h3>
                <p class="wb-part-note">Built from this lesson's own examples, so every missing
                word is one the lesson just taught you. The English is underneath.</p>
                <ol class="wb-items">${cloze.map(c => exerciseHtml(c, saved.items[c.n])).join('')}</ol>
            </div>` : ''}

            ${t.answered ? '<button type="button" class="wb-btn wb-quiet" data-reset-lesson>Clear my answers for this lesson</button>' : ''}

            ${currentId === 'FR' && data.outro ? `<div class="wb-teach wb-outro">${data.outro}</div>` : ''}

            <nav class="wb-move">
                ${prev ? `<a href="#workbook/${prev.id}">&larr; ${esc(prev.name)}</a>` : '<span></span>'}
                ${next ? `<a href="#workbook/${next.id}">${esc(next.name)} &rarr;</a>` : '<span></span>'}
            </nav>`;

        paintToc();
    }

    /* "N of M right" over every item was wrong the moment spoken drills started
     * counting — eight of Lesson 1's items can never be "right". Right is
     * reported over the marked items, said over the spoken ones, and the two
     * add up to the lesson. */
    const scoreLine = (t) => t.total
        ? `<b>${t.score}</b> / ${t.max} points`
            + (t.marked ? ` · ${t.correct} of ${t.marked} right` : '')
            + (t.spoken ? ` · ${t.said} of ${t.spoken} said aloud` : '')
            + (t.done ? ' · finished' : '')
        : 'Reading only — no exercises in this lesson.';

    function repaintScore() {
        const lesson = data.lessons.find(l => l.id === currentId);
        const el = $('[data-score]');
        if (lesson && el) el.innerHTML = scoreLine(tally(lesson));
        paintToc();
    }

    // ── Answering ───────────────────────────────────────────────────────────

    function find(n) {
        const lesson = data.lessons.find(l => l.id === currentId);
        // Cloze ids are strings, exercise numbers are not — compare as strings
        // so one lookup serves both.
        return [lesson, allItems(lesson || {}).find(e => String(e.n) === String(n))];
    }

    /** Write one answer, and the lesson totals it changes, in a single call. */
    function record(ex, rec) {
        const lesson = data.lessons.find(l => l.id === currentId);
        const saved = FiwoStore.lesson(lesson.id);
        const merged = { ...saved.items, [ex.n]: rec };
        const items = allItems(lesson).filter(counts);
        const score = items.reduce((n, e) => n + (merged[e.n] ? earned(e, merged[e.n]) : 0), 0);
        const max = items.reduce((n, e) => n + e.points, 0);
        const done = items.every(e => merged[e.n]);
        FiwoStore.setWorkbookItem(lesson.id, ex.n, rec, {
            score, max, doneAt: done ? new Date().toISOString() : null,
        });
    }

    function settle(li, ex, rec) {
        record(ex, rec);
        li.classList.remove('is-right', 'is-wrong', 'is-shown', 'is-spoken');
        li.classList.add(outcomeClass(rec));
        /* A filled gap becomes text, not a dead input box: the point of a cloze
         * is reading the finished sentence back, and a disabled field in the
         * middle of it still looks like something you are meant to edit. */
        const gap = li.querySelector('.wb-gap-input');
        if (gap) {
            const filled = document.createElement('span');
            filled.className = `wb-gap is-filled${rec.correct ? '' : ' is-wrong'}`;
            filled.textContent = rec.correct ? ex.answer : (rec.answer || ex.answer);
            gap.replaceWith(filled);
        }
        li.querySelectorAll('input, textarea, button[data-pick], .wb-tile').forEach(el => { el.disabled = true; });
        li.querySelector('.wb-entry-actions')?.remove();
        li.querySelector('[data-bank] .wb-hint')?.remove();
        // An empty tile row after the answer is placed is just a leftover box.
        const spare = li.querySelector('[data-bank] .wb-tiles');
        if (spare && !spare.querySelector('.wb-tile')) spare.remove();
        $('[data-feedback]', li).innerHTML = verdictHtml(ex, rec);
        repaintScore();
    }

    /** The placed words, in the order they were placed. */
    const slotWords = (li) =>
        [...li.querySelectorAll('[data-slot] .wb-tile')].map(t => t.textContent);

    function checkTyped(li, ex) {
        const bank = $('[data-bank]', li);
        const feedback = $('[data-feedback]', li);
        const tries = Number(li.dataset.tries || 0) + 1;
        li.dataset.tries = tries;

        if (bank) {
            const words = slotWords(li);
            if (!words.length) { feedback.innerHTML = '<p class="wb-hint">Place some words first.</p>'; return; }
            const built = words.join(' ');
            if (matches(built, ex.answers)) {
                // Always the retry rate, however few attempts it took: the bank
                // hands over the vocabulary and the spelling, and only the order
                // is still being tested.
                settle(li, ex, { answer: built, correct: true, tries, banked: true, points: POINTS.retry });
            } else {
                const why = diagnose(built);
                feedback.innerHTML = `<p class="wb-hint wb-miss">Not that order.${why ? ` ${esc(why)}` : ''}</p>`;
            }
            return;
        }

        const input = $('[data-answer]', li);
        const typed = (input?.value || '').trim();

        // Self-graded: the answer goes on screen and the reader judges.
        if (!AUTO_GRADED.has(ex.type)) {
            if (!typed) { feedback.innerHTML = '<p class="wb-hint">Write something first — comparing against your own attempt is the point.</p>'; return; }
            li.dataset.typed = typed;
            /* `explain` keys often carry the right Fiwo sentence too, so say when
             * the typed answer contains it. A bonus, not the grade. */
            const bonus = ex.answers.length && matches(typed, ex.answers)
                ? '<p class="wb-hint">That is exactly the sentence in the answer.</p>' : '';
            feedback.innerHTML = bonus + selfGradeHtml(ex);
            input.disabled = true;
            li.querySelector('.wb-entry-actions')?.remove();
            return;
        }

        if (!typed) {
            feedback.innerHTML = `<p class="wb-hint">${ex.type === 'cloze'
                ? 'Which word is missing?' : 'Type an answer, or press Show me.'}</p>`;
            return;
        }
        if (matches(typed, ex.answers)) {
            /* §2.4's 10-then-5 generalised: a retry is worth half. Stated as a
             * rule rather than a second table of constants, so a cloze item
             * (4 points) drops to 2 instead of to the type-fiwo retry value,
             * which is larger than the whole item is worth. */
            const full = ex.type === 'cloze' ? POINTS.cloze : POINTS.first;
            settle(li, ex, { answer: typed, correct: true, tries,
                             points: tries === 1 ? full : Math.floor(full / 2) });
            return;
        }
        const why = diagnose(typed);
        feedback.innerHTML = `<p class="wb-hint wb-miss">${ex.type === 'cloze'
            ? 'Not that word — it is one from this lesson.' : `Not that one.${why ? ` ${esc(why)}` : ''}`}</p>`;
        input.select?.();
    }

    document.addEventListener('click', (e) => {
        if (!data || !currentId) return;
        const li = e.target.closest('.wb-item');

        if (e.target.closest('[data-reset-lesson]')) {
            if (!confirm('Clear your answers for this lesson? The points go with them.')) return;
            FiwoStore.clearLesson(currentId);
            render();
            return;
        }
        if (!li) return;
        const [, ex] = find(li.dataset.n);
        if (!ex) return;

        // Word bank on and off. Off restores the plain input, because the bank
        // is a way past being stuck and should never be a one-way door.
        if (e.target.closest('[data-bank-on]')) {
            $('.wb-entry', li).outerHTML = bankHtml(ex, null);
            return;
        }
        if (e.target.closest('[data-bank-off]')) {
            $('[data-bank]', li).outerHTML = exerciseEntry(ex);
            return;
        }
        /* Tapping places at the END, so a word put in the wrong slot cannot be
         * moved by tapping alone — that is what dragging is for, and this is
         * for when dragging is more trouble than starting again. Without it the
         * tap-only path is a dead end after the first mistake. */
        if (e.target.closest('[data-bank-clear]')) {
            const tiles = $('.wb-tiles', li);
            li.querySelectorAll('[data-slot] .wb-tile').forEach(t => tiles.appendChild(t));
            return;
        }

        const tile = e.target.closest('.wb-tile');
        if (tile && !dragging) {
            const slot = $('[data-slot]', li);
            // Placed tiles go home; unplaced tiles join the end of the answer.
            (tile.parentElement === slot ? $('.wb-tiles', li) : slot).appendChild(tile);
            return;
        }

        if (e.target.closest('[data-check]')) { checkTyped(li, ex); return; }

        if (e.target.closest('[data-give-up]')) {
            /* Two points for looking, and `correct: false` — mastery is the
             * share of items you got RIGHT, and reading the answer is not
             * getting it right. The points are for having engaged with it. */
            settle(li, ex, { answer: $('[data-answer]', li)?.value.trim() || '', correct: false,
                             revealed: true, tries: Number(li.dataset.tries || 0), points: POINTS.revealed });
            return;
        }

        const pick = e.target.closest('[data-pick]');
        if (pick) {
            const chosen = pick.dataset.pick;
            settle(li, ex, { answer: chosen, correct: matches(chosen, ex.answers),
                             tries: 1, points: matches(chosen, ex.answers) ? POINTS.first : 0 });
            return;
        }

        if (e.target.closest('[data-oral]')) {
            /* `correct: false` and still worth points, like a reveal: mastery is
             * the share you got RIGHT and nothing heard this one, but the lesson
             * has to know it happened or its own drills do not count as work. */
            settle(li, ex, { answer: '', correct: false, tries: 1,
                             points: ex.points || POINTS.spoken, spoken: true });
            return;
        }

        const self = e.target.closest('[data-self]');
        if (self) {
            const got = self.dataset.self === '1';
            const typed = li.dataset.typed || '';
            if (!got) {
                /* "I didn't" leaves the item OPEN rather than banking a zero.
                 * Scoring a failure would make the lesson look finished when the
                 * thing it is measuring has not happened yet. */
                const input = $('[data-answer]', li);
                if (input) { input.disabled = false; input.focus(); }
                $('[data-feedback]', li).innerHTML =
                    `<p class="wb-key"><span>Answer</span> ${rich(ex.key)}</p>`
                    + '<p class="wb-hint">Left open — try it again whenever you like.</p>'
                    + '<div class="wb-entry-actions"><button type="button" class="wb-btn wb-btn-go" data-check>Reveal answer</button></div>';
                return;
            }
            settle(li, ex, { answer: typed, correct: true, tries: Number(li.dataset.tries || 1), points: POINTS.self });
        }
    });

    /* ── Dragging a tile ─────────────────────────────────────────────────────
     *
     * Pointer events, not HTML5 drag-and-drop, which does not fire on touch at
     * all. The tile follows the finger and a placeholder shows where it will
     * land; releasing drops it there. A drag that never moves more than a few
     * pixels is a tap, and falls through to the click handler above — which is
     * why `dragging` is checked there rather than the two competing.
     */
    const DRAG_SLOP = 6;
    let dragging = null;

    document.addEventListener('pointerdown', (e) => {
        const tile = e.target.closest('.wb-tile');
        if (!tile || tile.disabled || e.button > 0) return;
        const box = tile.getBoundingClientRect();
        dragging = {
            tile, moved: false,
            startX: e.clientX, startY: e.clientY,
            dx: e.clientX - box.left, dy: e.clientY - box.top,
            home: tile.parentElement, next: tile.nextSibling,
            ghost: null,
        };
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const { tile } = dragging;
        if (!dragging.moved) {
            if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) < DRAG_SLOP) return;
            dragging.moved = true;
            tile.setPointerCapture?.(e.pointerId);
            const box = tile.getBoundingClientRect();
            // A placeholder of the same size keeps the row from collapsing and
            // reflowing under the finger while the tile is lifted out of it.
            const ghost = document.createElement('span');
            ghost.className = 'wb-tile wb-tile-ghost';
            ghost.style.width = `${box.width}px`;
            ghost.style.height = `${box.height}px`;
            tile.after(ghost);
            dragging.ghost = ghost;
            tile.classList.add('is-dragging');
            tile.style.width = `${box.width}px`;
        }
        e.preventDefault();
        tile.style.left = `${e.clientX - dragging.dx}px`;
        tile.style.top = `${e.clientY - dragging.dy}px`;

        // Where would it land? The nearest gap in whichever row is under it.
        const li = tile.closest('.wb-item');
        const over = document.elementsFromPoint(e.clientX, e.clientY)
            .find(el => el.matches?.('[data-slot], .wb-tiles')) || dragging.ghost.parentElement;
        const siblings = [...over.querySelectorAll('.wb-tile')]
            .filter(t => t !== tile && t !== dragging.ghost);
        const after = siblings.find(t => {
            const b = t.getBoundingClientRect();
            return e.clientY < b.bottom && e.clientX < b.left + b.width / 2;
        });
        if (after) over.insertBefore(dragging.ghost, after);
        else over.appendChild(dragging.ghost);
        void li;
    });

    function endDrag() {
        if (!dragging) return;
        const { tile, ghost, moved } = dragging;
        if (moved) {
            tile.classList.remove('is-dragging');
            tile.style.cssText = '';
            ghost.replaceWith(tile);
        }
        // Cleared on the next frame so the click that follows a real drag is
        // ignored, and a tap (which never set `moved`) still lands.
        const wasMoved = moved;
        if (wasMoved) requestAnimationFrame(() => { dragging = null; });
        else dragging = null;
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // Enter checks a single-line Fiwo answer; a textarea keeps its newlines.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.matches('[data-answer]')) return;
        const li = e.target.closest('.wb-item');
        const [, ex] = find(li?.dataset.n);
        if (ex) { e.preventDefault(); checkTyped(li, ex); }
    });

    // ── Entry point ─────────────────────────────────────────────────────────

    const LAST = 'workbook.last';

    /** Called by script.js when #workbook becomes the active section. */
    function open(detail) {
        data = window.FIWO_WORKBOOK;
        const main = $('#wb-main');
        if (!main) return;
        if (!data) {
            main.innerHTML = '<p class="fc-note">The course could not load. '
                + '<code>workbook.js</code> is generated by <code>update_workbook.mjs</code> — if you are running '
                + 'this site from a copy, that file may be missing.</p>';
            return;
        }
        if (!tocBuilt) buildToc();

        const wanted = detail && data.lessons.some(l => l.id === detail) ? detail : null;
        // No lesson in the URL means the one you were last on — the workbook is
        // 46 sections long and starting over at L1 every visit is not a default,
        // it is an obstacle.
        currentId = wanted || FiwoStore.getPref(LAST, null) || data.lessons[0].id;
        if (!data.lessons.some(l => l.id === currentId)) currentId = data.lessons[0].id;
        FiwoStore.setPref(LAST, currentId);
        render();
        if (wanted) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Keeps the panel honest when progress changes anywhere else — importing a
    // backup file, or clearing everything from the reader's progress panel.
    document.addEventListener('fiwo-store-changed', () => {
        if (data && currentId && $('#workbook')?.classList.contains('active')) paintToc();
    });

    window.FiwoWorkbook = { open };

    // A deep link to #workbook resolves during script.js evaluation, which may
    // run before this file. Same guard flashcards.js uses.
    if (document.getElementById('workbook')?.classList.contains('active')) {
        open(location.hash.split('/')[1] || null);
    }
})();
