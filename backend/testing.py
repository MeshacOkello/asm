"""Test helpers: a throwaway database per test, inline judging, quick sign-in."""
import os
import shutil
import tempfile

# Set before app is imported anywhere, so no test touches a real database or
# leaves grading threads behind.
os.environ.setdefault('JUDGE_REQUEUE', '0')
_root = tempfile.mkdtemp(prefix='av-tests-')
os.environ.setdefault('DATABASE_URL', f'sqlite:///{_root}/import.db')

import db  # noqa: E402
from app import app  # noqa: E402


def isolated_client(testcase, **config):
    """A test client on a fresh database, judging submissions synchronously."""
    directory = tempfile.mkdtemp(prefix='av-db-')
    testcase.addCleanup(shutil.rmtree, directory, ignore_errors=True)
    db.init(f'sqlite:///{directory}/test.db')
    previous = dict(app.config)
    app.config.update({'TESTING': True, 'JUDGE_INLINE': True, 'AUTH_DEV_LOGIN': '1', **config})
    testcase.addCleanup(lambda: (app.config.clear(), app.config.update(previous)))
    return app.test_client()


def sign_in(client, name='Ada Lovelace'):
    """Sign in through the development login and return the user."""
    response = client.get(f'/auth/dev-login?name={name}&next=/%23/problems')
    assert response.status_code == 302, response.status_code
    return client.get('/api/me').get_json()['user']


def submit(client, slug, code):
    """Submit, then return the stored submission's response once judged."""
    created = client.post(f'/problems/{slug}/submit', json={'code': code})
    assert created.status_code == 202, created.get_json()
    return client.get(f'/api/submissions/{created.get_json()["id"]}')
