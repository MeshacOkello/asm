import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTags, difficultyLabel, filterProblems, tagLabel, visualizerProgram } from './problems.js';
import { parseBlocks, parseInline } from './markdown.js';

const PROBLEMS = [
    { slug: 'a', difficulty: 'easy', tags: ['loops', 'flags'] },
    { slug: 'b', difficulty: 'medium', tags: ['strings', 'loops'] },
    { slug: 'c', difficulty: 'medium', tags: ['recursion', 'stack-frames'] },
];

test('filters combine difficulty and tag', () => {
    const slugs = (filters) => filterProblems(PROBLEMS, filters).map((problem) => problem.slug);
    assert.deepEqual(slugs({}), ['a', 'b', 'c']);
    assert.deepEqual(slugs({ difficulty: 'medium' }), ['b', 'c']);
    assert.deepEqual(slugs({ tag: 'loops' }), ['a', 'b']);
    assert.deepEqual(slugs({ difficulty: 'medium', tag: 'loops' }), ['b']);
    assert.deepEqual(slugs({ difficulty: 'hard' }), []);
});

test('tags and labels', () => {
    assert.deepEqual(collectTags(PROBLEMS), ['flags', 'loops', 'recursion', 'stack-frames', 'strings']);
    assert.equal(tagLabel('stack-frames'), 'stack frames');
    assert.equal(difficultyLabel('medium'), 'Medium');
});

test('a function test opens the code with the grader harness after it', () => {
    const test = { name: 'Test 1', harness: '\nmain:\n        bl f\n' };
    assert.deepEqual(visualizerProgram({}, test, 'f:\n        ret'), {
        source: 'f:\n        ret\n\nmain:\n        bl f\n', stdin: null,
    });
    assert.equal(visualizerProgram({}, test, 'f:\n        ret\n').source, 'f:\n        ret\n\nmain:\n        bl f\n');
});

test('an io test opens the code alone, with the test input as stdin', () => {
    assert.deepEqual(visualizerProgram({}, { stdin: '3\n1 2 3\n' }, 'main: ret'), {
        source: 'main: ret', stdin: '3\n1 2 3\n',
    });
});

test('markdown blocks', () => {
    const blocks = parseBlocks([
        'Write `f`.', 'It returns **x0**.', '', '## Examples', '', '```c', 'long f(long n);', '', '```',
        '- one', '- two', '  continued', 'After.',
    ].join('\n'));
    assert.deepEqual(blocks, [
        { type: 'paragraph', text: 'Write `f`. It returns **x0**.' },
        { type: 'heading', level: 2, text: 'Examples' },
        { type: 'code', lang: 'c', text: 'long f(long n);\n' },
        { type: 'list', items: ['one', 'two continued'] },
        { type: 'paragraph', text: 'After.' },
    ]);
});

test('an unclosed fence runs to the end', () => {
    assert.deepEqual(parseBlocks('```\nmov x0, 1'), [{ type: 'code', lang: null, text: 'mov x0, 1' }]);
});

test('markdown inline spans, with markup kept as text', () => {
    assert.deepEqual(parseInline('Use `cmp` then **branch**, *not* <b>this</b>'), [
        { type: 'text', text: 'Use ' },
        { type: 'code', text: 'cmp' },
        { type: 'text', text: ' then ' },
        { type: 'strong', text: 'branch' },
        { type: 'text', text: ', ' },
        { type: 'em', text: 'not' },
        { type: 'text', text: ' <b>this</b>' },
    ]);
    assert.deepEqual(parseInline('2 * 3 = 6'), [{ type: 'text', text: '2 * 3 = 6' }]);
});
