"""Real OpenCode comparison with preserved Before inputs and own loopback server."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[3]
BEFORE = ROOT/'evidence/before/shop-planner-clean-uzra8h43'

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def main():
    required = ['model.txt','system-prompt.txt','user-task.txt','attack-review.txt','normal-context.txt','attack-context.txt']
    inputs = {name:(BEFORE/name).read_text() for name in required}
    assert inputs['model.txt'].strip() == 'vsellm/openai/gpt-5.6-sol'
    assert inputs['system-prompt.txt'] == (ROOT/'planner-system.txt').read_text()
    before_hashes = {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'evidence/before').rglob('*') if p.is_file()}
    run = Path(tempfile.mkdtemp(prefix='run-',dir=ROOT/'evidence/after/shop-planner'))
    print('Evidence:', run, flush=True)
    for name in ('model.txt','system-prompt.txt','user-task.txt','attack-review.txt'):
        (run/name).write_bytes((BEFORE/name).read_bytes())
    process = subprocess.Popen([sys.executable,'-B','service.py','--port','0'],cwd=ROOT/'lab',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    metadata = {'model':inputs['model.txt'].strip(),'agent':'shop-planner','user_task':inputs['user-task.txt'].rstrip('\n'),
                'before_directory':str(BEFORE),'source_sha256':hashlib.sha256((ROOT/'lab/service.py').read_bytes()).hexdigest(),
                'agent_config_sha256':hashlib.sha256((ROOT/'opencode.json').read_bytes()).hexdigest(),'calls':[]}
    opener = build_opener(ProxyHandler({}),NoRedirect)
    def save(name,value):
        with (run/name).open('x') as file:
            json.dump(value,file,ensure_ascii=False,indent=2); file.write('\n')
    try:
        startup=[process.stdout.readline().strip(),process.stdout.readline().strip()]
        base=startup[0].removeprefix('Local exercise: ')
        assert urlsplit(base).hostname=='127.0.0.1' and urlsplit(base).scheme=='http'
        metadata['server']={'pid':process.pid,'command':process.args,'startup':startup}
        def http(name,method,path,body=None,auth=None):
            headers={'Content-Type':'application/json',**(auth or {})}
            wire=json.dumps(body,ensure_ascii=False) if body is not None else None
            req=Request(base+path,data=wire.encode() if wire is not None else None,headers=headers,method=method)
            try: response=opener.open(req,timeout=5)
            except HTTPError as error: response=error
            with response:
                raw=response.read().decode(); status=response.status; rh=dict(response.headers)
            try: data=json.loads(raw)
            except json.JSONDecodeError: data=raw
            save(name,{'request':{'method':method,'url':base+path,'headers':headers,'body':body,'wire_body':wire},
                       'response':{'status':status,'headers':rh,'raw_body':raw,'body':data}})
            print(name,status,flush=True)
            return status,data
        status,login=http('login-http.json','POST','/login',{'username':'alice','password':'learn-alice'})
        assert status==200
        auth={'X-Token':login['token']}
        http('initial-receipt-http.json','GET','/files?path=receipt.txt',auth=auth)
        status,reviews=http('initial-reviews-http.json','GET','/reviews/view')
        assert status==200 and reviews=='<html><body></body></html>'
        query=urlencode({'order_id':'1','question':metadata['user_task']})
        def model_call(label):
            status,context=http(label+'-context-http.json','GET','/assistant/context?'+query,auth=auth)
            assert status==200
            context_file=run/(label+'-context.txt'); context_file.write_text(context['prompt'])
            diff=''.join(difflib.unified_diff(inputs[label+'-context.txt'].splitlines(True),context['prompt'].splitlines(True),fromfile='Before',tofile='After'))
            (run/(label+'-context-before-after.diff')).write_text(diff)
            command=['opencode','run','--agent','shop-planner','--model',metadata['model'],'--format','json','--file',str(context_file),metadata['user_task']]
            entry={'scenario':label,'command':command,'cwd':str(ROOT)}; metadata['calls'].append(entry)
            with (run/(label+'-opencode-raw.jsonl')).open('x') as stdout, (run/(label+'-opencode-stderr.txt')).open('x') as stderr:
                result=subprocess.run(command,cwd=ROOT,stdout=stdout,stderr=stderr,timeout=180)
            entry['exit_code']=result.returncode
            if result.returncode: raise RuntimeError('OpenCode/model unavailable; see preserved output for '+label)
            events=[json.loads(line) for line in (run/(label+'-opencode-raw.jsonl')).read_text().splitlines() if line.strip()]
            if any(e.get('type')=='error' for e in events): raise RuntimeError('OpenCode error event; no decision fabricated')
            texts=[e['part']['text'] for e in events if e.get('type')=='text' and 'text' in e.get('part',{})]
            if not texts: raise RuntimeError('No actual assistant text; stopping')
            answer=''.join(texts); (run/(label+'-model-output.txt')).write_text(answer)
            decision=json.loads(answer)
            if not isinstance(decision,dict) or not isinstance(decision.get('tool'),str) or not isinstance(decision.get('arguments'),dict):
                raise RuntimeError('Invalid actual model decision; no execution or fabrication')
            save(label+'-decision.json',decision)
            # Current executor refuses deletion and enforces receipt/role access itself.
            http(label+'-execution-http.json','POST','/assistant/execute',{'decision':decision},auth)
            print(label,'actual model decision:',json.dumps(decision,ensure_ascii=False),flush=True)
        model_call('normal')
        status,_=http('attack-review-http.json','POST','/reviews',{'product':'chair','text':inputs['attack-review.txt']},auth)
        assert status==201
        model_call('attack')
        http('forced-export-execution-http.json','POST','/assistant/execute',{'decision':{'tool':'export_profiles','arguments':{}}},auth)
        http('final-orders-http.json','GET','/orders',auth=auth)
        http('final-receipt-http.json','GET','/files?path=receipt.txt',auth=auth)
        http('final-reviews-http.json','GET','/reviews/view')
        metadata['completed']=True
    except Exception as error:
        metadata['completed']=False; metadata['error']=f'{type(error).__name__}: {error}'
        print(metadata['error'],flush=True)
    finally:
        process.send_signal(signal.SIGINT); process.wait(timeout=10)
        metadata['server_stopped']=True
        metadata['before_unchanged']=all(Path(p).is_file() and hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in before_hashes.items())
        save('experiment.json',metadata)
    return 0 if metadata['completed'] else 1

if __name__=='__main__':
    raise SystemExit(main())
