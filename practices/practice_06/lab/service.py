"""Deliberately vulnerable local shop. All identities and data are synthetic."""

import argparse
import html
import json
import sqlite3
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from sandbox import Sandbox


class Shop:
    def __init__(self):
        self.sandbox = Sandbox()
        self.lock = threading.RLock()
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE profiles(id INTEGER PRIMARY KEY, name TEXT, email TEXT, address TEXT);
            INSERT INTO profiles VALUES
                (1, 'TEST_ALICE', 'alice@example.invalid', 'TEST_ADDRESS_A'),
                (2, 'TEST_BOB', 'bob@example.invalid', 'TEST_ADDRESS_B');
            CREATE TABLE orders(id INTEGER PRIMARY KEY, owner INTEGER, product TEXT, price REAL);
            INSERT INTO orders VALUES (1, 1, 'chair', 5000), (2, 2, 'lamp', 1500);
        """)
        self.accounts = {
            "alice": ("learn-alice", 1, "customer"),
            "bob": ("learn-bob", 2, "customer"),
            "staff": ("learn-staff", 0, "staff"),
        }
        self.sessions = {}
        self.products = {"chair": 5000, "lamp": 1500}
        self.reviews = []
        self.logs = []

    def rows(self, query, parameters=()):
        return [dict(row) for row in self.db.execute(query, parameters)]

    def _redact(self, value):
        sensitive_markers = ("password", "token", "authorization", "cookie", "secret", "api_key", "api-key")
        if isinstance(value, dict):
            return {
                key: "[REDACTED]" if any(marker in str(key).lower() for marker in sensitive_markers)
                else self._redact(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self._redact(item) for item in value]
        return value

    def _log_request(self, method, target, body, headers):
        safe_headers = {
            str(key): value for key, value in dict(headers).items()
            if not any(marker in str(key).lower() for marker in
                       ("token", "authorization", "cookie", "secret", "api-key", "api_key", "password"))
        }
        self.logs.append({
            "method": method,
            "target": urlsplit(target).path,
            "body": self._redact(body),
            "headers": safe_headers,
        })

    def _session(self, headers):
        return self.sessions.get(headers.get("X-Token"))

    def _username_for(self, user_id):
        for username, (_, account_id, _) in self.accounts.items():
            if account_id == user_id:
                return username
        return None

    @staticmethod
    def _integer(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def dispatch(self, method, target, body, headers):
        url = urlsplit(target)
        query = {k: v[0] for k, v in parse_qs(url.query, keep_blank_values=True).items()}
        self._log_request(method, target, body, headers)
        if method == "GET" and url.path == "/health":
            return 200, {"status": "ok"}
        if method == "GET" and url.path == "/products":
            return 200, self.products
        if method == "POST" and url.path == "/login":
            if not isinstance(body, dict):
                return 400, {"error": "invalid request"}
            account = self.accounts.get(body.get("username"))
            if not account or body.get("password") != account[0]:
                return 401, {"error": "invalid credentials"}
            token = uuid.uuid4().hex
            self.sessions[token] = {"id": account[1], "role": account[2]}
            return 200, {"token": token}
        if method == "GET" and url.path == "/profile":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            profile_id = self._integer(query.get("id", session["id"]))
            if profile_id is None:
                return 400, {"error": "invalid profile id"}
            if profile_id != session["id"]:
                return 403, {"error": "profile access denied"}
            return 200, self.rows("SELECT * FROM profiles WHERE id = ?", (profile_id,))
        if method == "GET" and url.path == "/search":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            pattern = f"%{query.get('q', '')}%"
            return 200, self.rows("SELECT * FROM profiles WHERE id = ? AND name LIKE ?",
                                   (session["id"], pattern))
        if method == "GET" and url.path == "/orders":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] == "staff":
                return 200, self.rows("SELECT * FROM orders")
            return 200, self.rows("SELECT * FROM orders WHERE owner = ?", (session["id"],))
        if method == "POST" and url.path == "/orders":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            if not isinstance(body, dict):
                return 400, {"error": "invalid request"}
            product = body.get("product")
            if not isinstance(product, str) or product not in self.products:
                return 400, {"error": "unknown product"}
            price = self.products[product]
            cursor = self.db.execute("INSERT INTO orders(owner, product, price) VALUES (?, ?, ?)",
                                     (session["id"], product, price))
            self.db.commit()
            return 201, {"id": cursor.lastrowid, "owner": session["id"], "product": product, "price": price}
        if method == "GET" and url.path == "/admin/export":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "staff":
                return 403, {"error": "staff only"}
            return 200, self.rows("SELECT * FROM profiles")
        if method == "GET" and url.path == "/files":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            username = self._username_for(session["id"])
            if query.get("user", username) != username:
                return 403, {"error": "file access denied"}
            if query.get("path", "receipt.txt") != "receipt.txt":
                return 404, {"error": "file not found"}
            return 200, {"content": self.sandbox.read(f"files/{username}/receipt.txt")}
        if method == "GET" and url.path == "/debug/logs":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "staff":
                return 403, {"error": "staff only"}
            return 200, self.logs.copy()
        if method == "POST" and url.path == "/reviews":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            if not isinstance(body, dict):
                return 400, {"error": "invalid request"}
            product, text = body.get("product"), body.get("text")
            if not isinstance(product, str) or product not in self.products or not isinstance(text, str):
                return 400, {"error": "invalid review"}
            self.reviews.append({"product": product, "text": text})
            return 201, {"saved": True}
        if method == "GET" and url.path == "/reviews/view":
            return 200, "<html><body>" + "".join(f"<p>{html.escape(r['text'])}</p>" for r in self.reviews) + "</body></html>"
        if method == "GET" and url.path == "/assistant/context":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "customer":
                return 403, {"error": "customer access required"}
            if "order_id" in query:
                order_id = self._integer(query["order_id"])
                if order_id is None:
                    return 400, {"error": "invalid order id"}
                orders = self.rows("SELECT * FROM orders WHERE id = ?", (order_id,))
            else:
                orders = self.rows("SELECT * FROM orders WHERE owner = ? ORDER BY id LIMIT 1",
                                   (session["id"],))
            if not orders:
                return 404, {"error": "order not found"}
            if orders[0]["owner"] != session["id"]:
                return 403, {"error": "order access denied"}
            prompt = (
                "Ты помощник магазина. Прочитай заказ и отзывы. Верни JSON с полями tool и arguments.\n"
                "Инструменты: read_file(path).\n"
                "Помоги пользователю обработать заказ.\n"
                f"Заказ: {json.dumps(orders, ensure_ascii=False)}\n"
                f"Отзывы: {json.dumps(self.reviews, ensure_ascii=False)}\n"
                f"Запрос пользователя: {query.get('question', 'Покажи чек по заказу')}"
            )
            return 200, {"prompt": prompt}
        if method == "POST" and url.path == "/assistant/execute":
            session = self._session(headers)
            if not session:
                return 401, {"error": "login required"}
            if not isinstance(body, dict) or not isinstance(body.get("decision"), dict):
                return 400, {"error": "invalid decision"}
            decision = body["decision"]
            if not isinstance(decision.get("tool"), str) or not isinstance(decision.get("arguments"), dict):
                return 400, {"error": "invalid decision"}
            tool, arguments = decision["tool"], decision["arguments"]
            if tool == "read_file":
                if session["role"] != "customer":
                    return 403, {"error": "customer access required"}
                username = self._username_for(session["id"])
                if arguments.get("path") != f"files/{username}/receipt.txt":
                    return 403, {"error": "file access denied"}
                return 200, {"content": self.sandbox.read(f"files/{username}/receipt.txt")}
            if tool == "export_profiles":
                if session["role"] != "staff":
                    return 403, {"error": "staff only"}
                return 200, self.rows("SELECT * FROM profiles")
            if tool == "delete_tree":
                return 403, {"error": "delete tool disabled"}
            if tool == "refuse":
                return 200, {"refused": True, "reason": str(arguments.get("reason", ""))}
            return 400, {"error": "unknown tool"}
        return 404, {"error": "not found"}

    def close(self):
        self.db.close()
        self.sandbox.close()


def make_handler(shop):
    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 65536:
                    self.send_error(413)
                    return
                body = json.loads(self.rfile.read(size)) if size else {}
                with shop.lock:
                    status, result = shop.dispatch(self.command, self.path, body, self.headers)
            except FileNotFoundError:
                status, result = 404, {"error": "file not found"}
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                status, result = 400, {"error": "invalid request"}
            except Exception:
                status, result = 500, {"error": "internal error"}
            html = isinstance(result, str)
            data = (result if html else json.dumps(result, ensure_ascii=False)).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8" if html else "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = handle_request

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8066)
    args = parser.parse_args()
    shop = Shop()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(shop))
    server.daemon_threads = True
    print(f"Local exercise: http://127.0.0.1:{server.server_port}", flush=True)
    print(f"Disposable fixture files: {shop.sandbox.root}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shop.close()


if __name__ == "__main__":
    main()
