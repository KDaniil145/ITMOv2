# Spec Delta

## Purpose
Агрегированная сводка по batch‑маршрутизации: вернуть общую численность входных элементов, распределение по конвейерам и количество доменных ошибок, не изменяя поведение существующих инструментов.

## ADDED Requirements

### Requirement: Return batch routing summary
Система SHALL предоставлять инструмент MCP `route_parcels_summary`, который принимает именованный параметр `parcels` — список объектов с `weight` (number, обязательный) и `priority` (boolean, необязательный, по умолчанию False) — и возвращает сводку:
- `total`: общее число элементов
- `standard`: количество элементов со значением {"belt": "standard"}
- `express`: количество элементов со значением {"belt": "express"}
- `heavy`: количество элементов со значением {"belt": "heavy"}
- `errors`: количество элементов со значением {"error": "..."}

#### Scenario: Empty input yields zero summary
- **WHEN** клиент вызывает `route_parcels_summary` с пустым списком `parcels`
- **THEN** система возвращает {"total": 0, "standard": 0, "express": 0, "heavy": 0, "errors": 0}

#### Scenario: Valid items counted by belts
- **WHEN** вход содержит элементы с корректным `weight` и различными `priority` в зоне 0 < weight ≤ 10 и > 10
- **THEN** система считает распределение по belt согласно правилам (standard/express/heavy) и отражает его в полях сводки

#### Scenario: Partial domain errors counted
- **WHEN** часть элементов имеет числовой `weight` ≤ 0
- **THEN** эти элементы учитываются в поле `errors`, а остальные считаются по belt

### Requirement: Reuse existing batch routing logic
Система MUST использовать существующую логику `route_parcels`/`choose_belt` для вычисления исходных per‑item результатов и считать сводку поверх них.

#### Scenario: No changes to existing tools
- **WHEN** клиент вызывает `route_parcel` или `route_parcels`
- **THEN** их поведение остаётся неизменным; `route_parcels_summary` — отдельный инструмент

### Requirement: Input validation boundary
Входные некорректные типы/структура отклоняются FastMCP до выполнения инструмента (аналогично `route_parcels`).

#### Scenario: Invalid arguments rejected pre-call
- **WHEN** `weight` нечисловой или отсутствует, `priority` неверного типа
- **THEN** вызов отклоняется до выполнения инструмента (ошибка вызова или исключение валидации на стороне клиента)
