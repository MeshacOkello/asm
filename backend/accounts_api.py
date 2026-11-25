"""Signed-in features: submissions, history, progress, profile, drafts, import.

A submission is saved as soon as it arrives, in the 'judging' state, and is
graded on a background thread by the same grader Run uses. Its result page
polls until it is 'done'. Every submission is private: a request for one
that is not the signed-in user's own gets the same 404 as one that does not
exist.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import and_, func, insert, select, update

import auth
import challenges
import db
import errors
import rankings
import scoring
import streaks
from responses import bad_request, error_response, parse_body, read_code

bp = Blueprint('accounts', __name__)
logger = logging.getLogger(__name__)

# One grading thread: the grading worker process handles one job at a time,
# and submissions are graded in the order they arrive.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='judge')
RECENT = 10
HISTORY_LIMIT = 200


def not_found():
    return error_response(errors.payload(errors.REQUEST, 'There is no such submission.'), 404)


def cross_site():
    return error_response(errors.payload(errors.REQUEST, 'Cross-site request refused.'), 403)


# --- judging -----------------------------------------------------------------

def judge(submission_id):
    """Grade one saved submission and store its client-safe result."""
    with db.engine.connect() as connection:
        row = connection.execute(
            select(db.submissions).where(db.submissions.c.id == submission_id)).first()
    if row is None or row.status != 'judging':
        return
    problem = challenges.PROBLEMS.get(row.slug)
    try:
        summary = challenges.grade_summary(problem, row.code, 'submit')
    except Exception:  # noqa: BLE001 - recorded on the submission, never lost
        logger.exception('Judging submission %s failed', submission_id)
        with db.engine.begin() as connection:
            connection.execute(update(db.submissions).where(db.submissions.c.id == submission_id)
                               .values(status='error', verdict='internal_error',
                                       finished_at=db.now_ms()))
        return
    score = summary.get('score') or {}
    with db.engine.begin() as connection:
        connection.execute(update(db.submissions).where(db.submissions.c.id == submission_id).values(
            status='done', verdict=summary['verdict'], passed=summary['passed'],
            total=summary['total'], instructions=score.get('instructions'),
            memory_accesses=score.get('memory_accesses'),
            result_json=db.dumps(summary), finished_at=db.now_ms()))


def schedule(submission_id):
    if current_app.config.get('JUDGE_INLINE'):
        judge(submission_id)
    else:
        _executor.submit(judge, submission_id)


def requeue_unfinished():
    """Grade anything left 'judging' when the server last stopped."""
    with db.engine.connect() as connection:
        ids = connection.execute(select(db.submissions.c.id)
                                 .where(db.submissions.c.status == 'judging')
                                 .order_by(db.submissions.c.id)).scalars().all()
    for submission_id in ids:
        _executor.submit(judge, submission_id)
    return ids


@bp.route('/problems/<slug>/submit', methods=['POST'])
@auth.login_required
def submit(slug):
    if not auth.same_origin():
        return cross_site()
    problem, missing = challenges.find_problem(slug)
    if missing:
        return missing
    data, unreadable = parse_body()
    if unreadable is not None:
        return bad_request(unreadable)
    source, invalid = read_code(data)
    if invalid:
        return invalid
    user = auth.current_user()
    with db.engine.begin() as connection:
        busy = connection.execute(select(func.count()).select_from(db.submissions).where(and_(
            db.submissions.c.user_id == user.id, db.submissions.c.status == 'judging'))).scalar()
        if busy:
            return error_response(errors.payload(
                errors.REQUEST, 'Your previous submission is still being judged.',
                suggestion='Wait for its result, then submit again.'), 429)
        submission_id = connection.execute(insert(db.submissions).values(
            user_id=user.id, slug=slug, code=source, status='judging',
            created_at=db.now_ms())).inserted_primary_key[0]
    schedule(submission_id)
    return jsonify({'id': submission_id, 'status': 'judging'}), 202


# --- reading submissions -----------------------------------------------------

def summary_row(row):
    """A submission as a history row: no code and no per-test results."""
    problem = challenges.PROBLEMS.get(row.slug)
    return {
        'id': row.id, 'slug': row.slug, 'title': problem['title'] if problem else row.slug,
        'difficulty': problem['difficulty'] if problem else None,
        'status': row.status, 'verdict': row.verdict,
        'verdict_label': verdict_label(row), 'passed': row.passed, 'total': row.total,
        'instructions': row.instructions, 'memory_accesses': row.memory_accesses,
        'created_at': row.created_at,
    }


def verdict_label(row):
    if row.status == 'judging':
        return 'Judging…'
    if row.verdict == scoring.ACCEPTED:
        return 'Accepted'
    return challenges.FAILURE_LABELS.get(row.verdict, 'Grading failed')


def accepted_results(connection, slug):
    return connection.execute(
        select(db.submissions.c.user_id, db.submissions.c.instructions,
               db.submissions.c.memory_accesses)
        .where(db.submissions.c.slug == slug, db.submissions.c.status == 'done',
               db.submissions.c.verdict == scoring.ACCEPTED)).all()


def own_submission(connection, submission_id, user):
    return connection.execute(select(db.submissions).where(
        db.submissions.c.id == submission_id, db.submissions.c.user_id == user.id)).first()


@bp.route('/api/submissions/<int:submission_id>')
@auth.login_required
def show_submission(submission_id):
    user = auth.current_user()
    with db.engine.connect() as connection:
        row = own_submission(connection, submission_id, user)
        if row is None:
            return not_found()
        body = summary_row(row)
        result = db.loads(row.result_json) or {}
        body.update(code=row.code, finished_at=row.finished_at,
                    results=result.get('results', []), score=result.get('score'))
        failing = next((index for index, test in enumerate(body['results']) if not test['passed']), None)
        body['first_failure'] = failing
        body['ranking'] = None
        if row.verdict == scoring.ACCEPTED and row.status == 'done':
            body['ranking'] = rankings.ranking(
                {'instructions': row.instructions, 'memory_accesses': row.memory_accesses},
                user.id, accepted_results(connection, row.slug), rankings.min_users(),
                challenges.REFERENCE_TOTALS.get(row.slug))
        earlier = connection.execute(
            select(db.submissions).where(db.submissions.c.user_id == user.id,
                                         db.submissions.c.slug == row.slug,
                                         db.submissions.c.id < row.id)
            .order_by(db.submissions.c.id.desc()).limit(HISTORY_LIMIT)).all()
        body['earlier'] = [summary_row(other) for other in earlier]
    return jsonify(body)


@bp.route('/api/problems/<slug>/submissions')
@auth.login_required
def problem_submissions(slug):
    _, missing = challenges.find_problem(slug)
    if missing:
        return missing
    user = auth.current_user()
    with db.engine.connect() as connection:
        rows = connection.execute(
            select(db.submissions).where(db.submissions.c.user_id == user.id,
                                         db.submissions.c.slug == slug)
            .order_by(db.submissions.c.id.desc()).limit(HISTORY_LIMIT)).all()
    return jsonify({'submissions': [summary_row(row) for row in rows]})


# --- progress and profile -----------------------------------------------------

def progress_for(connection, user_id):
    """Per problem: attempted, solved, and the best result, server and imported."""
    progress = {}
    rows = connection.execute(
        select(db.submissions.c.slug, db.submissions.c.verdict,
               db.submissions.c.instructions, db.submissions.c.memory_accesses)
        .where(db.submissions.c.user_id == user_id)).all()
    for row in rows:
        entry = progress.setdefault(row.slug, {'attempted': True, 'solved': False,
                                               'best': None, 'source': 'server'})
        if row.verdict == scoring.ACCEPTED:
            entry['solved'] = True
            result = {'instructions': row.instructions, 'memory_accesses': row.memory_accesses}
            if scoring.better(result, entry['best']):
                entry['best'] = result
    imported = connection.execute(select(db.imported_progress)
                                  .where(db.imported_progress.c.user_id == user_id)).all()
    for row in imported:
        entry = progress.get(row.slug)
        if entry is None:
            entry = progress[row.slug] = {'attempted': True, 'solved': False,
                                          'best': None, 'source': 'imported'}
        if row.solved and not entry['solved']:
            entry.update(solved=True, source='imported', best=(
                {'instructions': row.instructions, 'memory_accesses': row.memory_accesses}
                if row.instructions is not None else None))
    return {slug: entry for slug, entry in progress.items() if slug in challenges.PROBLEMS}


@bp.route('/api/progress')
@auth.login_required
def progress():
    with db.engine.connect() as connection:
        return jsonify({'progress': progress_for(connection, auth.current_user().id)})


@bp.route('/api/profile')
@auth.login_required
def profile():
    user = auth.current_user()
    tz = streaks.zone(request.args.get('tz'))
    with db.engine.connect() as connection:
        record = progress_for(connection, user.id)
        recent = connection.execute(
            select(db.submissions).where(db.submissions.c.user_id == user.id)
            .order_by(db.submissions.c.id.desc()).limit(RECENT)).all()
        accepted_times = connection.execute(
            select(db.submissions.c.created_at).where(
                db.submissions.c.user_id == user.id, db.submissions.c.status == 'done',
                db.submissions.c.verdict == scoring.ACCEPTED)).scalars().all()
        attempts = dict(connection.execute(
            select(db.submissions.c.slug, func.count()).where(db.submissions.c.user_id == user.id)
            .group_by(db.submissions.c.slug)).all())

    by_difficulty = {}
    for problem in challenges.PROBLEMS.values():
        level = by_difficulty.setdefault(problem['difficulty'], {'solved': 0, 'total': 0})
        level['total'] += 1
        level['solved'] += bool(record.get(problem['slug'], {}).get('solved'))
    unsolved = [
        {'slug': slug, 'title': challenges.PROBLEMS[slug]['title'],
         'difficulty': challenges.PROBLEMS[slug]['difficulty'], 'attempts': attempts.get(slug, 0)}
        for slug, entry in record.items() if entry['attempted'] and not entry['solved']
    ]
    return jsonify({
        'user': auth.public_user(user),
        'solved': sum(1 for entry in record.values() if entry['solved']),
        'imported_solved': sum(1 for entry in record.values()
                               if entry['solved'] and entry['source'] == 'imported'),
        'total': len(challenges.PROBLEMS),
        'by_difficulty': by_difficulty,
        'attempted_unsolved': unsolved,
        'recent': [summary_row(row) for row in recent],
        'streak': streaks.streaks(accepted_times, db.now_ms(), tz),
        'time_zone': getattr(tz, 'key', 'UTC'),
    })


# --- drafts ------------------------------------------------------------------

@bp.route('/api/drafts/<slug>', methods=['GET', 'PUT'])
@auth.login_required
def draft(slug):
    _, missing = challenges.find_problem(slug)
    if missing:
        return missing
    user = auth.current_user()
    key = and_(db.drafts.c.user_id == user.id, db.drafts.c.slug == slug)
    if request.method == 'GET':
        with db.engine.connect() as connection:
            row = connection.execute(select(db.drafts).where(key)).first()
        return jsonify({'draft': {'code': row.code, 'updated_at': row.updated_at} if row else None})
    if not auth.same_origin():
        return cross_site()
    data, unreadable = parse_body()
    if unreadable is not None:
        return bad_request(unreadable)
    source, invalid = read_code(data)
    if invalid:
        return invalid
    now = db.now_ms()
    with db.engine.begin() as connection:
        if connection.execute(select(db.drafts.c.slug).where(key)).first():
            connection.execute(update(db.drafts).where(key).values(code=source, updated_at=now))
        else:
            connection.execute(insert(db.drafts).values(user_id=user.id, slug=slug, code=source,
                                                        updated_at=now))
    return jsonify({'draft': {'code': source, 'updated_at': now}})


# --- one-time import of browser progress --------------------------------------

def _count(value):
    return value if type(value) is int and 0 <= value < 1 << 40 else None


@bp.route('/api/import', methods=['POST'])
@auth.login_required
def import_local():
    """Bring this browser's drafts and progress into the account, once.

    Imported results join the solved record. They are never submissions, so
    they do not count toward streaks or rankings.
    """
    if not auth.same_origin():
        return cross_site()
    user = auth.current_user()
    if user.imported_at is not None:
        return error_response(errors.payload(
            errors.REQUEST, 'Progress from this browser was already imported.'), 409)
    data, unreadable = parse_body()
    if unreadable is not None:
        return bad_request(unreadable)
    now = db.now_ms()
    imported = {'drafts': 0, 'progress': 0}
    with db.engine.begin() as connection:
        if not data.get('decline'):
            drafts = data.get('drafts') if isinstance(data.get('drafts'), dict) else {}
            for slug, value in drafts.items():
                code = value.get('code') if isinstance(value, dict) else value
                if slug not in challenges.PROBLEMS or not isinstance(code, str) \
                        or len(code.encode('utf-8', 'replace')) > (1 << 20):
                    continue
                key = and_(db.drafts.c.user_id == user.id, db.drafts.c.slug == slug)
                if connection.execute(select(db.drafts.c.slug).where(key)).first():
                    continue  # the account's own draft wins
                connection.execute(insert(db.drafts).values(user_id=user.id, slug=slug, code=code,
                                                            updated_at=now))
                imported['drafts'] += 1
            entries = data.get('progress') if isinstance(data.get('progress'), dict) else {}
            for slug, entry in entries.items():
                if slug not in challenges.PROBLEMS or not isinstance(entry, dict):
                    continue
                best = entry.get('best') if isinstance(entry.get('best'), dict) else {}
                solved = entry.get('solved') is True
                if not solved and entry.get('attempted') is not True:
                    continue
                instructions, memory = _count(best.get('instructions')), _count(best.get('memory_accesses'))
                counted = solved and instructions is not None and memory is not None
                connection.execute(insert(db.imported_progress).values(
                    user_id=user.id, slug=slug, solved=int(solved),
                    instructions=instructions if counted else None,
                    memory_accesses=memory if counted else None,
                    imported_at=now))
                imported['progress'] += 1
        connection.execute(update(db.users).where(db.users.c.id == user.id).values(imported_at=now))
    return jsonify({'imported': imported, 'declined': bool(data.get('decline'))})


def wait_for_judging(timeout=30):
    """Block until everything queued so far is judged, for tests."""
    _executor.submit(lambda: None).result(timeout=timeout)
