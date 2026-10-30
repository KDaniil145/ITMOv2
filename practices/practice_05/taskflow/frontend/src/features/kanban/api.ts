import type { ApiError, CreateTaskRequest, PatchTaskRequest, Task, TaskList } from './types';
import { decodeApiError, decodeTask, decodeTaskList, InputError, isUuid, isVersion, ProtocolError, validateInput } from './validation';

export class KanbanApiError extends Error {
  constructor(readonly outcome: 'rejected' | 'unknown' | 'read_error',
    readonly reason: 'network' | 'protocol' | 'server' | 'api',
    readonly status?: number, readonly apiError?: ApiError) {
    super(outcome === 'unknown' ? 'Результат операции неизвестен. Сверьте состояние задачи.' :
      reason === 'api' ? 'Операция не выполнена. Проверьте данные и состояние задачи.' : 'Не удалось получить данные сервера. Повторите чтение.');
  }
}
function requireId(id: string) { if (!isUuid(id)) throw new InputError([{field:'id',code:'invalid_format'}]); }
function requireVersion(version: number) { if (!isVersion(version)) throw new InputError([{field:'version',code:'invalid_value'}]); }

export function createKanbanApi(fetcher: typeof fetch = fetch) {
  async function exchange<T>(url: string, method: string, decode: (input: unknown, response: Response) => T,
    body?: string, signal?: AbortSignal): Promise<T> {
    const write = method !== 'GET';
    let response: Response;
    try {
      response = await fetcher(url, {method, signal, ...(body === undefined ? {} : {body,headers:{'Content-Type':'application/json'}})});
    } catch {
      throw new KanbanApiError(write?'unknown':'read_error', 'network');
    }
    try {
      if (method === 'DELETE' && response.status === 204) return undefined as T;
      if (response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase() !== 'application/json') throw new ProtocolError();
      const input: unknown = await response.json();
      if (!response.ok) {
        const error = decodeApiError(input,response.status);
        if (error.code === 'method_not_allowed' && !response.headers.get('allow')) throw new ProtocolError();
        const server = error.code === 'internal_error' || error.code === 'storage_unavailable';
        throw new KanbanApiError(server?(write?'unknown':'read_error'):'rejected',server?'server':'api',response.status,error);
      }
      return decode(input,response);
    } catch (error) {
      if (error instanceof KanbanApiError) throw error;
      throw new KanbanApiError(write?'unknown':'read_error','protocol',response.status);
    }
  }
  return {
    listTasks(signal?: AbortSignal): Promise<TaskList> {
      return exchange('/api/tasks','GET',(body,response) => {
        if (response.status !== 200) throw new ProtocolError();
        return decodeTaskList(body);
      },undefined,signal);
    },
    getTask(id: string,signal?: AbortSignal): Promise<Task> {
      requireId(id);
      return exchange(`/api/tasks/${id}`,'GET',(body,response) => {
        const task = decodeTask(body);
        if (response.status !== 200 || task.id !== id) throw new ProtocolError();
        return task;
      },undefined,signal);
    },
    createTask(input: CreateTaskRequest | string,signal?: AbortSignal): Promise<Task> {
      // A saved intent may supply its original serialized body; never reserialize it.
      let parsed: unknown = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input); }
        catch { throw new InputError([{field:'$',code:'invalid_type'}]); }
      }
      const values = validateInput('create',parsed);
      const serialized = typeof input === 'string'?input:JSON.stringify(values);
      return exchange('/api/tasks','POST',(body,response) => {
        const task = decodeTask(body);
        if (![200,201].includes(response.status) || task.id !== values.id || task.version !== 1 ||
          task.created_at !== task.updated_at || Object.entries(values).some(([field,value]) => task[field as keyof Task] !== value) ||
          (response.status === 201 && response.headers.get('location') !== `/api/tasks/${task.id}`)) throw new ProtocolError();
        return task;
      },serialized,signal);
    },
    patchTask(id: string,input: PatchTaskRequest,signal?: AbortSignal): Promise<Task> {
      requireId(id);
      const values = validateInput('patch',input);
      return exchange(`/api/tasks/${id}`,'PATCH',(body,response) => {
        const task = decodeTask(body);
        if (response.status !== 200 || task.id !== id ||
          (task.version !== input.version && task.version !== input.version+1) ||
          Object.entries(values).some(([field,value]) => field !== 'version' && task[field as keyof Task] !== value)) throw new ProtocolError();
        return task;
      },JSON.stringify(values),signal);
    },
    deleteTask(id: string,version: number,signal?: AbortSignal): Promise<void> {
      requireId(id); requireVersion(version);
      return exchange(`/api/tasks/${id}?version=${version}`,'DELETE',() => { throw new ProtocolError(); },undefined,signal);
    },
  };
}
export const kanbanApi = createKanbanApi();
