"""Google sign-in and server-managed sessions.

The browser holds one random token in an HttpOnly cookie; the database keeps
only its SHA-256, the user it belongs to, and when it expires. Signing out
deletes the row, so a session ends on the server, not just in the browser.

Sign-in is Google's OAuth 2.0 authorization-code flow with PKCE. The ID token
comes straight from Google's token endpoint over TLS, which OpenID Connect
accepts in place of checking its signature (Core 1.0, section 3.1.3.7); its
issuer, audience and expiry are still checked.

Configuration, from the environment:
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the OAuth client
    PUBLIC_URL        the site's origin, for the redirect URI (default: the
                      request's own, which suits local development)
    SECRET_KEY        signs the short-lived OAuth state cookie
    AUTH_DEV_LOGIN=1  enables /auth/dev-login, a sign-in without Google for
                      local development only. Never set it in production.
"""
import base64
import functools
import hashlib
import json
import os
import re
import secrets
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, current_app, g, jsonify, redirect, request, session
from sqlalchemy import delete, insert, select, update

import db
import errors

bp = Blueprint('auth', __name__)

GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
GOOGLE_ISSUERS = ('https://accounts.google.com', 'accounts.google.com')
COOKIE = 'av_session'
SESSION_DAYS = 30
DAY_MS = 24 * 60 * 60 * 1000
# Where a sign-in may return to: a hash route of this app, nothing else, so
# the login link cannot be used to send anyone to another site.
NEXT_ROUTE = re.compile(r'^/#/[A-Za-z0-9_\-/]*$')
DEFAULT_NEXT = '/#/problems'


class GoogleError(Exception):
    """Google refused the code, or answered with something unusable."""


def setting(name, default=None):
    return current_app.config.get(name, os.environ.get(name, default))


def safe_next(value):
    return value if isinstance(value, str) and NEXT_ROUTE.match(value) else DEFAULT_NEXT


def public_url():
    return (setting('PUBLIC_URL') or request.host_url).rstrip('/')


def redirect_uri():
    return f'{public_url()}/auth/callback'


def secure_cookies():
    flag = setting('SESSION_COOKIE_SECURE')
    if flag is not None:
        return str(flag).lower() in ('1', 'true', 'yes')
    return public_url().startswith('https://')


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


# --- users and sessions ------------------------------------------------------

def public_user(row):
    return {
        'id': row.id, 'name': row.name or row.email or 'Student', 'email': row.email,
        'avatar_url': row.avatar_url, 'can_import': row.imported_at is None,
    }


def upsert_user(sub, email, name, avatar_url):
    with db.engine.begin() as connection:
        row = connection.execute(select(db.users).where(db.users.c.google_sub == sub)).first()
        if row is None:
            connection.execute(insert(db.users).values(
                google_sub=sub, email=email, name=name, avatar_url=avatar_url,
                created_at=db.now_ms()))
        else:
            connection.execute(update(db.users).where(db.users.c.id == row.id).values(
                email=email, name=name, avatar_url=avatar_url))
        return connection.execute(select(db.users).where(db.users.c.google_sub == sub)).first()


def start_session(response, user_id):
    token = secrets.token_urlsafe(32)
    now = db.now_ms()
    with db.engine.begin() as connection:
        connection.execute(insert(db.sessions).values(
            token_hash=hash_token(token), user_id=user_id, created_at=now,
            expires_at=now + SESSION_DAYS * DAY_MS))
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 24 * 3600, httponly=True,
                        secure=secure_cookies(), samesite='Lax', path='/')
    return response


def current_user():
    """The signed-in user's row, or None. Looked up once per request."""
    if 'user' in g:
        return g.user
    g.user = None
    token = request.cookies.get(COOKIE)
    if token:
        with db.engine.connect() as connection:
            g.user = connection.execute(
                select(db.users).join(db.sessions, db.sessions.c.user_id == db.users.c.id)
                .where(db.sessions.c.token_hash == hash_token(token),
                       db.sessions.c.expires_at > db.now_ms())
            ).first()
    return g.user


def sign_in_required():
    return jsonify({
        'error': 'Sign in to do this.',
        'error_info': errors.payload(errors.REQUEST, 'Sign in to do this.',
                                     suggestion='Sign in with Google, then try again.'),
        'login_required': True,
    }), 401


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return sign_in_required()
        return view(*args, **kwargs)
    return wrapped


def same_origin():
    """Refuse a state-changing request sent by another site.

    The session cookie is SameSite=Lax and these endpoints take JSON, which
    already stops a cross-site form; this checks the Origin header as well.
    """
    origin = request.headers.get('Origin')
    if not origin:
        return True
    allowed = {request.host_url.rstrip('/'), public_url()}
    return origin.rstrip('/') in allowed


# --- Google ------------------------------------------------------------------

def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _claims(id_token):
    try:
        payload = id_token.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise GoogleError('Google sent an ID token that could not be read.') from None


