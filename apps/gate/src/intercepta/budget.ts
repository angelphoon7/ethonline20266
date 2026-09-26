import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** OPERATIONAL_GUARDRAILS section 5: at most 40 live Intercepta calls per agent session. */
export const INTERCEPTA_CALL_LIMIT = 40;

export interface CallBudget {
  /** Consumes one call if any remain. Never throws. */
  tryConsume(): { ok: boolean; used: number; limit: number };
}

export class InMemoryBudget implements CallBudget {
  private used = 0;
  constructor(private readonly limit: number = INTERCEPTA_CALL_LIMIT) {}
  tryConsume() {
    if (this.used >= this.limit) return { ok: false, used: this.used, limit: this.limit };
    this.used += 1;
    return { ok: true, used: this.used, limit: this.limit };
  }
}

/** Persisted counter so the limit holds across processes within a session. Reset by deleting the file at session start. */
export class FileBudget implements CallBudget {
  constructor(
    private readonly path: string,
    private readonly limit: number = INTERCEPTA_CALL_LIMIT,
  ) {}

  private read(): number {
    if (!existsSync(this.path)) return 0;
    try {
      const v = (JSON.parse(readFileSync(this.path, 'utf8')) as { used?: unknown }).used;
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : this.limit; // unreadable => fail closed
    } catch {
      return this.limit;
    }
  }

  tryConsume() {
    const used = this.read();
    if (used >= this.limit) return { ok: false, used, limit: this.limit };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ used: used + 1 }));
    return { ok: true, used: used + 1, limit: this.limit };
  }
}
