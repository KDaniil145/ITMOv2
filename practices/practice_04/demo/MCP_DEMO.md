# MCP_DEMO — подтверждение работы собственного MCP

Этот документ подготовлен для практики 4. Проверено:
- Git-репозиторий: /home/daniil/ITMOv2-practice4
- Рабочая ветка: practice_04
- Файлы: demo/mcp_server.py, opencode.json

## 1. Назначение собственного MCP

- Инструменты MCP: route_parcel, route_parcels
- Реализация: demo/mcp_server.py
- Поведение:
  - route_parcel делегирует бизнес-логику функции choose_belt из service.py
  - route_parcels обрабатывает список посылок, делегируя каждый элемент в choose_belt; пер‑элементные доменные ошибки возвращаются как {"error": "..."}

Пояснение полезности для AI-агента:
- Единый источник правил: логика маршрутизации посылок сосредоточена в одном месте (service.choose_belt), что предотвращает дублирование и расхождение поведения между агентом и тестами.
- Тестопригодность: правила проверяются юнит‑тестами (make test), а MCP лишь вызывает их как «чёрный ящик».
- Устойчивость к изменениям: обновление правил в service.py автоматически отражается в поведении инструмента без модификации сервера MCP.
- Простота интерфейса: агенту доступен простой инструмент route_parcel, не требующий знания внутренних деталей ParcelBot.

Текущая спецификация choose_belt(weight, priority=False):
- weight <= 0 -> ValueError (независимо от priority)
- 0 < weight <= 10 ->
  - при priority=True возвращает "express"
  - при priority=False возвращает "standard"
- weight > 10 -> "heavy" (независимо от priority)

## 2. Окружение

- Язык/рантайм: Python 3.14
- Библиотека MCP: FastMCP 4.0.11
- Изоляция: отдельное виртуальное окружение

Пример команд для подготовки окружения (Linux):

```bash
# Создать и активировать отдельное окружение
python3.14 -m venv ~/.venvs/parcelbot-mcp
source ~/.venvs/parcelbot-mcp/bin/activate

# Обновить инструменты установки (рекомендуется)
pip install --upgrade pip setuptools wheel

# Установить FastMCP нужной версии
pip install fastmcp==4.0.11

# Команды запуска (с явным контекстом директории)
# Если вы находитесь в корне репозитория:
python practices/practice_04/demo/mcp_server.py

# Если вы находитесь в директории demo:
python mcp_server.py

# Примечание: сервер использует транспорт stdio и ожидает подключения MCP‑клиента.
# Он не печатает диагностик в stdout и завершится при остановке клиента/процесса.
```

В opencode.json указаны абсолютные пути к интерпретатору Python и скрипту MCP:

```json
{
  "mcp": {
    "servers": {
      "parcelbot": {
        "type": "local",
        "command": [
          "/home/daniil/.venvs/parcelbot-mcp/bin/python",
          "/home/daniil/ITMOv2-practice4/practices/practice_04/demo/mcp_server.py"
        ]
      }
    }
  }
}
```

Важно: на другом компьютере абсолютные пути нужно адаптировать (изменить на фактические пути к вашему виртуальному окружению и рабочей директории проекта), иначе OpenCode не сможет запустить локальный MCP-сервер parcelbot.

## 3. Пример реального вызова через FastMCP Client (из demo)

Ниже — реальный код, которым мы проверяли подключение и вызовы инструментов route_parcel и route_parcels. Это уже проведённый эксперимент, подтверждённый выводом терминала.

