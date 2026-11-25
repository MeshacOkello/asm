"""Run a student's program against a problem's tests with the simulator.

There is no second execution engine here: every test is assembled by
assembler.py and run by simulator.run_for_grading, the visualizer's own
instruction loop without its history.

An "io" test runs the student's whole program with the test's stdin and
compares stdout exactly. A "function" test appends a harness to the student's
code: a main that sets callee-saved registers to known values, puts the
arguments in x0-x7 (arrays and strings in .data), calls the student's label
and returns. Afterwards x0 and any named memory are compared, and x19-x28 and
sp must be what main left them, as the calling convention requires.

grade() runs inside the grading worker process (see assembly_worker.py).
"""
import time

import errors
from assembler import STACK_END, AssemblyError, assemble_program, split_sections
from simulator import run_for_grading, signed_value

PASSED = 'passed'
WRONG_ANSWER = 'wrong_answer'
RUNTIME_ERROR = 'runtime_error'
INSTRUCTION_LIMIT = 'instruction_limit'
TIME_LIMIT = 'time_limit'
ASSEMBLER_ERROR = 'assembler_error'
FAILURE_KINDS = (WRONG_ANSWER, RUNTIME_ERROR, INSTRUCTION_LIMIT, TIME_LIMIT, ASSEMBLER_ERROR)

HARNESS_PREFIX = '__grader_'
CALLEE_SAVED = range(19, 29)


def sentinel(register):
    """A recognisable value the harness leaves in a callee-saved register."""
    return 0x1111 * (register - 18)


def _move_immediate(register, value):
    """movz/movk lines that put any 64-bit value in a register."""
    value &= (1 << 64) - 1
    lines = [f'        movz    {register}, #0x{value & 0xFFFF:x}']
    for shift in (16, 32, 48):
        part = (value >> shift) & 0xFFFF
        if part:
            lines.append(f'        movk    {register}, #0x{part:x}, lsl #{shift}')
    return lines


def _string_literal(text):
    """A .asciz operand for any text, every byte but plain ASCII as an octal escape.

    Comment and separator characters are escaped too, so nothing in a test's
    string can be read as anything but string contents.
    """
    out = []
    for byte in text.encode('utf-8'):
        char = chr(byte)
        if byte < 0x80 and (char.isalnum() or char in ' ,.:!?()[]{}<>+-*=_'):
            out.append(char)
        else:
            out.append(f'\\{byte:03o}')
    return '"' + ''.join(out) + '"'


def harness(function, test_input):
    """The main that calls the student's function with one test's input."""
    data = []
    setup = []
    for index, argument in enumerate(function['args']):
        name, kind = argument['name'], argument['type']
        value = test_input[name]
        register = f'x{index}'
        if kind == 'long[]':
            label = f'{HARNESS_PREFIX}{name}'
            values = ', '.join(str(item) for item in value)
            data += ['        .align  3', f'{label}:',
                     f'        .quad   {values}' if value else '        .space  8']
            setup.append(f'        adr     {register}, {label}')
        elif kind == 'char*':
            label = f'{HARNESS_PREFIX}{name}'
            data += [f'{label}:', f'        .asciz  {_string_literal(value)}']
            setup.append(f'        adr     {register}, {label}')
        else:
            setup += _move_immediate(register, value)

    lines = ['', '// ---- Grader harness: calls your function with this test\'s input ----']
    if data:
        lines += ['        .section .data'] + data
    lines += [
        '        .section .text',
        '        .global main',
        'main:',
        '        stp     x29, x30, [sp, -16]!',
        '        mov     x29, sp',
    ]
    for register in CALLEE_SAVED:
        lines += _move_immediate(f'x{register}', sentinel(register))
    lines += setup
    lines += [
        f'        bl      {function["name"]}',
        '        ldp     x29, x30, [sp], 16',
        '        ret',
        '',
    ]
    return '\n'.join(lines)


def combine(source, harness_source):
    """The student's code first, so its line numbers stay the editor's."""
    separator = '' if source.endswith('\n') else '\n'
    return source + separator + harness_source


def line_count(source):
    return source.count('\n') + (0 if source.endswith('\n') else 1)


def describe_input(problem, test_input):
    """Readable text for a test's input, as the results panel shows it."""
    if problem['kind'] == 'io':
        return test_input
    parts = []
    for argument in problem['function']['args']:
        value = test_input[argument['name']]
        if argument['type'] == 'char*':
            value = repr(value).replace("'", '"') if '"' not in value else repr(value)
        elif argument['type'] == 'long[]':
            value = '[' + ', '.join(str(item) for item in value) + ']'
        parts.append(f'{argument["name"]} = {value}')
    return ', '.join(parts)


def _precheck(problem, source):
    """A clear message for the mistakes a harness would otherwise obscure."""
    if problem['kind'] != 'function':
        return None
    try:
        _, _, owners = split_sections(source)
    except AssemblyError:
        return None  # assembly reports it with the student's line number
    name = problem['function']['name']
    if 'main' in owners:
        return errors.payload(
            errors.ASSEMBLY, 'This problem supplies its own main, so your code must not define one.',
            suggestion=f'Remove main and write only {name} (and any helpers it calls).')
    if name not in owners:
        return errors.payload(
            errors.ASSEMBLY, f'Your code does not define the label {name}.',
            suggestion=f'The grader calls {name} with bl. Start the function with "{name}:".')
    clash = sorted(label for label in owners if label.startswith(HARNESS_PREFIX))
    if clash:
        return errors.payload(
            errors.ASSEMBLY, f'Labels starting with {HARNESS_PREFIX} are reserved for the grader.',
            suggestion=f'Rename {clash[0]}.')
    return None


