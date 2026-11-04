// Builds the signed statement (BRIEF §5.1 rule 8). Status words are listed / not listed only.
export function buildStatement({ ledger, request, chainId, burnTx, signedAt, serverPublicKey }) {
  const wallets = request.wallets;
  const known = new Set(request.hashes);
  const walletSet = new Set(wallets);
  const seen = new Map();
  for (const t of ledger.txs || []) {
    if (!t || !t.hash || !walletSet.has(String(t.from).toLowerCase())) continue;
    const hash = String(t.hash).toLowerCase();
    seen.set(hash, {
      hash,
      nonce: Number(t.nonce),
      block: Number(t.block ?? t.blockNumber),
      listedByClient: known.has(hash),
      value: String(t.valueWei ?? t.value ?? '0'),
      to: t.to ? String(t.to).toLowerCase() : null,
    });
  }
  const txs = [...seen.values()].sort((a, b) => a.block - b.block || a.nonce - b.nonce || (a.hash < b.hash ? -1 : 1));
  const nonceAt = {};
  for (const w of wallets) nonceAt[w] = Number(ledger.nonceAt?.[w] ?? ledger.nonceAt?.[w.toLowerCase()] ?? 0);
  return {
    v: 1,
    chainId,
    wallets,
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
    nonceAt,
    txs,
    unscannedRanges: (ledger.unscannedRanges || []).map((r) => (Array.isArray(r) ? { from: r[0], to: r[1] } : { from: r.from, to: r.to })),
    logSha256: request.logSha256,
    burnTx,
    signedAt,
    serverPublicKey,
  };
}
