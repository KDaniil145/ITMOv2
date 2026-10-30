# parcelbot/batch-routing Specification

## Purpose
Пакетная (batch) маршрутизация: за один вызов MCP‑инструмента обрабатывать список посылок и вернуть для каждой выбранный конвейер либо ошибку, не прерывая обработку остальных.

## Requirements

### Requirement: Route multiple parcels in one call
Система SHALL предоставлять инструмент MCP `route_parcels`, принимающий именованный параметр `parcels` — список объектов — и возвращающий список результатов той же длины и в исходном порядке.

#### Scenario: Empty input returns empty list
- **WHEN** клиент вызывает `route_parcels` с пустым списком посылок
- **THEN** система возвращает пустой список результатов

#### Scenario: All valid items succeed
- **WHEN** клиент передает список посылок с корректным весом для каждой
- **THEN** система возвращает для каждой посылки результат в формате {"belt": "standard"|"express"|"heavy"} по действующим правилам

#### Scenario: Mixed priority flags
- **WHEN** входной список содержит элементы с `priority=True` и `priority=False` в зоне 0 < weight ≤ 10
- **THEN** результаты отражают приоритет: для `priority=True` — {"belt": "express"}, для `priority=False` — {"belt": "standard"}

### Requirement: Per-item error isolation
Система MUST обрабатывать доменные ошибки отдельных элементов без прерывания всей операции и возвращать ошибку только в результате соответствующего элемента.

#### Scenario: Partial failures do not stop processing
- **WHEN** входной список содержит как корректные, так и некорректные по весу элементы (weight ≤ 0)
- **THEN** для некорректных элементов результат содержит {"error": "weight must be positive"}, а корректные элементы получают свои конвейеры в формате {"belt": "..."}

### Requirement: Reuse single-parcel routing rules
Система MUST использовать существующую бизнес‑логику `choose_belt(weight, priority=False)` для вычисления результата каждого элемента.

#### Scenario: Heavy weight remains heavy
- **WHEN** элемент имеет weight > 10 и любой `priority`
- **THEN** результат — {"belt": "heavy"}

#### Scenario: Standard vs express below or equal to 10
- **WHEN** элемент имеет 0 < weight ≤ 10 и `priority=False`
- **THEN** результат — {"belt": "standard"}

#### Scenario: Express on priority below or equal to 10
- **WHEN** элемент имеет 0 < weight ≤ 10 и `priority=True`
- **THEN** результат — {"belt": "express"}

### Requirement: Backward compatibility for existing tools
Добавление `route_parcels` MUST NOT изменять публичное поведение `choose_belt` и `route_parcel`.

#### Scenario: Existing tools unchanged
- **WHEN** клиент вызывает существующий инструмент `route_parcel` или функцию `choose_belt`
- **THEN** их поведение полностью соответствует текущим правилам проекта

### Requirement: Result shape and domain
Система MUST возвращать список результатов той же длины и порядке, что и `parcels`. Каждый элемент результата содержит ровно одно из полей:
- {"belt": one of ["standard","express","heavy"]}
- {"error": string}

#### Scenario: Exactly one field per item
- **WHEN** инструмент формирует результаты для каждого входного элемента
- **THEN** в каждом элементе присутствует ровно одно из полей: либо `belt`, либо `error`

### Requirement: Input contract and validation scope
Инструмент MUST принимать именованный параметр `parcels` — список объектов, где у каждого объекта `weight` (number) обязателен, а `priority` (boolean) необязателен и по умолчанию False.

#### Scenario: Valid input
- **WHEN** `parcels` содержит объекты с числовым `weight` и необязательным `priority`
- **THEN** вход считается корректным, и обработка выполняется согласно правилам и формату результатов

#### Scenario: FastMCP rejects invalid arguments
- **WHEN** FastMCP отклоняет аргументы до вызова инструмента (например, нечисловой/отсутствующий `weight` или неверная структура)
- **THEN** пакетная обработка не начинается, и вызов инструмента завершается ошибкой на уровне вызова

#### Scenario: Domain error for non-positive weight
- **WHEN** элемент имеет числовой `weight` ≤ 0
- **THEN** соответствующий элемент получает {"error": "weight must be positive"}, а остальные элементы обрабатываются дальше
