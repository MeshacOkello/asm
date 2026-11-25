import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareToReference, isBetterResult, medalLabel, medalRank, medalThresholds, normalizeMedal,
    resultHeadline, scoreRows, statusText, verdictLabel,
} from './scoring.js';

const result = (medal, instructions, memory_accesses) => ({ medal, instructions, memory_accesses });

test('medal labels and ranks, with unknown medals ignored', () => {
    assert.equal(medalLabel('gold'), 'Gold');
    assert.equal(medalLabel('bronze'), 'Bronze');
    assert.equal(medalLabel('platinum'), null);
    assert.equal(medalLabel('toString'), null);
    assert.ok(medalRank('gold') > medalRank('silver'));
    assert.ok(medalRank('silver') > medalRank('bronze'));
    assert.equal(medalRank(undefined), 0);
    assert.equal(normalizeMedal('silver'), 'silver');
    assert.equal(normalizeMedal(null), null);
});

test('a higher medal is better, then lower combined totals', () => {
    assert.ok(isBetterResult(result('bronze', 900, 90), null));
    assert.ok(isBetterResult(result('gold', 900, 90), result('silver', 10, 1)));
    assert.ok(!isBetterResult(result('silver', 10, 1), result('gold', 900, 90)));
    assert.ok(isBetterResult(result('silver', 100, 9), result('silver', 100, 10)));
    assert.ok(!isBetterResult(result('silver', 100, 10), result('silver', 100, 10)));
    assert.ok(!isBetterResult(result('wooden', 1, 1), null));
    assert.ok(!isBetterResult(null, result('gold', 1, 1)));
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
        instructions: 30, memory_accesses: 4, medal: 'silver',
        reference: { instructions: 27, memory_accesses: 4 },
    });
    assert.deepEqual(rows.map((row) => [row.key, row.yours, row.reference, row.comparison.better]), [
        ['instructions', 30, 27, false],
        ['memory_accesses', 4, 4, true],
    ]);
    assert.deepEqual(scoreRows(null), []);
    assert.deepEqual(scoreRows({ instructions: 1 }), []);
});

test('medal thresholds match the backend rule', () => {
    assert.deepEqual(medalThresholds({ instructions: 27, memory_accesses: 0 }), {
        gold: { instructions: 27, memory_accesses: 0 },
        silver: { instructions: 40, memory_accesses: 0 },
    });
    assert.deepEqual(medalThresholds({ instructions: 100, memory_accesses: 21 }).silver,
        { instructions: 150, memory_accesses: 31 });
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
    assert.equal(statusText({ solved: true, attempted: true, best: result('gold', 1, 1) }), 'Solved · Gold');
    assert.equal(statusText({ solved: false, attempted: true, best: null }), 'Attempted');
    assert.equal(statusText({ solved: false, attempted: false, best: null }), 'Not started');
    assert.equal(statusText(null), 'Not started');
});
