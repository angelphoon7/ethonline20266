import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_TAGS,
  hashDataset,
  hashPolicy,
  hashQuote,
  hashReport,
  sealPolicy,
  sealReport,
  verifyPolicyHash,
} from '../src/index.js';
import { PAY_TO_ALT, T0, USDC, caseInput, quoteInput, unsealedPolicyInput } from './fixtures.js';

const sha = (tag: string, canonical: string) => `0x${createHash('sha256').update(`${tag}\n${canonical}`, 'utf8').digest('hex')}`;

// T-003 (INV-005): quote hash covers every bound field.
describe('hashQuote', () => {
  it('matches an independently built tag + canonical string', () => {
    const literal =
      `{"amountAtomic":"50000","asset":"${USDC.toLowerCase()}","attemptId":"att-1","maxTimeoutSeconds":60,` +
      `"network":"eip155:84532","payTo":"0x${'11'.repeat(20)}","resourceUrl":"http://localhost:4021/paid/report/safe","scheme":"exact"}`;
    expect(hashQuote(quoteInput())).toBe(sha('risksir/quote/v1', literal));
  });

  it('has a stable golden vector (any change here is a breaking change to every stored decision)', () => {
    expect(hashQuote(quoteInput())).toBe('0xc29983001a3d797999aac9449582e79f1a73cfc1e5c2be4050cbd4bb590fca9c');
  });

  const mutations: [string, Record<string, unknown>][] = [
    ['scheme', { scheme: 'upto' }],
    ['network', { network: 'eip155:8453' }],
    ['asset', { asset: `0x${'44'.repeat(20)}` }],
    ['amount', { amountAtomic: '50001' }],
    ['payTo', { payTo: PAY_TO_ALT }],
    ['resource', { resourceUrl: 'http://localhost:4021/paid/report/risky' }],
    ['attemptId', { attemptId: 'att-2' }],
    ['validity', { maxTimeoutSeconds: 61 }],
  ];
  it.each(mutations)('changes when %s changes', (_field, patch) => {
    expect(hashQuote(quoteInput(patch))).not.toBe(hashQuote(quoteInput()));
  });

  it('does not change with address casing', () => {
    expect(hashQuote(quoteInput({ asset: USDC.toUpperCase().replace('0X', '0x') }))).toBe(hashQuote(quoteInput({ asset: USDC.toLowerCase() })));
  });

  it('rejects invalid quotes instead of hashing them', () => {
    expect(() => hashQuote(quoteInput({ amountAtomic: '0.05' }))).toThrow();
    expect(() => hashQuote(quoteInput({ payTo: '0x123' }))).toThrow();
  });

  it('is a lowercase 0x + 64 hex string', () => {
    expect(hashQuote(quoteInput())).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// T-004: policy, dataset and report hashes.
describe('policy, dataset and report hashes', () => {
  it('seals a policy and verifies it; tampering breaks verification', () => {
    const sealed = sealPolicy(unsealedPolicyInput() as never);
    expect(verifyPolicyHash(sealed)).toBe(true);
    const tampered = { ...sealed, defaultAction: 'DENY' as const };
    expect(verifyPolicyHash(tampered)).toBe(false);
  });

  it('policy hash ignores its own policyHash field and changes with any rule change', () => {
    const base = unsealedPolicyInput() as never;
    const sealed = sealPolicy(base);
    expect(hashPolicy(sealed)).toBe(hashPolicy(base));
    const changed = unsealedPolicyInput({ defaultAction: 'DENY' }) as never;
    expect(hashPolicy(changed)).not.toBe(hashPolicy(base));
  });

  it('dataset hash is order independent, sensitive to data, and rejects duplicate ids', () => {
    const a = caseInput({ caseId: 'a' });
    const b = caseInput({ caseId: 'b' });
    expect(hashDataset([a, b])).toBe(hashDataset([b, a]));
    const b2 = caseInput({ caseId: 'b', quote: { ...b.quote, amountAtomic: '80001' } });
    expect(hashDataset([a, b2])).not.toBe(hashDataset([a, b]));
    expect(() => hashDataset([a, a])).toThrow(/duplicate/);
  });

  const unsealedReport = () => ({
    candidateHash: `0x${'01'.repeat(32)}` as const,
    baselineHash: `0x${'02'.repeat(32)}` as const,
    datasetHash: `0x${'03'.repeat(32)}` as const,
    engineVersion: 'regression/1.0.0',
    caseResults: [],
    metrics: [],
    provenanceMix: { real_live: 0, sponsor_fixture: 0, controlled_variant: 0, synthetic: 0 },
  });

  it('report hash excludes reportId and generatedAt', () => {
    const r1 = sealReport(unsealedReport(), { reportId: 'r-1', generatedAt: T0 });
    const r2 = sealReport(unsealedReport(), { reportId: 'r-2', generatedAt: '2026-09-27T00:00:00.000Z' });
    expect(r1.reportHash).toBe(r2.reportHash);
    expect(hashReport(r1)).toBe(r1.reportHash);
  });

  it('report hash changes when the candidate hash changes', () => {
    const changed = { ...unsealedReport(), candidateHash: `0x${'09'.repeat(32)}` as const };
    expect(hashReport(changed)).not.toBe(hashReport(unsealedReport()));
  });

  it('uses distinct domain tags so hashes of different objects never collide by construction', () => {
    expect(new Set(Object.values(DOMAIN_TAGS)).size).toBe(4);
  });
});
