import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJSON } from '../src/canonical.mjs';

export function digestOf(statement) {
  return createHash('sha256').update(canonicalJSON(statement)).digest();
}

export function loadPrivateKey(file) {
  return createPrivateKey(readFileSync(file));
}

export function publicPemOf(privateKey) {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
}

// signature = ed25519(sha256(canonicalJSON(statement))), base64
export function signStatement(statement, privateKey) {
  return edSign(null, digestOf(statement), privateKey).toString('base64');
}

export function verifyStatement(statement, signatureB64, publicKeyPem) {
  try {
    return edVerify(null, digestOf(statement), createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
