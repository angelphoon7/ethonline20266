import { z } from 'zod';

/**
 * Every case and every piece of evidence carries exactly one provenance label. Never relabelled (INV-020),
 * and only `real_live` may ever be presented as live (INV-012).
 */
export const PROVENANCES = ['real_live', 'sponsor_fixture', 'controlled_variant', 'synthetic'] as const;
export const provenanceSchema = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof provenanceSchema>;

export function isLiveProvenance(p: Provenance): boolean {
  return p === 'real_live';
}

/** Throws if a record's provenance would change. Use wherever a stored case or evidence object is updated. */
export function assertSameProvenance(before: Provenance, after: Provenance, what: string): void {
  if (before !== after) {
    throw new Error(`provenance of ${what} is immutable (${before} -> ${after} rejected)`);
  }
}

export function countProvenance(items: readonly { provenance: Provenance }[]): Record<Provenance, number> {
  const mix: Record<Provenance, number> = { real_live: 0, sponsor_fixture: 0, controlled_variant: 0, synthetic: 0 };
  for (const item of items) mix[item.provenance] += 1;
  return mix;
}
