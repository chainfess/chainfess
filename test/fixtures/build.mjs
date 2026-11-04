// Regenerates test/fixtures/<name>/ and fixtures/demo/. All data is invented. Run by hand: node test/fixtures/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LATEST = 100000000;
export const LATEST_TS = Date.parse('2026-11-05T00:00:00Z') / 1000;
export const BLOCK_TIME = 0.104;
export const WALLET = '0x' + 'a1'.repeat(20);
export const OTHER = '0x' + 'b2'.repeat(20);
export const THIRD = '0x' + 'c3'.repeat(20);
export const TARGET = '0x' + 'd4'.repeat(20);
export const FAKE_KEY = '0x' + '7e57'.repeat(16);
export const FAKE_API = 'sk-ant-api03-FAKEFAKEFAKEFAKE';

export const blockAt = (iso) => LATEST - Math.floor((LATEST_TS - Date.parse(iso) / 1000) / BLOCK_TIME);
export const h = (s) => '0x' + createHash('sha256').update(String(s)).digest('hex');

const T = (min, sec = 0) => new Date(Date.parse('2026-11-01T10:00:00Z') + min * 60000 + sec * 1000).toISOString();
export const T_START = T(0);
export const T_END = T(10);

let uuid = 0;
const base = (type, ts, extra = {}) => ({ type, timestamp: ts, sessionId: 'sess-1', uuid: `u${++uuid}`, parentUuid: null, isSidechain: false, ...extra });
export const user = (ts, text) => base('user', ts, { message: { role: 'user', content: text } });
export const say = (ts, text, extra) => base('assistant', ts, { message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
export const use = (ts, id, command, name = 'Bash') => base('assistant', ts, { message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: { command } }] } });
export const result = (ts, id, content, extra) => base('user', ts, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });
const start = () => user(T_START, 'start');
const end = () => say(T_END, 'done');

const tx = (hash, from, nonce, block, extra = {}) => ({ hash, from, to: TARGET, nonce, block, value: '0x0', ...extra });
const world = (wallets, nonces, txs, extra = {}) => ({
  chainId: 4663, latest: LATEST, latestTs: LATEST_TS, blockTime: BLOCK_TIME, wallets, nonces,
  code: { [TARGET]: '0x' }, txs, ...extra,
});

