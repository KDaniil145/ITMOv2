# MCP_DEMO — подтверждение работы собственного MCP

Этот документ подготовлен для практики 4. Проверено:
- Git-репозиторий: /home/daniil/ITMOv2-practice4
- Рабочая ветка: practice_04
- Файлы: demo/mcp_server.py, opencode.json

## 1. Назначение собственного MCP

- Инструмент MCP: route_parcel
- Реализация: demo/mcp_server.py
- Поведение: инструмент route_parcel делегирует бизнес-логику функции choose_belt из service.py.

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

Ниже — реальный код, которым мы проверяли подключение и вызовы инструмента route_parcel. Это уже проведённый эксперимент, подтверждённый выводом терминала.

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

        ok = await client.call_tool(
            "route_parcel",
            {"weight": 5, "priority": True}
        )
        print("Успешный вызов:", ok.data, "Ошибка:", ok.is_error)

        bad = await client.call_tool(
            "route_parcel",
            {"weight": -5},
            raise_on_error=False
        )
        print("Некорректный вес, ошибка:", bad.is_error)
        print("Сообщение:", bad.content[0].text)

asyncio.run(main())
PY
```

Ожидаемые и подтверждённые результаты:
- В списке инструментов присутствует 'route_parcel'.
- Для weight=5, priority=True выводит express и is_error=False.
- Для weight=-5 is_error=True и в сообщении содержится текст об ошибочном весе.

## 4. Подтверждённые результаты реального MCP-клиента

- Список инструментов сервера: ['route_parcel']

Корректный вызов:
- Вход: weight=5, priority=True
- Результат: express
- is_error=False

Некорректный вызов:
- Вход: weight=-5
- is_error=True
- Сообщение: "Error calling tool 'route_parcel': weight must be positive"

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
