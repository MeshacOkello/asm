// Challenge progress, kept in this browser only: there are no accounts yet.
// Per problem: the draft code, whether it was attempted or solved, and the
// best accepted result. Storage can be missing, full, or turned off, so every
// read and write is guarded and the page works without it.
import { isBetterResult, normalizeMedal } from "./scoring.js";

const PREFIX = "assembly-visualizer-challenge";

function store(storage) {
    if (storage !== undefined) return storage;
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;   // reading localStorage itself throws when it is blocked
    }
}

function key(slug, part) {
    return `${PREFIX}:${slug}:${part}`;
}

function read(storage, name) {
    try {
        const raw = store(storage)?.getItem(name);
        return raw == null ? null : JSON.parse(raw);
    } catch {
        return null;   // blocked storage, or a value that is not ours
    }
}

function write(storage, name, value) {
    try {
        const target = store(storage);
        if (!target) return false;
        target.setItem(name, JSON.stringify(value));
        return true;
    } catch {
        return false;  // quota exceeded or storage turned off
    }
}

function remove(storage, name) {
    try {
        store(storage)?.removeItem(name);
    } catch {
        // Nothing to undo: the draft simply stays.
    }
}

// A draft is stored with when it was written, so a signed-in workspace can
// tell whether this browser's copy or the account's is newer. Drafts saved
// before that are plain strings, read as written at time 0.
export function loadDraftRecord(slug, storage) {
    const draft = read(storage, key(slug, "draft"));
    if (typeof draft === "string") return { code: draft, updatedAt: 0 };
    if (draft && typeof draft.code === "string" && Number.isFinite(draft.updatedAt)) {
        return { code: draft.code, updatedAt: draft.updatedAt };
    }
    return null;
}

export function loadDraft(slug, storage) {
    return loadDraftRecord(slug, storage)?.code ?? null;
}

export function saveDraft(slug, code, storage, updatedAt = Date.now()) {
    return write(storage, key(slug, "draft"), { code, updatedAt });
}

export function clearDraft(slug, storage) {
    remove(storage, key(slug, "draft"));
}

const EMPTY = Object.freeze({ attempted: false, solved: false, best: null });

function count(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

// Whatever is stored, as a well-formed progress record. A record edited by
// hand or left by an older version never breaks the list.
function normalizeProgress(value) {
    if (!value || typeof value !== "object") return EMPTY;
    let best = null;
    const medal = normalizeMedal(value.best?.medal);
    const instructions = count(value.best?.instructions);
    const memoryAccesses = count(value.best?.memory_accesses);
    if (medal && instructions !== null && memoryAccesses !== null) {
        best = { medal, instructions, memory_accesses: memoryAccesses };
    }
    const solved = value.solved === true && best !== null;
    return { attempted: value.attempted === true || solved, solved, best };
}

export function loadProgress(slug, storage) {
    return normalizeProgress(read(storage, key(slug, "progress")));
}

// "solved", "attempted", or null for a problem never run.
export function progressStatus(progress) {
    if (progress?.solved) return "solved";
    if (progress?.attempted) return "attempted";
    return null;
}

export function recordAttempt(slug, storage) {
    const progress = loadProgress(slug, storage);
    if (progress.attempted) return progress;
    const next = { ...progress, attempted: true };
    write(storage, key(slug, "progress"), next);
    return next;
}

// After a submission: an accepted one solves the problem, and replaces the
// best result when its medal is higher, or the same medal with lower totals.
export function recordSubmission(slug, response, storage) {
    const progress = loadProgress(slug, storage);
    let next = { ...progress, attempted: true };
    const score = response?.verdict === "accepted" ? response.score : null;
    if (score) {
        const result = {
            medal: normalizeMedal(score.medal),
            instructions: score.instructions,
            memory_accesses: score.memory_accesses,
        };
        next = {
            attempted: true,
            solved: true,
            best: isBetterResult(result, progress.best) ? result : progress.best,
        };
    }
    write(storage, key(slug, "progress"), next);
    return normalizeProgress(next);
}

// Everything this browser holds for the challenges, for the one-time import
// into an account: { drafts: { slug: { code, updated_at } }, progress: { slug: … } }.
export function collectLocalData(storage) {
    const drafts = {};
    const progress = {};
    try {
        const target = store(storage);
        const keys = [];
        for (let index = 0; index < (target?.length ?? 0); index++) keys.push(target.key(index));
        for (const name of keys) {
            const match = new RegExp(`^${PREFIX}:([a-z0-9-]+):(draft|progress)$`).exec(name ?? "");
            if (!match) continue;
            const [, slug, part] = match;
            if (part === "draft") {
                const draft = loadDraftRecord(slug, storage);
                if (draft?.code.trim()) drafts[slug] = { code: draft.code, updated_at: draft.updatedAt };
            } else {
                const entry = loadProgress(slug, storage);
                if (entry.attempted || entry.solved) progress[slug] = entry;
            }
        }
    } catch {
        // Unreadable storage simply has nothing to import.
    }
    return { drafts, progress };
}

export function hasLocalData(data) {
    return Object.keys(data.drafts).length > 0 || Object.keys(data.progress).length > 0;
}
