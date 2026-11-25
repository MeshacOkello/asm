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

export function loadDraft(slug, storage) {
    const draft = read(storage, key(slug, "draft"));
    return typeof draft === "string" ? draft : null;
}

export function saveDraft(slug, code, storage) {
    return write(storage, key(slug, "draft"), code);
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
