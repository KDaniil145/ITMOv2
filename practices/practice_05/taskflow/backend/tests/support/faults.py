"""Internal transaction fault injection; no diagnostic HTTP API."""
from contextlib import contextmanager

@contextmanager
def fail_at(monkeypatch,point):
    import app.tasks.storage as storage
    original=storage.connection
    def broken(path,*,write=False,fault=None):
        def checkpoint(name,db):
            if write and name==point:raise OSError('test-only storage boundary')
            if fault:fault(name,db)
        return original(path,write=write,fault=checkpoint)
    with monkeypatch.context() as patch:
        patch.setattr(storage,'connection',broken)
        yield
