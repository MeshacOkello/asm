"""Accounts: Google sign-in, sessions, submissions, history, profile, streaks,
rankings, drafts and the one-time import of browser progress."""
import base64
import json
import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import testing
import accounts_api
import auth
import db
import rankings
import streaks
from app import PROBLEMS, app
from sqlalchemy import insert, select

FACT = PROBLEMS['recursive-factorial']
SUM_TO_N = PROBLEMS['sum-to-n']
GOOGLE = {'GOOGLE_CLIENT_ID': 'client-123.apps.googleusercontent.com',
          'GOOGLE_CLIENT_SECRET': 'secret', 'AUTH_DEV_LOGIN': '0'}


def id_token(**claims):
    body = {'iss': 'https://accounts.google.com', 'aud': GOOGLE['GOOGLE_CLIENT_ID'],
            'exp': time.time() + 600, 'sub': 'google-42', 'email': 'ada@example.com',
            'name': 'Ada Lovelace', 'picture': 'https://example.com/a.png', **claims}
    encode = lambda part: base64.urlsafe_b64encode(json.dumps(part).encode()).rstrip(b'=').decode()  # noqa: E731
    return f'{encode({"alg": "RS256"})}.{encode(body)}.signature'


def slower_sum(extra):
    """sum-to-n's reference with `extra` wasted instructions per call."""
    body = SUM_TO_N['reference'].split('sumToN:\n', 1)[1]
    return 'sumToN:\n' + '        mov     x2, x2\n' * extra + body


class GoogleSignInTests(unittest.TestCase):
    def setUp(self):
        self.client = testing.isolated_client(self, **GOOGLE)

    def begin(self, next_route='/#/problems/sum-to-n'):
        response = self.client.get(f'/auth/login?next={quote(next_route, safe="")}')
        self.assertEqual(response.status_code, 302)
        location = urlparse(response.headers['Location'])
        self.assertEqual(location.netloc, 'accounts.google.com')
        return parse_qs(location.query)

    def finish(self, state, claims=None):
        with mock.patch.object(auth, 'exchange_code',
                               return_value={'id_token': id_token(**(claims or {}))}) as exchange:
            response = self.client.get(f'/auth/callback?state={state}&code=the-code')
        return response, exchange

    def test_login_returns_to_the_problem_signed_in(self):
        query = self.begin()
        self.assertEqual(query['client_id'], [GOOGLE['GOOGLE_CLIENT_ID']])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(query['redirect_uri'], ['http://localhost/auth/callback'])
        response, exchange = self.finish(query['state'][0])
        self.assertEqual(response.headers['Location'], '/#/problems/sum-to-n')
        exchange.assert_called_once()
        cookie = response.headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        user = self.client.get('/api/me').get_json()['user']
        self.assertEqual((user['name'], user['email']), ('Ada Lovelace', 'ada@example.com'))
        self.assertEqual(user['avatar_url'], 'https://example.com/a.png')

    def test_the_session_is_stored_hashed_on_the_server(self):
        response, _ = self.finish(self.begin()['state'][0])
        token = response.headers['Set-Cookie'].split(';')[0].split('=', 1)[1]
        with db.engine.connect() as connection:
            hashes = connection.execute(select(db.sessions.c.token_hash)).scalars().all()
        self.assertEqual(hashes, [auth.hash_token(token)])
        self.assertNotIn(token, hashes)

    def test_a_second_login_updates_the_same_account(self):
        self.finish(self.begin()['state'][0])
        self.finish(self.begin()['state'][0], {'name': 'Ada King'})
        with db.engine.connect() as connection:
            self.assertEqual(connection.execute(select(db.users.c.name)).scalars().all(), ['Ada King'])

    def test_state_must_match(self):
        self.begin()
        response, exchange = self.finish('forged-state')
        self.assertIn('login_error', response.headers['Location'])
        exchange.assert_not_called()
        self.assertIsNone(self.client.get('/api/me').get_json()['user'])

    def test_a_token_for_another_app_or_expired_is_refused(self):
        for claims in ({'aud': 'someone-else'}, {'exp': time.time() - 5},
                       {'iss': 'https://evil.example'}):
            with self.subTest(claims=claims):
                response, _ = self.finish(self.begin()['state'][0], claims)
                self.assertIn('login_error', response.headers['Location'])
                self.assertIsNone(self.client.get('/api/me').get_json()['user'])

    def test_next_cannot_leave_the_app(self):
        for target in ('https://evil.example/', '//evil.example', '/#/problems?x=<b>', 'javascript:alert(1)'):
            with self.subTest(target=target):
                state = self.begin(target)['state'][0]
                response, _ = self.finish(state)
                self.assertEqual(response.headers['Location'], '/#/problems')

    def test_logout_ends_the_session_on_the_server(self):
        response, _ = self.finish(self.begin()['state'][0])
        token = response.headers['Set-Cookie'].split(';')[0].split('=', 1)[1]
        self.assertEqual(self.client.post('/auth/logout').status_code, 200)
        self.assertIsNone(self.client.get('/api/me').get_json()['user'])
        # The old token is useless even if it was copied before signing out.
        self.client.set_cookie(auth.COOKIE, token)
        self.assertIsNone(self.client.get('/api/me').get_json()['user'])

    def test_dev_login_is_off_unless_enabled(self):
        self.assertEqual(self.client.get('/auth/dev-login').status_code, 404)

    def test_login_without_credentials_explains(self):
        app.config.update(GOOGLE_CLIENT_ID='', GOOGLE_CLIENT_SECRET='')
        response = self.client.get('/auth/login')
        self.assertIn('login_error', response.headers['Location'])


