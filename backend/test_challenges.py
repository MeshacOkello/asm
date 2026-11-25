"""Challenges: problem files, grading, redaction of hidden tests, and scoring."""
import json
import shutil
import tempfile
import time
import unittest
from pathlib import Path

import testing  # noqa: F401 - isolates the database before app is imported
import assembly_worker
import grader
import problems
import scoring
from app import EXECUTION_LIMIT, PROBLEMS, REFERENCE_TOTALS, app
from assembler import assemble_program
from simulator import run_for_grading, run_program

SEEDS = problems.PROBLEMS_DIR


def function_problem(name, args, returns='long', **limits):
    return {
        'slug': 'test', 'kind': 'function',
        'limits': {'instructions': limits.get('instructions', 5000),
                   'seconds': limits.get('seconds', 2.0)},
        'function': {'name': name, 'signature': '', 'args': args, 'returns': returns},
    }


def io_problem(**limits):
    return {'slug': 'test', 'kind': 'io', 'function': None,
            'limits': {'instructions': limits.get('instructions', 5000),
                       'seconds': limits.get('seconds', 2.0)}}


def test_case(test_input, expected, visible=True, id='t'):
    return {'id': id, 'visible': visible, 'input': test_input, 'expected': expected}


def grade_one(problem, source, test):
    return grader.grade(problem, source, [test])[0]


ECHO_SUM = '''
        .section .rodata
fmt:    .string "%ld"
out:    .string "%ld\\n"
        .section .text
        .global main
main:
        sub     sp, sp, 32
        str     x30, [sp]
        stp     x19, x20, [sp, 16]
        mov     x20, 0
        mov     x19, 2
loop:
        adr     x0, fmt
        add     x1, sp, 8
        bl      scanf
        ldr     x1, [sp, 8]
        add     x20, x20, x1
        subs    x19, x19, 1
        b.ne    loop
        adr     x0, out
        mov     x1, x20
        bl      printf
        ldp     x19, x20, [sp, 16]
        ldr     x30, [sp]
        add     sp, sp, 32
        mov     w0, 0
        ret
'''


