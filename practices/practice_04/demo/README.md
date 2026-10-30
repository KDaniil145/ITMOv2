ParcelBot (Практика 4)

Кратко
- Минимальный учебный проект для демонстрации TDD и работы с AI-агентами.
- Одна функция choose_belt(weight), которая по весу посылки выбирает конвейер.
- Основная логика (service.py) использует только стандартную библиотеку Python; MCP‑сервер (mcp_server.py) использует FastMCP для инструментов route_parcel и route_parcels.

Контракт (исходная версия)
- Вход: weight — вес посылки в килограммах (число).
- Поведение:
  - weight <= 10 возвращает "standard"
  - weight > 10 возвращает "heavy"
- Примеры (покрыто тестами): 5 -> standard, 10 -> standard, 15 -> heavy

Интерфейс
- service.choose_belt(weight, priority=False) -> str
 - MCP-инструменты:
   - route_parcel(weight: float, priority: bool = False) -> str
   - route_parcels(parcels: list of objects) -> list of objects

route_parcels — контракт
- Вход: параметр `parcels` — список объектов вида { `weight`: number (обязателен), `priority`: boolean? (необязателен, по умолчанию false) }
- Выход: список той же длины и порядка, каждый элемент содержит ровно одно поле:
  - Успех: {"belt": "standard" | "express" | "heavy"}
  - Доменная ошибка (числовой weight ≤ 0): {"error": "weight must be positive"}
- Некорректные аргументы отклоняются FastMCP до выполнения инструмента и могут приводить к ошибке вызова (is_error) или исключению валидации на стороне клиента.

Примеры
- Вход: {"parcels": [{"weight": 5}, {"weight": 10, "priority": true}, {"weight": 15}]}
  → [{"belt": "standard"}, {"belt": "express"}, {"belt": "heavy"}]
- Вход: {"parcels": [{"weight": -1}, {"weight": 5}, {"weight": 0}]}
  → [{"error": "weight must be positive"}, {"belt": "standard"}, {"error": "weight must be positive"}]

Как запустить тесты
- make test

Ограничения
- Бизнес-логика в service.py не требует внешних зависимостей; MCP‑сервер использует FastMCP.
- Исходный код минимален.

Текущее поведение (с учётом фичи A и B)
- weight <= 0 вызывает ValueError (независимо от priority)
- 0 < weight <= 10:
  - при priority=False возвращает "standard"
  - при priority=True возвращает "express"
- weight > 10 возвращает "heavy" (независимо от priority)

Планируемые фичи (НЕ реализованы)
— нет

Правила для агентов см. в AGENTS.md.
