// Guards what may reach a public page: only the whitelisted audit fields of CONTRACTS.md, no secret-shaped strings.
const TOP = new Set(['v', 'tool', 'toolVersion', 'demo', 'generatedAt', 'chainId', 'logs', 'session', 'wallets', 'scan', 'summary', 'txs', 'exitCode', 'note', 'verify']);
const TX = new Set(['hash', 'status', 'finding', 'from', 'to', 'toLabel', 'nonce', 'block', 'time', 'valueWei', 'valueEth', 'reverted', 'contractCreation', 'createdAddress', 'mentioned', 'source', 'pattern']);
const STATUS = new Set(['accounted', 'partial', 'unaccounted', 'foreign-signer', 'pre-session', 'post-session', 'pending', 'recent-other', 'observed']);

export function checkAudit(j, name = 'audit json') {
  const bad = [];
  if (j.v !== 1) bad.push('v must be 1');
  for (const k of Object.keys(j)) if (!TOP.has(k)) bad.push(`unknown top-level field "${k}"`);
  if (!j.session || !Array.isArray(j.wallets) || !j.wallets.length || !Array.isArray(j.txs)) bad.push('session, wallets[] and txs[] are required');
  for (const t of j.txs || []) {
    for (const k of Object.keys(t)) if (!TX.has(k)) bad.push(`unknown tx field "${k}"`);
    if (!STATUS.has(t.status)) bad.push(`unknown status "${t.status}"`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(t.hash || '')) bad.push(`bad hash "${t.hash}"`);
  }
  if (j.verify && Object.keys(j.verify).some((k) => k !== 'rpc')) bad.push('unknown verify field');
  const text = JSON.stringify(j);
  if (/PRIVATE_KEY|MNEMONIC|ANTHROPIC_API_KEY|--private-key|BEGIN [A-Z ]*PRIVATE/.test(text)) bad.push('secret-shaped string in audit json');
  if (bad.length) throw new Error(`${name}: ${bad.join('; ')}`);
  return true;
}
