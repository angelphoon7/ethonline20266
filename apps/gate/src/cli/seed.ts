/**
 * Seeds the labelled regression dataset into the local store (`data/risksir.db`) from committed fixtures only.
 * Idempotent: cases that already exist are left untouched (their label history is never overwritten).
 * Run: corepack pnpm seed. Makes no network calls.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ORG_ID } from '@risksir/core';
import { loadDataset } from '../dataset/load.js';
import { Store } from '../store/store.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const store = new Store(join(root, 'data', 'risksir.db'));
let added = 0;
let kept = 0;
for (const c of loadDataset(root)) {
  if (store.getCase(c.caseId)) {
    kept += 1;
    continue;
  }
  store.saveCase(c);
  added += 1;
}
const mix: Record<string, number> = {};
for (const c of store.listCases(DEMO_ORG_ID)) mix[c.provenance] = (mix[c.provenance] ?? 0) + 1;
console.log(JSON.stringify({ added, alreadyPresent: kept, provenanceMix: mix }));
store.close();
