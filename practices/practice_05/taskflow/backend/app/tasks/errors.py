"""Closed contract error vocabulary, independent of FastAPI handlers."""
from dataclasses import asdict, dataclass
from typing import Literal

DetailCode = Literal[
    'missing', 'invalid_type', 'invalid_length', 'invalid_value', 'invalid_format',
    'invalid_date', 'invalid_characters', 'invalid_unicode', 'unknown_field',
    'read_only', 'unknown_parameter', 'duplicate_parameter', 'empty_update',
    'body_not_allowed', 'stale_version', 'id_conflict', 'retired',
]
DETAIL_MESSAGES: dict[DetailCode, str] = {
    'missing': 'Обязательное значение отсутствует',
    'invalid_type': 'Неверный тип значения',
    'invalid_length': 'Недопустимая длина текста',
    'invalid_value': 'Недопустимое значение',
    'invalid_format': 'Неверный формат значения',
    'invalid_date': 'Укажите существующую дату в формате ГГГГ-ММ-ДД',
    'invalid_characters': 'Текст содержит запрещённые управляющие символы',
    'invalid_unicode': 'Некорректная последовательность Unicode',
    'unknown_field': 'Неизвестное поле',
    'read_only': 'Поле запрещено в этой операции',
    'unknown_parameter': 'Неизвестный параметр запроса',
    'duplicate_parameter': 'Параметр запроса повторён',
    'empty_update': 'Передайте хотя бы одно изменяемое поле',
    'body_not_allowed': 'Тело запроса не допускается',
    'stale_version': 'Загрузите актуальную задачу перед новым изменением',
    'id_conflict': 'Идентификатор занят несовместимой задачей',
    'retired': 'Идентификатор удалённой задачи нельзя использовать повторно',
}
ERRORS = {
    'invalid_json': (400, 'Некорректный JSON'),
    'unsupported_media_type': (415, 'Ожидается application/json'),
    'validation_error': (422, 'Проверьте поля запроса'),
    'task_not_found': (404, 'Задача не найдена'),
    'version_conflict': (409, 'Задача была изменена'),
    'task_id_conflict': (409, 'Идентификатор задачи уже занят'),
    'task_id_retired': (409, 'Задача с этим идентификатором ранее удалена'),
    'version_exhausted': (409, 'Достигнут предел версии задачи'),
    'method_not_allowed': (405, 'Метод не поддерживается'),
    'storage_unavailable': (503, 'Хранилище задач временно недоступно'),
    'internal_error': (500, 'Внутренняя ошибка сервера'),
}
CONFLICT_DETAILS = {
    'version_conflict': ('version', 'stale_version'),
    'task_id_conflict': ('id', 'id_conflict'),
    'task_id_retired': ('id', 'retired'),
}


@dataclass(frozen=True)
class ErrorDetail:
    field: str
    code: DetailCode

    def to_dict(self):
        return {**asdict(self), 'message': DETAIL_MESSAGES[self.code]}


class TaskError(Exception):
    def __init__(self, code: str, details=(), *, allow: str | None = None):
        self.code = code
        self.status, self.message = ERRORS[code]
        if code in CONFLICT_DETAILS:
            details = (ErrorDetail(*CONFLICT_DETAILS[code]),)
        elif code != 'validation_error':
            details = ()
        self.details = tuple(sorted(details, key=lambda detail: (detail.field, detail.code)))
        self.headers = {'Allow': allow} if code == 'method_not_allowed' and allow else {}
        super().__init__(self.message)

    def to_dict(self):
        return {'error': {'code': self.code, 'message': self.message,
                          'details': [detail.to_dict() for detail in self.details]}}
