# Интерфейсы и проверка единого контракта

Phase 1 Spec Kit. **Нормативный API — только [docs/sdd/kanban-api-contract.md](../../../docs/sdd/kanban-api-contract.md).** Это индекс реализации/проверок, а не второй протокол или новая редакция согласованных требований. [UI v2](../../001-kanban-ui/spec-v2.md) и [Backend v2](../../002-kanban-backend/spec-v2.md) используют один этот нормативный источник. Здесь не выбираются дополнительные поля, коды или заголовки.

## Отображение на интерфейсы приложения

| Интерфейс | Нормативное место | Будущая реализация / обязательная проверка |
| --- | --- | --- |
| Полная Task, POST/PATCH модели, defaults/omission/null | [контракт §2](../../../docs/sdd/kanban-api-contract.md#L17-L74) | frontend features/kanban/types.ts + response decoder; backend tasks/types.py + validation.py;9 полей,5 пользовательских, строгий integer, дата/UTC/Unicode |
| POST /api/tasks | [§3](../../../docs/sdd/kanban-api-contract.md#L76-L122), [§5.1](../../../docs/sdd/kanban-api-contract.md#L153-L164) | api.createTask/routes→storage.create:201 Task/Location; повтор200 только version1/совпавший нормализованный ввод;409 ID конфликт/retired |
| GET /api/tasks | [§3](../../../docs/sdd/kanban-api-contract.md#L76-L88) | api.listTasks:200 items/total,полная выдача, пусто только при успешном пустом SELECT; stable moment/id |
| GET /api/tasks/{id} | [§3–4](../../../docs/sdd/kanban-api-contract.md#L76-L149) | api.getTask:полная200 либо404 после валидации; используется для отдельного просмотра и сверки |
| PATCH /api/tasks/{id} | [§4](../../../docs/sdd/kanban-api-contract.md#L124-L149) | api.patchTask:expected version+≥1 field; no-op/старый no-op/max/конкуренция;200 полная Task |
| DELETE /api/tasks/{id} | [§3–4](../../../docs/sdd/kanban-api-contract.md#L76-L149) | api.deleteTask:ровно1 canonical query version,204 без JSON;атомарная отметка;повтор404 |
| GET /api/health | [§1](../../../docs/sdd/kanban-api-contract.md#L7-L15) | существующие checkHealth/main.py/test_health.py сохраняются, не проверяют task-хранилище |
| Ошибки и priority | [§6](../../../docs/sdd/kanban-api-contract.md#L188-L279) | validation/error builder/router handlers; UI code→state/field, не message;405 Allow, no trace |
| Client Intent/recovery | [§5.2–5.3](../../../docs/sdd/kanban-api-contract.md#L166-L186) | creationIntent/useKanban:immutable serialized POST,session fallback,GET перед явным retry,отдельный draft |
| Storage boundary | [§7](../../../docs/sdd/kanban-api-contract.md#L281-L287) | storage:файл/транзакции/сохранность/ошибки;UI не использует SQLite напрямую |

Content-Type, разрешённость query/тел и ошибки формы — §1/§6; существующий framework не добавляет альтернативный формат. Поскольку input разбирается вручную ради приоритетов, будущие FastAPI route descriptions/OpenAPI должны явно отражать request schemas/statuses/headers; нельзя считать схему, автоматически полученную из одного Request-параметра, полной. Генерацию проверять по нормативному документу, не наоборот.

## Матрица ошибок как критерий тестирования

Должны быть проверены все11 пар HTTP/error.code из §6.1 и все17 details.code из §6.2, включая сохранение состояния на отказе. Набор вложенных кодов: missing, invalid_type, invalid_length, invalid_value, invalid_format, invalid_date, invalid_characters, invalid_unicode, unknown_field, read_only, unknown_parameter, duplicate_parameter, empty_update, body_not_allowed, stale_version, id_conflict, retired. Version_exhausted — верхний code/details=[], не восемнадцатая деталь.

Независимые ошибки собираются/сортируются field/code, зависимые прекращаются после первого отказа поля. Обязательные пересечения:

- Неизвестное/известное запрещённое имя раньше значения: PATCH id:null →read_only; PATCH title:null →invalid_type; неизвестное поле с null →unknown_field. Исправление F-01 принято, общее правило null не перекрывает классификацию имени.
- Content-Type раньше JSON; повтор ключа JSON →400; корректный массив/null вместо объекта →422.
- Unicode раньше длины, длина раньше управляющих; крайний TAB title удалён точной обрезкой, внутренний запрещён; description сохраняет свои пробелы/допустимые переносы.
- DELETE duplicate version раньше syntax/value; 01 —invalid_format, каноническое превышение —invalid_value; неверный запрос422 даже для отсутствующего ID.
- После валидации: отсутствие404 →конфликт version409 →no-op →исчерпание. Актуальный no-op и DELETE разрешены на максимуме; совпавшие поля не разрешают старую версию.

Для примеров статусов/оболочек и точных значений обращаться к §6.4, не дублировать тексты как машинные идентификаторы. HTTP/code/details и неизменность всей записи проверяются через существующий pytest/httpx; UI-отображение и неизвестный ответ — отдельно через браузер/декодер.

## Сквозные доказательства

После фактического выполнения POST/PATCH/DELETE скрыть ответ от браузера, затем проверить GET из независимого клиента и UI-восстановление; до commit/внутри транзакции fault injection проверяет другие условия и не подменяет потерю ответа. POST→удаление другой вкладкой→retry исходного тела послеGET404, в том числе после restart: task_id_retired, не новая Task. Это обязательный сценарий закрытой F-02, без автоматического повтора/нового UUID.

У каждого будущего теста фиксируются ссылка на UI S/FR/SC или Backend AC/FR, раздел контракта, setup, запрос/действие и наблюдаемое состояние. Фикстуры и код тестов создаются на этапе реализации, не в этом каталоге. Полная программа — [quickstart.md](../quickstart.md), решения — [plan.md](../plan.md), [data-model.md](../data-model.md).
