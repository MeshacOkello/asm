"""Load and validate the challenge problems stored in backend/problems/.

Each problem is a folder named for its slug:

    problem.json   title, slug, difficulty, tags, kind, limits, and for a
                   "function" problem the function's name, signature and types
    statement.md   the problem text, with examples
    starter.s      the code the editor starts with
    tests.json     [{"id", "visible", "input", "expected"}, ...]
    reference.s    the reference solution; never sent to a client

Everything is checked when the backend starts. A malformed problem raises
ProblemError naming the file and the field, so a broken problem stops the
server instead of failing one student at a time.
"""
import json
import re
from pathlib import Path

PROBLEMS_DIR = Path(__file__).parent / 'problems'
DIFFICULTIES = ('easy', 'medium', 'hard')
KINDS = ('io', 'function')
# The execution limit of /simulate. A problem may lower it, never raise it.
MAX_INSTRUCTIONS = 10_000
DEFAULT_INSTRUCTIONS = 5_000
DEFAULT_SECONDS = 2.0
MAX_SECONDS = 10.0
# The AAPCS64 passes the first eight integer arguments in x0-x7.
MAX_ARGUMENTS = 8
ARGUMENT_TYPES = ('long', 'int', 'long[]', 'char*')
RETURN_TYPES = ('long', 'int', 'void')
MAX_ARRAY_LENGTH = 256
MAX_STRING_LENGTH = 1024
SLUG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
TAG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
REQUIRED_FILES = ('problem.json', 'statement.md', 'starter.s', 'tests.json', 'reference.s')
LONG_RANGE = (-(1 << 63), (1 << 63) - 1)
INT_RANGE = (-(1 << 31), (1 << 31) - 1)


class ProblemError(ValueError):
    """A problem folder that does not follow the format."""


def _fail(path, message):
    raise ProblemError(f'{path}: {message}')


def _is_int(value):
    return type(value) is int


def _in_range(value, bounds):
    return _is_int(value) and bounds[0] <= value <= bounds[1]


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        _fail(path, f'is not valid JSON ({error})')


def _check_function(path, function):
    if not isinstance(function, dict):
        _fail(path, '"function" must be an object with name, signature, args and returns')
    name = function.get('name')
    if not isinstance(name, str) or not NAME.match(name) or name == 'main':
        _fail(path, '"function.name" must be a label name other than main')
    if not isinstance(function.get('signature'), str) or not function['signature'].strip():
        _fail(path, '"function.signature" must be a non-empty string, such as "long f(long n)"')
    args = function.get('args')
    if not isinstance(args, list) or len(args) > MAX_ARGUMENTS:
        _fail(path, f'"function.args" must be a list of at most {MAX_ARGUMENTS} arguments')
    seen = set()
    for index, argument in enumerate(args):
        if (not isinstance(argument, dict) or not isinstance(argument.get('name'), str)
                or not NAME.match(argument['name'])):
            _fail(path, f'"function.args[{index}]" needs a "name" that is an identifier')
        if argument['name'] in seen:
            _fail(path, f'"function.args" names "{argument["name"]}" twice')
        seen.add(argument['name'])
        if argument.get('type') not in ARGUMENT_TYPES:
            _fail(path, f'"function.args[{index}].type" must be one of {", ".join(ARGUMENT_TYPES)}')
    if function.get('returns') not in RETURN_TYPES:
        _fail(path, f'"function.returns" must be one of {", ".join(RETURN_TYPES)}')
    return {
        'name': name, 'signature': function['signature'].strip(),
        'args': [{'name': a['name'], 'type': a['type']} for a in args],
        'returns': function['returns'],
    }


def _check_meta(path, meta, slug):
    if not isinstance(meta, dict):
        _fail(path, 'must be a JSON object')
    if meta.get('slug') != slug:
        _fail(path, f'"slug" must be "{slug}", the name of its folder')
    if not SLUG.match(slug):
        _fail(path, 'the slug must be lowercase words joined by hyphens')
    if not isinstance(meta.get('title'), str) or not meta['title'].strip():
        _fail(path, '"title" must be a non-empty string')
    if meta.get('difficulty') not in DIFFICULTIES:
        _fail(path, f'"difficulty" must be one of {", ".join(DIFFICULTIES)}')
    tags = meta.get('tags')
    if (not isinstance(tags, list) or not tags
            or any(not isinstance(tag, str) or not TAG.match(tag) for tag in tags)
            or len(set(tags)) != len(tags)):
        _fail(path, '"tags" must be a non-empty list of distinct lowercase-hyphenated strings')
    if meta.get('kind') not in KINDS:
        _fail(path, f'"kind" must be one of {", ".join(KINDS)}')

    limits = meta.get('limits', {})
    if not isinstance(limits, dict):
        _fail(path, '"limits" must be an object')
    instructions = limits.get('instructions', DEFAULT_INSTRUCTIONS)
    if not _is_int(instructions) or not 1 <= instructions <= MAX_INSTRUCTIONS:
        _fail(path, f'"limits.instructions" must be an integer from 1 to {MAX_INSTRUCTIONS}')
    seconds = limits.get('seconds', DEFAULT_SECONDS)
    if type(seconds) not in (int, float) or not 0 < seconds <= MAX_SECONDS:
        _fail(path, f'"limits.seconds" must be a number above 0 and at most {MAX_SECONDS:g}')

    function = None
    if meta['kind'] == 'function':
        function = _check_function(path, meta.get('function'))
    elif 'function' in meta:
        _fail(path, '"function" is only for problems whose kind is "function"')
    return {
        'slug': slug, 'title': meta['title'].strip(), 'difficulty': meta['difficulty'],
        'tags': list(tags), 'kind': meta['kind'],
        'limits': {'instructions': instructions, 'seconds': float(seconds)},
        'function': function,
    }