def tls_context():
    """Verify Google's certificate against certifi's roots when available.

    The python.org builds of Python for macOS ship without trusted root
    certificates until "Install Certificates.command" is run, so the system
    default would reject every HTTPS connection to Google.
    """
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def google_error_message(error):
    """Why the token request failed, in words a developer can act on."""
    if isinstance(error, urllib.error.HTTPError):
        try:
            body = json.loads(error.read() or b'{}')
        except ValueError:
            body = {}
        reason = body.get('error_description') or body.get('error') or f'HTTP {error.code}'
        hint = {
            'redirect_uri_mismatch': f' Add {redirect_uri()} as an authorized redirect URI of the OAuth client.',
            'invalid_client': ' Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        }.get(body.get('error'), '')
        return f'Google refused the sign-in: {reason}.{hint}'
    reason = getattr(error, 'reason', error)
    if isinstance(reason, ssl.SSLCertVerificationError):
        return ('The server could not verify Google\'s certificate. Install certifi in the '
                'backend\'s Python, or run "Install Certificates.command" for python.org Python on macOS.')
    if isinstance(error, ValueError):
        return 'Google answered the sign-in with something that was not JSON.'
    return f'The server could not reach Google ({reason}).'


def exchange_code(code, verifier):
    """Trade the authorization code for Google's ID token claims."""
    body = urllib.parse.urlencode({
        'code': code, 'client_id': setting('GOOGLE_CLIENT_ID'),
        'client_secret': setting('GOOGLE_CLIENT_SECRET'), 'redirect_uri': redirect_uri(),
        'grant_type': 'authorization_code', 'code_verifier': verifier,
    }).encode()
    token_request = urllib.request.Request(
        GOOGLE_TOKEN, data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(token_request, timeout=10, context=tls_context()) as response:
            tokens = json.loads(response.read())
    except (urllib.error.URLError, ValueError) as error:
        raise GoogleError(google_error_message(error)) from None
    return tokens


def verified_claims(tokens):
    claims = _claims(tokens.get('id_token', ''))
    if claims.get('iss') not in GOOGLE_ISSUERS:
        raise GoogleError('The ID token was not issued by Google.')
    if claims.get('aud') != setting('GOOGLE_CLIENT_ID'):
        raise GoogleError('The ID token was issued for another application.')
    if not isinstance(claims.get('exp'), (int, float)) or claims['exp'] < time.time():
        raise GoogleError('The ID token has expired.')
    if not claims.get('sub'):
        raise GoogleError('The ID token names no account.')
    return claims


def login_failed(message):
    return redirect(f'/#/problems?login_error={urllib.parse.quote(message)}')


@bp.route('/auth/login')
def login():
    next_route = safe_next(request.args.get('next'))
    if not setting('GOOGLE_CLIENT_ID') or not setting('GOOGLE_CLIENT_SECRET'):
        if str(setting('AUTH_DEV_LOGIN', '')) == '1':
            return redirect(f'/auth/dev-login?next={urllib.parse.quote(next_route)}')
        return login_failed('Google sign-in is not configured on this server.')
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    session['oauth'] = {'state': state, 'verifier': verifier, 'next': next_route}
    query = urllib.parse.urlencode({
        'client_id': setting('GOOGLE_CLIENT_ID'), 'redirect_uri': redirect_uri(),
        'response_type': 'code', 'scope': 'openid email profile', 'state': state,
        'code_challenge': _b64url(hashlib.sha256(verifier.encode()).digest()),
        'code_challenge_method': 'S256', 'prompt': 'select_account',
    })
    return redirect(f'{GOOGLE_AUTHORIZE}?{query}')


@bp.route('/auth/callback')
def callback():
    pending = session.pop('oauth', None)
    if not pending or not secrets.compare_digest(str(request.args.get('state', '')), pending['state']):
        return login_failed('The sign-in expired or did not start here. Try again.')
    if request.args.get('error') or not request.args.get('code'):
        return login_failed('Google sign-in was cancelled.')
    try:
        claims = verified_claims(exchange_code(request.args['code'], pending['verifier']))
    except GoogleError as error:
        current_app.logger.warning('Google sign-in failed: %s', error)
        return login_failed(str(error))
    user = upsert_user(claims['sub'], claims.get('email'), claims.get('name'), claims.get('picture'))
    return start_session(redirect(pending['next']), user.id)


@bp.route('/auth/dev-login')
def dev_login():
    """Sign in as a made-up user, for development without Google credentials."""
    if str(setting('AUTH_DEV_LOGIN', '')) != '1':
        return jsonify({'error': 'Not found.'}), 404
    name = (request.args.get('name') or 'Dev Student').strip()[:60] or 'Dev Student'
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'student'
    user = upsert_user(f'dev:{slug}', f'{slug}@example.test', name, None)
    return start_session(redirect(safe_next(request.args.get('next'))), user.id)


@bp.route('/auth/logout', methods=['POST'])
def logout():
    if not same_origin():
        return jsonify({'error': 'Cross-site request refused.'}), 403
    token = request.cookies.get(COOKIE)
    if token:
        with db.engine.begin() as connection:
            connection.execute(delete(db.sessions).where(db.sessions.c.token_hash == hash_token(token)))
    response = jsonify({'ok': True})
    response.delete_cookie(COOKIE, path='/')
    return response


@bp.route('/api/me')
def me():
    user = current_user()
    return jsonify({'user': public_user(user) if user else None,
                    'google_configured': bool(setting('GOOGLE_CLIENT_ID'))
                    or str(setting('AUTH_DEV_LOGIN', '')) == '1'})
