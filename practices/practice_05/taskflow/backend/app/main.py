from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException

from app.config import resolve_database_path
from app.tasks.errors import TaskError
from app.tasks.routes import error_response, router


def create_app(database_path: str | Path | None = None) -> FastAPI:
    application = FastAPI(title='TaskFlow API')
    # Resolving configuration does not open or initialize any database.
    application.state.database_path = resolve_database_path(database_path)
    application.include_router(router)
    original_openapi = application.openapi

    def contract_openapi():
        schema = original_openapi()
        # FastAPI's exclude_none strips JSON Schema default:null; restore it.
        schema['paths']['/api/tasks']['post']['requestBody']['content']['application/json']['schema']['properties']['due_date']['default'] = None
        return schema

    application.openapi = contract_openapi

    @application.exception_handler(HTTPException)
    async def route_error(request: Request, error: HTTPException):
        path = request.url.path
        item = path.startswith('/api/tasks/') and bool(path[len('/api/tasks/'):]) and '/' not in path[len('/api/tasks/'):]
        if error.status_code == 405 and (path == '/api/tasks' or item):
            allow = 'GET, PATCH, DELETE' if item else 'GET, POST'
            return error_response(TaskError('method_not_allowed', allow=allow))
        return await http_exception_handler(request,error)

    @application.get('/api/health')
    def health() -> dict[str, str]:
        return {'status': 'ok'}

    return application


app = create_app()
