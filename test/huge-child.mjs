// Runs one audit of a generated huge log and prints peak memory. Spawned by the huge-log test.
import { auditReport } from '../src/audit.mjs';
import { createReplay } from '../src/replay.mjs';
import { LATEST, LATEST_TS, BLOCK_TIME } from './fixtures/build.mjs';

const [log, hash, wallet, block] = process.argv.slice(2);
const world = {
  chainId: 4663, latest: LATEST, latestTs: LATEST_TS, blockTime: BLOCK_TIME, nonces: { [wallet]: 1 }, code: {},
  txs: [{ hash, from: wallet, to: null, nonce: 0, block: Number(block), value: '0x0' }],
};
let peak = 0;
const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
const timer = setInterval(sample, 20);
const { report } = await auditReport({
  wallets: [wallet], logs: [log], cwd: '/nonexistent', noBroadcast: true,
  fetchImpl: createReplay(world).fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false, onBytes: sample,
});
clearInterval(timer);
sample();
const maxRss = process.resourceUsage().maxRSS * 1024;
process.stdout.write(JSON.stringify({ accounted: report.summary.accounted, peakRssMb: Math.round(Math.max(peak, maxRss) / 1048576) }));
