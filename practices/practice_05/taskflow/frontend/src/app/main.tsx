import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { checkHealth } from '../lib/api';
import '../styles/index.css';
import { KanbanBoard } from '../features/kanban/KanbanBoard';
function App() {
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const [health, setHealth] = useState('Проверяем соединение');
  useEffect(() => {
    const controller = new AbortController();
    checkHealth(controller.signal)
      .then(() => setHealth('API доступен'))
      .catch(() => {
        if (!controller.signal.aborted) setHealth('API недоступен');
      });
    return () => controller.abort();
  }, []);
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('taskflow-theme', next);
    } catch {
      /* Theme remains usable without storage. */
    }
  }
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#main">
          <span className="logo">✦</span> TaskFlow
        </a>
        <div className="sidebar-bottom">
          <button
            className="theme"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
          >
            ◐ <span>Тёмная тема</span>
            <span className="switch">{theme === 'dark' ? 'Вкл' : 'Выкл'}</span>
          </button>
        </div>
      </aside>
      <main id="main">
        <header>
          <strong>Kanban-доска</strong>
          <span className="tag">НАЧАЛО ПУТИ</span>
        </header>
        <KanbanBoard />
        <footer>
          <span>TaskFlow · Пространство для вашего следующего шага</span>
          <span role="status">● {health}</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
