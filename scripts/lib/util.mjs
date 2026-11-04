// Small helpers shared by the static build scripts.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shortHash = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '');
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
export const utcTime = (iso) => (iso ? new Date(iso).toISOString().slice(11, 19) + ' UTC' : '—');
export const utcHM = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : '—');
export const utcDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');

export const LABEL = {
  accounted: 'accounted',
  partial: 'partial match only',
  unaccounted: 'not in this log',
  'foreign-signer': 'signed by a wallet not registered here',
  'pre-session': 'sent before this session (referenced in log)',
  'post-session': 'sent after this session',
  pending: 'pending at audit time; re-run later',
  'recent-other': "other wallet's tx mined during this tool call; cannot tell a read from a send",
  observed: "other wallet's tx referenced (read)",
};

// The brief's nonce line, built only from the JSON.
export function nonceLine(w) {
  if (!w) return '';
  if (w.neverSent) return 'Nonce 0 · this wallet has never sent a transaction.';
  const parts = [`Nonce ${w.nonce}`, `${w.inLog} in the log`, `${w.uIn} not`];
  if (w.uOut) parts.push(`${w.uOut} after the session`);
  return parts.join(' · ');
}
