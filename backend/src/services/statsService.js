'use strict';
const db = require('../config/db');
const { scopeClause } = require('./leadService');

const RANGE_SQL = {
  today: 'l.created_at >= CURDATE()',
  week: 'l.created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)',
  month: "l.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
  all: '1=1',
};
exports.RANGES = Object.keys(RANGE_SQL);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

exports.overview = async (allowed) => {
  const empty = { today: 0, this_week: 0, this_month: 0, new_unread: 0, by_type: { inquiry: 0, quote: 0 } };
  const scope = scopeClause(allowed);
  if (!scope) return empty;
  const [[r]] = await db.execute(
    `SELECT
       COALESCE(SUM(${RANGE_SQL.today}), 0) AS today,
       COALESCE(SUM(${RANGE_SQL.week}), 0) AS this_week,
       COALESCE(SUM(${RANGE_SQL.month}), 0) AS this_month,
       COALESCE(SUM(l.is_read = 0 AND l.status = 'new'), 0) AS new_unread,
       COALESCE(SUM(l.type = 'inquiry' AND ${RANGE_SQL.month}), 0) AS inquiry,
       COALESCE(SUM(l.type = 'quote' AND ${RANGE_SQL.month}), 0) AS quote
     FROM leads l
     WHERE l.status <> 'spam' AND ${scope.sql}`,
    scope.params
  );
  return {
    today: Number(r.today),
    this_week: Number(r.this_week),
    this_month: Number(r.this_month),
    new_unread: Number(r.new_unread),
    by_type: { inquiry: Number(r.inquiry), quote: Number(r.quote) },
  };
};

exports.daily = async (allowed, days) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const map = new Map();
  const scope = scopeClause(allowed);
  if (scope) {
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(l.created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
       FROM leads l
       WHERE l.status <> 'spam' AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND ${scope.sql}
       GROUP BY d`,
      [days - 1, ...scope.params]
    );
    for (const r of rows) map.set(r.d, Number(r.c));
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymd(d);
    out.push({ date: key, count: map.get(key) || 0 });
  }
  return out;
};

exports.bySite = async (allowed, range) => {
  const scope = scopeClause(allowed, 's.id');
  if (!scope) return [];
  const [rows] = await db.execute(
    `SELECT s.id AS site_id, s.name AS site_name, s.color, COUNT(l.id) AS count
     FROM sites s
     LEFT JOIN leads l ON l.site_id = s.id AND l.status <> 'spam' AND ${RANGE_SQL[range]}
     WHERE ${scope.sql}
     GROUP BY s.id, s.name, s.color
     ORDER BY count DESC, s.name ASC`,
    scope.params
  );
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
};