class GoogleErrorMessageTests(unittest.TestCase):
    """A failed token exchange says why, not just that it failed."""

    def setUp(self):
        testing.isolated_client(self, **GOOGLE)

    def http_error(self, body):
        import io
        import urllib.error
        return urllib.error.HTTPError(auth.GOOGLE_TOKEN, 400, 'Bad Request', {},
                                      io.BytesIO(json.dumps(body).encode()))

    def message(self, error):
        with app.test_request_context('/auth/callback'):
            return auth.google_error_message(error)

    def test_google_refusals_name_the_reason_and_the_fix(self):
        text = self.message(self.http_error({'error': 'redirect_uri_mismatch'}))
        self.assertIn('redirect_uri_mismatch', text)
        self.assertIn('http://localhost/auth/callback', text)
        text = self.message(self.http_error({'error': 'invalid_client',
                                             'error_description': 'The OAuth client was not found.'}))
        self.assertIn('The OAuth client was not found.', text)
        self.assertIn('GOOGLE_CLIENT_SECRET', text)

    def test_certificate_failures_say_how_to_fix_them(self):
        import ssl
        import urllib.error
        error = urllib.error.URLError(ssl.SSLCertVerificationError(1, 'certificate verify failed'))
        self.assertIn('certifi', self.message(error))

    def test_the_tls_context_verifies_certificates(self):
        import ssl
        context = auth.tls_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.client = testing.isolated_client(self)

    def test_run_works_signed_out_but_submit_needs_an_account(self):
        run = self.client.post('/problems/sum-to-n/run', json={'code': SUM_TO_N['reference']})
        self.assertEqual(run.get_json()['verdict'], 'accepted')
        response = self.client.post('/problems/sum-to-n/submit', json={'code': SUM_TO_N['reference']})
        self.assertEqual(response.status_code, 401)
        self.assertTrue(response.get_json()['login_required'])
        with db.engine.connect() as connection:
            self.assertEqual(connection.execute(select(db.submissions)).all(), [])

    def test_accepted_submission_is_saved_with_its_score(self):
        testing.sign_in(self.client)
        data = testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference']).get_json()
        self.assertEqual((data['status'], data['verdict'], data['passed'], data['total']),
                         ('done', 'accepted', 8, 8))
        self.assertEqual(data['code'], SUM_TO_N['reference'])
        self.assertEqual(data['score']['medal'], 'gold')
        self.assertEqual(data['instructions'], data['score']['reference']['instructions'])
        self.assertIsNone(data['ranking'])   # too few students yet
        self.assertIsNone(data['first_failure'])

    def test_failed_submission_points_at_the_first_failing_test(self):
        testing.sign_in(self.client)
        data = testing.submit(self.client, 'recursive-factorial', FACT['starter']).get_json()
        self.assertEqual(data['verdict'], 'wrong_answer')
        self.assertEqual(data['first_failure'], 2)
        self.assertFalse(data['results'][2]['passed'])

    def test_stored_results_keep_hidden_tests_secret(self):
        testing.sign_in(self.client)
        response = testing.submit(self.client, 'recursive-factorial', FACT['starter'])
        with db.engine.connect() as connection:
            stored = connection.execute(select(db.submissions.c.result_json)).scalar()
        for text in (response.get_data(as_text=True), stored):
            self.assertNotIn(FACT['reference'].strip(), text)
            for test in FACT['tests']:
                if not test['visible']:
                    self.assertNotIn(f'"{test["id"]}"', text)
                    value = str(test['expected']['x0'])
                    if len(value) >= 4:   # distinctive enough to mean a leak
                        self.assertNotIn(value, text)
        hidden = [r for r in response.get_json()['results'] if not r['visible']]
        self.assertTrue(all(set(r) == {'name', 'visible', 'passed', 'kind', 'kind_label', 'message'}
                            for r in hidden))

    def test_submissions_are_private_to_their_owner(self):
        testing.sign_in(self.client, 'Ada')
        mine = testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference']).get_json()['id']
        other = app.test_client()
        testing.sign_in(other, 'Grace')
        self.assertEqual(other.get(f'/api/submissions/{mine}').status_code, 404)
        self.assertEqual(other.get(f'/api/submissions/{mine + 999}').status_code, 404)
        self.assertEqual(other.get('/api/problems/sum-to-n/submissions').get_json()['submissions'], [])
        self.assertEqual(app.test_client().get(f'/api/submissions/{mine}').status_code, 401)

    def test_history_lists_attempts_newest_first(self):
        testing.sign_in(self.client)
        first = testing.submit(self.client, 'sum-to-n', SUM_TO_N['starter']).get_json()
        second = testing.submit(self.client, 'sum-to-n', slower_sum(1)).get_json()
        third = testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference']).get_json()
        rows = self.client.get('/api/problems/sum-to-n/submissions').get_json()['submissions']
        self.assertEqual([row['id'] for row in rows], [third['id'], second['id'], first['id']])
        self.assertEqual([row['verdict_label'] for row in rows], ['Accepted', 'Accepted', 'Wrong answer'])
        self.assertNotIn('code', rows[0])
        self.assertEqual(rows[0]['instructions'], third['instructions'])
        # Compare defaults to the attempt just before; any earlier one can be picked.
        self.assertEqual([row['id'] for row in third['earlier']], [second['id'], first['id']])
        self.assertEqual(first['earlier'], [])

    def test_one_submission_at_a_time(self):
        user = testing.sign_in(self.client)
        with db.engine.begin() as connection:
            connection.execute(insert(db.submissions).values(
                user_id=user['id'], slug='sum-to-n', code='x', status='judging', created_at=db.now_ms()))
        response = self.client.post('/problems/sum-to-n/submit', json={'code': SUM_TO_N['reference']})
        self.assertEqual(response.status_code, 429)

    def test_cross_site_requests_are_refused(self):
        testing.sign_in(self.client)
        response = self.client.post('/problems/sum-to-n/submit', json={'code': 'x'},
                                    headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status_code, 403)
        same = self.client.post('/problems/sum-to-n/submit', json={'code': SUM_TO_N['reference']},
                                headers={'Origin': 'http://localhost'})
        self.assertEqual(same.status_code, 202)

    def test_judging_runs_in_the_background(self):
        app.config['JUDGE_INLINE'] = False
        testing.sign_in(self.client)
        created = self.client.post('/problems/sum-to-n/submit', json={'code': SUM_TO_N['reference']})
        self.assertEqual(created.get_json()['status'], 'judging')
        accounts_api.wait_for_judging()
        data = self.client.get(f'/api/submissions/{created.get_json()["id"]}').get_json()
        self.assertEqual((data['status'], data['verdict']), ('done', 'accepted'))

    def test_unfinished_submissions_are_judged_after_a_restart(self):
        user = testing.sign_in(self.client)
        with db.engine.begin() as connection:
            connection.execute(insert(db.submissions).values(
                user_id=user['id'], slug='sum-to-n', code=SUM_TO_N['reference'],
                status='judging', created_at=db.now_ms()))
        self.assertEqual(len(accounts_api.requeue_unfinished()), 1)
        accounts_api.wait_for_judging()
        rows = self.client.get('/api/problems/sum-to-n/submissions').get_json()['submissions']
        self.assertEqual(rows[0]['verdict'], 'accepted')


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.client = testing.isolated_client(self)
        self.user = testing.sign_in(self.client)

    def backdate(self, submission_id, when):
        with db.engine.begin() as connection:
            connection.execute(db.submissions.update().where(db.submissions.c.id == submission_id)
                               .values(created_at=int(when.timestamp() * 1000)))

    def test_counts_unsolved_and_recent(self):
        testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference'])
        testing.submit(self.client, 'recursive-factorial', FACT['starter'])
        testing.submit(self.client, 'recursive-factorial', FACT['starter'])
        data = self.client.get('/api/profile?tz=UTC').get_json()
        self.assertEqual((data['solved'], data['total']), (1, len(PROBLEMS)))
        self.assertEqual(data['by_difficulty']['easy'], {'solved': 1, 'total': 3})
        self.assertEqual(data['by_difficulty']['medium'], {'solved': 0, 'total': 3})
        self.assertEqual([(p['slug'], p['attempts']) for p in data['attempted_unsolved']],
                         [('recursive-factorial', 2)])
        self.assertEqual([r['slug'] for r in data['recent']],
                         ['recursive-factorial', 'recursive-factorial', 'sum-to-n'])
        self.assertEqual(data['streak']['current'], 1)

    def test_streak_uses_the_students_time_zone(self):
        tz = ZoneInfo('America/New_York')
        today = datetime.now(tz)
        ids = [testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference']).get_json()['id']
               for _ in range(3)]
        # 11 pm yesterday and the day before, New York time: 4 am UTC the next day.
        for submission_id, days in zip(ids, (1, 2, 4)):
            self.backdate(submission_id, (today - timedelta(days=days)).replace(hour=23, minute=0))
        new_york = self.client.get('/api/profile?tz=America/New_York').get_json()['streak']
        self.assertEqual((new_york['current'], new_york['longest']), (2, 2))
        self.assertFalse(new_york['active_today'])
        # In UTC the same moments fall a day later: one of them is today.
        utc = self.client.get('/api/profile?tz=UTC').get_json()['streak']
        self.assertTrue(utc['active_today'] or utc['current'] >= 1)

    def test_failed_submissions_do_not_make_a_streak(self):
        testing.submit(self.client, 'recursive-factorial', FACT['starter'])
        self.assertEqual(self.client.get('/api/profile').get_json()['streak']['current'], 0)

    def test_unknown_time_zone_falls_back_to_utc(self):
        self.assertEqual(self.client.get('/api/profile?tz=Mars/Base').get_json()['time_zone'], 'UTC')


