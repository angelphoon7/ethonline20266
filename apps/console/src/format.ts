/** Display helpers only. Money is never computed with floats: atomic units are integer strings (USDC has 6 decimals). */
export function formatUsdc(atomic: string | null): string {
  if (atomic === null) return 'n/a';
  if (!/^(0|[1-9][0-9]*)$/.test(atomic)) return atomic;
  const v = BigInt(atomic);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${frac === '' ? whole.toString() : `${whole}.${frac}`} USDC`;
}

export const basescanTx = (hash: string): string => `https://sepolia.basescan.org/tx/${hash}`;

export const shortHash = (h: string | null, n = 8): string => (h ? `${h.slice(0, 2 + n)}…${h.slice(-6)}` : 'n/a');

export const timeOf = (iso: string | null): string => (iso ? iso.replace('T', ' ').replace('Z', ' UTC') : 'n/a');

/** The wording required next to every tier (SPEC section 10, ADR-017, ADR-023). */
export const TIER_LABEL = 'Risksir tier (policy threshold ADR-017), not an Intercepta verdict';

export const METRIC_LABELS: Record<string, string> = {
  bad_cases_prevented: 'Bad cases prevented',
  bad_value_prevented: 'Bad value prevented',
  bad_value_remaining: 'Bad value remaining',
  good_cases_changed: 'Good cases changed',
  good_value_delayed_or_denied: 'Good value delayed or denied',
  human_reviews_added: 'Human reviews added',
  auto_approval_rate: 'Auto-approved',
  hold_rate: 'Held',
  deny_rate: 'Denied',
  bad_cases_weakened: 'Bad cases weakened',
};

/** Metrics whose numerator and denominator are atomic USDC sums rather than counts. */
export const VALUE_METRICS = new Set(['bad_value_prevented', 'bad_value_remaining', 'good_value_delayed_or_denied']);

/** A USDC amount as a plain number for table cells (the column header says USDC). */
export function usdcNumber(atomic: string | null): string {
  if (atomic === null) return 'n/a';
  if (!/^(0|[1-9][0-9]*)$/.test(atomic)) return atomic;
  return formatUsdc(atomic).replace(' USDC', '');
}

/**
 * The rows of the incident table. Short lists are shown whole. Longer ones show the cases still waiting for a label first
 * (the incident to label), then a few bad and good ones; the rest stay available under "Show all", and every case takes
 * part in a replay either way.
 */
export function compactCases<T extends { caseId: string; label: string }>(cases: T[], keep: string): T[] {
  if (cases.length <= 6) return cases;
  const sorted = [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId));
  const first = (label: string, n: number) => sorted.filter((c) => c.label === label).slice(0, n).map((c) => c.caseId);
  const pick = new Set<string>([...first('unknown', 3), ...first('bad', 2), ...first('good', 2)]);
  if (keep) pick.add(keep);
  return sorted.filter((c) => pick.has(c.caseId));
}

/** A short case id for tables: the first two dash-separated parts (the full id is shown as a tooltip). */
export const shortCaseId = (id: string): string => id.split('-').slice(0, 2).join('-');

/** An address as 0x1234…abcd. */
export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** USDC with fixed decimals for right-aligned columns: two decimals when exact, otherwise as many as needed. */
export function usdcFixed(atomic: string | null): string {
  if (atomic === null) return 'n/a';
  if (!/^(0|[1-9][0-9]*)$/.test(atomic)) return atomic;
  const v = BigInt(atomic);
  let frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${v / 1_000_000n}.${frac}`;
}

/** HH:MM:SS (UTC) of an ISO timestamp, or null. */
export const clock = (iso: string | null): string | null => (iso ? iso.slice(11, 19) : null);
