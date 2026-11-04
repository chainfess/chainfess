// Usage: node server/gen-key.mjs <private-key-file>
// Writes an ed25519 private key (mode 600) and <file>.pub.pem. Prints only the public key.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: gen-key.mjs <private-key-file>'); process.exit(2); }
if (existsSync(file)) { console.error('refusing to overwrite existing key file'); process.exit(1); }
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(file + '.pub.pem', pub, { mode: 0o644 });
process.stdout.write(pub);
