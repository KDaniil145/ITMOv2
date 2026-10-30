"""Resolve storage configuration from the backend root, never from cwd."""
import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def resolve_database_path(value: str | Path | None = None) -> Path:
    if value is None:
        value = os.environ.get('TASKFLOW_DB_PATH', 'data/taskflow.sqlite3')
    path = Path(value)
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()
