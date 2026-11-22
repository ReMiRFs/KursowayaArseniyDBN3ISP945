import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const primaryPeriod = ['2026-11-16', '2026-11-24'];
const charts = ['chart-daily', 'chart-weekly', 'chart-status'];
const metrics = ['metric-count', 'metric-revenue', 'metric-average'];

const base = new URL(process.env.ORDERS_BASE_URL || 'http://127.0.0.1:8080/');
const output = resolve(process.cwd(), process.argv[2] || process.env.ORDERS_SCREENSHOTS_DIR || 'docs/screenshots');
const admin = {
  email: process.env.ORDERS_ADMIN_EMAIL || 'admin@example.test',
  password: process.env.ORDERS_ADMIN_PASSWORD,
};
const analyst = {
  email: process.env.ORDERS_ANALYST_EMAIL || 'analyst@example.test',
  password: process.env.ORDERS_ANALYST_PASSWORD,
};

function loadPlaywright() {
  if (process.env.ORDERS_PLAYWRIGHT_PATH) {
    return require(resolve(process.env.ORDERS_PLAYWRIGHT_PATH));
  }
  try {
    return require(require.resolve('playwright', { paths: [root, resolve(root, 'client')] }));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error('Укажите путь к модулю playwright в ORDERS_PLAYWRIGHT_PATH.');
  }
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

function link(page, name) {
  return page.getByRole('link', { name, exact: true });
}

function heading(page, name) {
  return page.getByRole('heading', { name, exact: true, level: 1 });
}

function endpoint(page, method, path, matches = () => true) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === base.origin && response.request().method() === method &&
      path.test(url.pathname) && matches(url);
  });
}

async function checkResponse(response, code) {
  assert.equal(response.status(), code, response.request().method() + ' ' + new URL(response.url()).pathname);
  assert.equal(await response.finished(), null);
}

async function screenshot(page, file) {
  await page.screenshot({
    path: resolve(output, file),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function login(page, user, takeLoginScreenshot = false) {
  const submit = button(page, 'Войти');
  await submit.waitFor();
  for (const role of ['link', 'button']) {
    assert.equal(await page.getByRole(role, { name: /регистрац/i }).count(), 0);
  }
  if (takeLoginScreenshot) await screenshot(page, '01-login.png');

  await page.getByLabel('Электронная почта', { exact: true }).fill(user.email);
  await page.getByLabel('Пароль', { exact: true }).fill(user.password);
  const response = endpoint(page, 'POST', /^\/api\/v1\/auth\/login$/);
  await submit.click();
  await checkResponse(await response, 200);
  await heading(page, 'Статистика').waitFor();
  const sid = (await page.context().cookies(base.href)).find(cookie => cookie.name === 'sid');
  assert(sid?.httpOnly, 'Cookie сессии должна быть HttpOnly.');
  assert.equal(sid.sameSite, 'Lax');
}

async function setPeriod(page, [from, to]) {
  await page.getByLabel('Дата начала', { exact: true }).fill(from);
  await page.getByLabel('Дата окончания', { exact: true }).fill(to);
  const response = endpoint(page, 'GET', /^\/api\/v1\/statistics$/, url =>
    url.searchParams.get('from') === from && url.searchParams.get('to') === to);
  await button(page, 'Применить').click();
  await checkResponse(await response, 200);
}

function moneyOrCount(text) {
  const compact = (text || '').replace(/[\s₽]/gu, '').replace(',', '.');
  if (/^[—–-]$/u.test(compact)) return null;
  return /^\d+(?:\.\d{1,2})?$/u.test(compact) ? Number(compact) : undefined;
}

async function assertMetrics(page, [orders, revenue, average]) {
  await page.waitForFunction(({ ids, amounts }) => ids.every((id, i) => {
    const compact = (document.querySelector('[data-testid="' + id + '"]')?.textContent || '')
      .replace(/[\s₽]/gu, '').replace(',', '.');
    return amounts[i] === null ? /^[—–-]$/u.test(compact) : /^\d+(?:\.\d{1,2})?$/u.test(compact) &&
      Number(compact) === amounts[i];
  }), { ids: metrics, amounts: [orders, revenue, average] });

  const text = await Promise.all(metrics.map(id => page.getByTestId(id).textContent()));
  assert.deepEqual(text.map(moneyOrCount), [orders, revenue, average]);
}

async function chartImages(page) {
  await page.waitForFunction(ids => ids.every(id => {
    const canvas = document.querySelector('canvas[data-testid="' + id + '"]');
    const bounds = canvas?.getBoundingClientRect();
    if (!(bounds?.width > 100 && bounds?.height > 80)) return false;
    if (canvas.width < bounds.width * devicePixelRatio - 2) return false;
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set();
    let visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]) {
        visible++;
        if (colors.size < 12) colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
      }
    }
    return visible > 200 && colors.size >= 4;
  }), charts);

  return Promise.all(charts.map(id => page.getByTestId(id).evaluate(canvas => ({
    width: canvas.width,
    bitmap: canvas.toDataURL(),
  }))));
}

