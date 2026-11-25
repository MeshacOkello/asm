import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clearDraft, collectLocalData, hasLocalData, loadDraft, loadDraftRecord, loadProgress, progressStatus,
    recordAttempt, recordSubmission, saveDraft,
} from './storage.js';

// A Storage stand-in with the same string-only interface.
function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get length() { return values.size; },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
}

// Storage that refuses everything, as in a private window or with storage off.
const blocked = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
};

const accepted = (medal, instructions, memory_accesses) => ({
    verdict: 'accepted',
    score: { medal, instructions, memory_accesses, reference: { instructions: 1, memory_accesses: 1 } },
});

test('drafts are kept per problem', () => {
    const storage = memoryStorage();
    assert.equal(loadDraft('sum-to-n', storage), null);
    assert.equal(saveDraft('sum-to-n', 'mov x0, 1', storage), true);
    saveDraft('array-max', 'ret', storage);
    assert.equal(loadDraft('sum-to-n', storage), 'mov x0, 1');
    assert.equal(loadDraft('array-max', storage), 'ret');
    clearDraft('sum-to-n', storage);
    assert.equal(loadDraft('sum-to-n', storage), null);
    assert.equal(loadDraft('array-max', storage), 'ret');
});

test('an empty draft is still a draft', () => {
    const storage = memoryStorage();
    saveDraft('p', '', storage);
    assert.equal(loadDraft('p', storage), '');
});

test('a new problem has no progress', () => {
    const progress = loadProgress('p', memoryStorage());
    assert.deepEqual(progress, { attempted: false, solved: false, best: null });
    assert.equal(progressStatus(progress), null);
});

test('a run or a failed submission marks the problem attempted', () => {
    const storage = memoryStorage();
    assert.equal(progressStatus(recordAttempt('p', storage)), 'attempted');
    assert.equal(progressStatus(loadProgress('p', storage)), 'attempted');
    const failed = recordSubmission('q', { verdict: 'wrong_answer', passed: 2, total: 9 }, storage);
    assert.deepEqual(failed, { attempted: true, solved: false, best: null });
});

test('an accepted submission solves the problem and keeps the best result', () => {
    const storage = memoryStorage();
    let progress = recordSubmission('p', accepted('bronze', 900, 90), storage);
    assert.equal(progressStatus(progress), 'solved');
    assert.deepEqual(progress.best, { medal: 'bronze', instructions: 900, memory_accesses: 90 });

    progress = recordSubmission('p', accepted('gold', 950, 95), storage);
    assert.equal(progress.best.medal, 'gold');
    // A worse result later does not replace it.
    progress = recordSubmission('p', accepted('silver', 10, 1), storage);
    assert.equal(progress.best.medal, 'gold');
    // Nor does a failed one unsolve it.
    progress = recordSubmission('p', { verdict: 'runtime_error' }, storage);
    assert.equal(progressStatus(progress), 'solved');
    assert.deepEqual(loadProgress('p', storage).best, { medal: 'gold', instructions: 950, memory_accesses: 95 });
    // The same medal with lower totals does.
    progress = recordSubmission('p', accepted('gold', 900, 95), storage);
    assert.equal(progress.best.instructions, 900);
});

test('stored values that are not ours are ignored', () => {
    const key = (slug, part) => `assembly-visualizer-challenge:${slug}:${part}`;
    const storage = memoryStorage({
        [key('a', 'draft')]: '{not json',
        [key('b', 'draft')]: '42',
        [key('c', 'progress')]: '"solved"',
        [key('d', 'progress')]: JSON.stringify({ solved: true, best: { medal: 'platinum', instructions: 1, memory_accesses: 1 } }),
        [key('e', 'progress')]: JSON.stringify({ solved: true, attempted: true, best: { medal: 'gold', instructions: -1, memory_accesses: 1 } }),
    });
    assert.equal(loadDraft('a', storage), null);
    assert.equal(loadDraft('b', storage), null);
    assert.equal(progressStatus(loadProgress('c', storage)), null);
    // "Solved" without a valid best result is not trusted.
    assert.deepEqual(loadProgress('d', storage), { attempted: false, solved: false, best: null });
    assert.deepEqual(loadProgress('e', storage), { attempted: true, solved: false, best: null });
});

test('blocked storage never throws', () => {
    assert.equal(loadDraft('p', blocked), null);
    assert.equal(saveDraft('p', 'x', blocked), false);
    assert.doesNotThrow(() => clearDraft('p', blocked));
    assert.deepEqual(loadProgress('p', blocked), { attempted: false, solved: false, best: null });
    assert.equal(progressStatus(recordAttempt('p', blocked)), 'attempted');
    assert.equal(progressStatus(recordSubmission('p', accepted('gold', 1, 1), blocked)), 'solved');
});

test('no storage at all is the same as empty storage', () => {
    assert.equal(loadDraft('p', null), null);
    assert.equal(saveDraft('p', 'x', null), false);
    assert.deepEqual(loadProgress('p', null), { attempted: false, solved: false, best: null });
});

test('the default storage is globalThis.localStorage, even when reading it throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
        const storage = memoryStorage();
        Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
        saveDraft('p', 'code');
        assert.equal(loadDraft('p'), 'code');
        Object.defineProperty(globalThis, 'localStorage', {
            get() { throw new Error('SecurityError'); }, configurable: true,
        });
        assert.equal(loadDraft('p'), null);
        assert.equal(saveDraft('p', 'code'), false);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
        else delete globalThis.localStorage;
    }
});

test('drafts remember when they were written, and old plain drafts still load', () => {
    const storage = memoryStorage({ 'assembly-visualizer-challenge:old:draft': JSON.stringify('legacy code') });
    assert.deepEqual(loadDraftRecord('old', storage), { code: 'legacy code', updatedAt: 0 });
    saveDraft('p', 'new code', storage, 1234);
    assert.deepEqual(loadDraftRecord('p', storage), { code: 'new code', updatedAt: 1234 });
    assert.equal(loadDraftRecord('missing', storage), null);
});

test('collecting this browser\'s data for the one-time import', () => {
    const storage = memoryStorage({ 'unrelated-key': 'x', 'assembly-visualizer-theme': 'dark' });
    assert.equal(hasLocalData(collectLocalData(storage)), false);
    saveDraft('sum-to-n', 'sumToN:\n        ret\n', storage, 99);
    saveDraft('blank', '   \n', storage, 5);
    recordSubmission('array-max', accepted('gold', 5, 2), storage);
    recordAttempt('string-length', storage);
    const data = collectLocalData(storage);
    assert.deepEqual(data.drafts, { 'sum-to-n': { code: 'sumToN:\n        ret\n', updated_at: 99 } });
    assert.deepEqual(Object.keys(data.progress).sort(), ['array-max', 'string-length']);
    assert.equal(data.progress['array-max'].best.medal, 'gold');
    assert.equal(hasLocalData(data), true);
    assert.deepEqual(collectLocalData(blocked), { drafts: {}, progress: {} });
});