export function buildAll(root = HERE) {
  const write = (name, files) => {
    const dir = join(root, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      let text;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';
      else text = JSON.stringify(content, null, 1) + '\n';
      writeFileSync(p, text);
    }
  };
  const W = WALLET;
  const inWin = blockAt(T(5));

  write('read-not-send', {
    'session.jsonl': [start(), use(T(5), 't1', `cast tx ${h('old')}`), result(T(5, 1), 't1', `from ${THIRD}\nhash ${h('old')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('old'), THIRD, 9, blockAt('2026-10-20T00:00:00Z'))]),
  });
  write('foreign-send-window', {
    'session.jsonl': [start(), use(T(5), 't1', 'node pay.mjs'), result(T(5, 3), 't1', `sent ${h('pay')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('pay'), OTHER, 3, inWin)]),
  });
  write('foreign-send-window-key', {
    'session.jsonl': [start(), use(T(5), 't1', 'node pay.mjs --private-key $DEPLOYER'), result(T(5, 3), 't1', `sent ${h('pay')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('pay'), OTHER, 3, inWin)]),
  });
  write('foreign-send-pattern', {
    'session.jsonl': [start(), use(T(5), 't1', `cast send ${TARGET} --private-key ${FAKE_KEY}`), result(T(5, 3), 't1', `transactionHash ${h('fs')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('fs'), OTHER, 3, inWin)]),
  });
  write('forge-broadcast', {
    'session.jsonl': [start(), end()],
    'broadcast/Deploy.s.sol/4663/run-latest.json': { transactions: [{ hash: h('fb') }], receipts: [{ transactionHash: h('fb') }] },
    'rpc.json': world([W], { [W]: 1 }, [tx(h('fb'), W, 0, inWin)]),
  });
  const trunc = '0x1234' + 'ee'.repeat(28) + 'abcd';
  write('truncated-hash', {
    'session.jsonl': [start(), say(T(5), 'sent it: 0x1234…abcd.'), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(trunc, W, 0, inWin)]),
  });
  write('not-a-tx', {
    'session.jsonl': [start(), use(T(5), 't1', 'forge inspect'), result(T(5, 1), 't1', `salt ${h('salt')}\nblock ${h('blockhash')}\ntestnet ${h('sepolia-tx')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, []),
  });
  write('pre-session', {
    'session.jsonl': [start(), use(T(5), 't1', `cast receipt ${h('pre')}`), result(T(5, 1), 't1', 'ok'), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pre'), W, 0, blockAt('2026-11-01T08:00:00Z'))]),
  });
  write('pending', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast send'), result(T(5, 1), 't1', `${h('pend')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('pend'), W, 0, null)]),
  });
  write('reverted', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast send'), result(T(5, 1), 't1', `${h('rev')}`), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('rev'), W, 0, inWin, { status: '0x0' })]),
  });
  const b4 = blockAt(T(2));
  const b5 = b4 + 150;
  const b6 = b4 + 300;
  const prior = [0, 1, 2, 3].map((n) => tx(h(`gg${n}`), W, n, blockAt('2026-10-30T00:00:00Z') + n));
  write('ghost-gap', {
    // Nonces 0-3 are in the log too: an unknown nonce below min(K) rightly adds a head scan (§2.2 step 4).
    'session.jsonl': [start(),
      use(T(1), 't0', 'cast receipt'), result(T(1, 1), 't0', prior.map((t) => t.hash).join(' ')),
      use(T(2), 't1', 'cast send'), result(T(2, 1), 't1', h('gg4')),
      use(T(3), 't2', 'cast send'), result(T(3, 1), 't2', h('gg6')), end()],
    'rpc.json': world([W], { [W]: 7 }, [...prior, tx(h('gg4'), W, 4, b4), tx(h('gg5'), W, 5, b5), tx(h('gg6'), W, 6, b6)]),
  });
  write('ghost-tail', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'), result(T(2, 1), 't1', `${h('gt0')} ${h('gt1')}`), end()],
    'rpc.json': world([W], { [W]: 3 }, [
      tx(h('gt0'), W, 0, blockAt('2026-10-30T00:00:00Z')), tx(h('gt1'), W, 1, blockAt(T(2))),
      tx(h('gt2'), W, 2, blockAt(T(60))),
    ]),
  });
  write('contiguous-no-scan', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'), result(T(2, 1), 't1', `${h('c0')} ${h('c1')} ${h('c2')}`), end()],
    'rpc.json': world([W], { [W]: 3 }, [tx(h('c0'), W, 0, blockAt(T(2))), tx(h('c1'), W, 1, blockAt(T(2)) + 1), tx(h('c2'), W, 2, blockAt(T(2)) + 2)]),
  });
  write('subagent', {
    'session.jsonl': [start(), end()],
    'session/subagents/agent-x.jsonl': [
      use(T(4), 's1', 'cast send'), result(T(4, 2), 's1', h('sub')),
    ],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('sub'), W, 0, blockAt(T(4)))]),
  });
  write('concurrent-session', {
    'project/main.jsonl': [start(), end()],
    'project/other.jsonl': [user(T(1), 'other'), use(T(3), 'o1', 'cast send'), result(T(3, 1), 'o1', h('conc')), say(T(4), 'other done')],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('conc'), W, 0, blockAt(T(3)))]),
  });
  write('empty-log', { 'session.jsonl': '', 'rpc.json': world([W], { [W]: 0 }, []) });
  write('corrupt-log', {
    'session.jsonl': [start(), '{not json', `{"type":"user","timestamp":"${T(2)}", broken ${h('corruptline')}`, 'also bad', end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('corruptline'), W, 0, blockAt(T(2)))]),
  });
  write('corrupt-log-all', { 'session.jsonl': ['nope', '{broken', 'still no'], 'rpc.json': world([W], { [W]: 0 }, []) });
  write('secret-in-log', {
    'session.jsonl': [start(),
      use(T(2), 't1', `cast send --private-key ${FAKE_KEY} && export ANTHROPIC_API_KEY=${FAKE_API}`),
      result(T(2, 2), 't1', `PRIVATE_KEY=${FAKE_KEY}\nANTHROPIC_API_KEY=${FAKE_API}\nthe plan is banana\n${h('sec')}`),
      say(T(3), `key is ${FAKE_KEY} and ANTHROPIC_API_KEY=${FAKE_API}`),
      end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('sec'), W, 0, blockAt(T(2)))]),
  });
  write('final-text', {
    'session.jsonl': [start(),
      use(T(1), 't1', 'cast send'), result(T(1, 1), 't1', `${h('f0')} ${h('f1')} ${h('f2')}`),
      say(T(2), `mid text ${h('f1')}`),
      say(T(3), `subagent final ${h('f2')}`, { isSidechain: true }),
      use(T(4), 't2', 'ls'), result(T(4, 1), 't2', 'x'),
      say(T_END, `finished, see ${h('f0')}`)],
    'rpc.json': world([W], { [W]: 3 }, [tx(h('f0'), W, 0, blockAt(T(1))), tx(h('f1'), W, 1, blockAt(T(1)) + 1), tx(h('f2'), W, 2, blockAt(T(1)) + 2)]),
  });
  const dump = Array.from({ length: 60 }, (_, i) => tx(h(`dump${i}`), '0x' + (i + 16).toString(16).repeat(20), i, inWin));
  write('block-dump', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast block latest --full'), result(T(5, 1), 't1', dump.map((t) => t.hash).join('\n')), end()],
    'rpc.json': world([W], { [W]: 0 }, dump),
  });
  write('block-dump-after-send', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast send && cast block latest'),
      result(T(5, 1), 't1', `${h('own')}\n${h('stranger')}`), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('own'), W, 0, inWin), tx(h('stranger'), OTHER, 4, inWin)]),
  });
  write('dump-three-senders', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast send && cast block latest'),
      result(T(5, 1), 't1', `${h('d1')}\n${h('d2')}\n${h('d3')}`), end()],
    'rpc.json': world([W], { [W]: 0 }, [tx(h('d1'), OTHER, 1, inWin), tx(h('d2'), THIRD, 1, inWin), tx(h('d3'), TARGET, 1, inWin)]),
  });
  // Real-log shapes from the spike.
  write('content-array', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', [{ type: 'text', text: `tx ${h('arr')}` }, { type: 'image', source: {} }]), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('arr'), W, 0, blockAt(T(2)))]),
  });
  write('tool-use-result-carrier', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', 'short', { toolUseResult: { stdout: `tx ${h('tur')}`, stderr: '' } }), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('tur'), W, 0, blockAt(T(2)))]),
  });
  write('persisted-marker', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', '<persisted-output>\nOutput too large (29.8KB). Full output saved to: @DIR@/session/tool-results/abc.txt\n\nPreview (first 2KB):\nnothing\n...</persisted-output>'), end()],
    'session/tool-results/abc.txt': `lots of output\n${h('pm')}\nend\n`,
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pm'), W, 0, blockAt(T(2)))]),
  });
  write('persisted-path', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', 'see file', { toolUseResult: { stdout: 'head', persistedOutputPath: '@DIR@/elsewhere/tool-results/def.txt', persistedOutputSize: 10 } }), end()],
    'elsewhere/tool-results/def.txt': `${h('pp')}\n`,
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pp'), W, 0, blockAt(T(2)))]),
  });
  write('persisted-glob', {
    'session.jsonl': [start(), end()],
    'session/tool-results/mcp-x.json': JSON.stringify([{ type: 'text', text: `hash ${h('pg')}` }]),
    'session/tool-results/shot.png': `${h('in-an-image')}`,
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pg'), W, 0, blockAt(T(2)))]),
  });
  write('persisted-foreign', {
    'session.jsonl': [start(), use(T(5), 't1', 'cast send --private-key $K'),
      result(T(5, 3), 't1', '<persisted-output>\nOutput too large. Full output saved to: @DIR@/session/tool-results/f.txt\n</persisted-output>'), end()],
    'session/tool-results/f.txt': `${h('pf')}\n`,
    'rpc.json': world([W], { [W]: 0 }, [tx(h('pf'), OTHER, 3, inWin)]),
  });
  write('persisted-missing', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', '<persisted-output>\nOutput too large. Full output saved to: /nowhere/s/tool-results/gone.txt\n</persisted-output>'), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pmiss'), W, 0, blockAt(T(2)))]),
  });
  write('persisted-over-cap', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'),
      result(T(2, 1), 't1', '<persisted-output>\nOutput too large. Full output saved to: @DIR@/session/tool-results/big.txt\n</persisted-output>'), end()],
    'session/tool-results/big.txt': `${'x'.repeat(4096)}${h('pover')}\n`,
    'rpc.json': world([W], { [W]: 1 }, [tx(h('pover'), W, 0, blockAt(T(2)))]),
  });
  write('unknown-types', {
    'session.jsonl': [
      { type: 'last-prompt', sessionId: 's' },
      { type: 'file-history-snapshot', timestamp: '2020-01-01T00:00:00Z' },
      start(),
      { type: 'queue-operation', timestamp: T(1), content: `queued ${h('queued')}` },
      { type: 'user', sessionId: 's', uuid: 'nots', message: { role: 'user', content: 'no timestamp on this one' } },
      end(),
    ],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('queued'), W, 0, blockAt(T(1)))]),
  });
  write('bare-hash', {
    'session.jsonl': [start(), use(T(2), 't1', 'some-tool'), result(T(2, 1), 't1', `id ${h('bare').slice(2)}`), end()],
    'rpc.json': world([W], { [W]: 1 }, [tx(h('bare'), W, 0, blockAt(T(2)))]),
  });
  write('same-block-nonces', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'), result(T(2, 1), 't1', `${h('sb0')} ${h('sb2')}`), end()],
    'rpc.json': world([W], { [W]: 3 }, [tx(h('sb0'), W, 0, inWin), tx(h('sb1'), W, 1, inWin), tx(h('sb2'), W, 2, inWin)]),
  });
  write('two-wallets', {
    'session.jsonl': [start(), use(T(2), 't1', 'cast send'), result(T(2, 1), 't1', h('tw')), end()],
    'rpc.json': world([W, OTHER], { [W]: 1, [OTHER]: 0 }, [tx(h('tw'), W, 0, blockAt(T(2)), { to: OTHER })]),
  });
  write('nothing-to-reconcile', {
    'session.jsonl': [start(), end()],
    'rpc.json': world([W], { [W]: 2 }, [tx(h('old0'), W, 0, blockAt('2026-10-01T00:00:00Z')), tx(h('old1'), W, 1, blockAt('2026-10-02T00:00:00Z'))]),
  });
}