async function checkValuesTable(page) {
  const summary = page.locator('summary').filter({ hasText: 'Значения' }).nth(1);
  const table = page.getByRole('table', { name: 'Выручка по неделям', exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await table.waitFor();
  const row = table.getByRole('row').last();
  const values = await row.getByRole('cell').allTextContents();
  assert.equal(moneyOrCount(values.at(-1)), 1000);
  await page.keyboard.press('Enter');
  await table.waitFor({ state: 'hidden' });
}

async function orderScenario(page) {
  await setPeriod(page, primaryPeriod);
  await assertMetrics(page, [3, 2000, 2000]);
  const before = await chartImages(page);
  await screenshot(page, '02-statistics-before.png');

  await link(page, 'Заказы').click();
  await heading(page, 'Заказы').waitFor();
  await page.getByLabel('Номер заказа', { exact: true }).fill('Z-104');
  const searched = endpoint(page, 'GET', /^\/api\/v1\/orders$/, url => url.searchParams.get('q') === 'Z-104');
  await button(page, 'Найти').click();
  await checkResponse(await searched, 200);
  await link(page, 'Открыть Z-104').waitFor();
  await screenshot(page, '09-filtered-orders.png');
  await link(page, 'Открыть Z-104').click();

  await heading(page, 'Заказ Z-104').waitFor();
  const status = page.getByTestId('order-status');
  await status.waitFor();
  assert.equal(await status.inputValue(), 'processing', 'Используйте исходную учебную базу с Z-104 в работе');
  await status.selectOption('completed');
  await screenshot(page, '03-complete-order.png');

  const update = endpoint(page, 'PATCH', /^\/api\/v1\/orders\/[1-9]\d*$/);
  await button(page, 'Сохранить заказ').click();
  await checkResponse(await update, 200);
  await link(page, 'К статистике').click();
  await heading(page, 'Статистика').waitFor();
  assert.equal(await page.getByLabel('Дата начала', { exact: true }).inputValue(), primaryPeriod[0]);
  assert.equal(await page.getByLabel('Дата окончания', { exact: true }).inputValue(), primaryPeriod[1]);
  await assertMetrics(page, [3, 3000, 1500]);

  const after = await chartImages(page);
  assert.notEqual(before[1].bitmap, after[1].bitmap, 'График выручки должен измениться');
  assert.notEqual(before[2].bitmap, after[2].bitmap, 'График статусов должен измениться');
  await checkValuesTable(page);
  await screenshot(page, '04-statistics-after.png');

  await setPeriod(page, ['2026-11-26', '2026-11-26']);
  await assertMetrics(page, [0, 0, null]);
  await page.getByText('За выбранный период заказов нет.', { exact: true }).waitFor();
  await setPeriod(page, ['2026-11-27', '2026-11-27']);
  await assertMetrics(page, [1, 0, 0]);
  await chartImages(page);
}

async function deleteChannel(page, name) {
  await button(page, 'Удалить канал «' + name + '»').click();
  const response = endpoint(page, 'DELETE', /^\/api\/v1\/sales-channels\/[1-9]\d*$/);
  await button(page, 'Удалить').click();
  return response;
}

async function channelScenario(page) {
  const created = 'Партнёрская витрина';
  const renamed = 'Витрина партнёра';
  const input = page.getByLabel('Название канала', { exact: true });
  await link(page, 'Каналы продаж').click();
  await heading(page, 'Каналы продаж').waitFor();

  await button(page, 'Добавить канал').click();
  await input.fill(created);
  const creation = endpoint(page, 'POST', /^\/api\/v1\/sales-channels$/);
  await button(page, 'Сохранить').click();
  await checkResponse(await creation, 201);
  await button(page, 'Изменить канал «' + created + '»').click();
  assert.equal(await input.inputValue(), created);
  await input.fill(renamed);
  const update = endpoint(page, 'PATCH', /^\/api\/v1\/sales-channels\/[1-9]\d*$/);
  await button(page, 'Сохранить').click();
  await checkResponse(await update, 200);
  await button(page, 'Изменить канал «' + renamed + '»').waitFor();
  await screenshot(page, '05-sales-channels.png');

  await checkResponse(await deleteChannel(page, renamed), 204);
  await button(page, 'Изменить канал «' + renamed + '»').waitFor({ state: 'detached' });
  const denied = await deleteChannel(page, 'Сайт');
  await checkResponse(denied, 409);
  const { error } = await denied.json();
  await page.getByText(error.message, { exact: true }).waitFor();
  await screenshot(page, '06-linked-channel-error.png');
}

async function analystScenario(page, context) {
  const logout = endpoint(page, 'POST', /^\/api\/v1\/auth\/logout$/);
  await button(page, 'Выйти').click();
  await checkResponse(await logout, 204);
  assert(!(await context.cookies(base.href)).some(cookie => cookie.name === 'sid'));
  await login(page, analyst);
  assert.equal(await link(page, 'Заказы').count(), 0);
  assert.equal(await link(page, 'Каналы продаж').count(), 0);
  const orders = await context.request.get(new URL('/api/v1/orders', base).href);
  assert.equal(orders.status(), 403);
  const channels = await context.request.get(new URL('/api/v1/sales-channels', base).href);
  assert.equal(channels.status(), 403);
  await page.goto(new URL('/orders', base).href);
  await page.waitForURL(new URL('/statistics', base).href);
  await heading(page, 'Статистика').waitFor();

  await setPeriod(page, primaryPeriod);
  await assertMetrics(page, [3, 3000, 1500]);
  const wideCharts = await chartImages(page);
  await screenshot(page, '07-analyst-statistics.png');

  for (const width of [768, 360]) {
    await page.setViewportSize({ width, height: 840 });
    await page.waitForFunction(screenWidth => innerWidth === screenWidth &&
      document.documentElement.scrollWidth <= screenWidth + 1, width);
    await assertMetrics(page, [3, 3000, 1500]);
    await chartImages(page);
  }
  const narrowCharts = await chartImages(page);
  assert.notEqual(wideCharts[0].width, narrowCharts[0].width, 'Canvas должен изменить ширину');
  await screenshot(page, '08-mobile-statistics.png');
}

async function main() {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
    'Регрессионный тест изменяет учебный заказ и запускается только на локальном адресе.');
  assert(admin.password && analyst.password, 'Задайте ORDERS_ADMIN_PASSWORD и ORDERS_ANALYST_PASSWORD.');
  await mkdir(output, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: process.env.ORDERS_CHROMIUM_PATH || undefined,
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      viewport: { width: 1280, height: 920 },
      deviceScaleFactor: 2,
    });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', error => faults.push(error.message));
    await page.goto(base.href);
    await login(page, admin, true);
    await orderScenario(page);
    await channelScenario(page);
    await analystScenario(page, context);
    assert.deepEqual(faults, [], 'Во время прогона в SPA не должно быть ошибок JavaScript.');
    console.log('Браузерная проверка пройдена. Снимки: ' + output);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  let message = error.stack || error.message;
  for (const password of [admin.password, analyst.password]) {
    if (password) message = message.replaceAll(password, '[учебный пароль]');
  }
  console.error(message);
  process.exitCode = 1;
});
