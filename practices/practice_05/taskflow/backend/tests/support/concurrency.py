"""Overlap real worker requests before SQLite BEGIN; no artificial writer lock."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading

@contextmanager
def synchronized_writes(monkeypatch):
    import app.tasks.storage as storage
    original=storage.connection
    gate=threading.Barrier(2)
    arrivals=[]
    def synchronized(path,*,write=False,fault=None):
        def checkpoint(point,db):
            if write and point=='before_begin':
                arrivals.append(threading.get_ident());gate.wait(timeout=10)
            if fault:fault(point,db)
        return original(path,write=write,fault=checkpoint)
    with monkeypatch.context() as patch:
        patch.setattr(storage,'connection',synchronized)
        yield arrivals

def pair(first,second):
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(first);b=pool.submit(second)
        return a.result(timeout=15),b.result(timeout=15)


@contextmanager
def ordered_writes(monkeypatch):
    """Both workers arrive before BEGIN; second waits for the first SQL COMMIT."""
    from contextvars import ContextVar
    import app.tasks.storage as storage
    role=ContextVar('test_write_role',default=-1)
    gate=threading.Barrier(2);committed=threading.Event();arrivals=[]
    original=storage.connection
    def synchronized(path,*,write=False,fault=None):
        def checkpoint(point,db):
            if write and point=='before_begin':
                current=role.get();assert current in (0,1)
                arrivals.append(current);gate.wait(timeout=10)
                if current==1:assert committed.wait(timeout=10)
            if write and point=='after_commit' and role.get()==0:committed.set()
            if fault:fault(point,db)
        return original(path,write=write,fault=checkpoint)
    def invoke(index,operation):
        token=role.set(index)
        try:return operation()
        finally:role.reset(token)
    with monkeypatch.context() as patch:
        patch.setattr(storage,'connection',synchronized)
        yield invoke,arrivals
