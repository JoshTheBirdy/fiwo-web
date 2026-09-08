/* fiwo-backup.js — Layer 3: your progress, in a real file, on your own disk.
 *
 * ── WHY THIS IS THE ONLY LAYER THAT ACTUALLY WORKS ──────────────────────────
 *
 * `fiwo-store.js` explains the honest frame: no browser API makes data
 * permanent, and "Clear browsing data" defeats every one of them by design.
 * Measured on the author's Chromium on 2026-09-07, `navigator.storage.persist()`
 * was SILENTLY DENIED with a service worker registered and controlling — so on
 * the machine this project is built on, Layer 1 buys nothing at all.
 *
 * This does. `showSaveFilePicker()` returns a handle to a file the user chose,
 * outside the origin sandbox. Writing to it survives clearing browser data,
 * survives eviction under storage pressure, survives uninstalling the browser,
 * and can be copied to another machine or opened in a text editor. It is the
 * same idea as the Android app storing `Documents/Fiwo/progress.json` in PUBLIC
 * storage rather than in its private data directory, and for the same reason:
 * review history is months of work that cannot be reconstructed from anything.
 *
 * Chromium desktop only — Firefox and Safari do not implement the picker. So it
 * is a progressive enhancement that happens to be strongest exactly where the
 * weakest browser guarantee was measured.
 *
 * ── THE HANDLE LIVES IN INDEXEDDB, AND THAT IS NOT A CONTRADICTION ──────────
 *
 * The app's rule is "progress lives in a public file, never in IndexedDB". That
 * still holds. What is stored here is the HANDLE — a pointer, not the data.
 * IndexedDB is the only place a `FileSystemFileHandle` can be kept, because it
 * is the only persistence that structured-clones. If the browser wipes it, the
 * pointer is lost and the FILE IS NOT: the user re-picks it and everything is
 * still there. That is the right failure mode, and it is the whole design.
 *
 * ── HOW A WRITE CANNOT EAT YOUR BACKUP ──────────────────────────────────────
 *
 * Three separate guards, because the failure being defended against is "the
 * backup file ends up emptier than the thing it was backing up":
 *
 *   1. LINKING READS FIRST. Pointing at an existing file imports it before
 *      writing a byte. Choosing your own backup file is therefore RECOVERY, not
 *      destruction — which matters because the save dialog's "replace?" prompt
 *      is the scariest possible framing of the safest possible action.
 *   2. RECONNECTING READS FIRST, on every visit. If this browser's localStorage
 *      was cleared but the handle survived, the file's contents come back
 *      before anything overwrites them.
 *   3. THE MERGE NEVER GOES BACKWARDS. `FiwoStore.importJSON` keeps whichever
 *      copy of a story got further and whichever card has more reviews, so a
 *      read-then-write round trip cannot lose work no matter which side is
 *      stale.
 *
 * Chromium's `createWritable()` writes to a swap file and renames it into place
 * on `close()`, so a tab that dies mid-write leaves the previous file intact
 * rather than a truncated one. That is the fourth guard, and it is not ours.
 */