/** The bundled demo. Invented wallets and hashes, 1 Accounted, 1 Unaccounted, 1 Foreign signer, 1 Observed. */
export function buildDemo(dir = join(HERE, '..', '..', 'fixtures', 'demo')) {
  const wallet = '0x' + 'de' + 'a1'.repeat(18) + 'de';
  const signer = '0x' + '5e'.repeat(19) + 'ed';
  const read = '0x' + '0b'.repeat(20);
  const payee = '0x' + '77'.repeat(19) + 'c0';
  const t = (m, s = 0) => new Date(Date.parse('2026-11-04T09:40:00Z') + m * 60000 + s * 1000).toISOString();
  const latest = LATEST;
  const latestTs = Date.parse('2026-11-04T12:00:00Z') / 1000;
  const at = (iso) => latest - Math.floor((latestTs - Date.parse(iso) / 1000) / BLOCK_TIME);
  const log = [
    user(t(0), 'Deploy the vault and fund it, then tell me what you did.'),
    use(t(2), 'toolu_d1', `cast send ${payee} --value 0.01ether --rpc-url $RPC`),
    result(t(2, 3), 'toolu_d1', `status 1\ntransactionHash ${h('demo-accounted')}`),
    use(t(5), 'toolu_d2', `cast tx ${h('demo-observed')} --rpc-url $RPC`),
    result(t(5, 1), 'toolu_d2', `from ${read}\nblockNumber 90000000`),
    use(t(9), 'toolu_d3', `cast send ${payee} --private-key $OTHER_KEY --rpc-url $RPC`),
    result(t(9, 3), 'toolu_d3', `status 1\ntransactionHash ${h('demo-foreign')}`),
    say(t(14), `Done. Funded the vault in one transaction: ${h('demo-accounted').slice(0, 8)}…${h('demo-accounted').slice(-6)}.`),
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const rpc = {
    chainId: 4663, latest, latestTs, blockTime: BLOCK_TIME,
    demoWallets: [wallet], demoNow: '2026-11-04T12:00:00Z',
    nonces: { [wallet]: 9 }, code: { [payee]: '0x60806040' },
    txs: [
      { hash: h('demo-accounted'), from: wallet, to: payee, nonce: 7, block: at(t(2, 2)), value: '0x2386f26fc10000' },
      { hash: h('demo-unaccounted'), from: wallet, to: signer, nonce: 8, block: at(t(11, 40)), value: '0x3782dace9d90000' },
      { hash: h('demo-foreign'), from: signer, to: payee, nonce: 41, block: at(t(9, 2)), value: '0x0' },
      { hash: h('demo-observed'), from: read, to: payee, nonce: 3, block: 90000000, value: '0x0' },
    ],
  };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.jsonl'), log);
  writeFileSync(join(dir, 'rpc.json'), JSON.stringify(rpc, null, 1) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildAll();
  buildDemo();
}