class ProblemFileTests(unittest.TestCase):
    """A problem folder is checked in full when the backend starts."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        shutil.copytree(SEEDS / 'array-max', self.root / 'array-max')
        shutil.copytree(SEEDS / 'sum-input', self.root / 'sum-input')

    def edit_json(self, slug, name, change):
        path = self.root / slug / name
        data = json.loads(path.read_text())
        change(data)
        path.write_text(json.dumps(data))

    def assert_rejected(self, fragment, file_name):
        with self.assertRaises(problems.ProblemError) as caught:
            problems.load_problems(self.root)
        self.assertIn(file_name, str(caught.exception))
        self.assertIn(fragment, str(caught.exception))

    def test_seed_problems_load_in_difficulty_order(self):
        loaded = problems.load_problems()
        self.assertEqual(len(loaded), 6)
        order = [problem['difficulty'] for problem in loaded.values()]
        self.assertEqual(order, sorted(order, key=problems.DIFFICULTIES.index))
        for problem in loaded.values():
            self.assertLessEqual(problem['limits']['instructions'], EXECUTION_LIMIT)

    def test_every_seed_has_three_visible_and_five_hidden_tests(self):
        for slug, problem in problems.load_problems().items():
            visible = [test for test in problem['tests'] if test['visible']]
            hidden = [test for test in problem['tests'] if not test['visible']]
            self.assertGreaterEqual(len(visible), 3, slug)
            self.assertGreaterEqual(len(hidden), 5, slug)

    def test_a_valid_copy_loads(self):
        self.assertEqual(sorted(problems.load_problems(self.root)), ['array-max', 'sum-input'])

    def test_missing_file(self):
        (self.root / 'array-max' / 'reference.s').unlink()
        self.assert_rejected('is missing', 'reference.s')

    def test_empty_file(self):
        (self.root / 'array-max' / 'statement.md').write_text('  \n')
        self.assert_rejected('is empty', 'statement.md')

    def test_invalid_json(self):
        (self.root / 'array-max' / 'tests.json').write_text('[{"id": ')
        self.assert_rejected('not valid JSON', 'tests.json')

    def test_slug_must_match_folder(self):
        self.edit_json('array-max', 'problem.json', lambda data: data.update(slug='other'))
        self.assert_rejected('"slug"', 'problem.json')

    def test_difficulty_kind_and_tags(self):
        cases = [
            (lambda data: data.update(difficulty='trivial'), '"difficulty"'),
            (lambda data: data.update(kind='quiz'), '"kind"'),
            (lambda data: data.update(tags=[]), '"tags"'),
            (lambda data: data.update(tags=['Loops']), '"tags"'),
        ]
        for change, fragment in cases:
            with self.subTest(fragment):
                self.setUp()
                self.edit_json('array-max', 'problem.json', change)
                self.assert_rejected(fragment, 'problem.json')

    def test_limits_stay_under_the_execution_limit(self):
        self.edit_json('array-max', 'problem.json',
                       lambda data: data['limits'].update(instructions=EXECUTION_LIMIT + 1))
        self.assert_rejected('"limits.instructions"', 'problem.json')

    def test_function_problem_needs_its_function(self):
        self.edit_json('array-max', 'problem.json', lambda data: data.pop('function'))
        self.assert_rejected('"function"', 'problem.json')

    def test_function_may_not_be_main(self):
        self.edit_json('array-max', 'problem.json', lambda data: data['function'].update(name='main'))
        self.assert_rejected('"function.name"', 'problem.json')

    def test_io_problem_has_no_function(self):
        self.edit_json('sum-input', 'problem.json',
                       lambda data: data.update(function={'name': 'f'}))
        self.assert_rejected('"function" is only', 'problem.json')

    def test_function_test_must_give_every_argument(self):
        self.edit_json('array-max', 'tests.json', lambda tests: tests[0]['input'].pop('n'))
        self.assert_rejected('exactly the arguments', 'tests.json')

    def test_argument_values_are_range_checked(self):
        self.edit_json('array-max', 'tests.json',
                       lambda tests: tests[0]['input'].update(n=1 << 63))
        self.assert_rejected('signed 64-bit', 'tests.json')

    def test_memory_expectations_name_array_arguments(self):
        self.edit_json('array-max', 'tests.json',
                       lambda tests: tests[0]['expected'].update(memory={'n': [1]}))
        self.assert_rejected('long[] arguments', 'tests.json')

    def test_io_test_values_are_strings(self):
        self.edit_json('sum-input', 'tests.json', lambda tests: tests[0].update(expected=6))
        self.assert_rejected('must both be strings', 'tests.json')

    def test_test_keys_ids_and_visibility(self):
        cases = [
            (lambda tests: tests[0].pop('visible'), 'exactly the keys'),
            (lambda tests: tests[1].update(id=tests[0]['id']), 'unique'),
            (lambda tests: [test.update(visible=False) for test in tests], 'at least one test'),
            (lambda tests: tests[0].update(visible='yes'), '"visible"'),
        ]
        for change, fragment in cases:
            with self.subTest(fragment):
                self.setUp()
                self.edit_json('array-max', 'tests.json', change)
                self.assert_rejected(fragment, 'tests.json')

    def test_summary_has_no_tests_statement_or_reference(self):
        problem = problems.load_problems()['array-max']
        self.assertEqual(set(problems.summary(problem)),
                         {'slug', 'title', 'difficulty', 'tags', 'kind'})


class SeedReferenceTests(unittest.TestCase):
    """Every seed problem's reference passes all of its own tests."""

    def test_reference_solutions_pass(self):
        for slug, problem in problems.load_problems().items():
            with self.subTest(slug):
                results = grader.grade(problem, problem['reference'], problem['tests'])
                failures = [(r['id'], r['kind'], r['message']) for r in results if not r['passed']]
                self.assertEqual(failures, [])

    def test_starter_code_assembles_and_is_not_accepted(self):
        for slug, problem in problems.load_problems().items():
            with self.subTest(slug):
                results = grader.grade(problem, problem['starter'], problem['tests'])
                self.assertNotIn(grader.ASSEMBLER_ERROR, [result['kind'] for result in results])
                self.assertNotEqual(scoring.verdict(results), scoring.ACCEPTED)

    def test_reference_totals_are_cached_at_startup(self):
        self.assertEqual(set(REFERENCE_TOTALS), set(PROBLEMS))
        for totals in REFERENCE_TOTALS.values():
            self.assertGreater(totals['instructions'], 0)


