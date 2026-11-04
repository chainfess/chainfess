// Minimal JSON-RPC client for the burn checks (no deps, 20 s timeout).
export function createChain({ url, fetchImpl = fetch, timeoutMs = 20000 }) {
  let id = 0;
  async function call(method, params = []) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'chainfess-server/0.1' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc http ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(`rpc error ${j.error.code}`);
    return j.result;
  }
  return {
    call,
    blockNumber: async () => Number(BigInt(await call('eth_blockNumber'))),
    getTx: (h) => call('eth_getTransactionByHash', [h]),
    getReceipt: (h) => call('eth_getTransactionReceipt', [h]),
    chainId: async () => Number(BigInt(await call('eth_chainId'))),
  };
}
