import { readFileSync } from 'node:fs';

// token.json is re-read every 30 s (BRIEF §4.6). Keeps the last good copy if a read fails.
export function createTokenStore({ file, intervalMs = 30000, readFile = (f) => readFileSync(f, 'utf8') }) {
  let cur = { launched: false };
  const load = () => {
    try { cur = JSON.parse(readFile(file)); } catch { /* keep last good */ }
    return cur;
  };
  load();
  const timer = setInterval(load, intervalMs);
  timer.unref?.();
  return { get: () => cur, reload: load, stop: () => clearInterval(timer) };
}

export function signingEnabled(t) {
  return !!(t && t.launched === true && /^0x[0-9a-fA-F]{40}$/.test(t.tokenAddress || '') && /^[1-9][0-9]*$/.test(String(t.burnAmount || '')));
}
