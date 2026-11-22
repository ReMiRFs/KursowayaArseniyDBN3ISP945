import assert from 'node:assert/strict';

const origin = new URL(process.env.ORDERS_BASE_URL ?? 'http://127.0.0.1:8080').origin;

export function apiSession() {
  let cookie = '';

  async function request(path, { method = 'GET', body, headers = {}, originHeader = origin } = {}) {
    const extra = {};
    if (cookie) extra.cookie = cookie;
    if (method !== 'GET' && originHeader) extra.origin = originHeader;
    const response = await fetch(origin + '/api/v1' + path, {
      method,
      headers: {
        ...extra,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('sid=')) cookie = setCookie.split(';', 1)[0];
    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;
    return { status: response.status, headers: response.headers, json };
  }

  async function expect(path, status, options) {
    const result = await request(path, options);
    assert.equal(result.status, status, (options?.method ?? 'GET') + ' ' + path + ' → ' + (result.json?.error?.code ?? result.status));
    return result;
  }

  return { expect, request, currentCookie: () => cookie };
}

export const credentials = {
  admin: { email: process.env.ORDERS_ADMIN_EMAIL || 'admin@example.test', password: process.env.ORDERS_ADMIN_PASSWORD },
  analyst: { email: process.env.ORDERS_ANALYST_EMAIL || 'analyst@example.test', password: process.env.ORDERS_ANALYST_PASSWORD },
};

export function requireDemoPassword(role) {
  if (!credentials[role].password) throw new Error('Укажите ORDERS_' + role.toUpperCase() + '_PASSWORD.');
}

export function login(session, role) {
  requireDemoPassword(role);
  return session.expect('/auth/login', 200, { method: 'POST', body: credentials[role] });
}