def _assembly_failure(error, program_source):
    return errors.assembly_error(
        error.message, line=error.line, source=program_source,
        suggestion=error.suggestion, detail=error.detail, kind=error.kind or errors.ASSEMBLY)


def make_result(test, kind, **fields):
    return {'id': test['id'], 'visible': test['visible'], 'kind': kind,
            'passed': kind == PASSED, 'message': None, 'error': None, 'actual': None,
            'instructions': 0, 'memory_accesses': 0, **fields}


def _decode_longs(data):
    return [int.from_bytes(data[offset:offset + 8], 'little', signed=True)
            for offset in range(0, len(data), 8)]


def _check_function_result(problem, test, run, combined_symbols):
    function = problem['function']
    expected = test['expected']
    registers = run['registers']
    actual = {}
    if function['returns'] != 'void':
        bits = 32 if function['returns'] == 'int' else 64
        actual['x0'] = signed_value(registers[0], bits)
    if 'memory' in expected:
        actual['memory'] = {
            name: None if run['memory'].get(name) is None else _decode_longs(run['memory'][name])
            for name in expected['memory']
        }

    for register in CALLEE_SAVED:
        if registers[register] != sentinel(register):
            return WRONG_ANSWER, actual, (
                f'x{register} is callee-saved, but it held 0x{registers[register]:x} after '
                f'{function["name"]} returned instead of 0x{sentinel(register):x}. '
                'Save it on the stack before using it, and restore it before ret.')
    if registers[31] != STACK_END:
        return WRONG_ANSWER, actual, (
            f'sp was not restored: {function["name"]} must add back every byte it reserved '
            'before it returns.')

    if 'x0' in expected and actual['x0'] != expected['x0']:
        return WRONG_ANSWER, actual, f'Expected x0 = {expected["x0"]}, but x0 = {actual["x0"]}.'
    for name, values in expected.get('memory', {}).items():
        if actual['memory'][name] != values:
            return WRONG_ANSWER, actual, f'The contents of {name} are not what was expected.'
    return PASSED, actual, None


def run_test(problem, source, test, precheck=None):
    """Assemble and run one test. The result keeps everything; app.py redacts."""
    limits = problem['limits']
    if precheck is not None:
        return make_result(test, ASSEMBLER_ERROR, message=precheck['message'], error=precheck)

    if problem['kind'] == 'function':
        program_source = combine(source, harness(problem['function'], test['input']))
        counted = set(range(1, line_count(source) + 1))
    else:
        program_source, counted = source, None

    try:
        program = assemble_program(program_source)
    except AssemblyError as error:
        failure = _assembly_failure(error, program_source)
        return make_result(test, ASSEMBLER_ERROR, message=errors.legacy_text(failure), error=failure)

    read_ranges = []
    if problem['kind'] == 'function':
        for name in test['expected'].get('memory', {}):
            read_ranges.append((name, program.symbols[f'{HARNESS_PREFIX}{name}'],
                                8 * len(test['input'][name])))

    deadline = time.monotonic() + limits['seconds']
    run = run_for_grading(
        program, test['input'] if problem['kind'] == 'io' else '',
        limits['instructions'], counted_lines=counted, deadline=deadline,
        read_ranges=read_ranges)
    counts = {'instructions': run['instructions'], 'memory_accesses': run['memory_accesses']}
    stdout = run['stdout'].decode('utf-8', errors='replace')

    if run['state'] == 'error':
        error = dict(run['error'])
        error['source_line'] = errors.source_line_text(program_source, error.get('line'))
        error = {key: value for key, value in error.items() if value is not None}
        return make_result(test, RUNTIME_ERROR, message=errors.legacy_text(error), error=error,
                       actual=stdout if problem['kind'] == 'io' else None, **counts)
    if run['state'] == 'execution_limit':
        return make_result(test, INSTRUCTION_LIMIT, **counts, message=(
            f'The program ran {limits["instructions"]} instructions without finishing.'),
            actual=stdout if problem['kind'] == 'io' else None)
    if run['state'] == 'timeout':
        return make_result(test, TIME_LIMIT, **counts, message=(
            f'The program was still running after {limits["seconds"]:g} seconds.'))

    if problem['kind'] == 'io':
        kind = PASSED if stdout == test['expected'] else WRONG_ANSWER
        message = None if kind == PASSED else 'The output does not match the expected output exactly.'
        return make_result(test, kind, actual=stdout, message=message, **counts)

    if run['state'] != 'returned':
        return make_result(test, RUNTIME_ERROR, **counts, message=(
            f'Control never came back to the grader\'s main after it called '
            f'{problem["function"]["name"]}. Check that x30 is saved before any bl and '
            'restored before ret, and that every path ends in ret.'))
    kind, actual, message = _check_function_result(problem, test, run, program.symbols)
    return make_result(test, kind, actual=actual, message=message, **counts)


def grade(problem, source, tests):
    """Run every test in order and return one result per test."""
    precheck = _precheck(problem, source)
    return [run_test(problem, source, test, precheck) for test in tests]


def job(problem, source, tests):
    """The picklable arguments for grade(), without the parts it never reads."""
    keep = ('slug', 'kind', 'limits', 'function')
    return {'problem': {key: problem[key] for key in keep}, 'source': source, 'tests': tests}
