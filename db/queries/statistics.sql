WITH period AS (
    SELECT $1::date AS from_date, $2::date AS to_date
), bounds AS (
    SELECT from_date, to_date,
        from_date::timestamp AT TIME ZONE 'Europe/Moscow' AS from_instant,
        (to_date + 1)::timestamp AT TIME ZONE 'Europe/Moscow' AS until_instant
    FROM period
), selected_orders AS MATERIALIZED (
    SELECT (orders.created_at AT TIME ZONE 'Europe/Moscow')::date AS order_date,
        orders.status, orders.total_kopecks
    FROM bounds
    JOIN orders ON orders.created_at >= bounds.from_instant
               AND orders.created_at < bounds.until_instant
), totals AS (
    SELECT count(*) AS orders,
        count(*) FILTER (WHERE status = 'completed') AS completed,
        coalesce(sum(total_kopecks) FILTER (WHERE status = 'completed'), 0) AS revenue,
        round(avg(total_kopecks) FILTER (WHERE status = 'completed')) AS average
    FROM selected_orders
), daily_counts AS (
    SELECT order_date, count(*) AS orders
    FROM selected_orders
    GROUP BY order_date
), daily AS (
    SELECT period.from_date + day_offset AS day, coalesce(daily_counts.orders, 0) AS orders
    FROM period
    CROSS JOIN LATERAL generate_series(0, period.to_date - period.from_date) AS offsets(day_offset)
    LEFT JOIN daily_counts ON daily_counts.order_date = period.from_date + day_offset
), weekly_sums AS (
    SELECT date_trunc('week', order_date::timestamp)::date AS week_start, sum(total_kopecks) AS revenue
    FROM selected_orders
    WHERE status = 'completed'
    GROUP BY 1
), weekly AS (
    SELECT weeks.week_start::date AS week_start,
        greatest(weeks.week_start::date, period.from_date) AS visible_from,
        least(weeks.week_start::date + 6, period.to_date) AS visible_to,
        coalesce(weekly_sums.revenue, 0) AS revenue
    FROM period
    CROSS JOIN LATERAL generate_series(
        date_trunc('week', period.from_date::timestamp),
        date_trunc('week', period.to_date::timestamp),
        interval '7 days'
    ) AS weeks(week_start)
    LEFT JOIN weekly_sums ON weekly_sums.week_start = weeks.week_start::date
), status_counts AS (
    SELECT status, count(*) AS orders
    FROM selected_orders
    GROUP BY status
), by_status AS (
    SELECT statuses.status, statuses.position, coalesce(status_counts.orders, 0) AS orders
    FROM (VALUES ('new', 1), ('processing', 2), ('completed', 3), ('cancelled', 4))
        AS statuses(status, position)
    LEFT JOIN status_counts USING (status)
)
SELECT jsonb_build_object(
    'period', jsonb_build_object('from', period.from_date, 'to', period.to_date, 'timeZone', 'Europe/Moscow'),
    'totals', jsonb_build_object('orders', totals.orders, 'completedOrders', totals.completed,
        'revenueKopecks', totals.revenue, 'averageCheckKopecks', totals.average),
    'dailyOrders', coalesce((SELECT jsonb_agg(jsonb_build_object('date', day, 'count', orders) ORDER BY day) FROM daily), '[]'::jsonb),
    'weeklyRevenue', coalesce((SELECT jsonb_agg(jsonb_build_object('from', visible_from, 'to', visible_to,
        'revenueKopecks', revenue) ORDER BY week_start) FROM weekly), '[]'::jsonb),
    'ordersByStatus', (SELECT jsonb_agg(jsonb_build_object('status', status, 'count', orders) ORDER BY position) FROM by_status)
) AS statistics
FROM period CROSS JOIN totals;
