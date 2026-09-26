/**
 * Starts the owner HTTP API on localhost only (OPERATIONAL_GUARDRAILS section 9). The bearer token comes from
 * OWNER_CONSOLE_TOKEN and is never printed. Run: pnpm owner-api
 *
 * Without LIVE=1 the API manages policies, cases and traces only; `POST /api/agent/run` answers 501 and `POST /api/approvals`
 * records the approval without resuming. With LIVE=1 (`pnpm owner-api:live`) the live gate is wired in: the local seller
 * starts on 127.0.0.1, `POST /api/agent/run` runs a named scenario and `POST /api/approvals` resumes the attempt through
 * the fresh-screen path. Live Intercepta calls and testnet payments stay within OPERATIONAL_GUARDRAILS sections 4 and 5.
 */
import { join } from 'node:path';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoPolicyV1, demoProfile } from '@risksir/core';
import { HttpError, createOwnerApi } from '../api/index.js';
import type { ApiDeps } from '../api/index.js';
import { SCENARIOS, scenarioTask } from '../agent/runner.js';
import { REPO_ROOT, createLiveWorld } from '../live/world.js';
import { installInitialPolicy } from '../policy/index.js';
import { Store } from '../store/store.js';

const token = process.env.OWNER_CONSOLE_TOKEN;
if (!token) {
  console.error('OWNER_CONSOLE_TOKEN is not set');
  process.exit(1);
}
const store = new Store(join(REPO_ROOT, 'data', 'risksir.db'));
if (store.getActivePolicyVersion(DEMO_ORG_ID) === null) installInitialPolicy(store, DEMO_ORG_ID, demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));

const live: Pick<ApiDeps, 'runScenario' | 'resumeApproval'> = {};
if (process.env.LIVE === '1') {
  const world = createLiveWorld(store, DEMO_ORG_ID);
  await world.startSeller();
  console.log(`LIVE mode: local seller on ${world.serviceBase}; live Intercepta screening and Base Sepolia payments within the guardrail limits`);
  live.runScenario = async (name) => {
    const variant = SCENARIOS[name].path.split('/')[1] as 'safe' | 'risky' | 'alt';
    const refusal = name === 'block' ? null : world.session.check(world.priceAtomic(variant));
    if (refusal) throw new HttpError(429, `live limit: ${refusal}`, 'LIVE_LIMIT');
    return world.gate.run(scenarioTask(name, world.serviceBase));
  };
  live.resumeApproval = async (attemptId, approvalId) => {
    const attempt = store.getAttempt(attemptId);
    if (!attempt) throw new Error('unknown attempt');
    return world.gate.resumeWithApproval(attemptId, approvalId, { agentId: attempt.agentId, taskId: attempt.taskId, url: attempt.resourceUrl, service: 'report' });
  };
}

const port = Number(process.env.OWNER_PORT ?? 4100);
createOwnerApi({ store, orgId: DEMO_ORG_ID, ownerToken: token, ...live }).listen(port, '127.0.0.1', () => {
  console.log(`owner API listening on http://127.0.0.1:${port} (all /api routes require the bearer token)`);
});
