import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.js';

const worker = fileURLToPath(new URL('./helpers/reserveWorker.ts', import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface WorkerResult {
  attemptId: string;
  ok: boolean;
  reason: string | null;
}

/** Spawns real OS processes that all open one SQLite file and contend for the same period cap at the same moment. */
async function contend(count: number, amountAtomic: string, capAtomic: string): Promise<{ results: WorkerResult[]; db: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'risksir-conc-'));
  dirs.push(dir);
  const db = join(dir, 'shared.db');
  const go = join(dir, 'go');
  new Store(db).close(); // create the schema once, before the workers open the file

  const children = Array.from({ length: count }, (_, i) => {
    const attemptId = `att-${i}`;
    return new Promise<WorkerResult>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', worker, db, go, attemptId, amountAtomic, capAtomic], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`worker ${attemptId} exited ${code}: ${err}`));
        resolve(JSON.parse(out.trim().split('\n').at(-1) as string) as WorkerResult);
      });
    });
  });
  await new Promise((r) => setTimeout(r, 3000)); // let every worker start and reach the barrier
  writeFileSync(go, 'go');
  return { results: await Promise.all(children), db };
}

// T-021 (AC-025, INV-007): parallel reservations from separate processes never exceed the period cap.
describe('reservation concurrency across processes', () => {
  it('six processes racing for 0.04 USDC each against a 0.10 USDC cap: exactly two win', async () => {
    const { results, db } = await contend(6, '40000', '100000');
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(2);
    for (const loser of results.filter((r) => !r.ok)) expect(loser.reason).toBe('PERIOD_CAP_EXCEEDED');

    const store = new Store(db);
    const rows = store.listReservations('org-exampleco');
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + BigInt(r.amountAtomic), 0n)).toBeLessThanOrEqual(100000n);
    expect(store.periodBudgetRemaining({ orgId: 'org-exampleco', periodCapAtomic: '100000', periodSeconds: 86400, nowIso: '2026-09-26T10:00:00.000Z' })).toBe(20000n);
    store.close();
  }, 90_000);

  it('eight processes racing for 0.025 USDC each against a 0.10 USDC cap: exactly four win and the cap is met exactly', async () => {
    const { results, db } = await contend(8, '25000', '100000');
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    const store = new Store(db);
    expect(store.periodBudgetRemaining({ orgId: 'org-exampleco', periodCapAtomic: '100000', periodSeconds: 86400, nowIso: '2026-09-26T10:00:00.000Z' })).toBe(0n);
    store.close();
  }, 90_000);
});
