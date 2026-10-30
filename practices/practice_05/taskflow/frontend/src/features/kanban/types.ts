export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const MAX_VERSION = 9007199254740991;
export type Status = typeof STATUSES[number];
export type Priority = typeof PRIORITIES[number];

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: Status;
  readonly priority: Priority;
  readonly due_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}
export type UserFields = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date'>;
export type CreateTaskRequest = Pick<Task, 'id' | 'title'> & Partial<Omit<UserFields, 'title'>>;
export type PatchTaskRequest = { version: number } & Partial<UserFields> & {
  [K in keyof UserFields]: Pick<UserFields, K>
}[keyof UserFields];
export interface TaskList { items: Task[]; total: number }
export const DETAIL_CODES = [
  'missing', 'invalid_type', 'invalid_length', 'invalid_value', 'invalid_format',
  'invalid_date', 'invalid_characters', 'invalid_unicode', 'unknown_field', 'read_only',
  'unknown_parameter', 'duplicate_parameter', 'empty_update', 'body_not_allowed',
  'stale_version', 'id_conflict', 'retired',
] as const;
export type DetailCode = typeof DETAIL_CODES[number];
export interface ValidationDetail { field: string; code: DetailCode; message: string }
export const ERROR_STATUS = {
  invalid_json: 400, unsupported_media_type: 415, validation_error: 422,
  task_not_found: 404, version_conflict: 409, task_id_conflict: 409,
  task_id_retired: 409, version_exhausted: 409, method_not_allowed: 405,
  storage_unavailable: 503, internal_error: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
export interface ApiError { code: ErrorCode; message: string; details: ValidationDetail[] }
