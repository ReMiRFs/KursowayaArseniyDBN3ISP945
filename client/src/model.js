const moscowDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
});
const moscowDateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short',
});
const numberFormat = new Intl.NumberFormat('ru-RU');
const currency = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export const statusLabels = {
  new: 'Новый',
  processing: 'В работе',
  completed: 'Завершён',
  cancelled: 'Отменён',
};
export const nextStatuses = {
  new: ['new', 'processing', 'cancelled'],
  processing: ['processing', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export const formatNumber = value => numberFormat.format(value);
export const formatMoney = kopecks => kopecks == null ? '—' : currency.format(kopecks / 100);
export const formatCreatedAt = value => moscowDateTime.format(new Date(value));
export const shortDay = value => value.slice(8, 10) + '.' + value.slice(5, 7);
export const fullDay = value => shortDay(value) + '.' + value.slice(0, 4);

export function dateRange(now = new Date()) {
  const parts = Object.fromEntries(moscowDate.formatToParts(now).map(part => [part.type, part.value]));
  const date = parts.year + '-' + parts.month + '-' + parts.day;
  const start = new Date(date + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: date };
}

export function periodError({ from, to }) {
  if (!from || !to) return 'Укажите обе даты.';
  if (from > to) return 'Дата начала должна быть не позже даты окончания.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) {
    return 'Выберите период не длиннее 366 календарных дней.';
  }
  return '';
}

export function parseKopecks(value) {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [rubles, fraction = ''] = value.trim().split(/[.,]/);
  return Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
}

export function asRubles(value) {
  return (value / 100).toFixed(2).replace('.', ',');
}
