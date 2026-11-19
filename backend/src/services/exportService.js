'use strict';
const { stringify } = require('csv-stringify/sync');
const ExcelJS = require('exceljs');

const STATUS_LABELS = { new: 'New', contacted: 'Contacted', followup: 'Follow up', closed: 'Closed', spam: 'Spam' };

const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

// Prevents CSV/Excel formula injection (=, +, -, @, tab, CR at the start of a cell).
const safeCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const extraText = (extra) => {
  if (!extra) return '';
  const obj = typeof extra === 'string' ? JSON.parse(extra) : extra;
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('; ');
};

const COLUMNS = [
  { header: 'ID', key: 'id', width: 8 },
  { header: 'Company', key: 'site_name', width: 22 },
  { header: 'Type', key: 'type', width: 10 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Subject', key: 'subject', width: 28 },
  { header: 'Visitor Company', key: 'company', width: 22 },
  { header: 'Message', key: 'message', width: 60 },
  { header: 'Extra', key: 'extra', width: 40 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Received (IST)', key: 'created_at', width: 20 },
  { header: 'Source URL', key: 'source_url', width: 40 },
];

// CSV needs the formula guard; XLSX cells are written as plain strings (never formulas),
// so there the apostrophe would just show up as text (e.g. on every +91 phone number).
const plainCell = (v) => (v === null || v === undefined ? '' : String(v));

function toRow(r, cell = safeCell) {
  return {
    id: r.id,
    site_name: cell(r.site_name),
    type: r.type === 'quote' ? 'Quote' : 'Inquiry',
    name: cell(r.name),
    phone: cell(r.phone),
    email: cell(r.email),
    subject: cell(r.subject),
    company: cell(r.company),
    message: cell(r.message),
    extra: cell(extraText(r.extra)),
    status: STATUS_LABELS[r.status] || r.status,
    created_at: r.created_at ? istFormat.format(new Date(r.created_at)) : '',
    source_url: cell(r.source_url),
  };
}

exports.toCsv = (rows) =>
  '﻿' + // BOM so Excel opens UTF-8 (Hindi names etc.) correctly
  stringify(rows.map((r) => toRow(r, safeCell)), { header: true, columns: COLUMNS.map((c) => ({ key: c.key, header: c.header })) });

exports.toXlsx = async (rows) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Central Leads Panel';
  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(toRow(r, plainCell)));
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  return wb.xlsx.writeBuffer();
};
