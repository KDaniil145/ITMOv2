"""Validated representations; runtime validation is explicit, without coercion."""
from dataclasses import dataclass
from typing import Literal, TypedDict

MAX_VERSION = 9007199254740991
Status = Literal['todo', 'in_progress', 'done']
Priority = Literal['low', 'medium', 'high']
Operation = Literal['create', 'list', 'get', 'patch', 'delete']
USER_FIELDS = frozenset({'title', 'description', 'status', 'priority', 'due_date'})
TASK_FIELDS = USER_FIELDS | {'id', 'created_at', 'updated_at', 'version'}


class Task(TypedDict):
    id: str
    title: str
    description: str
    status: Status
    priority: Priority
    due_date: str | None
    created_at: str
    updated_at: str
    version: int


@dataclass(frozen=True)
class ValidatedRequest:
    operation: Operation
    data: dict[str, object]
    task_id: str | None = None
