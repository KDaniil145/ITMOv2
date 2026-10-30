"""Local HTTP re-audit: own fresh subprocess, no redirects or external targets."""
import hashlib
import json
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def hashes():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / 'evidence/before').rglob('*') if p.is_file()}

def main():
    before = hashes()
    destination = ROOT / 'evidence/after'
    destination.mkdir(exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix='http-reaudit-', dir=destination))
    (out / 'before-sha256.json').write_text(json.dumps(before, indent=2))
    process = subprocess.Popen([sys.executable, '-B', 'service.py', '--port', '0'],
                               cwd=ROOT / 'lab', stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, env={**__import__('os').environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    records = []
    opener = build_opener(ProxyHandler({}), NoRedirect)
    try:
        startup = [process.stdout.readline().strip(), process.stdout.readline().strip()]
        base = startup[0].removeprefix('Local exercise: ')
        parsed = urlsplit(base)
        assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
        sandbox = Path(startup[1].removeprefix('Disposable fixture files: ')).resolve()
        assert sandbox.parent == Path(tempfile.gettempdir()).resolve() and sandbox.name.startswith('itmo-practice-06-')
        (out / 'server.json').write_text(json.dumps({'pid': process.pid, 'command': process.args,
            'cwd': str(ROOT / 'lab'), 'startup': startup, 'source_sha256': hashlib.sha256((ROOT/'lab/service.py').read_bytes()).hexdigest()}, indent=2))

        def call(case, ids, method, path, expected, body=None, headers=None, predicate=None):
            url = base + path
            assert urlsplit(url).netloc == parsed.netloc
            wire = json.dumps(body, ensure_ascii=False) if body is not None else None
            headers = {'Content-Type': 'application/json', **(headers or {})}
            req = Request(url, data=wire.encode() if wire is not None else None, headers=headers, method=method)
            record = {'case': case, 'findings': ids, 'expected_status': expected,
                      'request': {'method': method, 'url': url, 'headers': headers, 'body': body, 'wire_body': wire}}
            try:
                try:
                    response = opener.open(req, timeout=5)
                except HTTPError as error:
                    response = error
                with response:
                    raw = response.read().decode('utf-8')
                    status = response.status
                    response_headers = dict(response.headers)
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    data = raw
                record['response'] = {'status': status, 'headers': response_headers, 'body': data, 'raw_body': raw}
                record['pass'] = status == expected and (predicate is None or bool(predicate(data)))
            except Exception as error:
                record['error'] = f'{type(error).__name__}: {error}'
                record['pass'] = False
                data = None
            records.append(record)
            with (out / 'http.jsonl').open('a') as f:
                f.write(json.dumps(record, ensure_ascii=False) + '\n')
            print(('PASS' if record['pass'] else 'FAIL'), case, record.get('response', {}).get('status'), flush=True)
            return data

        # Replay original cases in the original order, with the fresh Alice token.
        old = [json.loads(line) for line in (ROOT/'evidence/before/http-checks.jsonl').read_text().splitlines()]
        statuses = [200,401,401,401,401,401,401,401,201,401,401,401,401,401,200,401,401]
        ids = [[],['R01'],['R01'],['R06'],['R02'],['R02'],['R03'],['R05'],['R04'],['R06'],['R01'],['R07'],['R07'],['R09'],['R10'],['R08'],['R08']]
        alice = None
        for index, row in enumerate(old):
            request = row['request']; url = urlsplit(request['url'])
            headers = {k: (alice['X-Token'] if k.lower() == 'x-token' else v) for k,v in request['headers'].items()}
            predicate = (lambda d: d['price'] == 1500 and d['owner'] == 1) if index == 8 else None
            if index == 14:
                predicate = lambda d: '<script>' not in d
            result = call('replay: '+row['case'], ids[index], request['method'], url.path+('?' + url.query if url.query else ''), statuses[index], request['body'], headers, predicate)
            if index == 0:
                alice = {'X-Token': result['token']}
        staff_login = call('staff login', [], 'POST', '/login', 200, {'username':'staff','password':'learn-staff'})
        staff = {'X-Token': staff_login['token']}
        call('own profile', ['R01'], 'GET', '/profile?id=1', 200, headers=alice, predicate=lambda d: len(d)==1 and d[0]['id']==1)
        call('cross profile', ['R01'], 'GET', '/profile?id=2', 403, headers=alice)
        call('own orders only', ['R01'], 'GET', '/orders', 200, headers=alice, predicate=lambda d: all(x['owner']==1 for x in d))
        call('cross order context', ['R01'], 'GET', '/assistant/context?order_id=2', 403, headers=alice)
        call('authenticated SQL profile', ['R02'], 'GET', '/profile?id=1+OR+1%3D1', 400, headers=alice)
        call('authenticated SQL search', ['R02'], 'GET', '/search?q=%25%27+OR+1%3D1+--+', 200, headers=alice, predicate=lambda d: d==[])
        call('authenticated role spoof', ['R03'], 'GET', '/admin/export', 403, headers={**alice,'X-Role':'staff'})
        call('staff export', ['R03'], 'GET', '/admin/export', 200, headers=staff, predicate=lambda d: len(d)==2)
        call('customer logs denied', ['R05'], 'GET', '/debug/logs', 403, headers=alice)
        secrets = ['learn-alice','learn-staff',alice['X-Token'],staff['X-Token']]
        call('staff logs redacted', ['R05'], 'GET', '/debug/logs', 200, headers=staff, predicate=lambda d: all(s not in json.dumps(d) for s in secrets))
        call('cross receipt', ['R06'], 'GET', '/files?user=bob&path=receipt.txt', 403, headers=alice)
        call('private traversal authenticated', ['R06'], 'GET', '/files?user=alice&path=../../private/operator-note.txt', 404, headers=alice)
        for tool,args,status in [('read_file',{'path':'private/operator-note.txt'},403),('export_profiles',{},403),('delete_tree',{'path':'files/alice/receipt.txt'},403),('read_file',{'path':'files/alice/receipt.txt'},200)]:
            call('authenticated tool '+tool+str(args), ['R08'] if tool=='delete_tree' else ['R07'], 'POST','/assistant/execute',status,{'decision':{'tool':tool,'arguments':args}},alice)
        call('receipt survives denied delete', ['R08'], 'GET','/files?user=alice&path=receipt.txt',200,headers=alice,predicate=lambda d: d['content']=='TEST_ALICE receipt: chair, 5000 RUB')
        marker="<script>alert('MINI_SHOP_XSS')</script>"
        call('authorized review', ['R09','R10'], 'POST','/reviews',201,{'product':'chair','text':marker},alice)
        call('escaped review HTML', ['R10'], 'GET','/reviews/view',200,predicate=lambda d: '<script>' not in d and '&lt;script&gt;' in d)
        call('missing disallowed filename', ['R11'], 'GET','/files?path=missing.txt',404,headers=alice,predicate=lambda d: d=={'error':'file not found'})
        # Remove only our fresh process's allowed fixture, to reach FileNotFoundError.
        receipt = sandbox / 'files/alice/receipt.txt'
        assert receipt.is_file() and receipt.read_text()=='TEST_ALICE receipt: chair, 5000 RUB'
        receipt.unlink()
        (out/'missing-fixture.json').write_text(json.dumps({'action':'unlink own temporary fixture','path':str(receipt),'exists_after':receipt.exists()}))
        call('allowed receipt really absent', ['R11'], 'GET','/files?path=receipt.txt',404,headers=alice,predicate=lambda d: d=={'error':'file not found'})
    finally:
        process.send_signal(signal.SIGINT)
        process.wait(timeout=10)
        unchanged = before == hashes()
        summary = {'checks':len(records),'passed':sum(r['pass'] for r in records),'failed':[r['case'] for r in records if not r['pass']], 'before_unchanged':unchanged,'server_stopped':process.poll() is not None,'llm_experiment_performed':False}
        (out/'summary.json').write_text(json.dumps(summary,indent=2))
        print(out, json.dumps(summary), flush=True)
    return 0 if unchanged and all(r['pass'] for r in records) else 1

if __name__ == '__main__':
    raise SystemExit(main())
