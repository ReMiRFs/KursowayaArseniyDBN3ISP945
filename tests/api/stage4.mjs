import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiSession, credentials, login, requireDemoPassword } from './client.mjs';

const admin = apiSession();
const analyst = apiSession();
const guest = apiSession();
const stats = '/statistics?from=2026-11-16&to=2026-11-24';

requireDemoPassword('admin');
requireDemoPassword('analyst');
await guest.expect(stats, 401);
await guest.expect('/auth/me', 401);
const wrongPassword = await guest.expect('/auth/login', 401, {
  method: 'POST', body: { email: credentials.admin.email, password: 'invalid-demo-password' },
});
const unknownUser = await guest.expect('/auth/login', 401, {
  method: 'POST', body: { email: 'unknown@example.test', password: 'invalid-demo-password' },
});
assert.deepEqual(wrongPassword.json, unknownUser.json);
await guest.expect('/auth/login', 403, { method: 'POST', body: credentials.admin, originHeader: null });

const adminLogin = await login(admin, 'admin');
const analystLogin = await login(analyst, 'analyst');
assert.equal(adminLogin.json.user.role, 'admin');
assert.equal(analystLogin.json.user.role, 'analyst');
const sid = adminLogin.headers.get('set-cookie') ?? '';
assert(/;\s*httponly/i.test(sid) && /;\s*samesite=lax/i.test(sid));
assert(/;\s*max-age=43200/i.test(sid));
assert(/^sid=[\w-]{43};/.test(sid), 'Unexpected opaque session token format');
assert.deepEqual(Object.keys(adminLogin.json.user).sort(), ['email', 'id', 'role']);
assert.deepEqual((await admin.expect('/auth/me', 200)).json, adminLogin.json);
await analyst.expect('/orders', 403);
await analyst.expect('/sales-channels', 403);
await analyst.expect('/orders/1', 403, { method: 'PATCH', body: { status: 'completed' } });
await analyst.expect('/sales-channels', 403, { method: 'POST', body: { name: 'Запрет роли' } });
await admin.expect('/sales-channels', 403, { method: 'POST', body: { name: 'Запрет origin' }, originHeader: 'http://other.example.test' });
console.log('OK: вход, сессии, ответы 401/403, роли и Origin.');

const baseline = (await admin.expect(stats, 200)).json;
assert.deepEqual((await analyst.expect(stats, 200)).json, baseline);
assert.deepEqual(baseline.totals, { orders: 3, completedOrders: 1, revenueKopecks: 200000, averageCheckKopecks: 200000 });
assert.deepEqual(baseline.dailyOrders.map(item => item.count), [1, 0, 0, 0, 0, 1, 0, 1, 0]);
assert.deepEqual(baseline.weeklyRevenue.map(item => item.revenueKopecks), [200000, 0]);
const day = async (date) => (await admin.expect('/statistics?from=' + date + '&to=' + date, 200)).json.totals;
assert.equal((await day('2026-11-16')).revenueKopecks, 200000);
assert.equal((await day('2026-11-25')).revenueKopecks, 90000);
assert.deepEqual(await day('2026-11-26'), { orders: 0, completedOrders: 0, revenueKopecks: 0, averageCheckKopecks: null });
assert.deepEqual(await day('2026-11-27'), { orders: 1, completedOrders: 1, revenueKopecks: 0, averageCheckKopecks: 0 });
for (const query of [
  'from=2026-11-24&to=2026-11-16', 'from=2026-02-30&to=2026-03-02', 'from=2026-11-24',
  'from=2024-01-01&to=2025-01-01', 'from=2026-11-16&from=2026-11-17&to=2026-11-24',
]) {
  const invalid = await admin.expect('/statistics?' + query, 400);
  assert.ok(invalid.json.error.fields);
}
const largest = await admin.expect('/statistics?from=2024-01-01&to=2024-12-31', 200);
assert.equal(largest.json.dailyOrders.length, 366);
console.log('OK: метрики, дни, недели, границы дат, пустой период и лимит 366 дней.');