```bash
# Выполнять из директории demo
~/.venvs/parcelbot-mcp/bin/python - <<'PY'
import asyncio
from pathlib import Path
from fastmcp import Client

async def main():
    async with Client(Path("mcp_server.py").resolve()) as client:
        tools = await client.list_tools()
        print("Инструменты:", [tool.name for tool in tools])

        # route_parcel: корректный и ошибочный вызовы
        ok = await client.call_tool("route_parcel", {"weight": 5, "priority": True})
        print("route_parcel OK:", ok.data, "Ошибка:", ok.is_error)

        bad = await client.call_tool("route_parcel", {"weight": -5}, raise_on_error=False)
        print("route_parcel BAD is_error:", bad.is_error)
        print("route_parcel BAD msg:", bad.content[0].text)

        # route_parcels: корректный батч
        bok = await client.call_tool(
            "route_parcels",
            {"parcels": [{"weight": 5}, {"weight": 10, "priority": True}, {"weight": 15}]}
        )
        print("route_parcels OK:", bok.data, "Ошибка:", bok.is_error)

        # route_parcels: частичные ошибки (доменные)
        bpartial = await client.call_tool(
            "route_parcels",
            {"parcels": [{"weight": -1}, {"weight": 5}, {"weight": 0}]}
        )
        print("route_parcels PARTIAL:", bpartial.data, "Ошибка:", bpartial.is_error)

        # route_parcels: ошибка валидации (отклонение до вызова)
        try:
            bbad = await client.call_tool("route_parcels", {"parcels": [{"priority": True}]})
            print("route_parcels BAD is_error:", bbad.is_error)
        except Exception as e:
            print("route_parcels BAD raised:", e)

asyncio.run(main())
PY
```

Ожидаемые и подтверждённые результаты:
- В списке инструментов присутствуют 'route_parcel' и 'route_parcels'.
- route_parcel: weight=5, priority=True → express, is_error=False; weight=-5 → is_error=True, сообщение об ошибке.
- route_parcels: корректный список → [{"belt": ...}] и is_error=False; частичные доменные ошибки → элементы с {"error": "weight must be positive"}, is_error=False; отсутствие weight/неверные типы → отклонение до вызова (исключение клиента).

## 4. Подтверждённые результаты реального MCP-клиента

- Список инструментов сервера: ['route_parcel', 'route_parcels']

Корректный вызов:
- route_parcel: вход weight=5, priority=True → express, is_error=False

Некорректный вызов:
- route_parcel: вход weight=-5 → is_error=True, сообщение: "Error calling tool 'route_parcel': weight must be positive"
- route_parcels: вход [{"weight": 5}, {"weight": 10, "priority": true}, {"weight": 15}] → [{"belt": "standard"}, {"belt": "express"}, {"belt": "heavy"}], is_error=False
- route_parcels: вход [{"weight": -1}, {"weight": 5}, {"weight": 0}] → [{"error": "weight must be positive"}, {"belt": "standard"}, {"error": "weight must be positive"}], is_error=False
- route_parcels: вход [{"priority": true}] → ошибка валидации FastMCP до вызова (исключение клиента)

Пояснение: некорректный вес приводит к ValueError в choose_belt; клиент MCP корректно передаёт ошибку как is_error=True с сообщением.

## 5. Доказательства (разделены по источникам)

- Реальные вызовы через FastMCP Client подтверждены выводом терминала:
  - Успешный вызов route_parcel(weight=5, priority=True) возвращает "express" без ошибок.
  - Ошибочный вызов route_parcel(weight=-5) возвращает is_error=True с сообщением об отрицательном весе.

- Подключение серверов OpenCode подтверждено скриншотом Connected.
  - Запуск parcelbot выполняется через местный интерпретатор из указанного виртуального окружения.

- Реальные вызовы самим агентом OpenCode пока не подтверждены журналом инструмента; имеется только текстовый отчёт агента.

## 6. Репликация

Шаги для повторения проверки на новой машине:
1) Создайте и активируйте виртуальное окружение, установите FastMCP 4.0.11 (см. раздел 2).
2) Склонируйте проект и переключитесь на ветку practice_04.
3) Адаптируйте абсолютные пути в opencode.json (раздел mcp.servers.parcelbot.command).
4) Запустите OpenCode и убедитесь, что оба сервера подключены (Connected: context7, parcelbot).
5) Вызовите инструмент route_parcel:
   - weight=5, priority=True -> ожидается "express", is_error=False
   - weight=-5 -> ожидается is_error=True с сообщением об ошибке
6) Дополнительно: запустите make test для проверки логики choose_belt.

---
Примечание: исходный код ParcelBot изменяется только в директории demo; конфигурации вне demo изменяются только при необходимости и с явным согласием.
