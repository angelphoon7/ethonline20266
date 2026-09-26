import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SiteRegression, SiteTrace, SiteV2 } from '../src/types';

const site = fileURLToPath(new URL('../', import.meta.url));
const root = join(site, '..', '..');
const dataDir = join(site, 'public', 'data');
const read = <T>(name: string) => JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

const pass = read<SiteTrace>('scene2-pass.json');
const block = read<SiteTrace>('scene3-block.json');
const regression = read<SiteRegression>('scene4-regression.json');
const v2 = read<SiteV2>('scene5-v2.json');
const traces = [pass, block, v2.v2, v2.v1AfterRollback];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    if (f === 'node_modules' || f === 'dist') return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Every key and string value in a JSON document. */
function scan(value: unknown, keys: string[] = [], strings: string[] = []): { keys: string[]; strings: string[] } {
  if (Array.isArray(value)) value.forEach((v) => scan(v, keys, strings));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k);
      scan(v, keys, strings);
    }
  } else if (typeof value === 'string') strings.push(value);
  return { keys, strings };
}

// The exported data is public: only fields the page shows, no keys, headers or raw signatures.
describe('exported site data is redacted and consistent', () => {
  const all = scan([pass, block, regression, v2]);

  it('has no key or header field names', () => {
    const forbidden = /(private|secret|signature|authorization|api[-_]?key|x-api|header|mnemonic|token|password|typeddata)/i;
    expect(all.keys.filter((k) => forbidden.test(k))).toEqual([]);
  });

  it('contains no raw signature (65-byte hex) and no 32-byte private-key-shaped value outside known hash fields', () => {
    expect(all.strings.filter((s) => /^0x[0-9a-fA-F]{130,}$/.test(s))).toEqual([]);
    const allowedHashKeys = new Set(['quoteHash', 'policyHash', 'txHash', 'reportHash', 'datasetHash']);
    const hashOwners = new Set<string>();
    const visit = (v: unknown, owner = ''): void => {
      if (Array.isArray(v)) v.forEach((x) => visit(x, owner));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => visit(x, k));
      else if (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)) hashOwners.add(owner);
    };
    visit([pass, block, regression, v2]);
    expect([...hashOwners].filter((k) => !allowedHashKeys.has(k))).toEqual([]);
  });

  it('never mentions an environment variable name from .env.example', () => {
    const names = readFileSync(join(root, '.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([A-Z][A-Z0-9_]+)=/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    expect(names.length).toBeGreaterThan(5);
    const files = [...walk(join(site, 'src')), ...walk(dataDir), join(site, 'index.html')];
    const offenders = files.flatMap((f) => names.filter((n) => readFileSync(f, 'utf8').includes(n)).map((n) => `${f}: ${n}`));
    expect(offenders).toEqual([]);
  });

  it('every trace is a stored real_live capture with a recording time, and only real_live evidence is exported', () => {
    for (const t of traces) {
      expect(t.evidence.provenance).toBe('real_live');
      expect(Date.parse(t.recordedAt)).not.toBeNaN();
      expect(t.quote.network).toBe('eip155:84532');
    }
  });

  it('signer calls, signer time and settlement agree in every trace', () => {
    for (const t of traces) {
      if (t.signer.calls === 0) {
        expect(t.signer.invokedAt).toBeNull();
        expect(t.settlement.txHash).toBeNull();
        expect(t.settlement.status).toBe('none');
      } else {
        expect(t.signer.calls).toBe(1);
        expect(t.signer.invokedAt).not.toBeNull();
        expect(Date.parse(t.signer.invokedAt as string)).toBeGreaterThanOrEqual(Date.parse(t.evidence.capturedAt));
        expect(t.settlement.txHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(t.settlement.basescan).toBe(`https://sepolia.basescan.org/tx/${t.settlement.txHash}`);
        expect(t.settlement.status).toBe('settled');
      }
    }
  });

  it('scene 2 pays under v1 with one signer call, scene 3 is an Intercepta-driven deny or hold with zero', () => {
    expect(pass.decision).toMatchObject({ action: 'PAY', policyVersion: 1 });
    expect(pass.signer.calls).toBe(1);
    expect(['DENY', 'HOLD']).toContain(block.decision.action);
    expect(block.signer.calls).toBe(0);
    expect(block.evidence.returned.traits.length).toBeGreaterThan(0);
    expect(block.evidence.returned.toxicScore).not.toBeNull();
  });

  it('scene 5 shows a changed action on a new attempt: v2 caps below the quote with zero signer calls, v1 paid it', () => {
    const { v2: a, v1AfterRollback: b } = v2;
    expect(a.decision.policyVersion).toBe(2);
    expect(b.decision.policyVersion).toBe(1);
    expect(a.decision.action).not.toBe(b.decision.action);
    expect(a.quote.amountAtomic).toBe(b.quote.amountAtomic);
    expect(a.quote.payTo).toBe(b.quote.payTo);
    expect(a.attemptId).not.toBe(b.attemptId);
    expect(a.signer.calls).toBe(0);
    expect(BigInt(a.decision.authorisedMaxAtomic ?? '0')).toBeLessThan(BigInt(a.quote.amountAtomic));
    expect(b.signer.calls).toBe(1);
  });

  it('scene 4 compares candidates A and B with numerators, denominators and the provenance mix, and names the approved one', () => {
    expect(regression.candidates.map((c) => c.key)).toEqual(['A', 'B']);
    for (const c of regression.candidates) {
      expect(c.metrics).toHaveLength(10);
      for (const m of c.metrics) {
        expect(m.numerator).toMatch(/^-?\d+$/);
        expect(m.denominator).toMatch(/^\d+$/);
      }
      expect(Object.keys(c.provenanceMix).sort()).toEqual(['controlled_variant', 'real_live', 'sponsor_fixture', 'synthetic']);
    }
    expect(regression.approved.reportHash).toBe(regression.candidates.find((c) => c.key === regression.approved.candidate)?.reportHash);
    expect(regression.caveat).toMatch(/not a measure of real prevented loss/i);
  });

  it('the build output, when present, contains no environment variable name', () => {
    const dist = join(site, 'dist');
    if (!existsSync(dist)) return;
    const names = readFileSync(join(root, '.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([A-Z][A-Z0-9_]+)=/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    const offenders = walk(dist).flatMap((f) => names.filter((n) => readFileSync(f, 'utf8').includes(n)).map((n) => `${f}: ${n}`));
    expect(offenders).toEqual([]);
  });
});
