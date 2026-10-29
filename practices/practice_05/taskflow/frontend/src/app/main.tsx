import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { checkHealth } from '../lib/api';
import '../styles/index.css';
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
        <div className="workspace">ЛИЧНОЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Главная навигация">
          <a className="selected" href="#main">
            ◫ <span>Обзор</span>
            <span className="dot">•</span>
          </a>
          {['Доска', 'Календарь', 'Проекты'].map((name, i) => (
            <button disabled key={name}>
              <span>{['▦', '▣', '▱'][i]}</span>
              {name}
              <small>Скоро</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="note">
            Меньше шума.
            <br />
            Больше ясности.
          </div>
          <button
            className="theme"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
          >
            ◐ <span>Тёмная тема</span>
            <span className="switch">{theme === 'dark' ? 'Вкл' : 'Выкл'}</span>
          </button>
          <div className="profile">
            <span className="avatar">Я</span>
            <div>
              Моё пространство<small>Персональный планировщик</small>
            </div>
          </div>
        </div>
      </aside>
      <main id="main">
        <header>
          <span>
            Пространство / <strong>Обзор</strong>
          </span>
          <span className="tag">НАЧАЛО ПУТИ</span>
        </header>
        <section className="heading">
          <div className="eyebrow">ВАШ ЛИЧНЫЙ РИТМ</div>
          <h1>
            Место для больших планов<span>.</span>
          </h1>
          <p>Освободите голову для важного. Всё остальное займёт своё место.</p>
        </section>
        <section className="hero">
          <div>
            <span className="tag">НОВАЯ ГЛАВА</span>
            <h2>
              Хороший день начинается
              <br />с ясного плана.
            </h2>
            <p>
              Здесь скоро появятся ваши задачи, проекты и маленькие победы.
              <br />А пока — пространство, в котором приятно начать.
            </p>
            <span className="coming">✦ Ваше пространство готовится</span>
          </div>
          <div className="art" aria-hidden="true">
            <div className="orbit"></div>
            <div className="tile">✓</div>
            <span className="spark">✧</span>
          </div>
        </section>
        <section className="stats" aria-label="Будущая статистика">
          {['Задачи в фокусе', 'В процессе', 'Завершено'].map((label, i) => (
            <article key={label}>
              <span className="stat-icon">{['◎', '↗', '✓'][i]}</span>
              <h3>{label}</h3>
              <b>—</b>
              <p>Появятся вместе с задачами</p>
            </article>
          ))}
        </section>
        <section className="next">
          <div>
            <div className="eyebrow">ШАГ ЗА ШАГОМ</div>
            <h2>Всё важное — в одном месте</h2>
            <p>
              Следующий этап — доска задач: от первой идеи до готового
              результата.
            </p>
          </div>
          <span className="badge">Kanban · скоро</span>
        </section>
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
