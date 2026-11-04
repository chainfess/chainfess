// BRIEF §5.1 rules 2-5, pure over a fetched tx + receipt. Rules 1, 6, 7 live in the app.
export const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const BURN_ADDRESSES = [
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
];
export const MIN_CONFIRMATIONS = 50;

const HEX_HASH = /^0x[0-9a-f]{64}$/;
export const isTxHash = (s) => typeof s === 'string' && HEX_HASH.test(s);
export const isAddress = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

const topicAddr = (t) => (typeof t === 'string' && /^0x[0-9a-fA-F]{64}$/.test(t) ? '0x' + t.slice(26).toLowerCase() : null);
const toBig = (h) => { try { return BigInt(h); } catch { return null; } };

const fail = (status, error, detail) => ({ ok: false, status, error, ...(detail ? { detail } : {}) });

/**
 * @param {{tx:object|null, receipt:object|null, latest:number, tokenAddress:string, burnAmount:string, wallets:string[]}} a
 * @returns {{ok:true, from:string, value:string}|{ok:false,status:number,error:string}}
 */
export function verifyBurn({ tx, receipt, latest, tokenAddress, burnAmount, wallets }) {
  // rule 2
  if (!tx) return fail(404, 'burn_tx_not_found');
  if (tx.blockNumber == null) return fail(409, 'too_recent', 'transaction is not mined yet');
  const bn = Number(BigInt(tx.blockNumber));
  if (!Number.isFinite(latest) || latest - bn < MIN_CONFIRMATIONS) return fail(409, 'too_recent');
  // rule 3
  if (!receipt) return fail(404, 'burn_receipt_not_found');
  if (receipt.status !== '0x1' && receipt.status !== 1) return fail(400, 'burn_reverted');
  // rule 4
  const token = String(tokenAddress || '').toLowerCase();
  const from = String(tx.from || '').toLowerCase();
  // Only Transfers from the token, sent by tx.from, to a burn address count. Other Transfers from the
  // token (e.g. a fee Transfer from a tax-on-transfer token) are ignored.
  const matching = (receipt.logs || []).filter(
    (l) => String(l.address || '').toLowerCase() === token && Array.isArray(l.topics) && l.topics.length === 3 &&
      String(l.topics[0]).toLowerCase() === TRANSFER_TOPIC0 &&
      topicAddr(l.topics[1]) === from && BURN_ADDRESSES.includes(topicAddr(l.topics[2])),
  );
  if (matching.length !== 1) return fail(400, 'burn_transfer_not_exactly_one');
  const t = matching[0];
  const value = toBig(t.data);
  const need = toBig(burnAmount);
  if (value === null || need === null || need <= 0n) return fail(400, 'burn_amount_invalid');
  if (value < need) return fail(400, 'amount_below_required');
  // rule 5
  if (!wallets.map((w) => w.toLowerCase()).includes(from)) return fail(403, 'burn_wallet_not_audited');
  return { ok: true, from, value: value.toString() };
}
