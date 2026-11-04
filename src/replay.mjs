// A recorded chain answering JSON-RPC from a fixture. Used by `demo` and by tests. Never touches the network.
// world: { chainId, latest, latestTs, blockTime, nonces:{addr:n}, code:{addr:hex}, txs:[{hash,from,to,nonce,block,value,status,contractAddress}], pending:[…] }
export function createReplay(world) {
  const log = { requests: 0, blocksFull: [], blocksHeader: [], hashes: [], receipts: [], methods: {}, bodies: [] };
  const blockTime = world.blockTime ?? 0.104;
  const txByHash = new Map();
  const byBlock = new Map();
  for (const t of world.txs || []) {
    txByHash.set(t.hash.toLowerCase(), t);
    if (t.block !== null && t.block !== undefined) {
      if (!byBlock.has(t.block)) byBlock.set(t.block, []);
      byBlock.get(t.block).push(t);
    }
  }
  const tsOf = (n) => {
    if (world.timestampAt) return world.timestampAt(n);
    return Math.floor(world.latestTs - (world.latest - n) * blockTime);
  };
  const hex = (n) => '0x' + Number(n).toString(16);
  const rpcTx = (t) => ({
    hash: t.hash, from: t.from, to: t.to ?? null, nonce: hex(t.nonce),
    blockNumber: t.block === null || t.block === undefined ? null : hex(t.block),
    value: t.value ?? '0x0', input: t.input ?? '0x',
  });
  const answer = (method, params) => {
    log.methods[method] = (log.methods[method] || 0) + 1;
    switch (method) {
      case 'eth_chainId': return hex(world.chainId);
      case 'eth_blockNumber': return hex(world.latest);
      case 'eth_getTransactionCount': return hex((world.nonces || {})[String(params[0]).toLowerCase()] ?? 0);
      case 'eth_getCode': return (world.code || {})[String(params[0]).toLowerCase()] ?? '0x';
      case 'eth_getBlockByNumber': {
        const n = params[0] === 'latest' ? world.latest : Number(params[0]);
        if (world.prunedBelow !== undefined && n < world.prunedBelow) return null;
        if (n > world.latest || n < 0) return null;
        (params[1] ? log.blocksFull : log.blocksHeader).push(n);
        const list = byBlock.get(n) || [];
        return { number: hex(n), timestamp: hex(tsOf(n)), transactions: params[1] ? list.map(rpcTx) : list.map((t) => t.hash) };
      }
      case 'eth_getTransactionByHash': {
        const h = String(params[0]).toLowerCase();
        log.hashes.push(h);
        const t = txByHash.get(h);
        return t ? rpcTx(t) : null;
      }
      case 'eth_getTransactionReceipt': {
        const h = String(params[0]).toLowerCase();
        log.receipts.push(h);
        const t = txByHash.get(h);
        if (!t || t.block === null || t.block === undefined) return null;
        return { transactionHash: t.hash, status: t.status ?? '0x1', contractAddress: t.contractAddress ?? null, blockNumber: hex(t.block) };
      }
      default:
        throw new Error(`replay: no answer for ${method}`);
    }
  };
  const fetchImpl = async (_url, init) => {
    log.requests++;
    log.bodies.push(init.body);
    if (world.fail && world.fail(log)) return { status: 503, json: async () => ({}) };
    const req = JSON.parse(init.body);
    const one = (r) => ({ jsonrpc: '2.0', id: r.id, result: answer(r.method, r.params) });
    const res = Array.isArray(req) ? req.map(one) : one(req);
    return { status: 200, json: async () => res };
  };
  return { fetchImpl, log };
}