class IoTestKindTests(unittest.TestCase):
    problem = io_problem()

    def test_exact_stdout_passes(self):
        result = grade_one(self.problem, ECHO_SUM, test_case('4\n5\n', '9\n'))
        self.assertEqual(result['kind'], grader.PASSED)
        self.assertEqual(result['actual'], '9\n')
        self.assertGreater(result['instructions'], 0)

    def test_any_difference_is_a_wrong_answer(self):
        result = grade_one(self.problem, ECHO_SUM, test_case('4 5', '9'))
        self.assertEqual(result['kind'], grader.WRONG_ANSWER)
        self.assertEqual(result['actual'], '9\n')

    def test_stdin_reaches_end_of_file_instead_of_waiting(self):
        source = '''
        .section .text
        .global main
main:
        sub     sp, sp, 16
        str     x30, [sp]
        bl      getchar
        mov     x1, x0
        ldr     x30, [sp]
        add     sp, sp, 16
        mov     x0, x1
        ret
'''
        program = assemble_program(source)
        run = run_for_grading(program, '')
        self.assertEqual(run['state'], 'returned')
        self.assertEqual(run['returned']['value'], -1)

    def test_runtime_error(self):
        source = '        .global main\nmain:\n        mov x1, 0\n        ldr x0, [x1]\n        ret\n'
        result = grade_one(self.problem, source, test_case('', ''))
        self.assertEqual(result['kind'], grader.RUNTIME_ERROR)
        self.assertEqual(result['error']['line'], 4)

    def test_assembler_error_names_the_line(self):
        source = '        .global main\nmain:\n        movv x0, 1\n        ret\n'
        result = grade_one(self.problem, source, test_case('', ''))
        self.assertEqual(result['kind'], grader.ASSEMBLER_ERROR)
        self.assertEqual(result['error']['line'], 3)


