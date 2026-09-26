import { z } from 'zod';

/**
 * Evidence tier mapping: Risksir policy over OBSERVED provider fields, never an Intercepta claim (ADR-007, ADR-017).
 * A mapper returns null when the body is not understood, which becomes UNAVAILABLE(MALFORMED) => HOLD.
 */
export interface MappedEvidence {
  tier: 'CLEAR' | 'WARN' | 'BLOCK';
  providerScore: number | null;
  reasons: string[];
}
export type Mapper = (body: unknown) => MappedEvidence | null;

/** Maps nothing. Kept for tests that must prove an unmapped response can never pass. */
export const unmappedMapper: Mapper = () => null;

export const QUICK_SCAN_MAPPING_VERSION = 'quickscan-v1';

/** Observed live (Spike A, 2026-09-26): `{ toxicScore: number, traits: [{ risk, name, description }] }`. Extra fields are ignored. */
export const quickScanBodySchema = z.object({
  toxicScore: z.number().min(0).max(100),
  traits: z.array(
    z.object({
      risk: z.number().min(0).max(100),
      name: z.string().min(1),
    }),
  ),
});

/** Thresholds are Risksir policy (ADR-017): BLOCK at 80 or above, WARN for any other non-zero signal, CLEAR only for a score of 0 with no traits. */
export const BLOCK_THRESHOLD = 80;

export const quickScanMapper: Mapper = (body) => {
  const parsed = quickScanBodySchema.safeParse(body);
  if (!parsed.success) return null;
  const { toxicScore, traits } = parsed.data;
  const reasons = traits.map((t) => t.name);
  const blocked = toxicScore >= BLOCK_THRESHOLD || traits.some((t) => t.risk >= BLOCK_THRESHOLD);
  if (blocked) return { tier: 'BLOCK', providerScore: toxicScore, reasons };
  if (toxicScore > 0 || traits.length > 0) return { tier: 'WARN', providerScore: toxicScore, reasons };
  return { tier: 'CLEAR', providerScore: toxicScore, reasons };
};
