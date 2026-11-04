#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { process.stderr.write(`unexpected error: ${e && e.message ? e.message : 'unknown'}\n`); process.exitCode = 3; },
);
