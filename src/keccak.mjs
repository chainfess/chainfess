// keccak-256 (not NIST SHA3), EIP-55 checksums, and the check that a 32-byte value is the key of a wallet.
import { createECDH } from 'node:crypto';

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PIL = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function f(s) {
  const c = new Array(5);
  for (let r = 0; r < 24; r++) {
    for (let i = 0; i < 5; i++) c[i] = s[i] ^ s[i + 5] ^ s[i + 10] ^ s[i + 15] ^ s[i + 20];
    for (let i = 0; i < 5; i++) {
      const d = c[(i + 4) % 5] ^ rotl(c[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) s[j + i] ^= d;
    }
    let t = s[1];
    for (let i = 0; i < 24; i++) {
      const j = PIL[i];
      const b = s[j];
      s[j] = rotl(t, ROT[i]);
      t = b;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) c[i] = s[j + i];
      for (let i = 0; i < 5; i++) s[j + i] = c[i] ^ (~c[(i + 1) % 5] & M & c[(i + 2) % 5]);
    }
    s[0] ^= RC[r];
  }
}

export function keccak256(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const rate = 136;
  const padded = Buffer.alloc(data.length + rate - (data.length % rate));
  data.copy(padded);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= padded.readBigUInt64LE(off + i * 8);
    f(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}

export function toChecksum(address) {
  if (!address) return address;
  const a = String(address).toLowerCase().replace(/^0x/, '');
  const h = keccak256(Buffer.from(a, 'ascii')).toString('hex');
  let out = '0x';
  for (let i = 0; i < a.length; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}

/** Address of a 32-byte private key given as 0x + 64 hex, or null when it is not a valid key. */
export function addressOfKey(hex32) {
  try {
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(hex32.slice(2), 'hex'));
    return '0x' + keccak256(ecdh.getPublicKey().subarray(1)).subarray(12).toString('hex');
  } catch {
    return null;
  }
}
