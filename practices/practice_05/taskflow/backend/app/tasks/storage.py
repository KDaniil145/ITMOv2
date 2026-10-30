"""Transactional task storage with version control and durable retired IDs."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3

from app.config import resolve_database_path
from .errors import TaskError

SCHEMA = {
    'tasks': '''CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('todo','in_progress','done')),
        priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
        due_date TEXT,
        created_at TEXT NOT NULL COLLATE BINARY,
        updated_at TEXT NOT NULL COLLATE BINARY,
        version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version BETWEEN 1 AND 9007199254740991)
    )''',
    'retired_task_ids': 'CREATE TABLE retired_task_ids (id TEXT PRIMARY KEY NOT NULL COLLATE BINARY)',
    'tasks_created_id': 'CREATE INDEX tasks_created_id ON tasks (created_at COLLATE BINARY, id COLLATE BINARY)',
}


def _canonical(sql):
    return ' '.join(sql.split())


def _inspect(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise TaskError('storage_unavailable')
    objects = dict(db.execute("SELECT name,sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_'"))
    version = db.execute('PRAGMA user_version').fetchone()[0]
    if not objects and version == 0:
        return False
    if version != 1 or set(objects) != set(SCHEMA) or any(
        _canonical(objects[name] or '') != _canonical(sql) for name, sql in SCHEMA.items()
    ):
        raise TaskError('storage_unavailable')
    return True


def _initialize(db):
    # Read schema and user_version from one snapshot, including first-open races.
    db.execute('BEGIN')
    try:
        initialized = _inspect(db)
    finally:
        db.execute('ROLLBACK')
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('PRAGMA synchronous=FULL')
    if initialized:
        return
    db.execute('BEGIN IMMEDIATE')
    try:
        # A different worker may have initialized it while we waited for the lock.
        if not _inspect(db):
            for sql in SCHEMA.values():
                db.execute(sql)
            db.execute('PRAGMA user_version=1')
        db.execute('COMMIT')
    except BaseException:
        if db.in_transaction:
            db.execute('ROLLBACK')
        raise


def _point(fault, name, db):
    if fault is not None:
        fault(name, db)


@contextmanager
def connection(path: str | Path | None = None, *, write: bool = False, fault=None):
    """One worker owns the connection; successful writes exit only after SQL COMMIT.

    Fault callbacks are internal test seams, disabled by default. An error after
    commit cannot roll that commit back; callers must not infer rollback from 503.
    """
    db = None
    try:
        file = resolve_database_path(path)
        file.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(file, timeout=5, autocommit=True)
        # Inspect existing files before any schema/journal change. Never reset them.
        _initialize(db)
        _point(fault, 'before_begin', db)
        if write:
            db.execute('BEGIN IMMEDIATE')
        _point(fault, 'after_begin', db)
        yield db
        if write:
            _point(fault, 'before_commit', db)
            db.execute('COMMIT')
            _point(fault, 'after_commit', db)
    except (sqlite3.IntegrityError, sqlite3.ProgrammingError, sqlite3.DataError) as error:
        raise TaskError('internal_error') from error
    except sqlite3.Error as error:
        primary = getattr(error, 'sqlite_errorcode', 0) & 0xFF
        unavailable = {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_READONLY,
                       sqlite3.SQLITE_CANTOPEN, sqlite3.SQLITE_IOERR, sqlite3.SQLITE_CORRUPT,
                       sqlite3.SQLITE_NOTADB, sqlite3.SQLITE_FULL, sqlite3.SQLITE_PERM,
                       sqlite3.SQLITE_AUTH, sqlite3.SQLITE_PROTOCOL}
        raise TaskError('storage_unavailable' if primary in unavailable else 'internal_error') from error
    except OSError as error:
        raise TaskError('storage_unavailable') from error
    finally:
        if db is not None:
            try:
                if db.in_transaction:
                    db.execute('ROLLBACK')
            finally:
                db.close()


def list_tasks(path: str | Path):
    """One SELECT defines both items and total; fixed UTC strings preserve moments."""
    with connection(path) as db:
        cursor = db.execute('SELECT * FROM tasks ORDER BY created_at COLLATE BINARY, id COLLATE BINARY')
        names = [column[0] for column in cursor.description]
        items = [dict(zip(names, row)) for row in cursor.fetchall()]
    return {'items': items, 'total': len(items)}


def get_task(path: str | Path, task_id: str):
    with connection(path) as db:
        cursor = db.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        names = [column[0] for column in cursor.description]
        row = cursor.fetchone()
    if row is None:
        raise TaskError('task_not_found')
    return dict(zip(names, row))


def create_task(path: str | Path, values: dict):
    """Create/replay transport-validated values in one atomic write transaction."""
    from datetime import datetime, timezone
    user_fields = ('title', 'description', 'status', 'priority', 'due_date')
    with connection(path, write=True) as db:
        if db.execute('SELECT id FROM retired_task_ids WHERE id=?', (values['id'],)).fetchone():
            raise TaskError('task_id_retired')
        cursor = db.execute('SELECT * FROM tasks WHERE id=?', (values['id'],))
        row = cursor.fetchone()
        if row is not None:
            task = dict(zip((column[0] for column in cursor.description), row))
            if task['version'] != 1 or any(task[field] != values[field] for field in user_fields):
                raise TaskError('task_id_conflict')
            created = False
        else:
            moment = datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
            task = {'id': values['id'], **{field: values[field] for field in user_fields},
                    'created_at': moment, 'updated_at': moment, 'version': 1}
            db.execute('INSERT INTO tasks (id,title,description,status,priority,due_date,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?)',
                       tuple(task[field] for field in ('id', *user_fields, 'created_at', 'updated_at', 'version')))
            created = True
    # Return only after the context's explicit SQL COMMIT succeeded.
    return task, created


def patch_task(path: str | Path, task_id: str, values: dict):
    """CAS and all field changes share one SQLite write transaction."""
    from datetime import datetime, timezone
    with connection(path, write=True) as db:
        cursor = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,))
        row = cursor.fetchone()
        if row is None:
            raise TaskError('task_not_found')
        task = dict(zip((column[0] for column in cursor.description), row))
        if values['version'] != task['version']:
            raise TaskError('version_conflict')
        changes = {field: value for field, value in values.items()
                   if field != 'version' and task[field] != value}
        if changes:
            if task['version'] == 9007199254740991:
                raise TaskError('version_exhausted')
            moment = datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
            task = {**task, **changes, 'version': task['version'] + 1,
                    'updated_at': max(moment, task['updated_at'])}
            fields = ('title', 'description', 'status', 'priority', 'due_date', 'updated_at', 'version')
            result = db.execute('UPDATE tasks SET title=?,description=?,status=?,priority=?,due_date=?,updated_at=?,version=? WHERE id=? AND version=?',
                                (*[task[field] for field in fields], task_id, values['version']))
            if result.rowcount != 1:
                raise TaskError('version_conflict')
    return task


def delete_task(path: str | Path, task_id: str, version: int, *, fault=None):
    """Retire and delete one version atomically; fault is an internal test seam."""
    with connection(path, write=True, fault=fault) as db:
        row = db.execute('SELECT version FROM tasks WHERE id=?', (task_id,)).fetchone()
        if row is None:
            raise TaskError('task_not_found')
        if row[0] != version:
            raise TaskError('version_conflict')
        db.execute('INSERT INTO retired_task_ids (id) VALUES (?)', (task_id,))
        _point(fault, 'after_retired_insert', db)
        result = db.execute('DELETE FROM tasks WHERE id=? AND version=?', (task_id, version))
        if result.rowcount != 1:
            raise TaskError('internal_error')
    # The transaction context commits before a caller may return 204.
