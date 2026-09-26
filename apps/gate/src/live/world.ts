import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIN } from '../chain.js';
import { FileBudget, QUICK_SCAN_MAPPING_VERSION, quickScanMapper, screenAddress, writeRecordedResponse } from '../intercepta/index.js';
import { createProtectedSigner } from '../signer/public.js';
import type { Store } from '../store/store.js';
import { createGate } from '../x402/gate.js';
import type { AttemptResult } from '../x402/gate.js';
import { LiveSession } from './session.js';
import { createSellerApp, routesFromEnv } from '@risksir/seller';
import { usdcStringToAtomic } from '@risksir/core';

/**
 * The live wiring shared by the demo CLIs and the owner API process: the live Intercepta screen (raw response recorded
 * without headers), the protected signer with the live spend limits (OPERATIONAL_GUARDRAILS section 4), the gate and the
 * local seller. Refuses to exist unless LIVE=1. Never prints secrets.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function requireLive(): void {
  if (process.env.LIVE !== '1') {
    console.error('refused: set LIVE=1 (live Intercepta calls and testnet payments, see OPERATIONAL_GUARDRAILS).');
    process.exit(1);
  }
}

export interface LiveWorld {
  gate: ReturnType<typeof createGate>;
  session: LiveSession;
  budget: FileBudget;
  serviceBase: string;
  routes: ReturnType<typeof routesFromEnv>;
  /** The price in atomic units of a seller variant. */
  priceAtomic(variant: 'safe' | 'risky' | 'alt'): bigint;
  payTo(variant: 'safe' | 'risky' | 'alt'): string | undefined;
  /** The paths of the raw Intercepta responses written by this world, in call order. */
  recorded: string[];
  startSeller(): Promise<{ close(): Promise<void> }>;
}

export function createLiveWorld(store: Store, orgId: string, log: (line: string) => void = (l) => console.log(l)): LiveWorld {
  const dataDir = join(REPO_ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  const recordedDir = join(REPO_ROOT, 'fixtures', 'intercepta', 'recorded');
  const port = Number(process.env.SELLER_PORT ?? 4021);
  const serviceBase = `http://127.0.0.1:${port}/paid/`;
  const routes = routesFromEnv(process.env);
  const session = new LiveSession(join(dataDir, 'live-session.json'));
  const budget = new FileBudget(join(dataDir, 'intercepta-calls.json'));
  const recorded: string[] = [];

  const signer = createProtectedSigner({
    store,
    now: () => new Date(),
    extraCheck: ({ amountAtomic: a }) => session.check(a),
    onSigned: ({ attemptId }) => {
      const amount = store.getAttempt(attemptId)?.quote?.amountAtomic;
      if (amount) session.recordSigned(BigInt(amount));
    },
  });

  const gate = createGate({
    orgId,
    store,
    signer,
    log,
    screen: async (address) => {
      const result = await screenAddress(address, {
        baseUrl: process.env.INTERCEPTA_BASE_URL,
        apiKey: process.env.INTERCEPTA_API_KEY,
        mapper: quickScanMapper,
        provenance: 'real_live',
        mappingVersion: QUICK_SCAN_MAPPING_VERSION,
        budget,
      });
      if (result.raw) {
        const path = writeRecordedResponse(recordedDir, result.raw);
        recorded.push(path);
        log(`recorded ${path.slice(REPO_ROOT.length)}`);
      }
      return result;
    },
  });

  return {
    gate,
    session,
    budget,
    serviceBase,
    routes,
    recorded,
    priceAtomic: (variant) => {
      const r = routes.find((x) => x.variant === variant);
      if (!r) throw new Error(`SELLER_PAY_TO for the ${variant} variant is not set`);
      return usdcStringToAtomic(r.price.replace('$', ''));
    },
    payTo: (variant) => routes.find((x) => x.variant === variant)?.payTo,
    async startSeller() {
      const server = createSellerApp({ facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator', routes }).listen(port, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      return { close: () => new Promise<void>((resolve) => void server.close(() => resolve())) };
    },
  };
}

/** The compact, secret-free summary of an attempt printed by the demos. */
export function summariseResult(result: AttemptResult) {
  const { attempt, decision, evidence, outcome } = result;
  return {
    attemptId: attempt.attemptId,
    status: attempt.status,
    policyVersion: attempt.policyVersion,
    quote: attempt.quote && { amountAtomic: attempt.quote.amountAtomic, payTo: attempt.quote.payTo, resourceUrl: attempt.quote.resourceUrl },
    evidence: evidence && { provenance: evidence.provenance, tier: evidence.tier, providerScore: evidence.providerScore, reasons: evidence.reasons, capturedAt: evidence.capturedAt },
    decision: decision && { action: decision.action, reasons: decision.reasons.map((r) => r.code), authorisedMaxAtomic: decision.authorisedMaxAtomic, signerEligible: decision.signerEligible },
    interceptaReturnedAt: attempt.interceptaReturnedAt,
    signerInvokedAt: attempt.signerInvokedAt,
    signerCalls: attempt.signerCalls,
    settlement: outcome?.settlementStatus ?? 'none',
    delivery: outcome?.deliveryStatus ?? null,
    txHash: outcome?.txHash ?? null,
    basescan: outcome?.txHash ? CHAIN.basescanTx(outcome.txHash) : null,
  };
}
