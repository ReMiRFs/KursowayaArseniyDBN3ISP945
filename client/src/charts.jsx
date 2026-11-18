import { useEffect, useRef } from 'react';
import { formatNumber } from './model.js';

const textColor = '#4d6476';
const gridColor = '#dce8ed';
const axisColor = '#98afba';
const teal = '#08776b';
const statusColors = ['#5279ad', '#98601e', teal, '#ad4d56'];
const font = '13px system-ui, sans-serif';

export function roundedStep(maximum, targetTicks = 4, minimum = 1) {
  if (maximum <= 0) return 1;
  const raw = maximum / targetTicks;
  const scale = 10 ** Math.floor(Math.log10(raw));
  const multiple = [1, 2, 5, 10].find(number => number * scale >= raw) || 10;
  return Math.max(minimum, multiple * scale);
}

function line(ctx, x1, y1, x2, y2, color) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function paintCartesian(ctx, width, height, points, series, units) {
  const values = points.map(point => point.y);
  const maximum = Math.max(0, ...values);
  const step = roundedStep(maximum, 4, series === 'bar' ? 0.01 : 1);
  const ticks = Math.max(1, Math.ceil(maximum / step - 1e-9));
  const top = 34;
  const bottom = height - 37;
  const right = width - 9;
  const axisLabels = Array.from({ length: ticks + 1 }, (_, index) => formatNumber(index * step));
  const axisLabelWidth = Math.max(...axisLabels.map(label => ctx.measureText(label).width));
  const left = Math.ceil(Math.max(36, axisLabelWidth + 13));
  const plotWidth = Math.max(1, right - left);
  const plotHeight = bottom - top;
  const y = value => bottom - value / (ticks * step) * plotHeight;
  const interval = plotWidth / (series === 'bar' ? Math.max(1, points.length) : Math.max(1, points.length - 1));
  const x = index => series === 'bar' ? left + (index + 0.5) * interval
    : points.length === 1 ? left + plotWidth / 2 : left + index * interval;

  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.fillText(units, 3, 16);
  ctx.textAlign = 'right';
  for (let index = 0; index <= ticks; index++) {
    const rowY = y(index * step);
    line(ctx, left, rowY, right, rowY, index === 0 ? axisColor : gridColor);
    ctx.fillText(axisLabels[index], left - 7, rowY + 4);
  }
  line(ctx, left, top, left, bottom, axisColor);

  if (series === 'line' && points.length) {
    ctx.beginPath();
    ctx.strokeStyle = teal;
    ctx.lineWidth = 2;
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();
    if (points.length <= 24) {
      ctx.fillStyle = teal;
      values.forEach((value, index) => {
        ctx.beginPath();
        ctx.arc(x(index), y(value), 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  }
  if (series === 'bar') {
    ctx.fillStyle = teal;
    const barWidth = Math.max(1, Math.min(44, interval * 0.58));
    values.forEach((value, index) => {
      const barHeight = bottom - y(value);
      if (barHeight > 0) ctx.fillRect(x(index) - barWidth / 2, bottom - barHeight, barWidth, barHeight);
    });
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  const labelGap = 9;
  const labels = points.map(({ label }, index) => {
    const labelWidth = ctx.measureText(label).width;
    const minX = Math.max(left - 7, Math.min(x(index) - labelWidth / 2, width - 4 - labelWidth));
    return { label, minX, maxX: minX + labelWidth };
  });
  let paintedRight = -Infinity;
  labels.forEach(({ label, minX, maxX }, index) => {
    const last = index === labels.length - 1;
    if (minX < paintedRight + labelGap) return;
    if (index && !last && maxX + labelGap > labels.at(-1).minX) return;
    ctx.fillText(label, minX, bottom + 21);
    paintedRight = maxX;
  });
}

function paintStatuses(ctx, width, height, points, units) {
  const left = 92;
  const start = 37;
  const rowHeight = (height - start - 20) / Math.max(1, points.length);
  const right = width - 27;
  const maximum = Math.max(1, ...points.map(point => point.y));
  ctx.fillStyle = textColor;
  ctx.fillText(units, 3, 16);
  points.forEach(({ label, y: value }, index) => {
    const centerY = start + rowHeight * (index + 0.5);
    const barHeight = Math.max(10, Math.min(20, rowHeight - 8));
    const plot = Math.max(1, right - left);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.fillText(label, 3, centerY + 4);
    ctx.fillStyle = '#eef4f6';
    ctx.fillRect(left, centerY - barHeight / 2, plot, barHeight);
    ctx.fillStyle = statusColors[index % statusColors.length];
    if (value > 0) ctx.fillRect(left, centerY - barHeight / 2, value / maximum * plot, barHeight);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';
    ctx.fillText(formatNumber(value), width - 2, centerY + 4);
  });
}

function ChartCanvas({ id, title, points, series, units }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    function draw() {
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      context.font = font;
      if (series === 'status') paintStatuses(context, width, height, points, units);
      else paintCartesian(context, width, height, points, series, units);
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    window.addEventListener('resize', draw);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [points, series, units]);

  return <canvas ref={ref} className="chart-canvas" data-testid={'chart-' + id}
    role="img" aria-label={title} aria-describedby={'chart-description-' + id} />;
}

export function Chart({ id, title, note, points, series, units, headers, rows }) {
  return <section className="panel chart-panel" aria-labelledby={'chart-title-' + id}>
    <div>
      <h2 id={'chart-title-' + id}>{title}</h2>
      <p className="muted" id={'chart-description-' + id}>{note}</p>
    </div>
    <ChartCanvas id={id} title={title} points={points} series={series} units={units} />
    <details className="chart-details">
      <summary>Значения</summary>
      <div className="table-wrap chart-table">
        <table aria-label={title}>
          <thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map(([key, label, value]) =>
            <tr key={key}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}
