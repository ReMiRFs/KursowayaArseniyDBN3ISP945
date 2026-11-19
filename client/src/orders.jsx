import { useState } from 'react';
import { api, query } from './api.js';
import { asRubles, formatCreatedAt, formatMoney, formatNumber, nextStatuses, parseKopecks, statusLabels } from './model.js';
import { ErrorMessage, Link, navigate, RequestState, useRequest } from './shared.jsx';

const initialFilters = { q: '', from: '', to: '', status: '', channelId: '' };

function ChannelOptions({ channels }) {
  return channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>);
}

function Status({ status }) {
  return <span className={'status-pill status-' + status}>{statusLabels[status]}</span>;
}

export function Orders() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [dateError, setDateError] = useState('');
  const channels = useRequest(signal => api('/sales-channels', { signal }), []);
  const search = query({ ...filters, page });
  const orders = useRequest(signal => api('/orders?' + search, { signal }), [search]);

  function apply(event) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setDateError('Дата начала должна быть не позже даты окончания.');
      return;
    }
    setDateError('');
    setFilters({ ...draft, q: draft.q.trim() });
    if (page === 1) orders.retry();
    setPage(1);
  }

  function change(event) {
    setDraft({ ...draft, [event.target.name]: event.target.value });
  }

  return <div className="stack">
    <div className="heading heading-actions">
      <div><h1>Заказы</h1><p className="muted">Управление заказами и их статусами</p></div>
      <Link href="/orders/new" className="button button-primary">Новый заказ</Link>
    </div>
    <form className="panel filters orders-filters" onSubmit={apply}>
      <label>Номер заказа<input type="search" name="q" data-testid="orders-search" maxLength={32}
        placeholder="Например, Z-104" value={draft.q} onChange={change} /></label>
      <label>Дата начала<input type="date" name="from" value={draft.from} onChange={change} /></label>
      <label>Дата окончания<input type="date" name="to" value={draft.to} onChange={change} /></label>
      <label>Статус<select name="status" aria-label="Статус" value={draft.status} onChange={change}>
        <option value="">Все статусы</option>
        {Object.entries(statusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>Канал продаж<select name="channelId" aria-label="Канал продаж" value={draft.channelId} onChange={change} disabled={!channels.data}>
        <option value="">Все каналы</option>
        <ChannelOptions channels={channels.data?.items || []} />
      </select></label>
      <button className="button button-primary" type="submit">Найти</button>
      {dateError && <p className="filter-error" role="alert">{dateError}</p>}
    </form>
    <ErrorMessage error={channels.error} retry={channels.retry} />
    <RequestState request={orders} loadingText="Загружаем заказы…">{result => {
      if (result.total === 0) return <p className="message" role="status">По этим фильтрам заказов нет.</p>;
      const pages = Math.ceil(result.total / result.pageSize);
      return <section className="panel list-panel" aria-label="Перечень заказов">
        <div className="table-wrap">
          <table className="data-table order-data" aria-label="Список заказов">
            <thead><tr><th scope="col">Номер</th><th scope="col">Создан</th><th scope="col">Канал</th>
              <th scope="col">Статус</th><th scope="col">Сумма</th><th scope="col">Действие</th></tr></thead>
            <tbody>{result.items.map(order => <tr key={order.id}>
              <th scope="row" data-label="Номер">{order.number}</th>
              <td data-label="Создан">{formatCreatedAt(order.createdAt)}</td>
              <td data-label="Канал">{order.channelName}</td>
              <td data-label="Статус"><Status status={order.status} /></td>
              <td data-label="Сумма" className="money">{formatMoney(order.totalKopecks)}</td>
              <td data-label="Действие"><Link className="text-action" href={'/orders/' + order.id} aria-label={'Открыть ' + order.number}>Открыть</Link></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="pager">
          <p className="muted">Страница {result.page} из {pages} · всего {formatNumber(result.total)}</p>
          <div className="actions">
            <button className="button" type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}>Назад</button>
            <button className="button" type="button" onClick={() => setPage(page + 1)} disabled={page >= pages}>Далее</button>
          </div>
        </div>
      </section>;
    }}</RequestState>
  </div>;
}

function initialOrder(order) {
  if (!order) return { number: '', channelId: '', amount: '', status: 'new' };
  return { number: order.number, channelId: order.channelId, amount: asRubles(order.totalKopecks), status: order.status };
}

function EditForm({ loadedOrder, channels }) {
  const [order, setOrder] = useState(loadedOrder);
  const [values, setValues] = useState(() => initialOrder(order));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState('');
  const locked = ['completed', 'cancelled'].includes(order?.status);

  function change(event) {
    setValues({ ...values, [event.target.name]: event.target.value });
    setSaved('');
    setError(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (locked || pending) return;
    setSaved('');
    setError(null);
    const number = values.number.trim();
    const totalKopecks = parseKopecks(values.amount);
    if (!/^[A-Za-z0-9-]{1,32}$/.test(number)) {
      setError(new Error('Номер должен содержать от 1 до 32 латинских букв, цифр или дефисов.'));
      return;
    }
    if (!values.channelId || totalKopecks === null) {
      setError(new Error('Выберите канал и укажите сумму от 0 до 9 999 999,99 ₽.'));
      return;
    }
    const submitted = { number: number.toUpperCase(), channelId: values.channelId, totalKopecks };
    const body = !order ? submitted : Object.fromEntries(
      Object.entries({ ...submitted, status: values.status }).filter(([key, value]) => value !== order[key]),
    );
    if (!Object.keys(body).length) {
      setSaved('Изменений нет.');
      return;
    }
    setPending(true);
    try {
      const updated = await api(order ? '/orders/' + order.id : '/orders', { method: order ? 'PATCH' : 'POST', body });
      if (!order) {
        navigate('/orders/' + updated.id);
        return;
      }
      setOrder(updated);
      setValues(initialOrder(updated));
      setSaved('Заказ сохранён.');
    } catch (problem) {
      setError(problem);
    } finally {
      setPending(false);
    }
  }

  return <div className="stack editor">
    <div className="heading heading-actions">
      <h1>{order ? 'Заказ ' + order.number : 'Новый заказ'}</h1>
      <Link href="/orders" className="button">К заказам</Link>
    </div>
    <form className="panel edit-form" onSubmit={submit} noValidate>
      <fieldset disabled={locked || pending} className="edit-fields">
        <legend className="sr-only">Данные заказа</legend>
        <label>Номер<input name="number" value={values.number} onChange={change} maxLength={32} required /></label>
        <label>Канал продаж<select name="channelId" aria-label="Канал продаж" value={values.channelId} onChange={change} required>
          <option value="">Выберите канал</option>
          <ChannelOptions channels={channels} />
        </select></label>
        <label>Сумма, ₽<input name="amount" inputMode="decimal" value={values.amount} onChange={change}
          placeholder="0,00" maxLength={10} required /></label>
        <label>Статус<select name="status" aria-label="Статус" data-testid="order-status" value={values.status} onChange={change} disabled={!order}>
          {(nextStatuses[order?.status] || ['new']).map(status =>
            <option value={status} key={status}>{statusLabels[status]}</option>)}
        </select></label>
      </fieldset>
      <p className="muted">{order ? 'Создан ' + formatCreatedAt(order.createdAt) + ' по Москве.' : 'Дата создания появится после сохранения.'}</p>
      <ErrorMessage error={error} />
      {saved && <p className="message" role="status">{saved}</p>}
      {locked && <p className="muted">Заказ имеет конечный статус.</p>}
      <div className="actions">
        {!locked && <button className="button button-primary" disabled={pending} type="submit">
          {pending ? 'Сохраняем…' : 'Сохранить заказ'}
        </button>}
        <Link href="/statistics" className="button">К статистике</Link>
      </div>
    </form>
  </div>;
}

export function OrderEditor({ orderId }) {
  const request = useRequest(async signal => {
    const [order, channels] = await Promise.all([
      orderId === 'new' ? Promise.resolve(null) : api('/orders/' + orderId, { signal }),
      api('/sales-channels', { signal }),
    ]);
    return { order, channels: channels.items };
  }, [orderId]);
  return <RequestState request={request} loadingText="Загружаем форму заказа…">
    {data => <EditForm loadedOrder={data.order} channels={data.channels} />}
  </RequestState>;
}
