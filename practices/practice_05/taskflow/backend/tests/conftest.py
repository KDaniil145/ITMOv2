"""Opt-in fixtures: existing health tests stay independent of a database."""
import pytest
from tests.support.fixtures import isolated_database
from tests.support.processes import BackendProcess


@pytest.fixture
def database_path():
    with isolated_database() as path:
        yield path


@pytest.fixture
def backend_process(database_path):
    server = BackendProcess(database_path)
    try:
        yield server.start()
    finally:
        server.stop()
