import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { riskEvidenceSchema } from '@risksir/core';
import type { RawIntercepta } from '@risksir/core';
import {
  FileBudget,
  InMemoryBudget,
  QUICK_SCAN_PATH_RE,
  screenAddress,
  toRecordedFile,
  unmappedMapper,
  writeRecordedResponse,
} from '../src/intercepta/index.js';
import type { Mapper, ScreenDeps } from '../src/intercepta/index.js';

const ADDRESS = `0x${'ab'.repeat(20)}`;
const SECRET = 'test-secret-key-do-not-leak';
const BASE = 'https://intercepta.test';

const testMapper: Mapper = (body) => {
  const b = body as { toxicScore?: unknown } | null;
  return b && typeof b.toxicScore === 'number' ? { tier: 'CLEAR', providerScore: b.toxicScore, reasons: [] } : null;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function deps(fetchImpl: typeof fetch, over: Partial<ScreenDeps> = {}): ScreenDeps {
  let n = 0;
  return {
    baseUrl: BASE,
    apiKey: SECRET,
    mapper: testMapper,
    provenance: 'synthetic',
    mappingVersion: 'test-0',
    fetchImpl,
    now: () => new Date('2026-09-26T10:00:00.000Z'),
    newId: () => `id-${++n}`,
    ...over,
  };
}

const stub = (impl: () => Promise<Response>) => vi.fn<typeof fetch>(() => impl());

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'risksir-'));
  tmp.push(d);
  return d;
};

