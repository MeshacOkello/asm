"""Account data: users, sessions, submissions, drafts and imported progress.

SQLAlchemy Core over whatever DATABASE_URL names: a SQLite file by default
(and in tests), or a hosted Postgres in production, since free web hosts do
not keep their disks between deploys. Tables are created on startup; there
are no migrations yet.

Times are stored as integer milliseconds since the epoch, UTC, which every
database compares and sorts the same way.
"""
import json
import os
import time
from pathlib import Path

from sqlalchemy import (
    BigInteger, Column, ForeignKey, Integer, MetaData, String, Table, Text, UniqueConstraint,
    create_engine, event,
)

DEFAULT_URL = f'sqlite:///{Path(__file__).parent / "data" / "app.db"}'

metadata = MetaData()

users = Table(
    'users', metadata,
    Column('id', Integer, primary_key=True),
    Column('google_sub', String(255), nullable=False, unique=True),
    Column('email', String(320)),
    Column('name', String(255)),
    Column('avatar_url', Text),
    Column('created_at', BigInteger, nullable=False),
    # Set once local progress has been imported (or the offer declined).
    Column('imported_at', BigInteger),
)

sessions = Table(
    'sessions', metadata,
    # SHA-256 of the cookie's token: a leaked table holds no usable session.
    Column('token_hash', String(64), primary_key=True),
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
    Column('created_at', BigInteger, nullable=False),
    Column('expires_at', BigInteger, nullable=False),
)

submissions = Table(
    'submissions', metadata,
    Column('id', Integer, primary_key=True),
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
    Column('slug', String(100), nullable=False, index=True),
    Column('code', Text, nullable=False),
    # judging -> done, or error if the grader itself failed.
    Column('status', String(16), nullable=False),
    Column('verdict', String(32)),
    Column('passed', Integer),
    Column('total', Integer),
    Column('instructions', Integer),
    Column('memory_accesses', Integer),
    # The redacted, client-safe result: hidden tests carry only their number
    # and failure kind, so nothing secret is ever stored with a submission.
    Column('result_json', Text),
    Column('created_at', BigInteger, nullable=False, index=True),
    Column('finished_at', BigInteger),
)

drafts = Table(
    'drafts', metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('slug', String(100), primary_key=True),
    Column('code', Text, nullable=False),
    Column('updated_at', BigInteger, nullable=False),
)

# Progress brought over from a browser's localStorage. It counts toward the
# solved record, never toward streaks or rankings, which come only from
# submissions graded here.
imported_progress = Table(
    'imported_progress', metadata,
    Column('id', Integer, primary_key=True),
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
    Column('slug', String(100), nullable=False),
    Column('solved', Integer, nullable=False),
    Column('instructions', Integer),
    Column('memory_accesses', Integer),
    Column('imported_at', BigInteger, nullable=False),
    UniqueConstraint('user_id', 'slug'),
)

engine = None


def now_ms():
    return int(time.time() * 1000)


def _sqlite_pragmas(connection, _record):
    cursor = connection.cursor()
    cursor.execute('PRAGMA foreign_keys=ON')
    # Lets the judging thread write while requests read.
    cursor.execute('PRAGMA journal_mode=WAL')
    cursor.close()


def init(url=None):
    """Connect to the database and create any missing tables."""
    global engine
    url = url or os.environ.get('DATABASE_URL') or DEFAULT_URL
    # Hosts often hand out postgres:// URLs; SQLAlchemy wants a driver name.
    if url.startswith('postgres://'):
        url = 'postgresql+psycopg://' + url[len('postgres://'):]
    elif url.startswith('postgresql://'):
        url = 'postgresql+psycopg://' + url[len('postgresql://'):]
    if url.startswith('sqlite:///') and url != 'sqlite:///:memory:':
        Path(url[len('sqlite:///'):]).parent.mkdir(parents=True, exist_ok=True)
    if engine is not None:
        engine.dispose()
    options = {'future': True}
    if url.startswith('sqlite'):
        options['connect_args'] = {'check_same_thread': False}
    else:
        options['pool_pre_ping'] = True
    engine = create_engine(url, **options)
    if url.startswith('sqlite'):
        event.listen(engine, 'connect', _sqlite_pragmas)
    metadata.create_all(engine)
    return engine


def dumps(value):
    return json.dumps(value, separators=(',', ':'))


def loads(text):
    return None if text is None else json.loads(text)
