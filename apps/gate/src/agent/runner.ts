import type { AttemptResult, BuyerTask } from '../x402/gate.js';

/**
 * The buyer agent: a deterministic task runner with NO LLM (ADR-006, INV-016). It requests an allowlisted paid resource
 * and hands the resulting 402 to the gate. It has no import path to the signer or the payer key (INV-008, T-025) and
 * cannot choose caps, context or policy: the gate derives all of that server-side.
 */
export interface PaidRequester {
  run(task: BuyerTask): Promise<AttemptResult>;
}

/** Named demo scenarios (SPEC section 19). The service id is fixed here, never taken from the seller. */
export const SCENARIOS = {
  pass: { path: 'report/safe', service: 'report' },
  block: { path: 'report/risky', service: 'report' },
  v2: { path: 'report/alt', service: 'report' },
} as const;
export type ScenarioName = keyof typeof SCENARIOS;

export function scenarioTask(name: ScenarioName, serviceBase: string, agentId = 'agent-1'): BuyerTask {
  const s = SCENARIOS[name];
  return { agentId, taskId: `scenario-${name}`, url: `${serviceBase}${s.path}`, service: s.service };
}

export async function runBuyerTask(requester: PaidRequester, task: BuyerTask): Promise<AttemptResult> {
  return requester.run(task);
}
