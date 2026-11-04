// Canonical JSON: keys sorted at every depth, no whitespace. Used for signing and verifying.
export function canonicalJSON(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('canonicalJSON: non-finite number');
    if (typeof v === 'bigint') throw new TypeError('canonicalJSON: bigint not allowed (use strings)');
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortKeys(x)));
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    out[k] = sortKeys(v[k]);
  }
  return out;
}
