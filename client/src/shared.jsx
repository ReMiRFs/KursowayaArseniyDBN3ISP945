import { useEffect, useState } from 'react';

export function navigate(path, replace = false) {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

export function Link({ href, children, ...props }) {
  return <a href={href} {...props} onClick={event => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}

export function useRequest(load, keys) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, data: null, error: null });
    load(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ loading: false, data, error: null }); })
      .catch(error => { if (!controller.signal.aborted) setState({ loading: false, data: null, error }); });
    return () => controller.abort();
  }, [...keys, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}

export function ErrorMessage({ error, retry }) {
  if (!error) return null;
  return <div className="message message-error" role="alert">
    <p>{error.message}</p>
    {!!Object.keys(error.fields || {}).length && <ul>
      {Object.entries(error.fields).map(([field, message]) => <li key={field}>{message}</li>)}
    </ul>}
    {retry && <button className="button" type="button" onClick={retry}>Повторить</button>}
  </div>;
}

export function RequestState({ request, loadingText, children }) {
  if (request.loading) return <div className="panel loading-state" role="status">{loadingText}</div>;
  if (request.error) return <ErrorMessage error={request.error} retry={request.retry} />;
  return children(request.data);
}