// T-027 (INV-003, AC-021): every failure is UNAVAILABLE evidence, with exactly one call and no retry.
describe('screenAddress failure handling', () => {
  const cases: [string, () => Promise<Response>, string][] = [
    ['HTTP 500', async () => json(500, { error: 'boom' }), 'HTTP_ERROR'],
    ['HTTP 401', async () => json(401, { error: 'unauthorised' }), 'HTTP_ERROR'],
    ['HTTP 429', async () => json(429, { error: 'slow down' }), 'RATE_LIMITED'],
    ['non-JSON body', async () => new Response('<html>oops</html>', { status: 200 }), 'MALFORMED'],
    ['empty body', async () => new Response('', { status: 200 }), 'MALFORMED'],
    ['schema mismatch', async () => json(200, { unexpected: true }), 'MALFORMED'],
    ['network failure', async () => Promise.reject(new TypeError('fetch failed')), 'HTTP_ERROR'],
    [
      'timeout',
      async () => Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })),
      'TIMEOUT',
    ],
  ];

  it.each(cases)('%s => UNAVAILABLE(%s) after exactly one call', async (_name, impl, code) => {
    const f = stub(impl);
    const { evidence } = await screenAddress(ADDRESS, deps(f));
    expect(f).toHaveBeenCalledTimes(1);
    expect(evidence.tier).toBe('UNAVAILABLE');
    expect(evidence.unavailable).toBe(code);
    expect(evidence.providerScore).toBeNull();
    expect(riskEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it('a real timeout aborts a hanging request', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const { evidence, raw } = await screenAddress(ADDRESS, deps(hang, { timeoutMs: 20 }));
    expect(evidence.unavailable).toBe('TIMEOUT');
    expect(raw?.error).toBe('TIMEOUT');
  });

  it('without an API key or base URL no call is made and the result is NO_KEY', async () => {
    const f = stub(async () => json(200, { toxicScore: 0 }));
    for (const over of [{ apiKey: undefined }, { apiKey: '' }, { baseUrl: undefined }]) {
      const { evidence, raw } = await screenAddress(ADDRESS, deps(f, over));
      expect(evidence.unavailable).toBe('NO_KEY');
      expect(raw).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('the unmapped mapper (real responses before Spike A) is MALFORMED, never a pass (ADR-007)', async () => {
    const { evidence } = await screenAddress(ADDRESS, deps(stub(async () => json(200, { toxicScore: 0 })), { mapper: unmappedMapper }));
    expect(evidence.tier).toBe('UNAVAILABLE');
    expect(evidence.unavailable).toBe('MALFORMED');
  });

  it('stops calling when the local session budget is exhausted', async () => {
    const f = stub(async () => json(200, { toxicScore: 1 }));
    const budget = new InMemoryBudget(2);
    const d = deps(f, { budget });
    expect((await screenAddress(ADDRESS, d)).evidence.tier).toBe('CLEAR');
    expect((await screenAddress(ADDRESS, d)).evidence.tier).toBe('CLEAR');
    const third = await screenAddress(ADDRESS, d);
    expect(f).toHaveBeenCalledTimes(2);
    expect(third.evidence.unavailable).toBe('RATE_LIMITED');
    expect(third.evidence.reasons[0]).toMatch(/LOCAL_CALL_BUDGET_EXHAUSTED/);
  });

  it('a file budget persists across instances and fails closed on a corrupt file', () => {
    const path = join(tmpDir(), 'calls.json');
    const a = new FileBudget(path, 2);
    expect(a.tryConsume().ok).toBe(true);
    expect(new FileBudget(path, 2).tryConsume().ok).toBe(true);
    expect(new FileBudget(path, 2).tryConsume().ok).toBe(false);
    const bad = join(tmpDir(), 'bad.json');
    writeFileSync(bad, 'not json');
    expect(new FileBudget(bad, 40).tryConsume().ok).toBe(false);
  });
});

describe('screenAddress request shape (INV-021)', () => {
  it('sends exactly one read-only GET to the quick-scan path with the key only in X-API-KEY', async () => {
    const f = stub(async () => json(200, { toxicScore: 3, traits: [] }));
    const { evidence, raw } = await screenAddress(ADDRESS.toUpperCase().replace('0X', '0x'), deps(f));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(new URL(url).origin).toBe(BASE);
    expect(new URL(url).pathname).toMatch(QUICK_SCAN_PATH_RE);
    expect(new URL(url).pathname).toContain(ADDRESS); // lowercased
    expect(String(url)).not.toContain(SECRET);
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe(SECRET);
    expect(evidence).toMatchObject({ tier: 'CLEAR', providerScore: 3, address: ADDRESS, provenance: 'synthetic' });
    expect(raw).toMatchObject({ interpretedNetwork: 'evm-mainnet', httpStatus: 200, address: ADDRESS });
  });

  it('never leaks the key into evidence, raw output or the recorded file', async () => {
    const { evidence, raw } = await screenAddress(ADDRESS, deps(stub(async () => json(200, { toxicScore: 3 }))));
    expect(JSON.stringify({ evidence, raw })).not.toContain(SECRET);
    const failed = await screenAddress(ADDRESS, deps(stub(async () => Promise.reject(new Error(`boom ${'x'}`)))));
    expect(JSON.stringify(failed)).not.toContain(SECRET);
  });

  it('only quick-scan paths on a 20-byte lowercase address are allowed', () => {
    expect(QUICK_SCAN_PATH_RE.test(`/api/public/v2/extension/account/${ADDRESS}/quick-scan`)).toBe(true);
    for (const bad of [
      `/api/public/v2/extension/account/${ADDRESS}/quick-scan/../x`,
      `/api/public/v2/extension/account/${ADDRESS}/alerts`,
      '/api/public/v2/extension/account/vitalik.eth/quick-scan',
      `/api/public/v2/other/${ADDRESS}`,
    ]) {
      expect(QUICK_SCAN_PATH_RE.test(bad)).toBe(false);
    }
  });
});

// T-028 (AC-029, INV-021): raw storage carries timestamp, endpoint, address, provenance, body and NO headers.
describe('raw response recording', () => {
  const liveDeps = (f: typeof fetch) => deps(f, { provenance: 'real_live' });

  it('writes a header-free JSON file for a real_live response', async () => {
    const { raw } = await screenAddress(ADDRESS, liveDeps(stub(async () => json(200, { toxicScore: 7, traits: [{ name: 'x' }] }))));
    const dir = tmpDir();
    const file = writeRecordedResponse(dir, raw as RawIntercepta);
    expect(readdirSync(dir)).toHaveLength(1);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['address', 'body', 'endpoint', 'error', 'httpStatus', 'latencyMs', 'provenance', 'timestamp']);
    expect(stored).toMatchObject({ provenance: 'real_live', httpStatus: 200, address: ADDRESS, timestamp: '2026-09-26T10:00:00.000Z' });
    expect(stored.body).toEqual({ toxicScore: 7, traits: [{ name: 'x' }] });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text.toLowerCase()).not.toContain('x-api-key');
    expect(text.toLowerCase()).not.toContain('authorization');
  });

  it('refuses to store anything but real_live as recorded, and refuses to overwrite', async () => {
    const synthetic = (await screenAddress(ADDRESS, deps(stub(async () => json(200, { toxicScore: 1 }))))).raw as RawIntercepta;
    expect(() => writeRecordedResponse(tmpDir(), synthetic)).toThrow(/only real_live/);
    const live = (await screenAddress(ADDRESS, liveDeps(stub(async () => json(200, { toxicScore: 1 }))))).raw as RawIntercepta;
    const dir = tmpDir();
    writeRecordedResponse(dir, live);
    expect(() => writeRecordedResponse(dir, live)).toThrow();
    expect(existsSync(dir)).toBe(true);
  });

  it('keeps error responses verbatim (status and body) for later analysis', async () => {
    const { raw } = await screenAddress(ADDRESS, liveDeps(stub(async () => json(429, { message: 'quota' }))));
    expect(toRecordedFile(raw as RawIntercepta)).toMatchObject({ httpStatus: 429, body: { message: 'quota' } });
  });
});
