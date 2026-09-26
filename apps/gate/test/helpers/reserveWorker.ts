/**
 * Child process used by the concurrency test (T-021): opens the SAME SQLite file as its siblings, waits for a start
 * file so that all workers contend at once, then makes one reservation and prints the result as JSON.
 * Usage: node --import tsx reserveWorker.ts <dbPath> <goFile> <attemptId> <amountAtomic> <capAtomic>
 */
import { existsSync } from 'node:fs';
import { Store } from '../../src/store/store.js';

const [dbPath, goFile, attemptId, amountAtomic, capAtomic] = process.argv.slice(2) as [string, string, string, string, string];

const store = new Store(dbPath);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile)) Atomics.wait(sleeper, 0, 0, 2);

const result = store.reserve({
  reservationId: `res-${attemptId}`,
  orgId: 'org-exampleco',
  attemptId,
  amountAtomic,
  periodCapAtomic: capAtomic,
  periodSeconds: 86400,
  nowIso: '2026-09-26T10:00:00.000Z',
  ttlSeconds: 300,
});
console.log(JSON.stringify({ attemptId, ok: result.ok, reason: result.ok ? null : result.reason }));
store.close();