class StreakTests(unittest.TestCase):
    tz = timezone.utc

    def at(self, day, hour=12):
        return int(datetime(2026, 3, day, hour, tzinfo=self.tz).timestamp() * 1000)

    def test_today_extends_the_run(self):
        result = streaks.streaks([self.at(8), self.at(9), self.at(10)], self.at(10, 20), self.tz)
        self.assertEqual(result, {'current': 3, 'longest': 3, 'active_today': True})

    def test_yesterday_keeps_the_streak_for_the_rest_of_today(self):
        result = streaks.streaks([self.at(8), self.at(9)], self.at(10, 23), self.tz)
        self.assertEqual((result['current'], result['active_today']), (2, False))

    def test_a_missed_day_ends_it(self):
        self.assertEqual(streaks.streaks([self.at(7), self.at(8)], self.at(10), self.tz)['current'], 0)

    def test_longest_is_the_best_run_ever(self):
        days = [1, 2, 3, 4, 7, 8, 10]
        result = streaks.streaks([self.at(d) for d in days] + [self.at(2, 18)], self.at(10), self.tz)
        self.assertEqual((result['current'], result['longest']), (1, 4))

    def test_local_midnight_decides_the_day(self):
        tokyo = ZoneInfo('Asia/Tokyo')
        # 23:30 UTC on the 8th is 08:30 on the 9th in Tokyo.
        late = int(datetime(2026, 3, 8, 23, 30, tzinfo=timezone.utc).timestamp() * 1000)
        early = int(datetime(2026, 3, 9, 1, tzinfo=timezone.utc).timestamp() * 1000)
        self.assertEqual(streaks.streaks([late, early], early, timezone.utc)['longest'], 2)
        self.assertEqual(streaks.streaks([late, early], early, tokyo)['longest'], 1)

    def test_nothing(self):
        self.assertEqual(streaks.streaks([], self.at(10), self.tz),
                         {'current': 0, 'longest': 0, 'active_today': False})


