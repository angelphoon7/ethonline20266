/**
 * Pure pieces of the demo preflight (`pnpm demo:smoke`): state classification and the limits arithmetic. Kept free of I/O so
 * they can be tested. The checks themselves (seller 402, facilitator, balance, live Intercepta) live in the CLI.
 */
import { LIVE_LIMITS, PAYER_BALANCE_CEILING_ATOMIC } from '@risksir/core';
import { INTERCEPTA_CALL_LIMIT } from '../intercepta/budget.js';

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** The scripted full run: demo:pass (SAFE), demo:block (RISKY), demo:v2 (SAFE under v2, ALT after rollback). */
export const FULL_RUN = { settlements: 3, spendAtomic: 150_000n, screens: 5 } as const;

export interface DemoState {
  activePolicyVersion: number | null;
  caseCount: number;
  safeKnown: boolean;
  altKnown: boolean;
}

/** Which step of the canonical demo the local state is ready for, or why it is not usable. */
export function classifyState(s: DemoState): { status: CheckStatus; detail: string } {
  if (s.activePolicyVersion === null) return { status: 'FAIL', detail: 'no active policy: run pnpm demo:reset' };
  if (s.caseCount < 19) return { status: 'FAIL', detail: `only ${s.caseCount} labelled cases (expected 19): run pnpm demo:seed or pnpm demo:reset` };
  if (s.activePolicyVersion !== 1) return { status: 'FAIL', detail: `policy v${s.activePolicyVersion} is active, not v1: run pnpm demo:reset` };
  if (s.altKnown) return { status: 'FAIL', detail: 'ALT was already paid, so it is no longer a first-time counterparty: run pnpm demo:reset' };
  if (!s.safeKnown) return { status: 'PASS', detail: 'fresh v1 state: run demo:pass, demo:block, then demo:v2 (or use the console scenes)' };
  return { status: 'PASS', detail: 'v1 active, SAFE already paid, ALT first-time: ready for demo:block and demo:v2' };
}

/** Whether a full scripted run still fits inside the session limits (OPERATIONAL_GUARDRAILS sections 4 and 5). */
export function limitsCheck(session: { settlements: number; totalAtomic: bigint }, interceptaUsed: number, extraScreens = 0): { status: CheckStatus; detail: string } {
  const problems: string[] = [];
  if (session.settlements + FULL_RUN.settlements > LIVE_LIMITS.maxSessionSettlements) problems.push(`settlements ${session.settlements}+${FULL_RUN.settlements} > ${LIVE_LIMITS.maxSessionSettlements}`);
  if (session.totalAtomic + FULL_RUN.spendAtomic > LIVE_LIMITS.maxSessionTotalAtomic) problems.push(`spend ${session.totalAtomic}+${FULL_RUN.spendAtomic} atomic > ${LIVE_LIMITS.maxSessionTotalAtomic}`);
  if (interceptaUsed + extraScreens + FULL_RUN.screens > INTERCEPTA_CALL_LIMIT) problems.push(`Intercepta calls ${interceptaUsed}+${extraScreens}+${FULL_RUN.screens} > ${INTERCEPTA_CALL_LIMIT}`);
  const detail = `session ${session.settlements}/${LIVE_LIMITS.maxSessionSettlements} settlements, ${session.totalAtomic}/${LIVE_LIMITS.maxSessionTotalAtomic} atomic USDC, Intercepta ${interceptaUsed}/${INTERCEPTA_CALL_LIMIT}; a full run needs ${FULL_RUN.settlements} settlements, ${FULL_RUN.spendAtomic} atomic, ${FULL_RUN.screens} screens`;
  return problems.length ? { status: 'FAIL', detail: `${problems.join('; ')} (${detail}). A new agent session is a human decision: pnpm demo:reset --new-session` } : { status: 'PASS', detail };
}

/** The payer must cover a full run and must respect the human's balance ceiling (100 test USDC). */
export function balanceCheck(usdcAtomic: bigint, ethWei: bigint): { status: CheckStatus; detail: string } {
  if (ethWei === 0n) return { status: 'FAIL', detail: 'no Base Sepolia ETH for gas' };
  if (usdcAtomic < FULL_RUN.spendAtomic) return { status: 'FAIL', detail: `payer holds ${usdcAtomic} atomic USDC, a full run needs ${FULL_RUN.spendAtomic}` };
  if (usdcAtomic > PAYER_BALANCE_CEILING_ATOMIC) return { status: 'FAIL', detail: `payer holds ${usdcAtomic} atomic USDC, above the ${PAYER_BALANCE_CEILING_ATOMIC} atomic (100 test USDC) ceiling: move funds out` };
  return { status: 'PASS', detail: `${usdcAtomic} atomic test USDC, ${ethWei} wei ETH` };
}

export const worst = (checks: Check[]): CheckStatus => (checks.some((c) => c.status === 'FAIL') ? 'FAIL' : checks.some((c) => c.status === 'SKIP') ? 'SKIP' : 'PASS');