const channels = (await admin.expect('/sales-channels', 200)).json.items;
const site = channels.find(item => item.name === 'Сайт');
assert(site);
await admin.expect('/sales-channels/' + site.id, 409, { method: 'DELETE' });
await admin.expect('/sales-channels', 409, { method: 'POST', body: { name: 'сАйТ' } });
const name = 'Проверка ' + randomUUID().slice(0, 8);
const createChannel = await admin.expect('/sales-channels', 201, { method: 'POST', body: { name: ' ' + name + ' ' } });
assert.equal(createChannel.json.name, name);
const channel = '/sales-channels/' + createChannel.json.id;
assert.equal(createChannel.headers.get('location'), '/api/v1' + channel);
assert.equal((await admin.expect(channel, 200)).json.name, name);
assert.equal((await admin.expect(channel, 200, { method: 'PATCH', body: { name: name + ' 2' } })).json.name, name + ' 2');
await admin.expect(channel, 204, { method: 'DELETE' });
await admin.expect(channel, 404);
await admin.expect('/sales-channels/0', 400);
console.log('OK: CRUD канала, уникальность кириллицы и ограничение внешнего ключа.');

const search = await admin.expect('/orders?q=z-104&from=2026-11-16&to=2026-11-24&status=processing', 200);
assert.deepEqual(search.json.items.map(item => item.number), ['Z-104']);
assert.equal(search.json.total, 1);
const siteOrders = await admin.expect('/orders?from=2026-11-16&to=2026-11-24&channelId=' + site.id, 200);
assert.deepEqual(siteOrders.json.items.map(item => item.number), ['Z-103', 'Z-102']);
assert.equal(siteOrders.json.total, 2);
assert.deepEqual((await admin.expect('/orders?q=%25_&page=2', 200)).json, { items: [], page: 2, pageSize: 20, total: 0 });
await admin.expect('/orders?page=0', 400);
await admin.expect('/orders?from=2026-11-24&to=2026-11-16', 400);
await admin.expect('/orders/not-a-number', 400);
const orderNumber = 'API-' + randomUUID().slice(0, 8).toUpperCase();
const initialOrder = { number: ' ' + orderNumber.toLowerCase() + ' ', channelId: site.id, totalKopecks: 0 };
await admin.expect('/orders', 400, { method: 'POST', body: { ...initialOrder, totalKopecks: -1 } });
await admin.expect('/orders', 400, { method: 'POST', body: { ...initialOrder, totalKopecks: null } });
await admin.expect('/orders', 400, { method: 'POST', body: { ...initialOrder, createdAt: '2026-11-01' } });
const order = await admin.expect('/orders', 201, { method: 'POST', body: initialOrder });
assert.equal(order.json.number, orderNumber);
assert.equal(order.json.totalKopecks, 0);
assert.equal(order.json.status, 'new');
assert(Number.isFinite(Date.parse(order.json.createdAt)));
await admin.expect('/orders', 409, { method: 'POST', body: initialOrder });
const orderPath = '/orders/' + order.json.id;
await admin.expect(orderPath, 405, { method: 'DELETE' });
await admin.expect(orderPath, 409, { method: 'PATCH', body: { status: 'completed', totalKopecks: 650 } });
assert.equal((await admin.expect(orderPath, 200)).json.totalKopecks, 0);
const changed = await admin.expect(orderPath, 200, { method: 'PATCH', body: { status: 'processing', totalKopecks: 650 } });
assert.equal(changed.json.status, 'processing');
assert.equal(changed.json.totalKopecks, 650);
await admin.expect(orderPath, 400, { method: 'PATCH', body: {} });
const contenders = await Promise.all([
  admin.request(orderPath, { method: 'PATCH', body: { status: 'cancelled' } }),
  admin.request(orderPath, { method: 'PATCH', body: { status: 'completed' } }),
]);
assert.deepEqual(contenders.map(item => item.status).sort(), [200, 409]);
const result = await admin.expect(orderPath, 200);
assert.equal(result.json.status, contenders.find(item => item.status === 200).json.status);
await admin.expect(orderPath, 409, { method: 'PATCH', body: { totalKopecks: 651 } });
console.log('OK: создание и изменение заказа, фильтры, статусы, отказ в удалении.');

const oldCookie = analyst.currentCookie();
await analyst.expect('/auth/logout', 204, { method: 'POST' });
await analyst.expect('/auth/me', 401, { headers: { cookie: oldCookie } });
await admin.expect('/auth/logout', 204, { method: 'POST' });
console.log('OK: после выхода старый идентификатор сессии недействителен.');