class RankingTests(unittest.TestCase):
    def test_hidden_below_the_threshold(self):
        accepted = [(user, 10, 1) for user in range(9)]
        self.assertIsNone(rankings.ranking({'instructions': 5, 'memory_accesses': 0}, 0, accepted, 10))

    def test_counts_only_strictly_worse_best_results(self):
        # Users 1-10; user 0 is the owner. Each user's best is by instructions,
        # then memory: user 1's best is (8, 9), not (9, 0).
        accepted = [(0, 10, 5), (1, 9, 0), (1, 8, 9), (2, 10, 5), (3, 12, 5)] + \
            [(user, 20, 1) for user in range(4, 11)]
        result = rankings.ranking({'instructions': 10, 'memory_accesses': 5}, 0, accepted, 10)
        self.assertEqual(result['users'], 11)
        self.assertEqual(result['compared'], 10)
        # Worse on instructions: user 3 (12) and users 4-10 (20); tie with user 2 does not count.
        self.assertEqual((result['instructions']['beats'], result['instructions']['worse']), (80, 8))
        # Worse on memory: only user 1 (9); user 2 and 3 tie at 5.
        self.assertEqual((result['memory_accesses']['beats'], result['memory_accesses']['worse']), (10, 1))

    def test_the_owners_own_results_are_not_compared(self):
        accepted = [(0, 5, 5), (0, 50, 50)] + [(user, 5, 5) for user in range(1, 10)]
        result = rankings.ranking({'instructions': 50, 'memory_accesses': 50}, 0, accepted, 10)
        self.assertEqual(result['instructions']['beats'], 0)

    def test_distribution_bars_cover_every_student(self):
        result = rankings.histogram([10, 10, 12, 40], 11)
        bars = result['bars']
        self.assertEqual(sum(bar['users'] for bar in bars), 4)
        self.assertEqual((bars[0]['low'], bars[-1]['high'] >= 40), (10, True))
        yours = bars[result['yours']]
        self.assertTrue(yours['low'] <= 11 <= yours['high'])
        self.assertLessEqual(len(bars), rankings.MAX_BARS)
        wide = rankings.histogram(list(range(0, 10_000, 7)), 5000)
        self.assertLessEqual(len(wide['bars']), rankings.MAX_BARS)
        self.assertEqual(sum(bar['users'] for bar in wide['bars']), len(range(0, 10_000, 7)))
        single = rankings.histogram([5, 5], 5)
        self.assertEqual(single, {'bars': [{'low': 5, 'high': 5, 'users': 2}], 'yours': 0})

    def test_threshold_is_configurable(self):
        with mock.patch.dict(os.environ, {'RANKING_MIN_USERS': '3'}):
            self.assertEqual(rankings.min_users(), 3)
        with mock.patch.dict(os.environ, {'RANKING_MIN_USERS': 'lots'}):
            self.assertEqual(rankings.min_users(), rankings.DEFAULT_MIN_USERS)

    def test_submission_page_shows_rankings_once_enough_students_solved_it(self):
        client = testing.isolated_client(self)
        with mock.patch.dict(os.environ, {'RANKING_MIN_USERS': '4'}):
            for index, extra in enumerate((0, 2, 4)):
                other = app.test_client()
                testing.sign_in(other, f'Student {index}')
                testing.submit(other, 'sum-to-n', slower_sum(extra))
            testing.sign_in(client, 'Me')
            below = testing.submit(client, 'recursive-factorial', FACT['reference']).get_json()
            self.assertIsNone(below['ranking'])
            mine = testing.submit(client, 'sum-to-n', slower_sum(1)).get_json()
        ranking = mine['ranking']
        self.assertEqual((ranking['users'], ranking['compared']), (4, 3))
        # Two of three others used more instructions; all tie on memory accesses.
        self.assertEqual((ranking['instructions']['beats'], ranking['instructions']['worse']), (66, 2))
        self.assertEqual((ranking['memory_accesses']['beats'], ranking['memory_accesses']['worse']), (0, 0))
        self.assertEqual(sum(bar['users'] for bar in ranking['instructions']['distribution']['bars']), 3)
        self.assertEqual(mine['score']['medal'], 'silver')


