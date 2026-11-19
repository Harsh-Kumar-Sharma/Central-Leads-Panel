export const TZ = 'Asia/Kolkata';

export const STATUSES = [
  { value: 'new', label: 'New', color: '#6366f1' },
  { value: 'contacted', label: 'Contacted', color: '#06b6d4' },
  { value: 'followup', label: 'Follow up', color: '#f59e0b' },
  { value: 'closed', label: 'Closed', color: '#10b981' },
  { value: 'spam', label: 'Spam', color: '#ef4444' },
];
export const statusMeta = (v) => STATUSES.find((s) => s.value === v) || { value: v, label: v, color: '#64748b' };

export const TYPES = [
  { value: 'inquiry', label: 'Inquiry', color: '#06b6d4' },
  { value: 'quote', label: 'Quote', color: '#8b5cf6' },
];
export const typeMeta = (v) => TYPES.find((t) => t.value === v) || { value: v, label: v, color: '#64748b' };

const fullFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
export const fullDate = (d) => (d ? fullFmt.format(new Date(d)) + ' IST' : '');

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function relativeTime(d) {
  if (!d) return '';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
}

/** project_location_and_scope -> "Project Location And Scope" */
export const humanizeKey = (k) =>
  String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function whatsappLink(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) digits = '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
  return `https://wa.me/${digits}`;
}
export const telLink = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null);
export const mailLink = (email) => (email ? `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` : null);

/** Only allow http(s) URLs to be rendered as clickable links. */
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// ---- Date range presets, computed in IST ----
const ymdIST = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
export function rangeDates(preset) {
  const now = new Date();
  const today = ymdIST(now);
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const shift = (days) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: shift(-1), to: shift(-1) };
    case 'week': { const wd = (base.getUTCDay() + 6) % 7; return { from: shift(-wd), to: today }; }
    case 'month': return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today };
    default: return { from: '', to: '' };
  }
}
