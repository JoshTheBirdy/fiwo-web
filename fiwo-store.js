/* fiwo-store.js — everything the site remembers, on your device and nowhere else.
 *
 * There is no account, no server and no telemetry here: this is localStorage,
 * scoped to this origin. Nothing in it ever leaves the machine unless the reader
 * exports it themselves.
 *
 * ── Why this file is more careful than "just call localStorage" ──
 *
 * The Fiwo Android app stores its review history as a plain JSON file in PUBLIC
 * storage (`Documents/Fiwo/progress.json`) precisely so that it survives an
 * uninstall, can be copied off the phone, and can be repaired in a text editor.
 * See `Fiwo APP/www/js/store.js`.
 *
 * A website cannot do any of those three. Browser storage is sandboxed to the
 * origin and, more importantly, it is EVICTABLE:
 *
 *   - Safari caps script-writable storage at 7 days without interaction, so a
 *     reader who doesn't visit for a week can lose everything silently.
 *   - Chrome and Firefox evict under storage pressure.
 *   - "Clear browsing data" wipes it, and most people don't realise that
 *     includes their study history.
 *
 * ── THE HONEST FRAME (Extras/Saving progress in a browser.md, measured 2026-09-07)
 *
 * No browser API makes data permanent, and "Clear browsing data" defeats every
 * one of them BY DESIGN — a site that could make itself undeletable would be a
 * privacy hole. Chrome silently DENIED `persist()` on the author's machine with
 * a service worker registered and controlling. So durability here is not one
 * feature. It is several independent chances, arranged so that none of them has
 * to work:
 *
 *   L1  ask for persistence — but from a user gesture, since Firefox is the one
 *       browser that prompts and a popup during first paint gets dismissed.
 *   L2  detect the real situation and say ONE concrete thing about it.
 *   L3  a real file on disk (File System Access) — `fiwo-backup.js`. Chromium
 *       desktop only, and the ONLY layer here that survives "Clear browsing
 *       data", so it outranks the rest of the readout when it is live.
 *   L4  export, and nag proportionally to what is actually at risk.
 *   L5  say the truth on screen — `storageHealth()`. A promise about durability
 *       that turns out to be false is worse than no promise.
 *
 * This file does not know how L3 works and cannot reach it: `fiwo-backup.js`
 * registers itself through `attachBackup()`, so the dependency runs one way and
 * the store still loads on a browser with no File System Access at all.
 *
 * ── Schema (v2) ──
 *
 * Shaped to match the app's progress.json where the two overlap, so that a
 * flashcard deck here can share an exporter with the app rather than needing a
 * migration:
 *
 *   { schema, stories: { [title]: { read, line, at } },
 *     cards: {},      // reserved — same shape as the app: id -> {fsrs, reviews, …}
 *     workbook: {},   // reserved — [lessonId] -> { items, score, max, doneAt }
 *     prefs: {},      // UI state: dictionary filters, reader toggles
 *     time: {},       // 'YYYY-MM-DD' -> { cards, stories } in ms, from timer.js
 *     meta: {},       // backup bookkeeping; local, never merged on import
 *     updatedAt }
 *
 * Stories are keyed by TITLE, which is also what the app hashes to build its
 * story id (`cardId('story', s.title)`), so no information is lost — an
 * exporter can derive the app's ids without the browser needing async SHA-1.
 *
 * ⚠️ UNKNOWN KEYS ARE PRESERVED, on both load and import. Before v2 they were
 * not: `repair()` rebuilt the object from a fixed list and `importJSON()` merged
 * only `stories` and `cards`, so `prefs` was already being dropped on every
 * round trip and `workbook` would have been next. A format two apps exchange
 * files in has to survive one of them being older than the other.
 */
