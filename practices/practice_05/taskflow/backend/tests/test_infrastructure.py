"""Infrastructure self-tests; the probe is explicitly not the TaskFlow API."""
from pathlib import Path
import socket
import sqlite3
import sys
import unittest

from tests.support.fixtures import isolated_database, open_fixture_database
from tests.support.processes import BackendProcess

PROBE = r'''
import http.server, json, os, socket, sqlite3, sys
with sqlite3.connect(os.environ["TASKFLOW_DB_PATH"]) as db:
    db.execute("CREATE TABLE IF NOT EXISTS infrastructure_probe (value TEXT)")
    db.execute("INSERT INTO infrastructure_probe VALUES ('started')")
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/api/health" else 404)
        self.end_headers()
        self.wfile.write(json.dumps({"status":"ok"} if self.path == "/api/health" else {}).encode())
    def log_message(self, *args): pass
server = http.server.HTTPServer(("127.0.0.1",0), Handler, bind_and_activate=False)
server.socket.close()
server.socket = socket.socket(fileno=int(sys.argv[1]))
server.server_address = server.socket.getsockname()
server.serve_forever()
'''


class ProbeProcess(BackendProcess):
    def _command(self, fd):
        return [sys.executable, "-c", PROBE, str(fd)]


class InfrastructureTests(unittest.TestCase):
    def test_isolated_real_sqlite_and_cleanup(self):
        with isolated_database() as path:
            self.assertTrue(path.is_absolute())
            with open_fixture_database(path) as db:
                db.execute("CREATE TABLE probe (value TEXT)")
                db.execute("INSERT INTO probe VALUES ('срок 😀')")
            with open_fixture_database(path) as db:
                self.assertEqual(db.execute("SELECT value FROM probe").fetchone()[0], 'срок 😀')
            directory = path.parent
        self.assertFalse(directory.exists())

    def test_reject_product_path(self):
        with self.assertRaises(ValueError):
            open_fixture_database(Path('data/taskflow.sqlite3'))
        with self.assertRaises(ValueError):
            BackendProcess(Path('data/taskflow.sqlite3'))

    def test_fixture_requires_active_allocation(self):
        with isolated_database() as owned:
            # A path inside an owned directory is not itself an allocated database.
            with self.assertRaises(ValueError):
                open_fixture_database(owned.parent / 'unallocated.sqlite3')
            with open_fixture_database(owned) as db:
                db.execute('SELECT 1')
        with self.assertRaises(ValueError):
            open_fixture_database(owned)

    def test_restart_force_stop_other_cwd_and_readiness(self):
        with isolated_database() as path:
            server = ProbeProcess(path)
            try:
                server.start()
                first_pid = server.process.pid
                with self.assertRaises(TimeoutError):
                    server.wait_ready(tasks=True, timeout=0.15)
                server.restart(cwd=path.parent)
                self.assertNotEqual(first_pid, server.process.pid)
                server.restart(force=True)
                with sqlite3.connect(path) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM infrastructure_probe').fetchone()[0], 3)
            finally:
                server.stop()
            self.assertIsNone(server.process)

    def test_busy_port_is_not_reused(self):
        with socket.socket() as occupied, isolated_database() as path:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            server = ProbeProcess(path, port=occupied.getsockname()[1])
            with self.assertRaises(OSError):
                server.start()
            self.assertIsNone(server.process)
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
