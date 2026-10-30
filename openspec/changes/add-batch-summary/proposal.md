# Proposal

## Why

Существующая batch‑маршрутизация (route_parcels) возвращает пер‑элементные результаты (belt или error). Для операционных отчётов и мониторинга удобно получать агрегированную сводку по партии: общее количество, распределение по конвейерам и число доменных ошибок. Это снижает накладные расходы на клиентскую агрегацию и упрощает интеграции.

## What Changes

- Добавить новый MCP‑инструмент `route_parcels_summary`, который, используя существующую бизнес‑логику, возвращает агрегированную сводку по входному списку посылок
- Не изменять поведение `choose_belt`, `route_parcel` и `route_parcels`

## Capabilities

### New Capabilities
- `parcelbot/batch-summary`: сводка batch‑маршрутизации — total, counts по belt (standard/express/heavy), count ошибок

### Modified Capabilities
- (нет)

## Impact

- Код: practices/practice_04/demo/mcp_server.py (новый инструмент `route_parcels_summary`), без изменения логики `choose_bелt`/`route_parcel`/`route_parcels`
- Тесты: добавить сценарии для валидного списка, пустого списка и частичных ошибок
- Документация: README и MCP_DEMO — краткое описание и примеры
