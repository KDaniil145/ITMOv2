"""Owned Uvicorn processes with inherited listening sockets and explicit readiness."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError, HTTPError
from urllib.request import urlopen

from .fixtures import BACKEND_ROOT, isolated_database, TEST_DATA_ROOT


class BackendProcess:
    def __init__(self, database: Path, *, cwd: Path = BACKEND_ROOT, port: int = 0):
        self.database = database.resolve()
        if not self.database.is_relative_to(TEST_DATA_ROOT.resolve()) or not self.database.parent.exists():
            raise ValueError("Use an allocated isolated test database")
        self.cwd = cwd
        self.port = port
        self.process = None
        self.base_url = ""

    def _command(self, fd: int):
        return [sys.executable, "-m", "uvicorn", "app.main:app", "--fd", str(fd)]

    def start(self):
        if self.process is not None:
            raise RuntimeError("Process already started")
        listener = socket.socket()
        try:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", self.port))
            listener.listen(128)
            self.port = listener.getsockname()[1]
            env = dict(os.environ, TASKFLOW_DB_PATH=str(self.database),
                       PYTHONPATH=str(BACKEND_ROOT))
            self.process = subprocess.Popen(
                self._command(listener.fileno()),
                cwd=self.cwd, env=env, pass_fds=(listener.fileno(),), start_new_session=True,
            )
        finally:
            listener.close()
        self.base_url = f"http://127.0.0.1:{self.port}"
        try:
            self.wait_ready(tasks=False)
        except BaseException:
            self.stop()
            raise
        return self

    def wait_ready(self, *, tasks: bool = True, timeout: float = 15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process is None or self.process.poll() is not None:
                raise RuntimeError("Owned backend process exited before readiness")
            try:
                with urlopen(self.base_url + ("/api/tasks" if tasks else "/api/health"), timeout=0.5) as response:
                    body = json.load(response)
                    if tasks:
                        ready = isinstance(body, dict) and isinstance(body.get("items"), list) and body.get("total") == len(body["items"])
                    else:
                        ready = body == {"status": "ok"}
                    if response.status == 200 and ready:
                        return
            except HTTPError as error:
                error.close()
            except (URLError, TimeoutError, ValueError):
                pass
            time.sleep(0.05)
        raise TimeoutError("Task readiness failed" if tasks else "Health readiness failed")

    def stop(self, *, force: bool = False):
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    def restart(self, *, force: bool = False, cwd: Path | None = None):
        self.stop(force=force)
        if cwd is not None:
            self.cwd = cwd
        return self.start()


@contextmanager
def running_backend(database: Path, **kwargs):
    server = BackendProcess(database, **kwargs)
    try:
        yield server.start()
    finally:
        server.stop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument('--control')
    args = parser.parse_args()
    control = Path(args.control).resolve() if args.control else None
    if control is not None and control.parent != TEST_DATA_ROOT.resolve():
        raise ValueError('Control file must be under test data root')
    # SIGTERM must unwind the context and stop the child before temporary cleanup.
    def terminate(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    with isolated_database() as database:
        try:
            with running_backend(database, port=args.port) as server:
                if control is not None:
                    control.write_text(json.dumps({'database': str(database), 'pid': server.process.pid}))
                while True:
                    if control is not None:
                        request=control.with_suffix('.restart-request')
                        if request.exists():
                            token=request.read_text();request.unlink()
                            server.restart().wait_ready()
                            control.write_text(json.dumps({'database':str(database),'pid':server.process.pid,'restart_token':token}))
                    time.sleep(0.25)
        finally:
            if control is not None:
                control.unlink(missing_ok=True)
                control.with_suffix('.restart-request').unlink(missing_ok=True)


if __name__ == "__main__":
    main()
