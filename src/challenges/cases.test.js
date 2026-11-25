import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCase, inputFields, outputFields, visibleWhitespace } from './cases.js';

const arrayMax = {
    function: { args: [{ name: 'arr', type: 'long[]' }, { name: 'n', type: 'long' }], returns: 'long' },
};
const length = { function: { args: [{ name: 's', type: 'char*' }], returns: 'long' } };
const io = { function: null };

test('one labelled block per argument', () => {
    assert.deepEqual(inputFields(arrayMax, { input: { arr: [3, -1], n: 2 } }), [
        { label: 'arr =', value: '[3, -1]' }, { label: 'n =', value: '2' },
    ]);
    assert.deepEqual(inputFields(length, { input: { s: 'a"b\n' } }), [{ label: 's =', value: '"a\\"b\\n"' }]);
    assert.deepEqual(inputFields(io, { input: '3\n1 2 3\n' }), [{ label: 'stdin', value: '3\n1 2 3\n' }]);
});

test('the register that differs is marked', () => {
    assert.deepEqual(outputFields(arrayMax, { expected: { x0: 5 }, actual: { x0: 7 } }), [
        { label: 'x0', expected: '5', actual: '7', differs: true },
    ]);
    assert.deepEqual(outputFields(arrayMax, { expected: { x0: 5 }, actual: { x0: 5 } })[0].differs, false);
});

test('memory regions and missing output', () => {
    const problem = { function: { args: [{ name: 'arr', type: 'long[]' }], returns: 'void' } };
    assert.deepEqual(outputFields(problem, {
        expected: { memory: { arr: [2, 4] } }, actual: { memory: { arr: [1, 2] } },
    }), [{ label: 'arr (memory)', expected: '[2, 4]', actual: '[1, 2]', differs: true }]);
    // A runtime error leaves no actual value: nothing is marked as different.
    assert.deepEqual(outputFields(arrayMax, { expected: { x0: 5 }, actual: null }),
        [{ label: 'x0', expected: '5', actual: null, differs: false }]);
    // A visible test before running has no actual at all.
    assert.equal(outputFields(arrayMax, { expected: { x0: 5 } })[0].actual, null);
});

test('io compares the whole of stdout', () => {
    assert.deepEqual(outputFields(io, { expected: '6\n', actual: '6' }),
        [{ label: 'stdout', expected: '6\n', actual: '6', differs: true }]);
    assert.equal(visibleWhitespace('6\n'), '6↵\n');
});

test('the case shown first', () => {
    assert.equal(initialCase([{ visible: true, passed: true }, { visible: true, passed: false }]), 1);
    assert.equal(initialCase([{ visible: true, passed: true }]), 0);
    assert.equal(initialCase([]), 0);
    assert.equal(initialCase(undefined), 0);
});
