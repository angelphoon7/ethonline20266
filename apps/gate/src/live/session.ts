import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIVE_LIMITS, atomicToUsdcString } from '@risksir/core';

/**
 * Live testnet spend limits (OPERATIONAL_GUARDRAILS section 4): at most 0.10 USDC per payment, 1.00 USDC per agent
 * session and 20 settlements per session. Signed payments count (an ambiguous one may still settle). The counter is a
 * local file, reset by deleting it at the start of a new agent session.
 */
export interface LiveSessionState {
  settlements: number;
  totalAtomic: bigint;
}

export class LiveSession {
  constructor(
    private readonly path: string,
    private readonly limits = LIVE_LIMITS,
  ) {}

  state(): LiveSessionState {
    if (!existsSync(this.path)) return { settlements: 0, totalAtomic: 0n };
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { settlements?: unknown; totalAtomic?: unknown };
      if (typeof raw.settlements === 'number' && typeof raw.totalAtomic === 'string' && /^(0|[1-9][0-9]*)$/.test(raw.totalAtomic)) {
        return { settlements: raw.settlements, totalAtomic: BigInt(raw.totalAtomic) };
      }
    } catch {
      // fall through
    }
    // Unreadable counter: fail closed as if the limits were exhausted.
    return { settlements: this.limits.maxSessionSettlements, totalAtomic: this.limits.maxSessionTotalAtomic };
  }

  /** Returns a refusal detail if paying `amountAtomic` would exceed a limit, otherwise null. */
  check(amountAtomic: bigint): string | null {
    const s = this.state();
    if (amountAtomic > this.limits.maxPerPaymentAtomic) {
      return `amount ${atomicToUsdcString(amountAtomic)} USDC exceeds the live per-payment limit ${atomicToUsdcString(this.limits.maxPerPaymentAtomic)}`;
    }
    if (s.totalAtomic + amountAtomic > this.limits.maxSessionTotalAtomic) {
      return `session total would exceed ${atomicToUsdcString(this.limits.maxSessionTotalAtomic)} USDC`;
    }
    if (s.settlements + 1 > this.limits.maxSessionSettlements) {
      return `session would exceed ${this.limits.maxSessionSettlements} settlements`;
    }
    return null;
  }

  recordSigned(amountAtomic: bigint): void {
    const s = this.state();
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ settlements: s.settlements + 1, totalAtomic: (s.totalAtomic + amountAtomic).toString() }));
  }
}

export interface LiveBanner {
  network: string;
  payerPublicAddress: string;
  payTo: string;
  amountAtomic: bigint;
  count: number;
  session: LiveSessionState;
  limits?: typeof LIVE_LIMITS;
}

/** The pre-run banner required by guardrails section 4: network, public payer, payTo, amount, count, maximum total. */
export function formatBanner(b: LiveBanner): string {
  const l = b.limits ?? LIVE_LIMITS;
  return [
    'LIVE RUN (testnet only)',
    `  network:        ${b.network}`,
    `  payer (public): ${b.payerPublicAddress}`,
    `  payTo:          ${b.payTo}`,
    `  amount:         ${atomicToUsdcString(b.amountAtomic)} USDC`,
    `  count:          ${b.count} (session so far: ${b.session.settlements}/${l.maxSessionSettlements})`,
    `  max total:      ${atomicToUsdcString(l.maxSessionTotalAtomic)} USDC per session (spent so far ${atomicToUsdcString(b.session.totalAtomic)})`,
  ].join('\n');
}
