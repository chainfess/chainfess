// Server-side scan: reuses CORE's rpc.mjs + ledger.mjs (CONTRACTS signature). Imported lazily.
export function createScanner({ rpcUrl, fallbackUrl = null, chainId = 4663, fetchImpl, paceMs, sleep }) {
  return async function scan({ wallets, fromBlock, toBlock, knownHashes, maxScanBlocks }) {
    const { createRpc } = await import('../src/rpc.mjs');
    const { runLedger } = await import('../src/ledger.mjs');
    const rpc = createRpc({ url: rpcUrl, fallbackUrl, chainId, fetchImpl, ...(paceMs !== undefined ? { paceMs } : {}), ...(sleep ? { sleep } : {}) });
    return runLedger({ rpc, wallets, fromBlock, toBlock, knownHashes, maxScanBlocks });
  };
}
