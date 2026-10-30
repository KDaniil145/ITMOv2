"""Exercise the real HTTP transport without an LLM or third-party packages."""

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from service import Shop, make_handler


class HttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shop = Shop()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.shop))
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()
        cls.shop.close()

    def call(self, method, path, body=None, headers=None):
        headers = {"Content-Type": "application/json", **(headers or {})}
        request = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                          headers=headers, method=method)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, response.headers, response.read().decode()

    def test_login_and_purchase_over_http(self):
        status, _, body = self.call("POST", "/login", {"username": "alice", "password": "learn-alice"})
        self.assertEqual(status, 200)
        token = json.loads(body)["token"]
        status, headers, body = self.call("POST", "/orders", {"product": "chair"}, {"X-Token": token})
        self.assertEqual(status, 201)
        self.assertIn("application/json", headers["Content-Type"])
        self.assertEqual(json.loads(body)["price"], 5000)

    def test_health_and_not_found(self):
        status, _, body = self.call("GET", "/health")
        self.assertEqual((status, json.loads(body)), (200, {"status": "ok"}))
        self.assertEqual(self.call("GET", "/missing")[0], 404)

    def test_transport_only_binds_loopback(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_malformed_json_returns_generic_client_error(self):
        request = Request(self.base + "/reviews", data=b"{",
                          headers={"Content-Type": "application/json"}, method="POST")
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            status = response.status
            body = response.read().decode()
        self.assertEqual(status, 400)
        self.assertNotIn("JSONDecodeError", body)
        self.assertNotIn("/home/", body)

    def test_missing_receipt_returns_generic_not_found(self):
        status, _, body = self.call("POST", "/login", {"username": "alice", "password": "learn-alice"})
        self.assertEqual(status, 200)
        token = json.loads(body)["token"]
        status, _, body = self.call("GET", "/files?path=missing.txt", headers={"X-Token": token})
        self.assertEqual(status, 404)
        self.assertNotIn("FileNotFoundError", body)
        self.assertNotIn("/tmp/", body)


class IsolatedHttpTest(unittest.TestCase):
    call = HttpTest.call

    def setUp(self):
        self.shop = Shop()
        self.addCleanup(self.shop.close)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.shop))
        self.server.daemon_threads = True
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, timeout=5)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def test_allowed_receipt_really_missing_returns_generic_404(self):
        # Each test owns a fresh Shop/server, including its receipt fixtures.
        self.shop.sandbox.path("files/alice/receipt.txt").unlink()
        status, _, body = self.call("POST", "/login", {"username": "alice", "password": "learn-alice"})
        self.assertEqual(status, 200)
        token = json.loads(body)["token"]
        status, _, body = self.call("GET", "/files?path=receipt.txt", headers={"X-Token": token})
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body), {"error": "file not found"})
        self.assertNotIn(str(self.shop.sandbox.root), body)
        self.assertNotIn("FileNotFoundError", body)

    def test_invalid_decision_structure_returns_400(self):
        status, _, body = self.call("POST", "/login", {"username": "alice", "password": "learn-alice"})
        self.assertEqual(status, 200)
        auth = {"X-Token": json.loads(body)["token"]}
        decisions = [None, "read_file", [], {}, {"arguments": {}},
                     {"tool": None, "arguments": {}}, {"tool": [], "arguments": {}},
                     {"tool": "read_file"}]
        decisions += [{"tool": "read_file", "arguments": value} for value in (None, "path", [])]
        for decision in decisions:
            with self.subTest(decision=decision):
                status, _, body = self.call("POST", "/assistant/execute", {"decision": decision}, auth)
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body), {"error": "invalid decision"})


if __name__ == "__main__":
    unittest.main()
