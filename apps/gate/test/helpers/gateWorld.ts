import { randomUUID } from 'node:crypto';
import { generatePrivateKey } from 'viem/accounts';
import { BASE_SEPOLIA_USDC, demoPolicyV1, demoProfile, sealPolicy } from '@risksir/core';
import type { PaymentPolicy, RiskEvidence, Tier } from '@risksir/core';
import { QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress } from '../../src/intercepta/index.js';
import type { ScreenResult } from '../../src/intercepta/index.js';
import { createProtectedSigner } from '../../src/signer/public.js';
import type { SignerDeps } from '../../src/signer/public.js';
import { Store } from '../../src/store/store.js';
import { createGate } from '../../src/x402/gate.js';
import type { BuyerTask, GateDeps } from '../../src/x402/gate.js';

export const ORG = 'org-exampleco';

/** Strictly increasing wall clock: the SDK signs with real time, so the fake clock must track it (INV-019 needs strict ordering). */
export function makeClock() {
  let last = 0;
  const offset = { ms: 0 };
  const now = () => {
    last = Math.max(Date.now() + offset.ms, last + 1);
    return new Date(last);
  };
  return { now, offset };
}

/** A screen returning a fixture tier with `synthetic` provenance (never recorded/live). */
export function fixtureScreen(tiers: Record<string, Tier> | Tier, clock: { now: () => Date }) {
  const calls: string[] = [];
  const screen = async (address: string): Promise<ScreenResult> => {
    calls.push(address);
    const tier = typeof tiers === 'string' ? tiers : (tiers[address.toLowerCase()] ?? 'UNAVAILABLE');
    const evidence: RiskEvidence = {
      evidenceId: randomUUID(),
      rawId: null,
      provenance: 'synthetic',
      address: address.toLowerCase() as `0x${string}`,
      tier,
      providerScore: tier === 'BLOCK' ? 100 : tier === 'CLEAR' ? 0 : tier === 'WARN' ? 35 : null,
      reasons: tier === 'BLOCK' ? ['known_scammer'] : [],
      unavailable: tier === 'UNAVAILABLE' ? 'MALFORMED' : null,
      capturedAt: clock.now().toISOString(),
      mappingVersion: 'fixture-0',
    };
    return { raw: null, evidence };
  };
  return { screen, calls };
}

/** A screen going through the production adapter and mapper with a stubbed fetch (failure-path tests). */
export function adapterScreen(fetchImpl: typeof fetch, clock: { now: () => Date }) {
  const calls = { n: 0 };
  const counting: typeof fetch = (...args) => {
    calls.n += 1;
    return fetchImpl(...args);
  };
  const screen = (address: string) =>
    screenAddress(address, {
      baseUrl: 'https://intercepta.test',
      apiKey: 'test-key',
      mapper: quickScanMapper,
      provenance: 'synthetic',
      mappingVersion: QUICK_SCAN_MAPPING_VERSION,
      fetchImpl: counting,
      now: clock.now,
      timeoutMs: 200,
    });
  return { screen, calls };
}

export interface GateWorldOptions {
  serviceBase: string;
  policy?: PaymentPolicy;
  screen: GateDeps['screen'];
  clock?: ReturnType<typeof makeClock>;
  signer?: Partial<Pick<SignerDeps, 'extraCheck'>>;
  configureClient?: GateDeps['configureClient'];
}

export function makeGateWorld(opts: GateWorldOptions) {
  const store = new Store(':memory:');
  const clock = opts.clock ?? makeClock();
  const policy = opts.policy ?? demoPolicyV1(demoProfile(opts.serviceBase));
  store.putPolicy(ORG, policy);
  store.setActivePolicy(ORG, policy.policyVersion, 'tr-1', clock.now().toISOString());

  const refusals: { code: string; detail: string }[] = [];
  const logs: string[] = [];
  const signer = createProtectedSigner({
    store,
    now: clock.now,
    keyProvider: () => generatePrivateKey(), // throwaway, unfunded test key
    ...(opts.signer?.extraCheck ? { extraCheck: opts.signer.extraCheck } : {}),
    onRefusal: (r) => refusals.push({ code: r.code, detail: r.detail }),
  });
  const gate = createGate({
    orgId: ORG,
    store,
    screen: opts.screen,
    signer,
    now: clock.now,
    log: (l) => logs.push(l),
    requestTimeoutMs: 10_000,
    ...(opts.configureClient ? { configureClient: opts.configureClient } : {}),
  });
  const task = (path: string, base = opts.serviceBase): BuyerTask => ({ agentId: 'agent-1', taskId: `task-${randomUUID()}`, url: `${base}${path}`, service: 'report' });
  return { store, clock, gate, signer, refusals, logs, policy, task };
}

/** Policy v1 with a different per-payment / period cap (re-sealed). */
export function policyWithCaps(serviceBase: string, caps: { maxPerPaymentAtomic?: string; periodCapAtomic?: string }): PaymentPolicy {
  const v1 = demoPolicyV1(demoProfile(serviceBase));
  return sealPolicy({ policyVersion: 1, parentVersion: null, profile: { ...v1.profile, ...caps }, rules: v1.rules, defaultAction: v1.defaultAction });
}

export { BASE_SEPOLIA_USDC };