def _check_value(path, where, kind, value):
    if kind == 'long' and not _in_range(value, LONG_RANGE):
        _fail(path, f'{where} must be an integer that fits in a signed 64-bit long')
    if kind == 'int' and not _in_range(value, INT_RANGE):
        _fail(path, f'{where} must be an integer that fits in a signed 32-bit int')
    if kind == 'long[]' and (
            not isinstance(value, list) or len(value) > MAX_ARRAY_LENGTH
            or any(not _in_range(item, LONG_RANGE) for item in value)):
        _fail(path, f'{where} must be a list of at most {MAX_ARRAY_LENGTH} signed 64-bit integers')
    if kind == 'char*' and (
            not isinstance(value, str) or len(value.encode('utf-8')) > MAX_STRING_LENGTH
            or '\0' in value):
        _fail(path, f'{where} must be a string of at most {MAX_STRING_LENGTH} bytes with no NUL')


def _check_test(path, index, test, problem):
    where = f'test {index}'
    if not isinstance(test, dict) or set(test) != {'id', 'visible', 'input', 'expected'}:
        _fail(path, f'{where} must have exactly the keys id, visible, input and expected')
    if not isinstance(test['id'], str) or not test['id'].strip():
        _fail(path, f'{where}: "id" must be a non-empty string')
    where = f'test "{test["id"]}"'
    if type(test['visible']) is not bool:
        _fail(path, f'{where}: "visible" must be true or false')

    if problem['kind'] == 'io':
        if not isinstance(test['input'], str) or not isinstance(test['expected'], str):
            _fail(path, f'{where}: an io test\'s input and expected must both be strings')
        return

    function = problem['function']
    names = [argument['name'] for argument in function['args']]
    test_input = test['input']
    if not isinstance(test_input, dict) or sorted(test_input) != sorted(names):
        _fail(path, f'{where}: "input" must give exactly the arguments {", ".join(names) or "(none)"}')
    for argument in function['args']:
        _check_value(path, f'{where}: input "{argument["name"]}"', argument['type'],
                     test_input[argument['name']])

    expected = test['expected']
    if not isinstance(expected, dict) or not expected or set(expected) - {'x0', 'memory'}:
        _fail(path, f'{where}: "expected" must be an object with "x0" and/or "memory"')
    if 'x0' in expected:
        if function['returns'] == 'void':
            _fail(path, f'{where}: a void function has no x0 result to expect')
        _check_value(path, f'{where}: expected "x0"', function['returns'], expected['x0'])
    if 'memory' in expected:
        regions = expected['memory']
        arrays = {a['name'] for a in function['args'] if a['type'] == 'long[]'}
        if not isinstance(regions, dict) or not regions or set(regions) - arrays:
            _fail(path, f'{where}: "expected.memory" may only name long[] arguments '
                        f'({", ".join(sorted(arrays)) or "none here"})')
        for name, values in regions.items():
            _check_value(path, f'{where}: expected memory "{name}"', 'long[]', values)
            if len(values) != len(test_input[name]):
                _fail(path, f'{where}: expected memory "{name}" must have as many elements as its input')


def load_problem(folder):
    folder = Path(folder)
    for name in REQUIRED_FILES:
        if not (folder / name).is_file():
            _fail(folder / name, 'is missing')
    problem = _check_meta(folder / 'problem.json', _read_json(folder / 'problem.json'), folder.name)
    for key, name in (('statement', 'statement.md'), ('starter', 'starter.s'),
                      ('reference', 'reference.s')):
        text = (folder / name).read_text(encoding='utf-8')
        if not text.strip():
            _fail(folder / name, 'is empty')
        problem[key] = text

    path = folder / 'tests.json'
    tests = _read_json(path)
    if not isinstance(tests, list) or not tests:
        _fail(path, 'must be a non-empty list of tests')
    for index, test in enumerate(tests):
        _check_test(path, index, test, problem)
    ids = [test['id'] for test in tests]
    if len(set(ids)) != len(ids):
        _fail(path, 'test ids must be unique')
    if not any(test['visible'] for test in tests):
        _fail(path, 'at least one test must be visible')
    problem['tests'] = tests
    return problem


def load_problems(root=PROBLEMS_DIR):
    """Every problem under `root`, keyed by slug, in a stable order."""
    root = Path(root)
    if not root.is_dir():
        _fail(root, 'the problems directory is missing')
    order = {difficulty: index for index, difficulty in enumerate(DIFFICULTIES)}
    problems = [load_problem(folder) for folder in sorted(root.iterdir())
                if folder.is_dir() and not folder.name.startswith(('.', '_'))]
    problems.sort(key=lambda problem: (order[problem['difficulty']], problem['title'].lower()))
    return {problem['slug']: problem for problem in problems}


def summary(problem):
    """What the problem list shows: no statement, no tests, no reference."""
    return {key: problem[key] for key in ('slug', 'title', 'difficulty', 'tags', 'kind')}