class FunctionTestKindTests(unittest.TestCase):
    add = function_problem('addTwo', [{'name': 'a', 'type': 'long'}, {'name': 'b', 'type': 'long'}])

    def test_arguments_arrive_in_x0_to_x7_and_x0_is_checked(self):
        source = 'addTwo:\n        add x0, x0, x1\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': -5, 'b': 1 << 40}, {'x0': (1 << 40) - 5}))
        self.assertEqual(result['kind'], grader.PASSED, result['message'])
        # Only the student's three lines are counted, not the harness.
        self.assertEqual(result['instructions'], 2)

    def test_wrong_return_value(self):
        source = 'addTwo:\n        sub x0, x0, x1\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': 2, 'b': 3}, {'x0': 5}))
        self.assertEqual(result['kind'], grader.WRONG_ANSWER)
        self.assertEqual(result['actual'], {'x0': -1})

    def test_int_return_reads_w0(self):
        problem = function_problem('f', [], returns='int')
        result = grade_one(problem, 'f:\n        mov x0, 0x1ffffffff\n        ret\n',
                           test_case({}, {'x0': -1}))
        self.assertEqual(result['kind'], grader.PASSED)

    def test_clobbering_a_callee_saved_register_fails(self):
        source = 'addTwo:\n        add x19, x0, x1\n        mov x0, x19\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': 2, 'b': 3}, {'x0': 5}))
        self.assertEqual(result['kind'], grader.WRONG_ANSWER)
        self.assertIn('x19 is callee-saved', result['message'])

    def test_saving_and_restoring_a_callee_saved_register_passes(self):
        source = '''addTwo:
        str     x19, [sp, -16]!
        add     x19, x0, x1
        mov     x0, x19
        ldr     x19, [sp], 16
        ret
'''
        result = grade_one(self.add, source, test_case({'a': 2, 'b': 3}, {'x0': 5}))
        self.assertEqual(result['kind'], grader.PASSED, result['message'])
        self.assertEqual(result['memory_accesses'], 2)

    def test_unbalanced_stack_fails(self):
        source = 'addTwo:\n        sub sp, sp, 16\n        add x0, x0, x1\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': 2, 'b': 3}, {'x0': 5}))
        self.assertEqual(result['kind'], grader.WRONG_ANSWER)
        self.assertIn('sp was not restored', result['message'])

    def test_recursion_that_loses_x30_fails(self):
        factorial = PROBLEMS['recursive-factorial']
        source = '''factorial:
        cmp     x0, 1
        b.le    base
        str     x0, [sp, -16]!
        sub     x0, x0, 1
        bl      factorial
        ldr     x1, [sp], 16
        mul     x0, x0, x1
        ret
base:
        mov     x0, 1
        ret
'''
        result = grade_one(factorial, source, test_case({'n': 3}, {'x0': 6}))
        self.assertFalse(result['passed'])
        self.assertIn(result['kind'], (grader.INSTRUCTION_LIMIT, grader.RUNTIME_ERROR,
                                       grader.WRONG_ANSWER))

    def test_strings_are_passed_as_pointers_to_nul_terminated_bytes(self):
        problem = PROBLEMS['string-length']
        for text in ('', 'a"b\\c', 'tab\there', 'h\u00e9llo', '// not a comment ; #'):
            with self.subTest(text=text):
                result = grade_one(problem, problem['reference'],
                                   test_case({'s': text}, {'x0': len(text.encode())}))
                self.assertEqual(result['kind'], grader.PASSED, result['message'])

    def test_named_memory_regions_are_checked(self):
        problem = function_problem('double', [{'name': 'arr', 'type': 'long[]'},
                                              {'name': 'n', 'type': 'long'}], returns='void')
        doubling = '''double:
        cbz     x1, done
loop:
        ldr     x2, [x0]
        add     x2, x2, x2
        str     x2, [x0], 8
        subs    x1, x1, 1
        b.ne    loop
done:
        ret
'''
        test = test_case({'arr': [1, -2, 3], 'n': 3}, {'memory': {'arr': [2, -4, 6]}})
        self.assertEqual(grade_one(problem, doubling, test)['kind'], grader.PASSED)
        wrong = grade_one(problem, 'double:\n        ret\n', test)
        self.assertEqual(wrong['kind'], grader.WRONG_ANSWER)
        self.assertEqual(wrong['actual'], {'memory': {'arr': [1, -2, 3]}})

    def test_defining_main_is_an_assembler_error(self):
        source = 'main:\n        ret\naddTwo:\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': 1, 'b': 1}, {'x0': 2}))
        self.assertEqual(result['kind'], grader.ASSEMBLER_ERROR)
        self.assertIn('main', result['message'])

    def test_missing_function_label_is_an_assembler_error(self):
        result = grade_one(self.add, 'add:\n        ret\n', test_case({'a': 1, 'b': 1}, {'x0': 2}))
        self.assertEqual(result['kind'], grader.ASSEMBLER_ERROR)
        self.assertIn('addTwo', result['message'])

    def test_falling_off_the_end_is_a_runtime_error(self):
        source = 'addTwo:\n        mov x30, 0x40\n        ret\n'
        result = grade_one(self.add, source, test_case({'a': 1, 'b': 1}, {'x0': 2}))
        self.assertEqual(result['kind'], grader.RUNTIME_ERROR)
        self.assertIn('x30', result['message'])


