/**
 * T-060 (live, L4): screens SELLER_PAY_TO_SAFE and SELLER_PAY_TO_RISKY once each through the production adapter and mapper,
 * and stores the raw responses under fixtures/intercepta/recorded/. Run only through `LIVE=1 pnpm test:live`.
 * Spends 2 of the 40 live Intercepta calls per run (OPERATIONAL_GUARDRAILS section 5). Prints no secrets.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileBudget, QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress, writeRecordedResponse } from '../src/intercepta/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // env vars may already be set by the caller
}

const budget = new FileBudget(join(root, 'data', 'intercepta-calls.json'));
const screen = (address: string | undefined) =>
  screenAddress(address ?? '', {
    baseUrl: process.env.INTERCEPTA_BASE_URL,
    apiKey: process.env.INTERCEPTA_API_KEY,
    mapper: quickScanMapper,
    provenance: 'real_live',
    mappingVersion: QUICK_SCAN_MAPPING_VERSION,
    budget,
  });

describe.skipIf(process.env.LIVE !== '1')('T-060 live Intercepta screen', () => {
  it('SAFE payTo is CLEAR and RISKY payTo is BLOCK, both raw responses stored', async () => {
    const safe = await screen(process.env.SELLER_PAY_TO_SAFE);
    const risky = await screen(process.env.SELLER_PAY_TO_RISKY);
    for (const r of [safe, risky]) {
      expect(r.raw?.httpStatus).toBe(200);
      expect(r.evidence.provenance).toBe('real_live');
      const file = writeRecordedResponse(join(root, 'fixtures', 'intercepta', 'recorded'), r.raw as NonNullable<typeof r.raw>);
      console.log(`recorded ${file.slice(root.length)} at ${r.evidence.capturedAt}`);
    }
    console.log(`SAFE tier=${safe.evidence.tier} score=${safe.evidence.providerScore}; RISKY tier=${risky.evidence.tier} score=${risky.evidence.providerScore} reasons=${risky.evidence.reasons.join(',')}`);
    expect(safe.evidence.tier).toBe('CLEAR');
    expect(risky.evidence.tier).toBe('BLOCK');
  });
});