(function () {
    'use strict';

    const DB_NAME = 'fiwo-backup';
    const DB_STORE = 'handles';
    const DB_KEY = 'progress';

    const FILENAME = 'fiwo-progress.json';

    /* A burst of grades should be one write, not eight. The timer restarts on
     * every change, so continuous activity — scrolling a story, grading a run of
     * cards — writes once when it pauses rather than once per event. */
    const WRITE_DELAY = 2000;
    /* And a floor between writes, so a long scroll with rhythmic pauses cannot
     * turn into a file write every two seconds all afternoon. */
    const MIN_GAP = 15000;

    let handle = null;
    let permission = 'unknown';   // 'granted' | 'prompt' | 'denied' | 'unknown'
    let lastError = null;
    let lastWriteAt = 0;
    let writtenRevision = -1;
    let writing = false;
    let queued = false;
    let timer = null;

    const supported = typeof window.showSaveFilePicker === 'function';

    /** Live means: we have a handle, we are allowed to write, nothing is broken. */
    function live() {
        return Boolean(handle) && permission === 'granted' && !lastError;
    }

    function announce() {
        document.dispatchEvent(new CustomEvent('fiwo-backup-changed'));
    }

    // ── The handle store ────────────────────────────────────────────────────

    function withStore(mode, fn) {
        return new Promise((resolve, reject) => {
            let req;
            try {
                req = indexedDB.open(DB_NAME, 1);
            } catch (err) {
                // Private browsing in some builds refuses to open a database at
                // all. Not fatal: it means the link cannot be REMEMBERED, and
                // linking again in this session still works.
                reject(err);
                return;
            }
            req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(DB_STORE, mode);
                const request = fn(tx.objectStore(DB_STORE));
                tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
    }

    const readHandle = () => withStore('readonly', s => s.get(DB_KEY));
    const writeHandle = (h) => withStore('readwrite', s => s.put(h, DB_KEY));
    const dropHandle = () => withStore('readwrite', s => s.delete(DB_KEY));

    // ── Permission ──────────────────────────────────────────────────────────

    /* `queryPermission` never prompts, so it is safe at load. `requestPermission`
     * does prompt and therefore MUST come from a click — which is why
     * `reconnect()` exists as its own entry point rather than being folded into
     * the boot path. */
    async function query() {
        if (!handle?.queryPermission) return 'granted';   // OPFS-style handles
        try {
            permission = await handle.queryPermission({ mode: 'readwrite' });
        } catch {
            permission = 'unknown';
        }
        return permission;
    }

    async function request() {
        if (!handle?.requestPermission) return 'granted';
        try {
            permission = await handle.requestPermission({ mode: 'readwrite' });
        } catch {
            permission = 'denied';
        }
        return permission;
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /* Is this file OURS?
     *
     * It has to be asked before anything is imported, and long before anything
     * is written, because linking is destructive to whatever was in the file
     * before. `FiwoStore.repair()` will not answer it: repair's whole job is to
     * salvage a damaged file, so it accepts ANY object, fills in the missing
     * keys and carries unknown ones through for forward compatibility. That is
     * right for a Fiwo file written by a newer build and catastrophic here —
     * without this check, pointing the picker at any valid JSON file on the
     * disk absorbed its keys into the store and then overwrote it. Found by
     * doing exactly that to a file called tax-return.json.
     *
     * `schema` is the stamp both formats carry: this store writes it, and the
     * Android app's progress.json has `PROGRESS_SCHEMA` in the same field — so
     * one test accepts a file from either device, which is the point of them
     * sharing a format (Learn pages roadmap D4). */
    const CONTAINERS = ['stories', 'cards', 'cloze', 'workbook', 'time'];

    function looksLikeProgress(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        if (typeof obj.schema !== 'number') return false;
        return CONTAINERS.some(k => obj[k] && typeof obj[k] === 'object');
    }

    /**
     * Fold the file's contents into the store.
     *
     * Runs before the first write of every session — see guard 2 in the header.
     * An empty or brand-new file is the normal case and is not an error, since
     * that is exactly what the save dialog hands back for a new file.
     */
    async function absorb() {
        const file = await handle.getFile();
        const text = (await file.text()).trim();
        if (!text) return { merged: false, reason: 'empty' };

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`${handle.name} is not a Fiwo progress file, so nothing was written to it.`);
        }
        if (!looksLikeProgress(parsed)) {
            throw new Error(`${handle.name} is valid JSON but not Fiwo progress — it was left exactly as it was. `
                + 'Pick a new file, or the one an export made.');
        }
        return { merged: true, ...FiwoStore.importJSON(text) };
    }

    // ── Writing ─────────────────────────────────────────────────────────────

    function schedule() {
        if (!live()) return;
        if (timer) clearTimeout(timer);
        const wait = Math.max(WRITE_DELAY, MIN_GAP - (Date.now() - lastWriteAt));
        timer = setTimeout(() => { timer = null; flush(); }, wait);
    }

    /**
     * Write the store to the file, if it is not already there.
     *
     * The revision check is at FIRE time rather than schedule time on purpose:
     * a successful write calls `noteExported()`, which is itself a mutation and
     * schedules another write. Comparing revisions when the timer fires absorbs
     * that echo instead of ringing forever.
     */
    async function flush() {
        if (!live()) return false;
        if (writing) { queued = true; return false; }
        if (FiwoStore.revision() === writtenRevision) return true;

        writing = true;
        try {
            const text = FiwoStore.exportJSON();
            const stream = await handle.createWritable();
            await stream.write(text);
            await stream.close();

            lastWriteAt = Date.now();
            lastError = null;
            /* This IS the backup, so it resets the nag and stamps the date the
             * health block reads. Done after the write, never before: a warning
             * cleared for a write that did not happen is worse than the nag. */
            FiwoStore.noteExported();
            // After noteExported, because that call bumps the revision too.
            writtenRevision = FiwoStore.revision();
            announce();
            return true;
        } catch (err) {
            if (err && err.name === 'NotAllowedError') {
                // Permission lapsed mid-session. Recoverable with one click, so
                // it is a permission state and not an error.
                permission = 'prompt';
            } else if (err && err.name === 'NotFoundError') {
                lastError = 'The file has been moved or deleted.';
            } else {
                lastError = `Writing failed (${err && err.name ? err.name : 'unknown error'}).`;
            }
            announce();
            return false;
        } finally {
            writing = false;
            if (queued) { queued = false; schedule(); }
        }
    }

    // ── Linking ─────────────────────────────────────────────────────────────

    /* Shared tail of every way of acquiring a handle: read what is already
     * there, remember the handle, write. In that order — see the header. */
    async function adopt(next) {
        handle = next;
        lastError = null;
        const summary = await absorb();
        try {
            await writeHandle(next);
        } catch {
            /* The file works; only the memory of it does not. Worth saying,
             * because "it forgot my file" and "it never worked" need different
             * responses from the reader. */
            lastError = null;
            console.warn('[fiwo-backup] the file is linked, but this browser would not remember it for next time');
        }
        writtenRevision = -1;   // force the first write
        await flush();
        announce();
        return summary;
    }

    /** From a click. The save dialog — for a new file, or an existing one. */
    async function link() {
        if (!supported) return { ok: false, message: 'This browser cannot save to a file you choose.' };
        let picked;
        try {
            picked = await window.showSaveFilePicker({
                id: 'fiwo-progress',            // Chrome reopens in the same place next time
                suggestedName: FILENAME,
                types: [{ description: 'Fiwo progress', accept: { 'application/json': ['.json'] } }],
            });
        } catch {
            return { ok: false, message: null };   // the user cancelled; say nothing
        }
        permission = 'granted';   // a fresh pick is granted by definition
        try {
            const summary = await adopt(picked);
            return { ok: true, summary, message: describe(summary) };
        } catch (err) {
            handle = null;
            return { ok: false, message: String(err.message || err) };
        }
    }

    /** From a click. The open dialog — "I already have one of these". */
    async function linkExisting() {
        if (typeof window.showOpenFilePicker !== 'function') {
            return { ok: false, message: 'This browser cannot open a file you choose.' };
        }
        let picked;
        try {
            [picked] = await window.showOpenFilePicker({
                id: 'fiwo-progress',
                multiple: false,
                types: [{ description: 'Fiwo progress', accept: { 'application/json': ['.json'] } }],
            });
        } catch {
            return { ok: false, message: null };
        }
        handle = picked;
        /* An open-picker handle is read-only until asked. Requesting write here
         * is still inside the click that opened the dialog, which is what the
         * API requires. */
        await request();
        if (permission !== 'granted') {
            handle = null;
            return { ok: false, message: 'Without permission to write, that file can be read but not kept up to date.' };
        }
        try {
            const summary = await adopt(picked);
            return { ok: true, summary, message: describe(summary) };
        } catch (err) {
            handle = null;
            return { ok: false, message: String(err.message || err) };
        }
    }

    /** From a click. Revive a handle the browser remembered but locked. */
    async function reconnect() {
        if (!handle) return { ok: false, message: 'There is no backup file set up on this device.' };
        await request();
        if (permission !== 'granted') {
            announce();
            return { ok: false, message: 'Your browser did not give this page access to the file.' };
        }
        try {
            lastError = null;
            const summary = await absorb();
            writtenRevision = -1;
            await flush();
            announce();
            return { ok: true, summary, message: describe(summary) };
        } catch (err) {
            lastError = String(err.message || err);
            announce();
            return { ok: false, message: lastError };
        }
    }

    /** Forget the file. Never touches the file itself. */
    async function unlink() {
        handle = null;
        permission = 'unknown';
        lastError = null;
        if (timer) { clearTimeout(timer); timer = null; }
        try { await dropHandle(); } catch { /* nothing to forget */ }
        announce();
    }

    function describe(summary) {
        if (!summary || !summary.merged) return `Backing up to ${FILENAME}. Everything here is now written to it as you go.`;
        const bits = [];
        if (summary.added) bits.push(`${summary.added} ${summary.added === 1 ? 'story' : 'stories'} restored`);
        if (summary.advanced) bits.push(`${summary.advanced} moved forward`);
        return `Read that file first, then linked it${bits.length ? ` — ${bits.join(', ')}` : ''}. Nothing was moved backwards.`;
    }

    // ── Status, for the health block ────────────────────────────────────────

    function status() {
        return {
            supported,
            linked: Boolean(handle),
            permission,
            name: handle ? handle.name : null,
            error: lastError,
            lastWriteAt: lastWriteAt || null,
            live: live(),
        };
    }

    // ── Boot ────────────────────────────────────────────────────────────────

    FiwoStore.attachBackup(status);

    /* Anything that changes the store schedules a write. The store's own
     * `fiwo-store-changed` is the single signal, so a feature added later —
     * the workbook, say — is backed up without knowing this file exists. */
    document.addEventListener('fiwo-store-changed', schedule);

    /* Last chance. `close()` will not finish during unload, but the write has
     * already been queued with the browser by then and Chromium's swap-file
     * rename means a half-finished one cannot corrupt the previous contents. */
    window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); timer = null; flush(); } });

    (async function boot() {
        if (!supported) return;
        let stored;
        try {
            stored = await readHandle();
        } catch {
            return;   // no IndexedDB; the picker still works, it just won't stick
        }
        if (!stored) return;
        handle = stored;
        await query();
        if (permission === 'granted') {
            /* Guard 2. Read before write, every visit — this is the path that
             * brings a wiped localStorage back from the file without the reader
             * doing anything. */
            try {
                await absorb();
                writtenRevision = -1;
                await flush();
            } catch (err) {
                lastError = String(err.message || err);
            }
        }
        announce();
    })();

    window.FiwoBackup = {
        isSupported: () => supported,
        status, link, linkExisting, reconnect, unlink,
        flush,
    };
})();