(function () {
    'use strict';

    const KEY = 'fiwo.progress';
    const SCHEMA = 2;
    const WRITE_DELAY = 400;   // ms; reading position fires on scroll

    /* Keys this version knows how to validate. Anything else found in a stored
     * or imported object is carried through untouched — see repair(). */
    const KNOWN = new Set(['schema', 'stories', 'cards', 'workbook', 'prefs', 'time', 'meta', 'updatedAt']);

    let mode = 'unknown';      // 'persistent' | 'best-effort' | 'memory'
    /* WHY we ended up in memory mode, when we did. The two causes need
     * different sentences: storage refused at load is almost always private
     * browsing and nothing was ever saved, whereas a quota exceeded mid-session
     * means everything up to that point IS still on disk and only new writes
     * are being lost. Telling someone their data has vanished when it hasn't is
     * the same class of mistake as promising durability that isn't there. */
    let memoryReason = null;   // 'blocked' | 'full'
    let state = null;
    let writeTimer = null;

    /* A monotonic count of mutations, so the backup layer can answer "is what is
     * on disk still what is in memory?" without diffing two 100 KB strings on
     * every store event. Bumped where the state CHANGES, not where it is
     * flushed, because the flush is debounced and the question is about content.
     *
     * Never reset, including by `reset()` — a counter that can go backwards
     * would let a stale write look current. */
    let revisionCount = 0;

    /* L3, registered rather than imported — see the header. `null` on any
     * browser without File System Access, and on any page that loads this file
     * without `fiwo-backup.js`. */
    let backupProbe = null;

    /* Measured environment, filled in asynchronously at boot. Cached so that
     * storageHealth() can stay synchronous — the UI renders on every store
     * change and cannot await a permissions query each time. */
    const probe = { persisted: false, permission: 'unknown', checked: false };

    function empty() {
        return {
            schema: SCHEMA,
            stories: {}, cards: {}, workbook: {}, prefs: {}, time: {},
            meta: { lastExportAt: null, sinceExport: { stories: 0, cards: 0, workbook: 0 } },
            updatedAt: null,
        };
    }

    function emptyCounts() {
        return { stories: 0, cards: 0, workbook: 0 };
    }

    /* Stored data is untrusted input for the same reason the app's is: it can be
     * written by an older version of this script, hand-edited, or restored from
     * a stale export. Repair it rather than letting one bad key break the page. */
    function repair(raw) {
        const base = empty();
        if (!raw || typeof raw !== 'object') return base;

        for (const [title, entry] of Object.entries(raw.stories || {})) {
            if (!entry || typeof entry !== 'object') continue;
            const line = Number(entry.line);
            base.stories[title] = {
                read: entry.read === true,
                line: Number.isFinite(line) && line >= 0 ? Math.floor(line) : 0,
                at: typeof entry.at === 'string' ? entry.at : null,
            };
        }
        if (raw.cards && typeof raw.cards === 'object') base.cards = raw.cards;
        if (raw.workbook && typeof raw.workbook === 'object') base.workbook = raw.workbook;
        if (raw.prefs && typeof raw.prefs === 'object') base.prefs = raw.prefs;
        if (raw.time && typeof raw.time === 'object') base.time = raw.time;

        if (raw.meta && typeof raw.meta === 'object') {
            const since = raw.meta.sinceExport;
            base.meta = {
                lastExportAt: typeof raw.meta.lastExportAt === 'string' ? raw.meta.lastExportAt : null,
                sinceExport: { ...emptyCounts(), ...(since && typeof since === 'object' ? since : {}) },
            };
        }

        base.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;

        /* Anything a newer version wrote. Copied last so it can never overwrite
         * a validated key — the point is to avoid throwing data away, not to let
         * unvalidated input win. */
        for (const [k, v] of Object.entries(raw)) {
            if (!KNOWN.has(k)) base[k] = v;
        }
        return base;
    }

    function canWrite() {
        try {
            const probeKey = '__fiwo_probe__';
            localStorage.setItem(probeKey, '1');
            localStorage.removeItem(probeKey);
            return true;
        } catch {
            // Private mode, disabled storage, or a full quota.
            return false;
        }
    }

    function load() {
        if (!canWrite()) { mode = 'memory'; memoryReason = 'blocked'; return empty(); }
        mode = 'best-effort';
        try {
            return repair(JSON.parse(localStorage.getItem(KEY)));
        } catch {
            return empty();
        }
    }

    function flush() {
        writeTimer = null;
        if (mode === 'memory') return;
        state.updatedAt = new Date().toISOString();
        state.schema = SCHEMA;
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch {
            // Quota exceeded mid-session. Downgrade honestly rather than
            // throwing on every subsequent keystroke. Everything written before
            // this point is still on disk — only new writes are being lost.
            mode = 'memory';
            memoryReason = 'full';
            changed();
        }
    }

    /* Writes are debounced because reading position updates on scroll, but a
     * pagehide must not lose the last few hundred ms of them. */
    function save() {
        revisionCount++;
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(flush, WRITE_DELAY);
    }

    function saveNow() {
        revisionCount++;
        if (writeTimer) clearTimeout(writeTimer);
        flush();
    }

    function changed() {
        document.dispatchEvent(new CustomEvent('fiwo-store-changed'));
    }

    /** Count one unit of work that a backup would protect. */
    function countChange(kind) {
        state.meta.sinceExport[kind] = (state.meta.sinceExport[kind] || 0) + 1;
    }

    state = load();

    /* ── L1: ask, but not here ───────────────────────────────────────────────
     *
     * This used to call `persist()` on page load, fire-and-forget. That is the
     * wrong moment: Firefox is the only browser that shows a prompt, and a
     * permission popup during the first paint of a site you have never used is
     * one people dismiss reflexively. `requestPersistence()` is now called from
     * a real gesture instead.
     *
     * What happens HERE is read-only and never prompts: find out what the
     * browser has already decided, so the UI can tell the truth about it. */
    if (mode !== 'memory' && navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted()
            .then(already => {
                probe.persisted = already === true;
                if (already) mode = 'persistent';
            })
            .catch(() => { /* leave mode as best-effort */ })
            .then(() => navigator.permissions?.query({ name: 'persistent-storage' }))
            .then(status => { if (status) probe.permission = status.state; })
            .catch(() => { /* Firefox does not expose this permission name */ })
            .then(() => { probe.checked = true; changed(); });
    } else {
        probe.checked = true;
    }

    /* Flush anything the debounce is still holding. Deliberately not `saveNow`:
     * that counts as a mutation, and unloading the page is not one — a phantom
     * bump here would make the backup file look stale on the next visit and
     * provoke a pointless rewrite. */
    window.addEventListener('pagehide', () => {
        if (writeTimer) { clearTimeout(writeTimer); flush(); }
    });

    // ── Environment ─────────────────────────────────────────────────────────

    /* Keyed off capability and measured state wherever possible. UA sniffing is
     * used for exactly one thing — telling iOS apart — because that is the one
     * case whose instruction is platform-specific and whose consequence
     * (deletion after 7 days) is certain rather than probabilistic. */
    function environment() {
        const ua = navigator.userAgent || '';
        const ios = /iPad|iPhone|iPod/.test(ua)
            // iPadOS 13+ reports itself as a Mac; the touch points give it away.
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return {
            ios,
            firefox: ua.includes('Firefox'),
            installed: window.matchMedia?.('(display-mode: standalone)').matches === true
                || window.navigator.standalone === true,
            canPickFile: typeof window.showSaveFilePicker === 'function',
            canInstallPrompt: 'onbeforeinstallprompt' in window,
        };
    }

    // ── Public API ──────────────────────────────────────────────────────────

    function storageMode() { return mode; }

    function revision() { return revisionCount; }

    /** L3 registers here. `probe` is synchronous and must stay that way. */
    function attachBackup(probe) {
        backupProbe = typeof probe === 'function' ? probe : null;
    }

    const NO_FILE = { supported: false, linked: false, permission: 'unknown', name: null, error: null };

    function fileStatus() {
        if (!backupProbe) return NO_FILE;
        try {
            return { ...NO_FILE, ...(backupProbe() || {}) };
        } catch {
            return NO_FILE;
        }
    }

    function storageDescription() {
        switch (mode) {
            case 'persistent':
                return 'Saved on this device, and marked as persistent — your browser has agreed not to clear it to reclaim space.';
            case 'best-effort':
                return 'Saved on this device. Your browser may still clear it if storage runs low, or if you go a long time without visiting — export a copy to be safe.';
            case 'memory':
                return 'Not being saved. This browser is blocking storage (private browsing will do this), so progress will vanish when you close the tab.';
            default:
                return 'Not initialised.';
        }
    }

    /** How much work is sitting here that a backup would protect. */
    function atRisk() {
        const s = state.meta.sinceExport;
        return (s.stories || 0) + (s.cards || 0) + (s.workbook || 0);
    }

    function daysSinceExport() {
        const at = state.meta.lastExportAt;
        if (!at) return null;
        const ms = Date.now() - new Date(at).getTime();
        return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
    }

    /* ── L4: nag, proportionally ─────────────────────────────────────────────
     *
     * Reading positions and review histories are not worth the same. Losing
     * where you were in a story costs you a scroll; losing four months of FSRS
     * scheduling ends the deck, because it cannot be reconstructed from
     * anything. So the thresholds differ by an order of magnitude, and the
     * message names what is actually at stake rather than saying "back up".
     *
     * A live L3 file silences this without a special case: every successful
     * write to it calls `noteExported()`, because writing the same JSON to the
     * user's disk IS the backup this nag is asking for. If those writes start
     * failing the counter climbs again on its own, which is exactly right.
     */
    function backupStatus() {
        const s = state.meta.sinceExport;
        const precious = (s.cards || 0) + (s.workbook || 0);
        const days = daysSinceExport();
        const never = state.meta.lastExportAt === null;

        if (precious >= 25 || (precious > 0 && days !== null && days >= 14)) {
            return {
                due: true, level: 'high',
                text: `${precious} reviews here have never been backed up. Scheduling is months of work and cannot be rebuilt — export a copy.`,
            };
        }
        if ((s.stories || 0) >= 10 || (atRisk() > 0 && days !== null && days >= 45)) {
            return {
                due: true, level: 'low',
                text: 'You have read a fair bit since your last export. A copy takes a second and your browser cannot clear it.',
            };
        }
        if (never && atRisk() >= 3) {
            return {
                due: true, level: 'low',
                text: 'Nothing here has ever been exported. The downloaded file is the only copy your browser cannot clear.',
            };
        }
        return { due: false, level: 'none', text: '' };
    }

    /* ── L2 + L5: the honest readout ─────────────────────────────────────────
     *
     * One object with everything the UI needs, and one concrete instruction
     * rather than a generic warning. Generic warnings get ignored; "Tap Share →
     * Add to Home Screen" does not.
     *
     * Synchronous on purpose — every progress-aware view re-renders on
     * `fiwo-store-changed`, and awaiting a permissions query per render would
     * make the panel flicker. The async facts are probed once at boot.
     */
    function storageHealth() {
        const env = environment();
        const backup = backupStatus();
        const file = fileStatus();
        let risk = 'low';
        let headline = storageDescription();
        let advice = null;

        if (mode === 'memory' && memoryReason === 'full') {
            risk = 'high';
            headline = 'This device is out of storage, so nothing new is being saved.';
            advice = {
                text: 'What you had saved before now is still here — free up some space, then export a copy before doing anything else.',
                action: null,
            };
        } else if (mode === 'memory') {
            risk = 'high';
            headline = 'Nothing is being saved.';
            advice = { text: 'This looks like a private window. Progress will vanish when you close the tab.', action: null };
        } else if (env.ios && !env.installed) {
            // The one case that is not a probability. iOS deletes script-written
            // storage after 7 days without interaction; home-screen web apps are
            // exempt and get their own counter.
            risk = 'high';
            headline = 'iOS will delete this after 7 days.';
            advice = {
                text: 'Tap Share → Add to Home Screen. Until you do, iOS deletes saved progress after 7 days without opening this page.',
                action: null,
            };
        } else if (mode === 'persistent') {
            risk = 'none';
            headline = 'Saved, and marked persistent — only you can clear it.';
            advice = env.canPickFile
                ? { text: 'Even so, a backup file survives clearing browser data. Persistent storage does not.', action: 'file' }
                : null;
        } else if (env.firefox) {
            /* Checked BEFORE the denied branch on purpose. Firefox is the only
             * browser that actually asks the user, so it is the only one where
             * offering the button is worth anything — and today it does not
             * implement the `persistent-storage` permission name at all, so the
             * query throws and `permission` stays 'unknown'. If a future release
             * starts reporting 'denied', ordering it after that branch would
             * silently swap the one useful control for Chrome's advice. */
            risk = 'medium';
            headline = 'Saved, but your browser may still clear it.';
            advice = { text: 'Bookmark this page, then press Keep my progress and allow it.', action: 'persist' };
        } else if (probe.permission === 'denied') {
            // Chrome's normal outcome: silently refused, no prompt, no recourse.
            risk = 'medium';
            headline = 'Saved, but your browser refused to mark it persistent.';
            advice = env.canPickFile
                ? { text: 'Install this site, and set up a backup file — it saves straight to your disk and survives clearing browser data.', action: 'file' }
                : { text: 'Install this site from your browser menu, and export a copy now and then.', action: 'install' };
        } else {
            risk = 'medium';
            headline = 'Saved, but your browser may still clear it.';
            advice = { text: 'Press Keep my progress to ask this browser not to.', action: 'persist' };
        }

        /* ── L3 outranks all of it ───────────────────────────────────────────
         *
         * Everything above is a statement about BROWSER storage, and every one
         * of those states is defeated by "Clear browsing data". A file on the
         * disk is not, so once one is live it is the honest headline no matter
         * what the origin's quota is doing — including in a private window,
         * where localStorage saves nothing and the file saves everything.
         *
         * Written as an override rather than another branch above because the
         * branches answer a different question ("will this browser keep it?")
         * and the file does not change any of their answers. */
        if (file.linked) {
            if (file.error) {
                risk = 'high';
                headline = 'Your backup file could not be written.';
                advice = { text: `${file.error} Pick the file again, or export a copy the ordinary way.`, action: 'file' };
            } else if (file.permission !== 'granted') {
                risk = 'medium';
                headline = 'Your backup file needs permission again.';
                advice = {
                    text: 'Browsers drop file access between visits unless you allow it every time. '
                        + 'Nothing is being written to it until you reconnect.',
                    action: 'file-reconnect',
                };
            } else {
                risk = mode === 'memory' ? 'low' : 'none';
                headline = mode === 'memory'
                    ? 'This browser is saving nothing — but your backup file is.'
                    : 'Backed up to a file on this device.';
                advice = mode === 'memory'
                    ? { text: 'Everything is going straight to the file you chose. Keep this tab open until you are done.', action: null }
                    : null;
            }
        }

        if (backup.level === 'high' && risk !== 'high') risk = 'high';

        return {
            mode, risk, headline, advice, backup, file,
            persisted: probe.persisted,
            permission: probe.permission,
            checked: probe.checked,
            env,
            atRisk: atRisk(),
            lastExportAt: state.meta.lastExportAt,
            daysSinceExport: daysSinceExport(),
        };
    }

    /** L1. Call this from a click, never from page load. */
    async function requestPersistence() {
        if (mode === 'memory' || !navigator.storage?.persist) return false;
        try {
            const granted = await navigator.storage.persist();
            probe.persisted = granted === true;
            if (granted) mode = 'persistent';
            try {
                const status = await navigator.permissions?.query({ name: 'persistent-storage' });
                if (status) probe.permission = status.state;
            } catch { /* Firefox does not expose this permission name */ }
            changed();
            return granted === true;
        } catch {
            return false;
        }
    }

    function getStory(title) {
        return state.stories[title] || { read: false, line: 0, at: null };
    }

    function setStoryLine(title, line) {
        const prev = getStory(title);
        if (prev.line === line) return;
        state.stories[title] = { ...prev, line, at: new Date().toISOString() };
        save();
        changed();
    }

    function setStoryRead(title, read) {
        const prev = getStory(title);
        state.stories[title] = { ...prev, read, at: new Date().toISOString() };
        // Finishing a story is the event worth protecting; moving the bookmark
        // fires on scroll and would swamp the counter within one sitting.
        if (read && !prev.read) countChange('stories');
        saveNow();
        changed();
    }

    function clearStory(title) {
        delete state.stories[title];
        saveNow();
        changed();
    }

    function stories() { return state.stories; }

    /* ── The deck ────────────────────────────────────────────────────────────
     *
     * `cards` is stored in the Android app's exact shape — id → { fsrs,
     * orphaned, firstSeen, reviews } — so a progress file moves between the
     * phone and this browser without a migration. Card ids are
     * `sha1(type:normalizedFiwoText).slice(0,12)` on both sides.
     *
     * Handed out by reference rather than cloned: the deck's own modules treat
     * progress as immutable and hand back a new object per grade, so a defensive
     * copy on every read would be 8,268 entries of pointless work per render.
     */
    function cards() { return state.cards; }

    /* Engaged study time, `YYYY-MM-DD` → { cards, cloze, stories } in ms.
     *
     * Part of the app's progress shape, so it lives here rather than in `prefs`
     * — an exported file should be the same object on both devices. Written
     * only by the vendored `timer.js`, which counts time while the page is in
     * front of you and you are still doing something. */
    function time() { return state.time; }

    function setTime(next) {
        if (!next || typeof next !== 'object') return;
        state.time = next;
        save();   // debounced: the timer flushes on a 60s tick, not per event
    }

    /**
     * Replace the whole card map.
     *
     * `newReviews` is how many reviews this write ADDS, which is what the backup
     * nag counts. Passed in rather than diffed here because the caller already
     * knows: a write can also come from an import or an orphan reconciliation,
     * and neither of those is work the reader would lose by not backing up.
     */
    function setCards(next, newReviews = 0) {
        if (!next || typeof next !== 'object') return;
        state.cards = next;
        for (let i = 0; i < newReviews; i++) countChange('cards');
        saveNow();
        changed();
    }

    /* ── The workbook ────────────────────────────────────────────────────────
     *
     *   workbook: { L4: { items: { 5: { answer, correct, tries, at } },
     *                     score, max, doneAt } }
     *
     * `answer` is what the reader actually typed, not just whether it was right
     * (roadmap D7). ~457 short strings is well under 100 KB, and coming back to
     * a lesson should show you your own attempt rather than a blank box.
     */
    function workbook() { return state.workbook; }

    function lesson(id) {
        return state.workbook[id] || { items: {}, score: 0, max: 0, doneAt: null };
    }

    /**
     * Record one answered item and the lesson totals it changes.
     *
     * Deliberately one call rather than a setter per field: score and mastery
     * are derived from the items, and letting a caller write a score that
     * disagrees with them is how a total ends up unexplainable.
     */
    function setWorkbookItem(id, n, record, totals) {
        const prev = lesson(id);
        const items = { ...prev.items, [n]: { ...record, at: new Date().toISOString() } };
        const wasScored = prev.items[n] !== undefined;
        state.workbook[id] = { ...prev, ...totals, items };
        // One count per item, not per attempt: retrying should not inflate the
        // estimate of how much unprotected work is sitting here.
        if (!wasScored) countChange('workbook');
        saveNow();
        changed();
    }

    function clearLesson(id) {
        delete state.workbook[id];
        saveNow();
        changed();
    }

    /* ── One streak, shared (roadmap D9) ─────────────────────────────────────
     *
     * A day you studied is a day you studied. The deck has its own streak in
     * the vendored `stats.js`, computed from card review dates — but that
     * module is the app's and cannot know about the workbook, and two competing
     * counters on one site teach the reader to distrust both.
     *
     * So the streak lives here, over the UNION of everything that counts as
     * work: a card graded, or a workbook item answered. Both surfaces read this
     * one rather than each counting its own half.
     */
    function activeDays() {
        const days = new Set();
        const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);
        for (const card of Object.values(state.cards || {})) {
            for (const r of card.reviews || []) { const d = day(r.at); if (d) days.add(d); }
        }
        for (const les of Object.values(state.workbook || {})) {
            for (const item of Object.values(les.items || {})) {
                const d = day(item.at); if (d) days.add(d);
            }
        }
        return days;
    }

    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    function streak() {
        const days = activeDays();
        if (!days.size) return { current: 0, longest: 0, today: false, days: 0 };

        const today = new Date();
        const todayKey = dayKey(today);
        /* Counting back from YESTERDAY when today is empty is the point: a
         * streak that resets at midnight punishes someone for not having
         * studied yet at 9am, which is the hour they are most likely to look. */
        let cursor = new Date(today);
        if (!days.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
        let current = 0;
        while (days.has(dayKey(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }

        const sorted = [...days].sort();
        let longest = 0, run = 0, prev = null;
        for (const d of sorted) {
            const asDate = new Date(`${d}T00:00:00`);
            run = (prev && (asDate - prev) === 86400000) ? run + 1 : 1;
            longest = Math.max(longest, run);
            prev = asDate;
        }
        return { current, longest, today: days.has(todayKey), days: days.size };
    }

    function getPref(key, fallback) {
        return Object.prototype.hasOwnProperty.call(state.prefs, key)
            ? state.prefs[key] : fallback;
    }

    function setPref(key, value) {
        if (state.prefs[key] === value) return;
        state.prefs[key] = value;
        save();
    }

    /** The whole store as a formatted JSON string, for download. */
    function exportJSON() {
        return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    }

    /** L4 bookkeeping. Called once the file has actually been handed over. */
    function noteExported() {
        state.meta.lastExportAt = new Date().toISOString();
        state.meta.sinceExport = emptyCounts();
        saveNow();
        changed();
    }

    /** Merge an exported file back in.
     *
     * Merge rather than replace, and per story keep whichever copy got further:
     * importing a backup should never move you backwards through a book you have
     * since finished on this device.
     *
     * `meta` is deliberately NOT merged. It records how long THIS device has
     * gone without a backup, and adopting another device's export date would
     * silence the nag on a machine that has never actually written a file.
     */
    function importJSON(text) {
        const incoming = repair(JSON.parse(text));
        let added = 0, advanced = 0;
        for (const [title, entry] of Object.entries(incoming.stories)) {
            const mine = state.stories[title];
            if (!mine) { state.stories[title] = entry; added++; continue; }
            const merged = {
                read: mine.read || entry.read,
                line: Math.max(mine.line, entry.line),
                at: (entry.at || '') > (mine.at || '') ? entry.at : mine.at,
            };
            if (merged.line !== mine.line || merged.read !== mine.read) advanced++;
            state.stories[title] = merged;
        }
        /* Cards merge card-by-card, keeping whichever side has MORE REVIEWS.
         *
         * This used to be `{...mine, ...incoming}`, incoming winning outright,
         * which is right for a restore into an empty browser and wrong for
         * every other case: importing last month's export, or linking a backup
         * file that a second device has since fallen behind on, would roll live
         * scheduling back to a stale state. Review history only ever grows, so
         * its length is a usable clock — the same reasoning as keeping the
         * further-along copy of a story above, and the same rule the app
         * applies in `importStudyProgress` ("importing twice must never roll
         * back newer reviews").
         *
         * Cheap: `cards` holds only cards actually studied, not all 8,268. */
        for (const [id, entry] of Object.entries(incoming.cards)) {
            const mine = state.cards[id];
            const mineLen = mine?.reviews?.length || 0;
            const theirLen = entry?.reviews?.length || 0;
            if (!mine || theirLen > mineLen) state.cards[id] = entry;
        }
        /* Workbook answers still merge incoming-wins. Its shape is reserved and
         * nothing writes it yet (Learn pages roadmap §2), so there is no
         * "further along" to compare; the rule gets decided with the scoring in
         * step 7, where a lesson's score is the obvious clock. */
        state.workbook = { ...state.workbook, ...incoming.workbook };
        state.prefs = { ...state.prefs, ...incoming.prefs };
        // Time is per-day. Taking the LARGER of the two is the honest merge:
        // adding them would double-count a day studied on both devices, and no
        // total here should claim more minutes than were actually spent.
        for (const [day, v] of Object.entries(incoming.time || {})) {
            const mine = state.time[day] || {};
            const merged = { ...mine };
            for (const k of Object.keys(v || {})) {
                merged[k] = Math.max(Number(mine[k]) || 0, Number(v[k]) || 0);
            }
            state.time[day] = merged;
        }
        for (const [k, v] of Object.entries(incoming)) {
            if (!KNOWN.has(k) && k !== 'exportedAt') state[k] = v;
        }
        saveNow();
        changed();
        return { added, advanced, total: Object.keys(incoming.stories).length };
    }

    function reset() {
        state = empty();
        if (mode !== 'memory') { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
        changed();
    }

    window.FiwoStore = {
        storageMode, storageDescription, storageHealth,
        requestPersistence, noteExported,
        revision, attachBackup,
        getStory, setStoryLine, setStoryRead, clearStory, stories,
        cards, setCards, time, setTime,
        workbook, lesson, setWorkbookItem, clearLesson, streak,
        getPref, setPref,
        exportJSON, importJSON, reset,
    };
})();
