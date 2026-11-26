const enNumberCache = new Map<string, Intl.NumberFormat>();

function getNumberFormatter(maxFractionDigits = 2, minFractionDigits = 0): Intl.NumberFormat {
  const key = `${minFractionDigits}:${maxFractionDigits}`;
  let fmt = enNumberCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    });
    enNumberCache.set(key, fmt);
  }
  return fmt;
}

export function formatNumber(value: number, maxFractionDigits = 2, minFractionDigits = 0): string {
  if (!Number.isFinite(value)) return getNumberFormatter(0, 0).format(0);
  return getNumberFormatter(maxFractionDigits, minFractionDigits).format(value);
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '৳ 0';
  const hasFraction = Math.abs(value - Math.round(value)) > 0.001;
  return `৳ ${formatNumber(value, hasFraction ? 2 : 0, 0)}`;
}

export function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return '৳0';
  return `৳${new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${formatNumber(value, 1)}%`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMonthLabel(monthKey: string): string {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
  }).format(dt);
}

export function shiftDaysISO(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDaysAgoISO(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMonthStartISO(offsetMonths = 0): string {
  const dt = new Date();
  dt.setDate(1);
  dt.setMonth(dt.getMonth() + offsetMonths);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function getMonthEndISO(offsetMonths = 0): string {
  const dt = new Date();
  dt.setDate(1);
  dt.setMonth(dt.getMonth() + offsetMonths + 1);
  dt.setDate(0);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toSafeFirestoreId(prefix: string, raw: string): string {
  const normalized = raw.trim();
  const bytes = new TextEncoder().encode(normalized);

  // Hash all bytes into a 128-bit (32 hex char) deterministic digest to prevent truncation collisions
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((b + i) & 0xff), 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ (b ^ 0xa5), 0x85ebca6b) >>> 0;
    h4 = Math.imul(h4 ^ ((b + 17) & 0xff), 0xc2b2ae35) >>> 0;
  }
  const digest = [h1, h2, h3, h4]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');

  const safePrefix = prefix
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 16);
  const asciiPart = normalized
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);

  return `${safePrefix || 'id'}_${asciiPart || 'item'}_${digest}`;
}

export function normalizeBengaliDigits(input: string): string {
  return input.replace(/[\u09E6-\u09EF]/g, (ch) =>
    String(ch.charCodeAt(0) - 0x09e6)
  );
}

export function sanitizeNumericInput(raw: string, allowDecimal = true): string {
  const normalized = normalizeBengaliDigits(raw)
    .replace(/[,\s]/g, '')
    .replace(/।/g, '.');
  if (!allowDecimal) {
    return normalized.replace(/[^0-9]/g, '');
  }
  let result = '';
  let hasDot = false;
  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      result += ch;
    } else if (ch === '.' && !hasDot) {
      hasDot = true;
      result += '.';
    }
  }
  return result;
}

