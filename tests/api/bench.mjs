import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { apiSession, login } from './client.mjs';

const session = apiSession();
await login(session, 'analyst');
const path = '/statistics?from=2026-09-01&to=2026-09-30';
const warmup = 20;
const requests = 200;
const concurrency = 5;

async function measure() {
  const start = performance.now();
  const response = await session.expect(path, 200);
  const elapsed = performance.now() - start;
  assert.equal(response.json.totals.orders, 10000, 'В периоде замера нужно ровно 10 000 заказов.');
  return elapsed;
}

for (let i = 0; i < warmup; i++) await measure();
const samples = [];
let next = 0;
let errors = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < requests) {
    next++;
    try {
      samples.push(await measure());
    } catch (error) {
      errors++;
      if (errors === 1) console.error(error.message);
    }
  }
}));
samples.sort((left, right) => left - right);
const mean = samples.reduce((total, duration) => total + duration, 0) / samples.length;
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
console.log(JSON.stringify({ requests, concurrency, warmup, errors, meanMs: +mean.toFixed(2), p95Ms: p95 === undefined ? null : +p95.toFixed(2) }));
assert.equal(errors, 0);
assert(p95 <= 300, 'p95 выше цели в 300 мс');
await session.expect('/auth/logout', 204, { method: 'POST' });

if (process.env.ORDERS_ADMIN_PASSWORD) {
  const admin = apiSession();
  await login(admin, 'admin');
  const results = [];
  for (const page of [1, 2, 501]) {
    const { json } = await admin.expect('/orders?from=2026-09-01&to=2026-09-30&page=' + page, 200);
    assert.equal(json.page, page);
    assert.equal(json.total, 10000);
    assert.equal(json.items.length, page <= 2 ? 20 : 0);
    results.push(...json.items);
  }
  assert.equal(new Set(results.map(order => order.id)).size, 40);
  assert(results.every((order, index) => !index || Date.parse(order.createdAt) <= Date.parse(results[index - 1].createdAt)));
  await admin.expect('/auth/logout', 204, { method: 'POST' });
  console.log('OK: первые две страницы по 20 заказов, стабильная сортировка и пустая страница за пределом списка.');
}
