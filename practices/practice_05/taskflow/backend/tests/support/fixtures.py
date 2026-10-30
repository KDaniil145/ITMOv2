"""Owned temporary files; no production schema or application imports."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import tempfile

BACKEND_ROOT = Path(__file__).resolve().parents[2]
TEST_DATA_ROOT = BACKEND_ROOT / ".test-data"
_ACTIVE_DATABASES: set[Path] = set()


@contextmanager
def isolated_database():
    TEST_DATA_ROOT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kanban-", dir=TEST_DATA_ROOT) as directory:
        path = Path(directory).resolve() / "tasks.sqlite3"
        _ACTIVE_DATABASES.add(path)
        try:
            yield path
        finally:
            _ACTIVE_DATABASES.remove(path)


def open_fixture_database(path: Path):
    """Open only a database allocated by an active context in this process."""
    path = path.resolve()
    if path not in _ACTIVE_DATABASES:
        raise ValueError("Database must belong to an isolated test directory")
    return sqlite3.connect(path)
