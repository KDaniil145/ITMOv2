"""Strict transport and field validation before any storage access (API §§1/2/6)."""
from datetime import date
import json
import re
from uuid import UUID, RFC_4122

from .errors import ErrorDetail, TaskError
from .types import MAX_VERSION, TASK_FIELDS, USER_FIELDS, Operation, ValidatedRequest

WHITE_SPACE = ''.join(chr(c) for c in (
    *range(0x0009, 0x000E), 0x0020, 0x0085, 0x00A0, 0x1680,
    *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
))
DEFAULTS = {'description': '', 'status': 'todo', 'priority': 'medium', 'due_date': None}


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def _constant(_value):
    raise ValueError('non-JSON constant')


def _integer(token):
    # Every permitted numeric input is a bounded version. Preserve its JSON type,
    # but cap out-of-domain integers to avoid Python's decimal-conversion limit.
    digits = token.removeprefix('-')
    if len(digits) > 16:
        return -(MAX_VERSION + 1) if token.startswith('-') else MAX_VERSION + 1
    return int(token)


def decode_json(body: bytes):
    try:
        return json.loads(body.decode('utf-8'), object_pairs_hook=_object,
                          parse_constant=_constant, parse_int=_integer)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise TaskError('invalid_json') from error


def _field_code(field: str, value: object):
    if field == 'due_date' and value is None:
        return None
    if field == 'version':
        if type(value) is not int:
            return 'invalid_type'
        return None if 1 <= value <= MAX_VERSION else 'invalid_value'
    if not isinstance(value, str):
        return 'invalid_type'
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        return 'invalid_unicode'
    if field in {'title', 'description'}:
        minimum, maximum = (1, 200) if field == 'title' else (0, 5000)
        if not minimum <= len(value) <= maximum:
            return 'invalid_length'
        allowed_controls = '\n\r\t' if field == 'description' else ''
        if any((ord(ch) < 0x20 or ord(ch) == 0x7F) and ch not in allowed_controls for ch in value):
            return 'invalid_characters'
    elif field == 'id':
        try:
            parsed = UUID(value)
        except ValueError:
            return 'invalid_format'
        if str(parsed) != value or parsed.version != 4 or parsed.variant != RFC_4122:
            return 'invalid_format'
    elif field in {'status', 'priority'}:
        allowed = {'todo', 'in_progress', 'done'} if field == 'status' else {'low', 'medium', 'high'}
        if value not in allowed:
            return 'invalid_value'
    elif field == 'due_date':
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
            return 'invalid_date'
        try:
            date.fromisoformat(value)
        except ValueError:
            return 'invalid_date'
    return None


def _normalize(field: str, value: object):
    # Unicode validity is tested before trimming/length, even for edge characters.
    if field == 'title' and isinstance(value, str) and not any(0xD800 <= ord(c) <= 0xDFFF for c in value):
        return value.strip(WHITE_SPACE)
    return value


def validate_request(operation: Operation, *, body: bytes = b'', content_type: str | None = None,
                     query=(), task_id: str | None = None) -> ValidatedRequest:
    if operation not in {'create', 'list', 'get', 'patch', 'delete'}:
        raise ValueError('Unknown internal operation')
    data = {}
    details = []
    if operation in {'create', 'patch'}:
        if not content_type or content_type.split(';', 1)[0].strip().lower() != 'application/json':
            raise TaskError('unsupported_media_type')
        decoded = decode_json(body)
        if not isinstance(decoded, dict):
            details.append(ErrorDetail('$', 'invalid_type'))
        else:
            allowed = USER_FIELDS | ({'id'} if operation == 'create' else {'version'})
            required = {'id', 'title'} if operation == 'create' else {'version'}
            for name in required - decoded.keys():
                details.append(ErrorDetail(name, 'missing'))
            for name, value in decoded.items():
                if name not in allowed:
                    details.append(ErrorDetail(name, 'read_only' if name in TASK_FIELDS else 'unknown_field'))
                    continue
                normalized = _normalize(name, value)
                code = _field_code(name, normalized)
                if code:
                    details.append(ErrorDetail(name, code))
                else:
                    data[name] = normalized
            if operation == 'create':
                data = {**DEFAULTS, **data}
            elif not details and not USER_FIELDS.intersection(decoded):
                details.append(ErrorDetail('$', 'empty_update'))
    elif body:
        details.append(ErrorDetail('$', 'body_not_allowed'))

    parameters = {}
    for name, value in query:
        parameters.setdefault(name, []).append(value)
    for name in parameters:
        if operation != 'delete' or name != 'version':
            details.append(ErrorDetail(name, 'unknown_parameter'))
    if operation == 'delete':
        versions = parameters.get('version', [])
        if not versions:
            details.append(ErrorDetail('version', 'missing'))
        elif len(versions) != 1:
            details.append(ErrorDetail('version', 'duplicate_parameter'))
        elif not re.fullmatch(r'[1-9][0-9]*', versions[0]):
            details.append(ErrorDetail('version', 'invalid_format'))
        elif len(versions[0]) > 16 or int(versions[0]) > MAX_VERSION:
            details.append(ErrorDetail('version', 'invalid_value'))
        else:
            data['version'] = int(versions[0])
    if operation in {'get', 'patch', 'delete'}:
        code = 'missing' if task_id is None else _field_code('id', task_id)
        if code:
            detail = ErrorDetail('id', code)
            if detail not in details:
                details.append(detail)
    if details:
        raise TaskError('validation_error', details)
    return ValidatedRequest(operation, data, task_id)
