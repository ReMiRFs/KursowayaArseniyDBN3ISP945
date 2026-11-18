import { useState } from 'react';
import { api, query } from './api.js';
import { Chart } from './charts.jsx';
import { formatMoney, formatNumber, fullDay, periodError, shortDay, statusLabels } from './model.js';
import { RequestState, useRequest } from './shared.jsx';

function Metric({ id, label, value, description }) {
  return <div className="panel metric">
    <span className="muted">{label}</span>
    <strong data-testid={'metric-' + id}>{value}</strong>
    <span className="muted">{description}</span>
  </div>;
}

function Charts({ report }) {
  return <div className="chart-grid">
    <Chart id="daily" title="Заказы по дням" note="Все статусы · шт." units="шт." series="line"
      points={report.dailyOrders.map(row => ({ label: shortDay(row.date), y: row.count }))}
      headers={['Дата', 'Заказы, шт.']}
      rows={report.dailyOrders.map(row => [row.date, fullDay(row.date), formatNumber(row.count)])} />
    <Chart id="weekly" title="Выручка по неделям" note="Завершённые заказы · ₽" units="₽" series="bar"
      points={report.weeklyRevenue.map(row => ({ label: shortDay(row.from), y: row.revenueKopecks / 100 }))}
      headers={['Период', 'Выручка']}
      rows={report.weeklyRevenue.map(row => [row.from,
        row.from === row.to ? fullDay(row.from) : fullDay(row.from) + ' – ' + fullDay(row.to),
        formatMoney(row.revenueKopecks)])} />
    <Chart id="status" title="Заказы по статусам" note="Текущий статус каждого заказа · шт." units="шт." series="status"
      points={report.ordersByStatus.map(row => ({ label: statusLabels[row.status], y: row.count }))}
      headers={['Статус', 'Заказы, шт.']}
      rows={report.ordersByStatus.map(row => [row.status, statusLabels[row.status], formatNumber(row.count)])} />
  </div>;
}

export function Dashboard({ period, setPeriod }) {
  const [draft, setDraft] = useState(period);
  const [error, setError] = useState('');
  const request = useRequest(signal => api('/statistics?' + query(period), { signal }), [period.from, period.to]);

  function apply(event) {
    event.preventDefault();
    const invalid = periodError(draft);
    setError(invalid);
    if (invalid) return;
    if (draft.from === period.from && draft.to === period.to) request.retry();
    else setPeriod(draft);
  }

  return <div className="stack">
    <div className="heading">
      <h1>Статистика</h1>
      <p className="muted">Заказы по дате создания · время Москвы</p>
    </div>
    <form className="panel filters period-filters" aria-label="Период статистики" onSubmit={apply} noValidate>
      <label>Дата начала
        <input data-testid="stats-from" type="date" value={draft.from} required
          onChange={event => setDraft({ ...draft, from: event.target.value })} />
      </label>
      <label>Дата окончания
        <input data-testid="stats-to" type="date" value={draft.to} required
          onChange={event => setDraft({ ...draft, to: event.target.value })} />
      </label>
      <button data-testid="stats-apply" type="submit" className="button button-primary">Применить</button>
      {error && <p className="filter-error" role="alert">{error}</p>}
    </form>
    <RequestState request={request} loadingText="Загружаем статистику…">{report => <>
      <div className="metrics" aria-label="Итоги периода" aria-live="polite">
        <Metric id="count" label="Всего заказов" value={formatNumber(report.totals.orders)} description="Все статусы" />
        <Metric id="revenue" label="Выручка" value={formatMoney(report.totals.revenueKopecks)} description="Завершённые заказы" />
        <Metric id="average" label="Средний чек" value={formatMoney(report.totals.averageCheckKopecks)} description="На завершённый заказ" />
      </div>
      {report.totals.orders === 0
        ? <p className="message" role="status">За выбранный период заказов нет.</p>
        : <Charts report={report} />}
    </>}</RequestState>
  </div>;
}
