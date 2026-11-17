import test from 'node:test';
import assert from 'node:assert/strict';
import { asRubles, dateRange, formatMoney, parseKopecks, periodError } from '../src/model.js';

test('last 30 dates use Moscow midnight rather than browser timezone', () => {
  assert.deepEqual(dateRange(new Date('2026-11-24T21:05:00Z')), {
    from: '2026-10-27', to: '2026-11-25',
  });
});

test('amount input preserves exact kopecks and distinguishes invalid from zero', () => {
  assert.equal(parseKopecks('0'), 0);
  assert.equal(parseKopecks('11,09'), 1109);
  assert.equal(parseKopecks('1.2'), 120);
  assert.equal(parseKopecks('9999999,99'), 999999999);
  assert.equal(parseKopecks('10000000'), null);
  assert.equal(parseKopecks('0.001'), null);
  assert.equal(parseKopecks('-1'), null);
  assert.equal(asRubles(1109), '11,09');
  assert.equal(formatMoney(null), '—');
  assert.match(formatMoney(0), /^0\s*₽$/);
});

test('filters allow a single day and exactly 366 inclusive dates', () => {
  assert.equal(periodError({ from: '2024-05-07', to: '2024-05-07' }), '');
  assert.equal(periodError({ from: '2024-01-01', to: '2024-12-31' }), '');
  assert.ok(periodError({ from: '2024-01-01', to: '2025-01-01' }));
  assert.ok(periodError({ from: '2024-05-08', to: '2024-05-07' }));
  assert.ok(periodError({ from: '', to: '2024-05-07' }));
});
