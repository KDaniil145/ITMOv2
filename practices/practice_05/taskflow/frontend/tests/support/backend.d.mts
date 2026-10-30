export function fixture(action?: 'seed' | 'empty' | 'corrupt' | 'restore' | 'delete_first' | 'rename_first' | 'invalid_task' | 'retire' | 'id_conflict' | 'future_tasks' | 'max_first' | 'almost_max_first' | 'restart', id?: string): void;
export function ensureTestDirectory(path: string): void;
export function fixture(action: 'snapshot'): { tasks: import('../../src/features/kanban/types').Task[]; retired: string[] };
