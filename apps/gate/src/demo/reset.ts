import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { demoPolicyV1, demoProfile } from '@risksir/core';
import { loadDataset } from '../dataset/load.js';
import { installInitialPolicy } from '../policy/index.js';
import { Store } from '../store/store.js';

/**
 * Brings the local demo state to a known start (M-011): policy v1 active, the labelled dataset seeded, no attempts.
 * The previous database is MOVED to `data/backup/` (evidence is never deleted). It refuses while a reservation is
 * reserved or reconciling (money may be in flight) unless forced. The live spend and Intercepta call counters
 * (OPERATIONAL_GUARDRAILS sections 4 and 5) are only reset with `newSession`: a session limit is not something a demo
 * reset may silently lift.
 */
export class ResetRefusedError extends Error {}

export interface ResetOptions {
  dataDir: string;
  /** Repository root holding `fixtures/` (the dataset is built from committed fixtures only). */
  datasetRoot: string;
  serviceBase: string;
  orgId: string;
  force?: boolean;
  newSession?: boolean;
  now?: () => Date;
}

export interface ResetResult {
  backedUp: string | null;
  policyVersion: number;
  cases: number;
  countersReset: boolean;
}

const SUFFIXES = ['', '-wal', '-shm'];

export function resetDemoState(o: ResetOptions): ResetResult {
  const db = join(o.dataDir, 'risksir.db');
  mkdirSync(o.dataDir, { recursive: true });

  if (existsSync(db)) {
    const old = new Store(db);
    const open = old.listReservations(o.orgId).filter((r) => r.status === 'reserved' || r.status === 'reconciling');
    old.close();
    if (open.length > 0 && !o.force) {
      throw new ResetRefusedError(
        `${open.length} reservation(s) are reserved or reconciling (money may be in flight). Run pnpm reconcile first, or pass --force to back up and reset anyway.`,
      );
    }
  }

  let backedUp: string | null = null;
  if (existsSync(db)) {
    const stamp = (o.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
    const backupDir = join(o.dataDir, 'backup');
    mkdirSync(backupDir, { recursive: true });
    backedUp = join(backupDir, `risksir-${stamp}.sqlite`);
    try {
      for (const s of SUFFIXES) if (existsSync(db + s)) renameSync(db + s, backedUp + s);
    } catch (err) {
      throw new ResetRefusedError(`could not move the database (is the owner API or a demo still running? stop it first): ${(err as Error).message}`);
    }
  }

  const store = new Store(db);
  installInitialPolicy(store, o.orgId, demoPolicyV1(demoProfile(o.serviceBase)), o.now ? { now: o.now } : {});
  const dataset = loadDataset(o.datasetRoot);
  for (const c of dataset) store.saveCase(c);
  store.close();

  let countersReset = false;
  if (o.newSession) {
    for (const f of ['live-session.json', 'intercepta-calls.json']) rmSync(join(o.dataDir, f), { force: true });
    countersReset = true;
  }
  return { backedUp, policyVersion: 1, cases: dataset.length, countersReset };
}
