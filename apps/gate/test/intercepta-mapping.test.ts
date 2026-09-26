import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUICK_SCAN_MAPPING_VERSION, quickScanMapper } from '../src/intercepta/index.js';

const fixtures = fileURLToPath(new URL('../../../fixtures/intercepta/', import.meta.url));
const load = (dir: string, file: string) => JSON.parse(readFileSync(join(fixtures, dir, file), 'utf8')) as { provenance: string; body: unknown; address: string; error?: string };

// Recorded fixtures are REAL live responses (Spike A). Provenance stays real_live; nothing here relabels them.
const allRecorded = readdirSync(join(fixtures, 'recorded'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => load('recorded', f));
// A live call can also be recorded as an error (for example a real 8 s TIMEOUT observed 2026-09-26): no body, nothing to map.
const recorded = allRecorded.filter((r) => r.body !== null);
const errorRecords = allRecorded.filter((r) => r.body === null);

describe('quickScanMapper on recorded real_live responses (ADR-017)', () => {
  it('has recorded evidence from Spike A', () => {
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    expect(allRecorded.every((r) => r.provenance === 'real_live')).toBe(true);
  });

  it('a recorded live error (no body) is unusable evidence: the mapper returns null, so the gate holds', () => {
    for (const r of errorRecords) {
      expect(typeof r.error, r.address).toBe('string');
      expect(quickScanMapper(r.body)).toBeNull();
    }
  });

  it('maps every recorded body without returning null, and score 0 with no traits is CLEAR', () => {
    for (const r of recorded) {
      const mapped = quickScanMapper(r.body);
      expect(mapped, r.address).not.toBeNull();
      const body = r.body as { toxicScore: number; traits: unknown[] };
      if (body.toxicScore === 0 && body.traits.length === 0) expect(mapped?.tier).toBe('CLEAR');
    }
  });

  it('maps the observed known-risk response to BLOCK with the provider trait names as reasons', () => {
    const risky = recorded.find((r) => (r.body as { toxicScore: number }).toxicScore === 100);
    expect(risky).toBeDefined();
    expect(quickScanMapper(risky?.body)).toEqual({
      tier: 'BLOCK',
      providerScore: 100,
      reasons: ['known_scammer', 'attack_money_target'],
    });
  });

  it('maps the observed clean response to CLEAR', () => {
    const clean = recorded.find((r) => (r.body as { toxicScore: number }).toxicScore === 0);
    expect(quickScanMapper(clean?.body)).toEqual({ tier: 'CLEAR', providerScore: 0, reasons: [] });
  });
});

describe('quickScanMapper boundaries and unknown shapes (fail closed)', () => {
  const body = (toxicScore: number, traits: { risk: number; name: string }[] = []) => ({ toxicScore, traits });

  it('maps the unobserved mid band from a labelled SYNTHETIC fixture to WARN', () => {
    const synthetic = load('synthetic', 'quick-scan-warn-midband.json');
    expect(synthetic.provenance).toBe('synthetic');
    expect(quickScanMapper(synthetic.body)).toMatchObject({ tier: 'WARN', providerScore: 35, reasons: ['non_kyc_transfers'] });
  });

  it('BLOCK at 80 or above on the score or on any trait, WARN below, CLEAR only at 0 with no traits', () => {
    expect(quickScanMapper(body(80))?.tier).toBe('BLOCK');
    expect(quickScanMapper(body(79))?.tier).toBe('WARN');
    expect(quickScanMapper(body(1))?.tier).toBe('WARN');
    expect(quickScanMapper(body(10, [{ risk: 80, name: 'x' }]))?.tier).toBe('BLOCK');
    expect(quickScanMapper(body(0, [{ risk: 5, name: 'x' }]))?.tier).toBe('WARN'); // a trait with score 0 is still a signal
    expect(quickScanMapper(body(0))?.tier).toBe('CLEAR');
  });

  it.each([
    ['null', null],
    ['string', 'ok'],
    ['empty object', {}],
    ['missing traits', { toxicScore: 0 }],
    ['missing score', { traits: [] }],
    ['string score', { toxicScore: '0', traits: [] }],
    ['negative score', { toxicScore: -1, traits: [] }],
    ['score above 100', { toxicScore: 101, traits: [] }],
    ['trait without a name', { toxicScore: 0, traits: [{ risk: 1 }] }],
    ['NaN score', { toxicScore: NaN, traits: [] }],
  ])('returns null (MALFORMED => HOLD) for %s', (_n, value) => {
    expect(quickScanMapper(value)).toBeNull();
  });

  it('ignores unknown extra provider fields', () => {
    expect(quickScanMapper({ toxicScore: 0, traits: [], somethingNew: 1 })?.tier).toBe('CLEAR');
  });

  it('has a version string that is stored on evidence', () => {
    expect(QUICK_SCAN_MAPPING_VERSION).toBe('quickscan-v1');
  });
});
