import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBurn } from '../../server/verify-burn.mjs';
import { TOKEN, WALLET, WALLET2, STRANGER, burnFixture, transferLog } from './helpers.mjs';

const base = (f, over = {}) => ({ ...f, latest: 1100, tokenAddress: TOKEN, burnAmount: '1000', wallets: [WALLET], ...over });

test('verifyBurn accepts exact amount, larger amount, burn to 0x0 and to dEaD', () => {
  assert.equal(verifyBurn(base(burnFixture())).ok, true);
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog({ value: 5000n })] }))).ok, true);
  const zero = '0x' + '0'.repeat(40);
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog({ to: zero })] }))).ok, true);
});
test('verifyBurn rule 2: exactly 50 blocks passes, 49 is too_recent, pending is too_recent, unknown tx is 404', () => {
  assert.equal(verifyBurn(base(burnFixture(), { latest: 1050 })).ok, true);
  const r = verifyBurn(base(burnFixture(), { latest: 1049 }));
  assert.deepEqual([r.status, r.error], [409, 'too_recent']);
  const f = burnFixture(); f.tx.blockNumber = null;
  assert.equal(verifyBurn(base(f)).error, 'too_recent');
  assert.equal(verifyBurn(base({ tx: null, receipt: null })).status, 404);
});
test('verifyBurn rule 3: reverted receipt is rejected', () => {
  const r = verifyBurn(base(burnFixture({ status: '0x0' })));
  assert.deepEqual([r.status, r.error], [400, 'burn_reverted']);
});
test('verifyBurn rule 4: zero, two, or other-token transfers are rejected', () => {
  assert.equal(verifyBurn(base(burnFixture({ logs: [] }))).error, 'burn_transfer_not_exactly_one');
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog(), transferLog()] }))).error, 'burn_transfer_not_exactly_one');
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog({ token: '0x' + 'bb'.repeat(20) })] }))).error, 'burn_transfer_not_exactly_one');
});
test('verifyBurn rule 4: token address compare is case-insensitive; an unrelated token log does not count as a second transfer', () => {
  const other = transferLog({ token: '0x' + 'bb'.repeat(20) });
  assert.equal(verifyBurn(base(burnFixture({ logs: [other, transferLog()] }), { tokenAddress: TOKEN.toUpperCase().replace('0X', '0x') })).ok, true);
});
test('verifyBurn rule 4: transfer to a non-burn address, or from another sender, is rejected', () => {
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog({ to: STRANGER })] }))).error, 'burn_transfer_not_to_burn_address');
  assert.equal(verifyBurn(base(burnFixture({ logs: [transferLog({ from: WALLET2 })] }))).error, 'burn_transfer_wrong_sender');
});
test('verifyBurn rule 4: amount below burnAmount is rejected with amount_below_required', () => {
  const r = verifyBurn(base(burnFixture({ logs: [transferLog({ value: 999n })] })));
  assert.deepEqual([r.status, r.error], [400, 'amount_below_required']);
});
test('verifyBurn rule 5: burn from a wallet that is not audited is 403', () => {
  const f = burnFixture({ from: STRANGER });
  const r = verifyBurn(base(f));
  assert.deepEqual([r.status, r.error], [403, 'burn_wallet_not_audited']);
  assert.equal(verifyBurn(base(f, { wallets: [WALLET, STRANGER.toUpperCase().replace('0X', '0x')] })).ok, true);
});
