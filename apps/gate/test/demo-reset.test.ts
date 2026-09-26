import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_ORG_ID, DEMO_SERVICE_BASE, demoPolicyV1, demoProfile } from '@risksir/core';
import { ResetRefusedError, resetDemoState } from '../src/demo/reset.js';
import { installInitialPolicy } from '../src/policy/index.js';
import { Store } from '../src/store/store.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'risksir-reset-'));
  dirs.push(d);
  return d;
};
const opts = (dataDir: string) => ({ dataDir, datasetRoot: repoRoot, serviceBase: DEMO_SERVICE_BASE, orgId: DEMO_ORG_ID, now: () => new Date('2026-09-26T12:00:00.000Z') });

/** A used database: v1 active, one open reservation (money in flight). */
function usedDb(dataDir: string, reservation: boolean) {
  const store = new Store(join(dataDir, 'risksir.db'));
  installInitialPolicy(store, DEMO_ORG_ID, demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));
  if (reservation) {
    const r = store.reserve({ reservationId: 'res-1', orgId: DEMO_ORG_ID, attemptId: 'att-1', amountAtomic: '50000', periodCapAtomic: '500000', periodSeconds: 86400, nowIso: '2026-09-26T11:00:00.000Z', ttlSeconds: 300 });
    expect(r.ok).toBe(true);
  }
  store.close();
}

// T-055 (AC-004, AC-005, AC-013): a known start state, without losing evidence or bypassing the spend limits.
describe('demo reset', () => {
  it('starts a missing database: v1 active and the 19 labelled cases seeded, nothing backed up', () => {
    const dataDir = tmp();
    const r = resetDemoState(opts(dataDir));
    expect(r).toMatchObject({ backedUp: null, policyVersion: 1, cases: 19, countersReset: false });
    const store = new Store(join(dataDir, 'risksir.db'));
    expect(store.getActivePolicyVersion(DEMO_ORG_ID)).toBe(1);
    expect(store.listCases(DEMO_ORG_ID)).toHaveLength(19);
    expect(store.listAttempts(DEMO_ORG_ID)).toHaveLength(0);
    store.close();
  });

  it('moves a used database to data/backup (evidence is kept, never deleted) and starts clean', () => {
    const dataDir = tmp();
    usedDb(dataDir, false);
    const r = resetDemoState(opts(dataDir));
    expect(r.backedUp).toMatch(/backup[\\/]risksir-2026-09-26T12-00-00-000Z\.sqlite$/);
    expect(existsSync(r.backedUp as string)).toBe(true);
    const old = new Store(r.backedUp as string);
    expect(old.getActivePolicyVersion(DEMO_ORG_ID)).toBe(1); // the backup is the previous state, intact
    old.close();
    const fresh = new Store(join(dataDir, 'risksir.db'));
    expect(fresh.listPolicyVersions(DEMO_ORG_ID)).toHaveLength(1);
    fresh.close();
  });

  it('refuses while a reservation is reserved or reconciling (money may be in flight), and changes nothing', () => {
    const dataDir = tmp();
    usedDb(dataDir, true);
    expect(() => resetDemoState(opts(dataDir))).toThrow(ResetRefusedError);
    expect(existsSync(join(dataDir, 'backup'))).toBe(false);
    const store = new Store(join(dataDir, 'risksir.db'));
    expect(store.listReservations(DEMO_ORG_ID)).toHaveLength(1); // untouched
    store.close();
  });

  it('proceeds over an open reservation only with force, and the backup still holds it', () => {
    const dataDir = tmp();
    usedDb(dataDir, true);
    const r = resetDemoState({ ...opts(dataDir), force: true });
    const old = new Store(r.backedUp as string);
    expect(old.listReservations(DEMO_ORG_ID)).toHaveLength(1);
    old.close();
  });

  it('does not reset the live spend and Intercepta call counters unless a new session is requested', () => {
    const dataDir = tmp();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'live-session.json'), JSON.stringify({ settlements: 5, totalAtomic: '250000' }));
    writeFileSync(join(dataDir, 'intercepta-calls.json'), JSON.stringify({ used: 14 }));
    resetDemoState(opts(dataDir));
    expect(existsSync(join(dataDir, 'live-session.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'intercepta-calls.json'))).toBe(true);
    const r = resetDemoState({ ...opts(dataDir), newSession: true });
    expect(r.countersReset).toBe(true);
    expect(existsSync(join(dataDir, 'live-session.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'intercepta-calls.json'))).toBe(false);
  });

  it('two resets in a row keep two distinct backups', () => {
    const dataDir = tmp();
    usedDb(dataDir, false);
    const first = resetDemoState(opts(dataDir));
    const later = resetDemoState({ ...opts(dataDir), now: () => new Date('2026-09-26T12:05:00.000Z') });
    expect(first.backedUp).not.toBe(later.backedUp);
    expect(readdirSync(join(dataDir, 'backup')).filter((f) => f.endsWith('.sqlite'))).toHaveLength(2);
  });
});
