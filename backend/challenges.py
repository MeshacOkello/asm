"""The challenge problems: listing them, showing them, and grading code.

Submissions, which need an account, are in accounts_api.py; this module only
grades. Hidden tests and reference solutions never leave the server.
"""
from flask import Blueprint, jsonify

import errors
import grader
import problems as problem_files
import scoring
from assembly_worker import ASSEMBLY_TIMEOUT, GradingTimeout, grade_in_worker, timeout_error
from responses import bad_request, error_response, parse_body, read_code

bp = Blueprint('challenges', __name__)

# Challenges -----------------------------------------------------------------
#
# Problems live in backend/problems/ and are validated here, at startup: a
# malformed problem, or a reference solution that fails its own tests, stops
# the backend with a ProblemError naming the file. Reference totals are
# computed once and kept for the medals.

FAILURE_LABELS = {
    grader.WRONG_ANSWER: 'Wrong answer',
    grader.RUNTIME_ERROR: 'Runtime error',
    grader.INSTRUCTION_LIMIT: 'Exceeded instruction limit',
    grader.TIME_LIMIT: 'Exceeded time limit',
    grader.ASSEMBLER_ERROR: 'Assembler error',
}


def job_timeout(problem, tests):
    """The whole job's budget: every test's own limit, plus room to assemble."""
    return ASSEMBLY_TIMEOUT + len(tests) * (problem['limits']['seconds'] + 1)


def run_tests(problem, source, tests):
    """Every test's full, unredacted result, from the grading worker."""
    try:
        return grade_in_worker(grader.job(problem, source, tests), job_timeout(problem, tests))
    except GradingTimeout:
        # Each run has its own deadline, so only Keystone can get here.
        failure = timeout_error()
        return [grader.make_result(test, grader.ASSEMBLER_ERROR, message=failure['message'],
                               error=failure) for test in tests]


def reference_totals(problems):
    """Run each reference solution once; it must pass every one of its tests."""
    totals = {}
    for slug, problem in problems.items():
        results = run_tests(problem, problem['reference'], problem['tests'])
        for result in results:
            if not result['passed']:
                raise problem_files.ProblemError(
                    f'{problem_files.PROBLEMS_DIR / slug / "reference.s"}: the reference '
                    f'solution fails test "{result["id"]}" ({result["kind"]}: {result["message"]})')
        totals[slug] = scoring.totals(results)
    return totals


def describe_result(problem, value):
    """Readable text for an expected or actual function result, or io output."""
    if value is None:
        return None
    if problem['kind'] == 'io':
        return value
    parts = []
    if 'x0' in value:
        parts.append(f'x0 = {value["x0"]}')
    for name, values in value.get('memory', {}).items():
        shown = 'unreadable' if values is None else '[' + ', '.join(map(str, values)) + ']'
        parts.append(f'{name} = {shown}')
    return ', '.join(parts)


def visible_test(problem, test, number):
    """A visible test as the workspace shows it, with what it needs to replay it."""
    shown = {
        'id': test['id'], 'name': f'Test {number}', 'visible': True,
        'input': test['input'], 'input_text': grader.describe_input(problem, test['input']),
        'expected': test['expected'], 'expected_text': describe_result(problem, test['expected']),
    }
    if problem['kind'] == 'function':
        # The main the grader adds after the student's code, so "Open in
        # visualizer" can step through exactly the program that was graded.
        shown['harness'] = grader.harness(problem['function'], test['input'])
    else:
        shown['stdin'] = test['input']
    return shown


def public_result(problem, test, result, number, hidden_number):
    """One test's result as a client may see it.

    A visible test shows its input, expected and actual values and any error.
    A hidden test shows only that it passed, or that it failed and the kind of
    failure: never its id, input, expected value, output or error message.
    """
    label = FAILURE_LABELS.get(result['kind'])
    if not test['visible']:
        name = f'Hidden test {hidden_number}'
        return {
            'name': name, 'visible': False, 'passed': result['passed'],
            'kind': result['kind'], 'kind_label': label,
            'message': None if result['passed'] else f'{name} failed',
        }
    shown = visible_test(problem, test, number)
    shown.update({
        'passed': result['passed'], 'kind': result['kind'], 'kind_label': label,
        'actual_text': describe_result(problem, result['actual']),
        'message': result['message'], 'error': result['error'],
        'instructions': result['instructions'], 'memory_accesses': result['memory_accesses'],
    })
    return shown


def numbered(tests):
    """(test, visible number, hidden number) in the order the tests are listed."""
    visible = hidden = 0
    for test in tests:
        if test['visible']:
            visible += 1
        else:
            hidden += 1
        yield test, visible, hidden


PROBLEMS = problem_files.load_problems()
REFERENCE_TOTALS = reference_totals(PROBLEMS)


def find_problem(slug):
    problem = PROBLEMS.get(slug)
    if problem is None:
        return None, error_response(errors.payload(
            errors.REQUEST, 'There is no challenge with that name.',
            suggestion='Open the challenge from the Challenges list.'), 404)
    return problem, None


@bp.route('/problems', methods=['GET'])
def list_problems():
    return jsonify({'problems': [problem_files.summary(problem) for problem in PROBLEMS.values()]})


@bp.route('/problems/<slug>', methods=['GET'])
def show_problem(slug):
    problem, missing = find_problem(slug)
    if missing:
        return missing
    body = problem_files.summary(problem)
    body.update({
        'statement': problem['statement'],
        'starter': problem['starter'],
        'limits': problem['limits'],
        'tests': [visible_test(problem, test, number)
                  for test, number, _ in numbered(problem['tests']) if test['visible']],
        'hidden_count': sum(1 for test in problem['tests'] if not test['visible']),
    })
    if problem['function']:
        body['function'] = {key: problem['function'][key] for key in ('name', 'signature', 'args', 'returns')}
    return jsonify(body)


def grade_summary(problem, source, mode):
    """Grade `source` and return the client-safe summary.

    'run' uses the visible tests only and is never scored; 'submit' runs
    every test and, when accepted, scores against the reference totals.
    """
    tests = problem['tests'] if mode == 'submit' else [t for t in problem['tests'] if t['visible']]
    results = run_tests(problem, source, tests)
    summary = scoring.summarize(results, REFERENCE_TOTALS[problem['slug']] if mode == 'submit' else None)
    summary['verdict_label'] = 'Accepted' if summary['verdict'] == scoring.ACCEPTED \
        else FAILURE_LABELS[summary['verdict']]
    summary['mode'] = mode
    summary['results'] = [
        public_result(problem, test, result, number, hidden)
        for (test, number, hidden), result in zip(numbered(tests), results)
    ]
    return summary


@bp.route('/problems/<slug>/run', methods=['POST'])
def run_problem(slug):
    """Anyone may run the visible tests; nothing is saved."""
    problem, missing = find_problem(slug)
    if missing:
        return missing
    data, unreadable = parse_body()
    if unreadable is not None:
        return bad_request(unreadable)
    source, invalid = read_code(data)
    if invalid:
        return invalid
    return jsonify(grade_summary(problem, source, 'run'))
