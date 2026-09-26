/**
 * Spike A probe (M-003): screens the SAFE and RISKY payTo live, once each, and stores the raw responses under
 * fixtures/intercepta/recorded/. Run: LIVE=1 corepack pnpm --filter @risksir/gate spike:a. Prints public addresses and
 * observed fields only, never the API key. Uses the unmapped mapper: this run OBSERVES, it does not interpret.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileBudget, screenAddress, unmappedMapper, writeRecordedResponse } from '../intercepta/index.js';

if (process.env.LIVE !== '1') {
  console.error('spike-a refused: set LIVE=1 (live Intercepta calls are budgeted, see OPERATIONAL_GUARDRAILS section 5).');
  process.exit(1);
}

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const recordedDir = join(root, 'fixtures', 'intercepta', 'recorded');
const budget = new FileBudget(join(root, 'data', 'intercepta-calls.json'));

const subjects: [string, string | undefined][] = [
  ['SAFE', process.env.SELLER_PAY_TO_SAFE],
  ['RISKY', process.env.SELLER_PAY_TO_RISKY],
];

for (const [label, address] of subjects) {
  if (!address) {
    console.error(`${label}: env var not set, skipping`);
    continue;
  }
  const { raw, evidence } = await screenAddress(address, {
    baseUrl: process.env.INTERCEPTA_BASE_URL,
    apiKey: process.env.INTERCEPTA_API_KEY,
    mapper: unmappedMapper,
    provenance: 'real_live',
    mappingVersion: 'unmapped-spike-a',
    budget,
  });
  const file = raw ? writeRecordedResponse(recordedDir, raw) : null;
  console.log(
    JSON.stringify({
      subject: label,
      address: evidence.address,
      httpStatus: raw?.httpStatus ?? null,
      latencyMs: raw?.latencyMs ?? null,
      error: raw?.error ?? null,
      unavailable: evidence.unavailable,
      recordedFile: file ? file.slice(root.length) : null,
      body: raw?.body ?? null,
    }),
  );
}
console.log('INTERCEPTA calls used: see data/intercepta-calls.json (limit 40)');
