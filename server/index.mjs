import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { openDb } from './db.mjs';
import { createChain } from './chain.mjs';
import { createTokenStore } from './token.mjs';
import { createScanner } from './scan.mjs';
import { loadPrivateKey, publicPemOf } from './keys.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const PORT = Number(env.PORT || 4905);
const STATE_DIR = env.STATE_DIR || join(root, 'state');
const RPC_URL = env.RPC_URL || 'https://robinhood-rpc.publicnode.com';
const TOKEN_JSON = env.TOKEN_JSON || join(root, 'web', 'token.json');
const SIGNING_KEY_FILE = env.SIGNING_KEY_FILE || join(STATE_DIR, 'signing.key');
const MAX_SCAN_BLOCKS = Number(env.MAX_SCAN_BLOCKS || 210000);
const FALLBACK = env.RPC_FALLBACK_URL || 'https://robinhood.drpc.org';

mkdirSync(STATE_DIR, { recursive: true });
const privateKey = loadPrivateKey(SIGNING_KEY_FILE); // never printed
const publicPem = publicPemOf(privateKey);
const db = openDb(join(STATE_DIR, 'chainfess.db'));
const tokenStore = createTokenStore({ file: TOKEN_JSON });
const chain = createChain({ url: RPC_URL });
const scan = createScanner({ rpcUrl: RPC_URL, fallbackUrl: FALLBACK === 'off' ? null : FALLBACK });

const app = createApp({
  db, chain, tokenStore, privateKey, publicPem, scan, maxScanBlocks: MAX_SCAN_BLOCKS,
  log: (...a) => console.error(new Date().toISOString(), ...a),
});
app.server.listen(PORT, '127.0.0.1', () => console.log(`chainfess server on 127.0.0.1:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { app.server.close(); setTimeout(() => process.exit(0), 200); });
