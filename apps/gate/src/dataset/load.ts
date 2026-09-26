import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PaymentCase } from '@risksir/core';
import { buildDataset, manifestSchema } from './build.js';
import type { RecordedResponse } from './build.js';

/** Reads the committed fixtures under `<root>/fixtures` and builds the dataset. */
export function loadDataset(root: string): PaymentCase[] {
  const recordedDir = join(root, 'fixtures', 'intercepta', 'recorded');
  const recorded: Record<string, RecordedResponse> = {};
  for (const f of readdirSync(recordedDir).filter((n) => n.endsWith('.json'))) {
    recorded[f] = JSON.parse(readFileSync(join(recordedDir, f), 'utf8')) as RecordedResponse;
  }
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'cases', 'real_live_manifest.json'), 'utf8')));
  const syntheticWarn = JSON.parse(readFileSync(join(root, 'fixtures', 'intercepta', 'synthetic', 'quick-scan-warn-midband.json'), 'utf8')) as RecordedResponse;
  return buildDataset({ manifest, recorded, syntheticWarn });
}
