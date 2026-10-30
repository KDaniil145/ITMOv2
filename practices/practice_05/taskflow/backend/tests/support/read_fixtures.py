"""Offline fixtures for US1 browsers. Never exposed through the application API."""
import argparse
import json
import time
import uuid
from pathlib import Path
from app.tasks.storage import connection
from .fixtures import TEST_DATA_ROOT


def apply_fixture(control_path: str, action: str, task_id: str | None = None):
    control=Path(control_path).resolve()
    if control.parent != TEST_DATA_ROOT.resolve(): raise ValueError('Not a test control file')
    metadata=json.loads(control.read_text())
    path=Path(metadata['database']).resolve()
    if not path.is_relative_to(TEST_DATA_ROOT.resolve()) or path.parent==TEST_DATA_ROOT.resolve():
        raise ValueError('Not an isolated test database')
    if action=='restart':
        # Only the already-running owner restarts its own child; no arbitrary PID signal.
        token=str(uuid.uuid4());request=control.with_suffix('.restart-request')
        if request.exists():raise ValueError('Restart already requested')
        temporary=request.with_name(request.name+'.'+token)
        temporary.write_text(token);temporary.replace(request)
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            try:
                current=json.loads(control.read_text())
                if current.get('restart_token')==token:
                    if current['database']!=str(path) or current['pid']==metadata['pid']:
                        raise ValueError('Restart changed storage or did not create a new process')
                    return
            except (FileNotFoundError,json.JSONDecodeError):pass
            time.sleep(0.05)
        raise TimeoutError('Owned backend did not confirm restart')
    backup=path.with_suffix('.fixture-backup')
    if action=='corrupt':
        if backup.exists(): raise ValueError('Already corrupted')
        backup.write_bytes(path.read_bytes())
        path.write_bytes(b'corrupt test database')
        return
    if action=='restore':
        if backup.exists():
            path.write_bytes(backup.read_bytes()); backup.unlink()
        return
    if action=='snapshot':
        with connection(path) as db:
            cursor=db.execute('SELECT * FROM tasks ORDER BY created_at,id')
            names=[column[0] for column in cursor.description]
            return {'tasks':[dict(zip(names,row)) for row in cursor.fetchall()],
                    'retired':[row[0] for row in db.execute('SELECT id FROM retired_task_ids ORDER BY id')]}
    if backup.exists():
        path.write_bytes(backup.read_bytes()); backup.unlink()
    with connection(path,write=True) as db:
        if action in {'seed','empty'}:
            db.execute('DELETE FROM tasks'); db.execute('DELETE FROM retired_task_ids')
            for i in range(30 if action=='seed' else 0):
                id_=f'00000000-0000-4000-8000-{i:012x}'
                moment=f'2026-10-30T00:00:00.{i//2:06}Z'
                title=f'Задача {i:02}'
                description=('Полный текст '+('длинное описание 😀 '*50)) if i==0 else ('<img src=x onerror="window.injected=true">' if i==1 else '')
                db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',
                    (id_,title,description,['todo','in_progress','done'][i%3],['low','medium','high'][i%3],
                     '0001-01-01' if i%2==0 else None,moment,moment,1))
        elif action=='delete_first':
            id_='00000000-0000-4000-8000-000000000000'
            db.execute('INSERT INTO retired_task_ids VALUES (?)',(id_,))
            db.execute('DELETE FROM tasks WHERE id=?',(id_,))
        elif action=='rename_first':
            db.execute("UPDATE tasks SET title='Актуальное название',version=version+1 WHERE id='00000000-0000-4000-8000-000000000000'")
        elif action=='invalid_task':
            db.execute("UPDATE tasks SET title='' WHERE id='00000000-0000-4000-8000-000000000000'")
        elif action=='retire':
            if not task_id: raise ValueError('Missing test ID')
            db.execute('INSERT INTO retired_task_ids VALUES (?)',(task_id,))
            db.execute('DELETE FROM tasks WHERE id=?',(task_id,))
        elif action=='id_conflict':
            if not task_id: raise ValueError('Missing test ID')
            moment='2026-10-30T00:00:00.000001Z'
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',(task_id,'Существующая задача','','done','high',None,moment,moment,1))
        elif action in {'max_first','almost_max_first'}:
            version=9007199254740991 if action=='max_first' else 9007199254740990
            db.execute("UPDATE tasks SET version=? WHERE id='00000000-0000-4000-8000-000000000000'",(version,))
        elif action=='future_tasks':
            db.execute("UPDATE tasks SET created_at='9999-12-31T23:59:59.000001Z',updated_at='9999-12-31T23:59:59.000001Z'")
        else: raise ValueError('Unknown fixture action')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--control',required=True)
    parser.add_argument('--action',required=True,choices=['seed','empty','corrupt','restore','delete_first','rename_first','invalid_task','snapshot','retire','id_conflict','future_tasks','max_first','almost_max_first','restart'])
    parser.add_argument('--id')
    args=parser.parse_args()
    result=apply_fixture(args.control,args.action,args.id)
    if result is not None: print(json.dumps(result))
