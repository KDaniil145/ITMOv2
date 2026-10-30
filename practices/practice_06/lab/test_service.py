"""Functional contract and exercise containment; security regressions are student work."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from sandbox import Sandbox
from service import Shop


class ShopTest(unittest.TestCase):
    def setUp(self):
        self.shop = Shop()
        self.addCleanup(self.shop.close)

    def request(self, method, path, body=None, headers=None):
        with self.shop.lock:
            return self.shop.dispatch(method, path, body or {}, headers or {})

    def login(self, username="alice", password="learn-alice"):
        status, result = self.request("POST", "/login", {"username": username, "password": password})
        self.assertEqual(status, 200)
        return {"X-Token": result["token"]}

    def test_health_and_catalog(self):
        self.assertEqual(self.request("GET", "/health"), (200, {"status": "ok"}))
        self.assertEqual(self.request("GET", "/products"), (200, {"chair": 5000, "lamp": 1500}))

    def test_wrong_password_rejected(self):
        self.assertEqual(self.request("POST", "/login", {"username": "alice", "password": "wrong"})[0], 401)

    def test_tokens_identify_distinct_users(self):
        alice, bob = self.login(), self.login("bob", "learn-bob")
        self.assertNotEqual(alice, bob)
        self.assertEqual(self.request("GET", "/profile?id=1", headers=alice)[1][0]["name"], "TEST_ALICE")
        self.assertEqual(self.request("GET", "/profile?id=2", headers=bob)[1][0]["name"], "TEST_BOB")

    def test_staff_can_export_with_staff_session(self):
        auth = self.login("staff", "learn-staff")
        status, profiles = self.request("GET", "/admin/export", headers=auth)
        self.assertEqual(status, 200)
        self.assertEqual(len(profiles), 2)

    def test_own_profile_and_receipt(self):
        auth = self.login()
        status, profile = self.request("GET", "/profile?id=1", headers=auth)
        self.assertEqual(status, 200)
        self.assertEqual(profile[0]["name"], "TEST_ALICE")
        status, receipt = self.request("GET", "/files?user=alice&path=receipt.txt", headers=auth)
        self.assertEqual(status, 200)
        self.assertIn("TEST_ALICE", receipt["content"])

    def test_customer_can_buy_at_catalog_price(self):
        status, order = self.request("POST", "/orders", {"product": "lamp"}, self.login())
        self.assertEqual(status, 201)
        self.assertEqual((order["owner"], order["price"]), (1, 1500))

    def test_unknown_product_rejected(self):
        self.assertEqual(self.request("POST", "/orders", {"product": "unknown"}, self.login())[0], 400)

    def test_review_can_be_submitted_and_viewed(self):
        auth = self.login()
        self.assertEqual(self.request("POST", "/reviews", {"product": "chair", "text": "Comfortable"}, auth)[0], 201)
        self.assertIn("Comfortable", self.request("GET", "/reviews/view", headers=auth)[1])

    def test_assistant_can_return_own_receipt(self):
        auth = self.login()
        status, context = self.request("GET", "/assistant/context?order_id=1", headers=auth)
        self.assertEqual(status, 200)
        self.assertIn("chair", context["prompt"])
        status, result = self.request("POST", "/assistant/execute", {
            "decision": {"tool": "read_file", "arguments": {"path": "files/alice/receipt.txt"}}
        }, auth)
        self.assertEqual(status, 200)
        self.assertIn("TEST_ALICE", result["content"])

    def test_security_profile_orders_and_context_require_ownership(self):
        self.assertEqual(self.request("GET", "/profile?id=1")[0], 401)
        self.assertEqual(self.request("GET", "/orders")[0], 401)
        self.assertEqual(self.request("GET", "/assistant/context?order_id=1")[0], 401)
        alice = self.login()
        self.assertEqual(self.request("GET", "/profile?id=2", headers=alice)[0], 403)
        self.assertEqual(self.request("GET", "/assistant/context?order_id=2", headers=alice)[0], 403)
        status, orders = self.request("GET", "/orders", headers=alice)
        self.assertEqual(status, 200)
        self.assertEqual([order["id"] for order in orders], [1])
        bob = self.login("bob", "learn-bob")
        status, orders = self.request("GET", "/orders", headers=bob)
        self.assertEqual(status, 200)
        self.assertEqual([order["id"] for order in orders], [2])

    def test_security_sql_inputs_are_parameterized_and_scoped(self):
        auth = self.login()
        self.assertEqual(self.request("GET", "/profile?id=1 OR 1=1", headers=auth)[0], 400)
        self.assertEqual(self.request("GET", "/search?q=TEST")[0], 401)
        status, own_rows = self.request("GET", "/search?q=TEST", headers=auth)
        self.assertEqual(status, 200)
        self.assertEqual([row["id"] for row in own_rows], [1])
        status, injection_rows = self.request("GET", "/search?q=%25%27%20OR%201%3D1%20--%20", headers=auth)
        self.assertEqual(status, 200)
        self.assertEqual(injection_rows, [])
        self.assertEqual(self.request("GET", "/assistant/context?order_id=1 OR 1=1", headers=auth)[0], 400)

    def test_security_admin_role_comes_from_session(self):
        self.assertEqual(self.request("GET", "/admin/export", headers={"X-Role": "staff"})[0], 401)
        alice = {**self.login(), "X-Role": "staff"}
        self.assertEqual(self.request("GET", "/admin/export", headers=alice)[0], 403)
        staff = self.login("staff", "learn-staff")
        status, profiles = self.request("GET", "/admin/export", headers=staff)
        self.assertEqual(status, 200)
        self.assertEqual(len(profiles), 2)

    def test_security_order_price_comes_from_catalog(self):
        status, order = self.request("POST", "/orders", {"product": "lamp", "price": 0.01}, self.login())
        self.assertEqual(status, 201)
        self.assertEqual(order["price"], 1500)

    def test_security_file_reads_are_session_scoped_and_allowlisted(self):
        self.assertEqual(self.request("GET", "/files?user=bob&path=receipt.txt")[0], 401)
        alice = self.login()
        self.assertEqual(self.request("GET", "/files?user=bob&path=receipt.txt", headers=alice)[0], 403)
        self.assertEqual(self.request("GET", "/files?path=../../private/operator-note.txt", headers=alice)[0], 404)
        status, receipt = self.request("GET", "/files?path=receipt.txt", headers=alice)
        self.assertEqual(status, 200)
        self.assertIn("TEST_ALICE", receipt["content"])

    def test_security_logs_require_staff_and_redact_secrets(self):
        alice = self.login()
        self.request("POST", "/reviews", {
            "product": "chair", "text": "ok", "access_token": "BODY_TOKEN_SENTINEL",
            "password": "BODY_PASSWORD_SENTINEL",
        }, {**alice, "X-Auth-Token": "HEADER_TOKEN_SENTINEL"})
        self.assertEqual(self.request("GET", "/debug/logs")[0], 401)
        staff = self.login("staff", "learn-staff")
        status, logs = self.request("GET", "/debug/logs", headers=staff)
        self.assertEqual(status, 200)
        serialized = str(logs)
        self.assertNotIn("learn-alice", serialized)
        self.assertNotIn("learn-staff", serialized)
        self.assertNotIn(staff["X-Token"], serialized)
        self.assertNotIn("BODY_TOKEN_SENTINEL", serialized)
        self.assertNotIn("BODY_PASSWORD_SENTINEL", serialized)
        self.assertNotIn("HEADER_TOKEN_SENTINEL", serialized)

    def test_security_reviews_require_login_and_are_html_escaped(self):
        review = {"product": "chair", "text": "<script>alert('x')</script>"}
        self.assertEqual(self.request("POST", "/reviews", review)[0], 401)
        auth = self.login()
        self.assertEqual(self.request("POST", "/reviews", review, auth)[0], 201)
        html = self.request("GET", "/reviews/view")[1]
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>", html)
        status, context = self.request("GET", "/assistant/context?order_id=1", headers=auth)
        self.assertEqual(status, 200)
        self.assertIn("<script>alert('x')</script>", context["prompt"])

    def test_security_assistant_tools_check_permissions_and_refuse_delete(self):
        read = {"decision": {"tool": "read_file", "arguments": {"path": "files/alice/receipt.txt"}}}
        export = {"decision": {"tool": "export_profiles", "arguments": {}}}
        delete = {"decision": {"tool": "delete_tree", "arguments": {"path": "files/alice/receipt.txt"}}}
        self.assertEqual(self.request("POST", "/assistant/execute", read)[0], 401)
        self.assertEqual(self.request("POST", "/assistant/execute", export)[0], 401)
        self.assertEqual(self.request("POST", "/assistant/execute", delete)[0], 401)
        alice = self.login()
        self.assertEqual(self.request("POST", "/assistant/execute", export, alice)[0], 403)
        self.assertEqual(self.request("POST", "/assistant/execute", delete, alice)[0], 403)
        status, result = self.request("POST", "/assistant/execute", read, alice)
        self.assertEqual(status, 200)
        self.assertIn("TEST_ALICE", result["content"])
        status, receipt = self.request("GET", "/files?path=receipt.txt", headers=alice)
        self.assertEqual(status, 200)
        self.assertIn("TEST_ALICE", receipt["content"])
        staff = self.login("staff", "learn-staff")
        status, profiles = self.request("POST", "/assistant/execute", export, staff)
        self.assertEqual(status, 200)
        self.assertEqual(len(profiles), 2)
        self.assertEqual(self.request("POST", "/assistant/execute", delete, staff)[0], 403)
        refusal = {"decision": {"tool": "refuse", "arguments": {"reason": "not authorized"}}}
        status, response = self.request("POST", "/assistant/execute", refusal, alice)
        self.assertEqual(status, 200)
        self.assertTrue(response["refused"])


class SandboxTest(unittest.TestCase):
    def setUp(self):
        self.sandbox = Sandbox()
        self.addCleanup(self.sandbox.close)

    def test_parent_paths_cannot_escape_exercise(self):
        for name in ("../../outside.txt", "/etc/passwd"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.sandbox.read(name)

    def test_external_directory_cannot_be_deleted(self):
        with TemporaryDirectory() as directory:
            sentinel = Path(directory) / "sentinel.txt"
            sentinel.write_text("keep")
            with self.assertRaises(ValueError):
                self.sandbox.delete_tree(directory)
            self.assertEqual(sentinel.read_text(), "keep")

    def test_symlink_cannot_escape_exercise(self):
        with TemporaryDirectory() as directory:
            sentinel = Path(directory) / "sentinel.txt"
            sentinel.write_text("keep")
            link = self.sandbox.root / "escape"
            link.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(ValueError):
                self.sandbox.read("escape/sentinel.txt")
            with self.assertRaises(ValueError):
                self.sandbox.delete_tree("escape")
            self.assertEqual(sentinel.read_text(), "keep")

    def test_delete_of_fixture_root_stays_inside_exercise(self):
        with TemporaryDirectory() as directory:
            sentinel = Path(directory) / "sentinel.txt"
            sentinel.write_text("keep")
            self.sandbox.delete_tree(".")
            self.assertFalse(self.sandbox.root.exists())
            self.assertEqual(sentinel.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
