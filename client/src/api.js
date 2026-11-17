export class ApiError extends Error {
  constructor(status, details) {
    super(details?.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
    this.status = status;
    this.fields = details?.fields || {};
  }
}

export async function api(path, { method = 'GET', body, signal, initial = false } = {}) {
  const response = await fetch('/api/v1' + path, {
    method,
    signal,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !initial) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, payload?.error);
  }
  if (payload === null) throw new Error('Сервер вернул пустой ответ.');
  return payload;
}

export function query(params) {
  const values = Object.entries(params).filter(([, value]) => value !== '' && value != null);
  return new URLSearchParams(values).toString();
}
