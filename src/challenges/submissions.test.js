import test from 'node:test';
import assert from 'node:assert/strict';
import { diffStats, lineDiff } from './diff.js';
import {
    attemptLabel, formatTimestamp, isJudging, metricsText, rankingRows, relativeTime, visualizerTest,
} from './submissions.js';
import { loginErrorFrom, loginUrl } from '../account.js';
import { routeFrom } from '../routes.js';

const kinds = (diff) => diff.map((line) => `${line.type[0]}:${line.text}`);

test('a line diff keeps shared lines and marks the changes', () => {
    const before = 'f:\n    mov x0, 1\n    ret\n';
    const after = 'f:\n    cmp x0, 1\n    mov x0, 1\n    ret\n';
    const diff = lineDiff(before, after);
    assert.deepEqual(kinds(diff), ['s:f:', 'a:    cmp x0, 1', 's:    mov x0, 1', 's:    ret']);
    assert.deepEqual(diff[1], { type: 'added', text: '    cmp x0, 1', before: null, after: 2 });
    assert.deepEqual(diffStats(diff), { added: 1, removed: 0 });
});

test('a replaced line is a removal and an addition', () => {
    const diff = lineDiff('a\nb\nc', 'a\nx\nc');
    assert.deepEqual(kinds(diff), ['s:a', 'r:b', 'a:x', 's:c']);
    assert.deepEqual(diffStats(diff), { added: 1, removed: 1 });
});

test('identical, empty and line-ending differences', () => {
    assert.deepEqual(diffStats(lineDiff('a\nb\n', 'a\nb')), { added: 0, removed: 0 });
    assert.deepEqual(diffStats(lineDiff('a\r\nb', 'a\nb')), { added: 0, removed: 0 });
    assert.deepEqual(kinds(lineDiff('', 'a')), ['a:a']);
    assert.deepEqual(kinds(lineDiff('a', '')), ['r:a']);
    assert.deepEqual(lineDiff('', ''), []);
});

test('line numbers on each side', () => {
    const diff = lineDiff('one\ntwo\nthree', 'one\nthree\nfour');
    assert.deepEqual(diff.map((line) => [line.before, line.after]), [[1, 1], [2, null], [3, 2], [null, 3]]);
});

test('a very large diff falls back to whole sides', () => {
    const big = Array.from({ length: 2100 }, (_, i) => `line ${i}`).join('\n');
    const diff = lineDiff(big, `${big}\nmore`);
    assert.equal(diffStats(diff).removed, 2100);
    assert.equal(diffStats(diff).added, 2101);
});

test('the test Open in visualizer starts from', () => {
    const results = [
        { name: 'Test 1', visible: true, passed: true },
        { name: 'Test 2', visible: true, passed: false },
        { name: 'Hidden test 1', visible: false, passed: false },
    ];
    assert.equal(visualizerTest(results).name, 'Test 2');
    assert.equal(visualizerTest([results[0], results[2]]).name, 'Test 1');
    assert.equal(visualizerTest([results[2]]), null);
    assert.equal(visualizerTest(undefined), null);
});

test('ranking rows say whom the attempt beats', () => {
    assert.equal(rankingRows(null), null);
    const rows = rankingRows({
        users: 12, compared: 11,
        instructions: { beats: 72, worse: 8 }, memory_accesses: { beats: 0, worse: 0 },
    });
    assert.deepEqual(rows.map((row) => [row.key, row.beats, row.text]), [
        ['instructions', 72, 'Beats 72% of students'],
        ['memory_accesses', 0, 'Beats 0% of students'],
    ]);
});

test('times and labels', () => {
    const now = Date.UTC(2026, 10, 24, 12);
    assert.equal(relativeTime(now - 10_000, now), 'just now');
    assert.equal(relativeTime(now - 5 * 60_000, now), '5 min ago');
    assert.equal(relativeTime(now - 3 * 3_600_000, now), '3 h ago');
    assert.equal(relativeTime(now - 26 * 3_600_000, now), '1 day ago');
    assert.equal(relativeTime(now - 3 * 86_400_000, now), '3 days ago');
    assert.match(relativeTime(now - 30 * 86_400_000, now, { timeZone: 'UTC' }), /Oct 25, 2026/);
    assert.equal(formatTimestamp(Date.UTC(2026, 0, 2, 15, 4), { timeZone: 'UTC' }), 'Jan 2, 2026, 3:04 PM');
    assert.equal(formatTimestamp(undefined), '');
    assert.equal(metricsText({ instructions: 1234, memory_accesses: 5 }), '1,234 instr · 5 mem');
    assert.equal(metricsText({ instructions: null }), '—');
    assert.equal(attemptLabel({ id: 7, verdict_label: 'Accepted', created_at: now }, now), '#7 · Accepted · just now');
    assert.ok(isJudging({ status: 'judging' }));
    assert.ok(!isJudging({ status: 'done' }));
});

