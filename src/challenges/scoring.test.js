import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareToReference, isBetterResult, resultHeadline, scoreRows, statusText, verdictLabel,
} from './scoring.js';

const result = (instructions, memory_accesses) => ({ instructions, memory_accesses });

test('fewer instructions is better; memory accesses break a tie', () => {
    assert.ok(isBetterResult(result(900, 90), null));
    assert.ok(isBetterResult(result(10, 500), result(11, 0)));
    assert.ok(!isBetterResult(result(11, 0), result(10, 500)));
    assert.ok(isBetterResult(result(100, 9), result(100, 10)));
    assert.ok(!isBetterResult(result(100, 10), result(100, 10)));
    assert.ok(!isBetterResult(null, result(1, 1)));
    assert.ok(!isBetterResult({ instructions: 'many' }, null));
});

test('comparison with the reference', () => {
    assert.deepEqual(compareToReference(27, 27), { difference: 0, text: 'Same as the reference', better: true });
    assert.deepEqual(compareToReference(20, 27), { difference: -7, text: '7 fewer than the reference', better: true });
    assert.deepEqual(compareToReference(40, 32), { difference: 8, text: '8 more than the reference (1.25×)', better: false });
    assert.equal(compareToReference(64, 32).text, '32 more than the reference (2×)');
    assert.equal(compareToReference(1500, 1000).text, '500 more than the reference (1.5×)');
    // No ratio against a reference of zero.
    assert.equal(compareToReference(2, 0).text, '2 more than the reference');
    assert.equal(compareToReference(12345, 10).text.startsWith('12,335 more'), true);
});

test('score rows for an accepted submission', () => {
    const rows = scoreRows({
        instructions: 30, memory_accesses: 4,
        reference: { instructions: 27, memory_accesses: 4 },
    });
    assert.deepEqual(rows.map((row) => [row.key, row.yours, row.reference, row.comparison.better]), [
        ['instructions', 30, 27, false],
        ['memory_accesses', 4, 4, true],
    ]);
    assert.deepEqual(scoreRows(null), []);
    assert.deepEqual(scoreRows({ instructions: 1 }), []);
});

test('result headlines', () => {
    assert.deepEqual(
        resultHeadline({ mode: 'submit', verdict: 'accepted', verdict_label: 'Accepted', passed: 9, total: 9 }),
        { verdict: 'Accepted', accepted: true, counts: '9 of 9 tests passed' });
    assert.deepEqual(
        resultHeadline({ mode: 'run', verdict: 'wrong_answer', passed: 1, total: 3 }),
        { verdict: 'Wrong answer', accepted: false, counts: '1 of 3 visible tests passed' });
    assert.equal(verdictLabel('instruction_limit'), 'Exceeded instruction limit');
    assert.equal(verdictLabel('nonsense'), 'Not graded');
});

test('list status text', () => {
    assert.equal(statusText({ solved: true, attempted: true, best: result(1, 1) }), 'Solved');
    assert.equal(statusText({ solved: false, attempted: true, best: null }), 'Attempted');
    assert.equal(statusText({ solved: false, attempted: false, best: null }), 'Not started');
    assert.equal(statusText(null), 'Not started');
});