class ImportAndDraftTests(unittest.TestCase):
    def setUp(self):
        self.client = testing.isolated_client(self)
        self.user = testing.sign_in(self.client)

    def test_import_happens_once_and_joins_the_solved_record(self):
        self.assertTrue(self.user['can_import'])
        payload = {
            'drafts': {'sum-to-n': {'code': 'sumToN:\n        ret\n'}, 'nope': {'code': 'x'}},
            'progress': {
                'array-max': {'attempted': True, 'solved': True,
                              'best': {'medal': 'gold', 'instructions': 5, 'memory_accesses': 2}},
                'string-length': {'attempted': True, 'solved': False, 'best': None},
                'not-a-problem': {'solved': True, 'best': {'medal': 'gold'}},
            },
        }
        result = self.client.post('/api/import', json=payload).get_json()
        self.assertEqual(result['imported'], {'drafts': 1, 'progress': 2})
        self.assertEqual(self.client.post('/api/import', json=payload).status_code, 409)
        self.assertFalse(self.client.get('/api/me').get_json()['user']['can_import'])

        progress = self.client.get('/api/progress').get_json()['progress']
        self.assertEqual(progress['array-max']['best']['medal'], 'gold')
        self.assertEqual(progress['array-max']['source'], 'imported')
        self.assertFalse(progress['string-length']['solved'])
        profile = self.client.get('/api/profile').get_json()
        self.assertEqual((profile['solved'], profile['imported_solved']), (1, 1))
        # Imported results are not graded submissions: no streak, no ranking entry.
        self.assertEqual(profile['streak']['current'], 0)
        self.assertEqual(profile['recent'], [])
        self.assertEqual(self.client.get('/api/drafts/sum-to-n').get_json()['draft']['code'],
                         'sumToN:\n        ret\n')

    def test_a_graded_solve_replaces_the_imported_one(self):
        self.client.post('/api/import', json={'progress': {'sum-to-n': {
            'solved': True, 'best': {'medal': 'bronze', 'instructions': 1, 'memory_accesses': 1}}}})
        testing.submit(self.client, 'sum-to-n', SUM_TO_N['reference'])
        entry = self.client.get('/api/progress').get_json()['progress']['sum-to-n']
        self.assertEqual((entry['source'], entry['best']['medal']), ('server', 'gold'))

    def test_declining_also_ends_the_offer(self):
        self.client.post('/api/import', json={'decline': True})
        self.assertFalse(self.client.get('/api/me').get_json()['user']['can_import'])

    def test_drafts_are_per_user(self):
        self.assertIsNone(self.client.get('/api/drafts/sum-to-n').get_json()['draft'])
        saved = self.client.put('/api/drafts/sum-to-n', json={'code': 'mine'}).get_json()['draft']
        self.assertEqual(saved['code'], 'mine')
        self.client.put('/api/drafts/sum-to-n', json={'code': 'mine, edited'})
        self.assertEqual(self.client.get('/api/drafts/sum-to-n').get_json()['draft']['code'], 'mine, edited')
        other = app.test_client()
        testing.sign_in(other, 'Someone Else')
        self.assertIsNone(other.get('/api/drafts/sum-to-n').get_json()['draft'])
        self.assertEqual(app.test_client().get('/api/drafts/sum-to-n').status_code, 401)
        self.assertEqual(self.client.put('/api/drafts/nope', json={'code': 'x'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
