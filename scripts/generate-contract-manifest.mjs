import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
const source = new URL('../packages/contracts/openapi.json', import.meta.url);
const target = new URL('../packages/contracts/contract-manifest.json', import.meta.url);
const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
writeFileSync(target, JSON.stringify({ version: '1.0.0', sha256: digest }) + '\n');
