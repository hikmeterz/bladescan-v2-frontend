// Display formatting shared by every page (English UI, metric units).
export const date = ms => (ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export const meters = n => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + ' m';

export const mb = bytes => (bytes / 1e6).toLocaleString('en-GB', { maximumFractionDigits: bytes >= 1e10 ? 0 : 1 }) + ' MB';

export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${s} s`;
}

// Section codes: L / T since Oct 2026; older inspections used numbers 1-4.
export const sectionLabel = s => ({ L: 'Leading edge', T: 'Trailing edge' })[s] || (s ? 'Section ' + s : '—');
