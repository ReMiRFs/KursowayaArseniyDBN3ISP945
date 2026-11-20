import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Dashboard } from './dashboard.jsx';
import { Orders, OrderEditor } from './orders.jsx';
import { Channels } from './channels.jsx';
import { dateRange } from './model.js';
import { ErrorMessage, Link, navigate, RequestState, usePath, useRequest } from './shared.jsx';
import './styles.css';

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>;
}

function Login({ onLogin, expired }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await api('/auth/login', {
        method: 'POST',
        initial: true,
        body: { email: data.get('email'), password: data.get('password') },
      });
      onLogin(response.user);
    } catch (problem) {
      setError(problem);
    } finally {
      setPending(false);
    }
  }

  return <main id="main-content" className="login-shell" tabIndex="-1">
    <form className="panel login-panel" onSubmit={submit}>
      <h1>Вход</h1>
      <p className="muted">Войдите, чтобы посмотреть статистику заказов.</p>
      {expired && <p className="message" role="status">Сессия завершилась. Войдите снова.</p>}
      <label>Электронная почта
        <input name="email" type="email" maxLength={254} autoComplete="username" required />
      </label>
      <label>Пароль
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <ErrorMessage error={error} />
      <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Вход…' : 'Войти'}</button>
    </form>
  </main>;
}

function Application() {
  const [session, setSession] = useState(undefined);
  const [expired, setExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  const [period, setPeriod] = useState(dateRange);
  const path = usePath();
  const initialSession = useRequest(async signal => {
    try {
      const response = await api('/auth/me', { signal, initial: true });
      return { user: response.user };
    } catch (error) {
      if (error.status === 401) return { user: null };
      throw error;
    }
  }, []);
  const user = session === undefined ? initialSession.data?.user : session;
  const admin = user?.role === 'admin';
  const editorMatch = /^\/orders\/([1-9]\d*|new)$/.exec(path);
  const allowed = path === '/statistics' || (admin && (
    path === '/orders' || path === '/sales-channels' || editorMatch
  ));

  useEffect(() => {
    function expire() {
      setExpired(true);
      setSession(null);
    }
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  useEffect(() => {
    if (user === null && path !== '/login') navigate('/login', true);
    if (user && !allowed) navigate('/statistics', true);
  }, [user, path, allowed]);
  useEffect(() => {
    document.title = ({
      '/login': 'Вход', '/statistics': 'Статистика', '/orders': 'Заказы',
      '/sales-channels': 'Каналы продаж',
    }[path] || (editorMatch ? 'Заказ' : 'Статистика')) + ' · Статистика заказов';
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [path, user]);

  async function logout() {
    setLogoutError(null);
    setLoggingOut(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      setExpired(false);
      setSession(null);
      setPeriod(dateRange());
    } catch (error) {
      if (error.status !== 401) setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }

  function login(currentUser) {
    setExpired(false);
    setSession(currentUser);
    navigate('/statistics');
  }

  return <>
    <a className="skip-link" href="#main-content">К содержимому</a>
    <header className="app-header">
      <div className="shell header-inner">
        <div className="brand"><Mark />Статистика заказов</div>
        {user && <>
          <nav className="nav" aria-label="Разделы приложения">
            <Link href="/statistics" aria-current={path === '/statistics' ? 'page' : undefined}>Статистика</Link>
            {admin && <Link href="/orders" aria-current={path.startsWith('/orders') ? 'page' : undefined}>Заказы</Link>}
            {admin && <Link href="/sales-channels" aria-current={path === '/sales-channels' ? 'page' : undefined}>Каналы продаж</Link>}
          </nav>
          <div className="session"><span className="role-label">{admin ? 'Администратор' : 'Аналитик'}</span>
            <button type="button" className="button" onClick={logout} disabled={loggingOut}>Выйти</button></div>
        </>}
      </div>
    </header>
    {user === undefined && <main id="main-content" className="shell page" tabIndex="-1">
      <RequestState request={initialSession} loadingText="Проверяем сессию…">{() => null}</RequestState>
    </main>}
    {user === null && <Login onLogin={login} expired={expired} />}
    {user && <main id="main-content" className="shell page" tabIndex="-1">
      <ErrorMessage error={logoutError} />
      {(!allowed || path === '/statistics') && <Dashboard period={period} setPeriod={setPeriod} />}
      {admin && path === '/orders' && <Orders />}
      {admin && editorMatch && <OrderEditor key={editorMatch[1]} orderId={editorMatch[1]} />}
      {admin && path === '/sales-channels' && <Channels />}
    </main>}
  </>;
}

createRoot(document.getElementById('root')).render(<Application />);