test('sign-in links return to an app route', () => {
    assert.equal(loginUrl('#/problems/sum-to-n'), '/auth/login?next=%2F%23%2Fproblems%2Fsum-to-n');
    assert.equal(loginUrl('https://evil.example'), '/auth/login?next=%2F%23%2Fproblems');
    assert.equal(loginUrl(), '/auth/login?next=%2F%23%2Fproblems');
    assert.equal(loginErrorFrom('#/problems?login_error=Google%20sign-in%20was%20cancelled.'),
        'Google sign-in was cancelled.');
    assert.equal(loginErrorFrom('#/problems'), null);
});

test('routes', () => {
    assert.deepEqual(routeFrom('#/problems'), { page: 'challenges', section: null, slug: null });
    assert.deepEqual(routeFrom('#/problems?login_error=x'), { page: 'challenges', section: null, slug: null });
    assert.equal(routeFrom('#/problems/sum-to-n').tab, 'description');
    assert.deepEqual(routeFrom('#/problems/sum-to-n/submissions'),
        { page: 'challenge', section: null, slug: 'sum-to-n', tab: 'submissions' });
    assert.deepEqual(routeFrom('#/submissions/42'), { page: 'submission', section: null, slug: null, id: 42 });
    assert.deepEqual(routeFrom('#/problems/sum-to-n/submissions/7'),
        { page: 'challenge', section: null, slug: 'sum-to-n', tab: 'result', id: 7 });
    assert.equal(routeFrom('#/submissions/abc').page, 'visualizer');
    assert.equal(routeFrom('#/profile').page, 'profile');
    assert.equal(routeFrom('#/how-to').page, 'guide');
    assert.equal(routeFrom('').page, 'visualizer');
});

test('chart layout: shares, a y axis in 25% steps, and spaced x labels', async () => {
    const { chartLayout } = await import('./submissions.js');
    const layout = chartLayout({
        bars: [{ low: 10, high: 10, users: 3 }, { low: 11, high: 11, users: 0 }, { low: 12, high: 12, users: 1 }],
        yours: 1,
    });
    assert.deepEqual(layout.bars.map((bar) => bar.share), [75, 0, 25]);
    assert.equal(layout.yMax, 75);
    assert.deepEqual(layout.gridlines, [0, 25, 50, 75]);
    assert.deepEqual(layout.bars.map((bar) => Math.round(bar.height * 100) / 100), [100, 0, 33.33]);
    assert.deepEqual(layout.bars.map((bar) => bar.yours), [false, true, false]);
    assert.deepEqual(layout.ticks.map((tick) => tick.label), [10, 11, 12]);

    const wide = chartLayout({ bars: Array.from({ length: 24 }, (_, i) => ({ low: i * 10, high: i * 10 + 9, users: 1 })), yours: 0 });
    assert.equal(wide.yMax, 5);
    assert.deepEqual(wide.gridlines, [0, 5]);
    assert.ok(wide.ticks.length <= 6);
    assert.equal(wide.ticks[0].label, 0);

    const tail = chartLayout({ bars: [
        { low: 1, high: 1, users: 2 }, { low: 2, high: 2, users: 1 }, { low: 3, high: 90, users: 1, overflow: true },
    ], yours: 0 });
    assert.deepEqual(tail.ticks.at(-1), { index: 2, label: 3, overflow: true });

    const lonely = chartLayout({ bars: [{ low: 5, high: 5, users: 0 }], yours: 0, reference: 0 });
    assert.equal(lonely.empty, true);
    assert.equal(lonely.bars[0].height, 0);
    assert.equal(lonely.bars[0].reference, true);

    // LeetCode's memory chart: a 22% peak gets 10% steps up to 30%.
    const memory = chartLayout({ bars: [{ low: 0, high: 0, users: 22 }, { low: 1, high: 1, users: 78 }], yours: 0 });
    assert.equal(memory.yMax, 100);
    const flatter = chartLayout({ bars: Array.from({ length: 5 }, (_, i) => ({ low: i, high: i, users: [22, 20, 20, 20, 18][i] })), yours: 0 });
    assert.deepEqual(flatter.gridlines, [0, 10, 20, 30]);

    // A window of the bars: shares stay out of everyone, indices stay absolute.
    const windowed = chartLayout({ bars: [{ low: 1, high: 1, users: 1 }, { low: 2, high: 2, users: 3 }, { low: 3, high: 3, users: 0 }], yours: 2 }, 1, 2);
    assert.deepEqual(windowed.bars.map((bar) => [bar.index, bar.share, bar.yours]), [[1, 75, false], [2, 0, true]]);
});