class LimitTests(unittest.TestCase):
    loop = 'spin:\n        b spin\n'

    def test_instruction_limit(self):
        problem = function_problem('spin', [], instructions=300)
        result = grade_one(problem, self.loop, test_case({}, {'x0': 0}))
        self.assertEqual(result['kind'], grader.INSTRUCTION_LIMIT)
        # The harness's own instructions count toward the limit too.
        self.assertLessEqual(result['instructions'], 300)

    def test_wall_clock_deadline(self):
        problem = function_problem('spin', [], instructions=EXECUTION_LIMIT, seconds=1e-9)
        result = grade_one(problem, self.loop, test_case({}, {'x0': 0}))
        self.assertEqual(result['kind'], grader.TIME_LIMIT)

    def test_a_job_past_its_timeout_replaces_the_worker(self):
        problem = PROBLEMS['sum-to-n']
        job = grader.job(problem, problem['reference'], problem['tests'] * 20)
        started = time.monotonic()
        with self.assertRaises(assembly_worker.GradingTimeout):
            assembly_worker.grade_in_worker(job, timeout=0.01)
        self.assertLess(time.monotonic() - started, 5)
        # The next job gets a fresh process and finishes normally.
        small = grader.job(problem, problem['reference'], problem['tests'][:1])
        self.assertTrue(assembly_worker.grade_in_worker(small, timeout=10)[0]['passed'])


class LightweightModeTests(unittest.TestCase):
    """The grading run agrees with the visualizer's recorded run."""

    def test_counts_match_the_full_trace(self):
        source = (SEEDS / 'recursive-factorial' / 'reference.s').read_text() + '''
        .global main
main:
        str     x30, [sp, -16]!
        mov     x0, 6
        bl      factorial
        ldr     x30, [sp], 16
        ret
'''
        program = assemble_program(source)
        trace = run_program(program, [], EXECUTION_LIMIT)
        run = run_for_grading(program, '', EXECUTION_LIMIT)
        executed, accesses = trace[2], trace[4]
        self.assertEqual(run['state'], 'returned')
        self.assertEqual(run['instructions'], len(executed) - 1)
        self.assertEqual(run['memory_accesses'], sum(len(step) for step in accesses))
        self.assertEqual(run['registers'], trace[0][-1])
        self.assertEqual(run['registers'][0], 720)

    def test_stdout_is_captured(self):
        program = assemble_program(ECHO_SUM)
        run = run_for_grading(program, '40 2')
        self.assertEqual(run['stdout'], b'42\n')


class ScoringTests(unittest.TestCase):
    reference = {'instructions': 100, 'memory_accesses': 20}

    def results(self, *kinds, instructions=10, memory=2):
        return [{'passed': kind == grader.PASSED, 'kind': kind,
                 'instructions': instructions, 'memory_accesses': memory} for kind in kinds]

    def test_verdict_is_accepted_only_when_all_pass(self):
        self.assertEqual(scoring.verdict(self.results('passed', 'passed')), scoring.ACCEPTED)
        self.assertEqual(scoring.verdict(self.results('passed', 'runtime_error', 'wrong_answer')),
                         'runtime_error')

    def test_totals(self):
        self.assertEqual(scoring.totals(self.results('passed', 'passed', instructions=7, memory=3)),
                         {'instructions': 14, 'memory_accesses': 6})

    def test_medal_boundaries(self):
        cases = [
            ((100, 20), scoring.GOLD),
            ((50, 0), scoring.GOLD),
            ((101, 20), scoring.SILVER),
            ((150, 30), scoring.SILVER),
            ((151, 20), scoring.BRONZE),
            ((100, 31), scoring.BRONZE),
        ]
        for (instructions, memory), expected in cases:
            with self.subTest(instructions=instructions, memory=memory):
                score = {'instructions': instructions, 'memory_accesses': memory}
                self.assertEqual(scoring.medal(score, self.reference), expected)

    def test_medal_with_no_reference_memory_accesses(self):
        reference = {'instructions': 10, 'memory_accesses': 0}
        self.assertEqual(scoring.medal({'instructions': 10, 'memory_accesses': 0}, reference), 'gold')
        self.assertEqual(scoring.medal({'instructions': 10, 'memory_accesses': 1}, reference), 'bronze')

    def test_summary_scores_only_an_accepted_submission(self):
        accepted = scoring.summarize(self.results('passed', 'passed', instructions=60), self.reference)
        self.assertEqual(accepted['score'], {
            'instructions': 120, 'memory_accesses': 4, 'reference': self.reference, 'medal': 'silver'})
        failed = scoring.summarize(self.results('passed', 'wrong_answer'), self.reference)
        self.assertNotIn('score', failed)
        self.assertEqual((failed['passed'], failed['total']), (1, 2))
        self.assertNotIn('score', scoring.summarize(self.results('passed'), None))


class ChallengeEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = testing.isolated_client(self)
        testing.sign_in(self.client)

    def submit(self, slug, code, mode='submit'):
        """A Run response, or the stored submission once it is judged."""
        if mode == 'run':
            return self.client.post(f'/problems/{slug}/run', json={'code': code})
        return testing.submit(self.client, slug, code)

    def secrets(self, problem):
        """Text that would reveal a hidden test or the reference if it appeared.

        Encoded as Flask encodes the response. A value that is also public,
        such as a hidden expected "0\\n" that a visible test shares, proves
        nothing either way and is left out.
        """
        encode = app.json.dumps
        visible = [test for test in problem['tests'] if test['visible']]
        public = encode({
            'tests': [{'id': t['id'], 'input': t['input'], 'expected': t['expected']} for t in visible],
            'text': [problem['statement'], problem['starter'], problem['title']],
            'function': problem['function'],
            'shown': [grader.describe_input(problem, t['input']) for t in visible],
        })
        found = [encode(problem['reference'])[1:-1]]
        for test in problem['tests']:
            if test['visible']:
                continue
            found += [encode(test['id']), encode(test['input']), encode(test['expected'])]
            if problem['kind'] == 'function':
                found.append(encode(grader.harness(problem['function'], test['input']))[1:-1])
                found.append(encode(grader.describe_input(problem, test['input']))[1:-1])
        return [secret for secret in found if secret not in public]

    def assert_no_secrets(self, problem, body):
        secrets = self.secrets(problem)
        self.assertTrue(secrets)
        for secret in secrets:
            self.assertNotIn(secret, body)

    def test_list_has_no_tests_or_reference(self):
        data = self.client.get('/problems').get_json()
        self.assertEqual([p['slug'] for p in data['problems']], list(PROBLEMS))
        for problem in data['problems']:
            self.assertEqual(set(problem), {'slug', 'title', 'difficulty', 'tags', 'kind'})

    def test_detail_shows_only_visible_tests(self):
        for slug, problem in PROBLEMS.items():
            with self.subTest(slug):
                response = self.client.get(f'/problems/{slug}')
                data = response.get_json()
                visible = [test['id'] for test in problem['tests'] if test['visible']]
                self.assertEqual([test['id'] for test in data['tests']], visible)
                self.assertEqual(data['starter'], problem['starter'])
                self.assertNotIn('reference', data)
                self.assert_no_secrets(problem, response.get_data(as_text=True))

    def test_unknown_problem(self):
        response = self.client.get('/problems/no-such-problem')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error_info']['kind'], 'request')
        response = self.client.post('/problems/no-such-problem/submit', json={'code': ''})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.post('/problems/no-such-problem/run', json={'code': ''}).status_code, 404)

    def test_code_must_be_a_string(self):
        response = self.client.post('/problems/sum-to-n/run', json={'code': 5})
        self.assertEqual(response.status_code, 400)

    def test_run_uses_only_visible_tests(self):
        problem = PROBLEMS['array-max']
        data = self.submit('array-max', problem['reference'], mode='run').get_json()
        self.assertEqual(data['verdict'], 'accepted')
        self.assertTrue(all(result['visible'] for result in data['results']))
        self.assertEqual(data['total'], sum(test['visible'] for test in problem['tests']))
        self.assertNotIn('score', data)

    def test_accepted_reference_earns_gold(self):
        for slug, problem in PROBLEMS.items():
            with self.subTest(slug):
                data = self.submit(slug, problem['reference']).get_json()
                self.assertEqual(data['verdict_label'], 'Accepted')
                self.assertEqual(data['score']['medal'], 'gold')
                self.assertEqual(data['score']['reference'], REFERENCE_TOTALS[slug])

    def test_medals_against_the_reference(self):
        reference = PROBLEMS['sum-to-n']['reference']
        body = reference.split('sumToN:\n', 1)[1]
        # One extra instruction per call: within 1.5 times the reference.
        silver = 'sumToN:\n        mov     x2, x2\n' + body
        # Two memory accesses per call, where the reference makes none.
        bronze = ('sumToN:\n        str     x19, [sp, -16]!\n        ldr     x19, [sp], 16\n'
                  + body)
        for source, medal in ((silver, 'silver'), (bronze, 'bronze')):
            with self.subTest(medal):
                data = self.submit('sum-to-n', source).get_json()
                self.assertEqual(data['verdict'], 'accepted')
                self.assertEqual(data['score']['medal'], medal)

    def test_failing_hidden_tests_reveal_only_their_number_and_kind(self):
        for slug, problem in PROBLEMS.items():
            with self.subTest(slug):
                response = self.submit(slug, problem['starter'])
                data = response.get_json()
                self.assertNotEqual(data['verdict'], 'accepted')
                self.assertIsNone(data.get('score'))
                hidden = [result for result in data['results'] if not result['visible']]
                self.assertEqual(len(hidden), sum(not test['visible'] for test in problem['tests']))
                for number, result in enumerate(hidden, 1):
                    self.assertEqual(set(result),
                                     {'name', 'visible', 'passed', 'kind', 'kind_label', 'message'})
                    if not result['passed']:
                        self.assertEqual(result['message'], f'Hidden test {number} failed')
                self.assert_no_secrets(problem, response.get_data(as_text=True))

    def test_hidden_runtime_errors_reveal_no_message(self):
        source = 'absValue:\n        mov x1, 0\n        ldr x0, [x1]\n        ret\n'
        response = self.submit('absolute-value', source)
        data = response.get_json()
        hidden = [result for result in data['results'] if not result['visible']]
        self.assertTrue(all(result['kind'] == 'runtime_error' for result in hidden))
        self.assertTrue(all(result['kind_label'] == 'Runtime error' for result in hidden))
        self.assertTrue(all('error' not in result for result in hidden))
        self.assert_no_secrets(PROBLEMS['absolute-value'], response.get_data(as_text=True))

    def test_visible_failures_show_input_expected_and_actual(self):
        data = self.submit('sum-input', PROBLEMS['sum-input']['starter'], mode='run').get_json()
        first = data['results'][0]
        self.assertEqual(first['input_text'], '3\n1 2 3\n')
        self.assertEqual(first['expected_text'], '6\n')
        self.assertEqual(first['actual_text'], '')
        self.assertEqual(first['kind_label'], 'Wrong answer')

    def test_assembler_error_on_submit(self):
        data = self.submit('sum-to-n', 'sumToN:\n        bogus x0\n').get_json()
        self.assertEqual(data['verdict'], 'assembler_error')
        self.assertEqual(data['verdict_label'], 'Assembler error')
        self.assertEqual(data['results'][0]['error']['line'], 2)


if __name__ == '__main__':
    unittest.main()
