# SPEC — Risksir engineering contract

Version 1.1 (2026-09-26; human SPEC review applied, ADR-019 to ADR-024). Status: binding for implementation. Source tags: `[07 §n]` = `docs/07_PROJECT_FREEZE.md`, `[08 §n]` = `docs/08_SYSTEM_DEPENDENCY_DESIGN.md`, `[PA]` = `docs/PRIZE_ANCHOR_INTERCEPTA.md`, `[G §n]` = `OPERATIONAL_GUARDRAILS.md`, `[ADR-n]` = `DECISIONS.md` (agent default, human may override). Nothing here is claimed as verified unless `TEST_PLAN.md` or `EXECUTION_PLAN.md` records evidence. `OPEN` = deliberately undecided; the conservative default is stated in §25.

---

## 1. Authority and change control

| Rank | Source | Note |
| --- | --- | --- |
| 1 | Explicit human instruction in the current session | |
| 2 | This SPEC | Refines 07 and 08. May not contradict `[PA]`, 07 §14 "DO NOT", 07 §28 or 08 §12. On conflict, correct SPEC toward the freeze. |
| 3 | `[PA]`, 07 | |
| 4 | 08 | |
| 5 | Official x402 and Intercepta (W3A) docs for the **installed** versions | Never rely on remembered SDK behaviour. |
| 6 | `DECISIONS.md`, existing code, `HANDOFF.md` | If code disagrees with SPEC, the code is wrong. |

| Agent may change autonomously | Human only (stop, `AGENT_STATUS: HUMAN_REQUIRED`) |
| --- | --- |
| Bugs, internals, file layout, helper structure, refactors preserving behaviour | The user promise; the semantics of `PAY/CAP/HOLD/ASK_HUMAN/DENY` |
| Resolving an `OPEN` item **with recorded evidence plus an ADR** | The trust boundary; payment semantics; the sponsor dependency |
| Demo thresholds scaled to testnet amounts (ADR) | Any `AC-xxx` or `INV-xxx` (may be split or refined, never weakened) |
| Mapping from observed Intercepta fields to tiers (ADR) | Anything in `[G]` (limits, networks, git rules) |

## 2. Objective, user and problem boundary

**Objective.** Risksir is a closed-loop risk-policy engine for autonomous x402 buyer agents. Live Intercepta evidence decides whether an agent's x402 payment is signed. Incidents become regression cases. Only replay-tested, owner-approved policy versions govern future payments. Target: the Intercepta prize *Safe Agent-to-Agent Payments with x402* `[PA]`, `[07 §1]`.

**User.** An organisation's risk/security owner or developer operating a buyer agent that can pay x402 services from an organisation-funded wallet. In the demo: one owner, one agent, one bounded testnet USDC wallet, one policy `[08 §1]`. Demand is a hypothesis.

**Problem.** A counterparty-risk signal alone cannot decide whether *this agent*, for *this task*, may pay *this quote* under *this organisation's* limits; and a policy can become too permissive or too strict after incidents `[07 §1]`, `[08 §1]`.

**Frozen non-claim `[07 §1]`.** Risksir is **not** a replacement risk engine, a second scam database, a wallet blacklist, a generic "Intercepta verdict → if red, block" wrapper, or a claim that company-specific rules alone are novel. Intercepta detects risk; Risksir governs and continuously validates how an autonomous payer reacts to it `[PA]`.

## 3. Scope

| Level | Item | Src |
| --- | --- | --- |
| MUST | One explicit organisation, one agent use case, bounded limits, ≥1 contextual policy rule | 07 §14.1 |
| MUST | Real x402 `402` on Base Sepolia, official SDK, testnet settlement | 07 §14.2 |
| MUST | Protected pre-sign boundary; hold/deny ⇒ zero signer calls | 07 §14.3 |
| MUST | Live Intercepta screen of the exact selected `payTo`; one pass, one hold/deny | 07 §14.4 |
| MUST | Decision trace: quote, evidence, policy version, action, signer yes/no, settlement, delivery | 07 §14.5 |
| MUST | ≥1 regression case, ≥2 candidate policies replayed, trade-off metrics from data | 07 §14.6 |
| MUST | Approve → policy vN+1 → changes a later decision under a fresh live screen | 07 §14.7 |
| MUST | Public repo, README pointing at Intercepta call, decision point, signer gate, regression engine, 3–5 lines of API feedback | 07 §14.8 |
| SHOULD | Rollback vN+1 → vN; fail-closed timeout/error; quote mutation invalidates decision; regression metrics set | 07 §14 SHOULD |
| SHOULD | Later re-screen trigger (B) ; token / EIP-712 scan **only if** payload compatibility is proven | 07 §7, 08 §9 |
| COULD | LLM policy analyst that explains or proposes only; multiple org profiles; forensic links | 07 §14 COULD |
| NOT | See §24 | 07 §14, §28 |

## 4. Actors and permissions

| Actor | Trust | Controls | Cannot |
| --- | --- | --- | --- |
| Owner (human, browser) | Trusted after bearer-token auth `[ADR-009]` | Profile/policy approval, rollback, incident labels, ASK_HUMAN approvals | Waive a hard prohibition (INV-015) |
| Buyer agent (deterministic runner, **no LLM**) | **Untrusted** | Chooses an allowlisted task/resource URL | Reach the payer key, the signer, the owner API, or set caps/context |
| x402 seller (paid service) | **Untrusted** | Quote terms (`payTo`, amount, asset, network), delivery | Change an already-decided quote without invalidating the decision (INV-005) |
| Facilitator | Trusted for liveness and honest settle/verify reports only | Verify and settle EIP-3009 transfer | Know or enforce Risksir policy |
| Intercepta | Trusted for what its evidence states; **not** for seller honesty or delivery `[08 §7]` | Live risk evidence | Sign, approve or override policy |
| Protected signer | Trusted for correctness and key custody | Signs one bounded authorisation per valid decision | Be invoked by agent/regression code |
| Risksir backend/DB | Trusted for correctness (centralised, explicit `[08 §7]`) | Policy evaluation, reservations, audit | — |

## 5. End-to-end flow (14 steps, `[08 §2]`)

| # | Actor | Input → system action → output | State change | Failure behaviour |
| --- | --- | --- | --- | --- |
| 1 | Owner | Auth; approve profile + policy vN → active pointer | `PolicyVersion active` | Auth fail: 401, nothing changes |
| 2 | Agent | Allowed task + resource URL → request without payment credential → `402` | `PaymentAttempt created` | Resource not allowlisted: attempt `failed`, no quote |
| 3 | Seller | Route returns `PaymentRequired` (`exact`, network, USDC, `payTo`) | — | Non-402 / invalid body: `QUOTE_INVALID`, HOLD |
| 4 | Gate | Parse (zod) + select one requirement → `CanonicalQuote` + `quoteHash` | `quoted` | Unparsable: attempt `failed`, `QUOTE_INVALID` |
| 5 | Gate + policy engine, **local stage** | Local checks in this order: scheme, network and asset allowlist, per-payment cap, service scope, quote validity/expiry (§9 stage A). **No Intercepta call is spent on a locally rejected quote** | Rejected: a `Decision` **without evidence** (`DENY` or `HOLD`, never signer-eligible), attempt `failed` | Zero Intercepta calls, zero signer calls |
| 6 | Intercepta adapter | Only if the local stage passed: live quick-scan of the selected `payTo` → raw snapshot + `RiskEvidence` | `screened`; `interceptaRequestedAt/ReturnedAt` | Error/timeout/429/malformed/stale ⇒ `UNAVAILABLE` evidence record ⇒ HOLD |
| 7 | Policy engine (evidence stage) + gate | Active policy + evidence + quote + context → `Decision` (action, reasons). `ASK_HUMAN` ⇒ attempt `awaiting_approval`. If eligible (`PAY`, or `CAP` within its cap): **one serialised transaction re-checks `used + amount ≤ cap` and creates the reservation** (failure ⇒ HOLD); then the gate arms the single-use signing permit (§12) | `decided` or `awaiting_approval` | Engine exception ⇒ HOLD |
| 7a | Owner, then gate | Approval (bound to `attemptId`, `quoteHash`, `policyVersion`, expiry) → the gate obtains a current 402 for the same attempt whose quote must equal the approved one → **fresh live screen** → re-evaluate under the **current** active policy → only a `PAY` result continues to reserve, arm and sign; any other result is recorded as the new action | `awaiting_approval` → `decided` / `failed` / `expired` | Approval or window expiry, or a policy-version change ⇒ `expired` (terminal), zero signer calls |
| 8 | Protected signer | The SDK asks to sign; the signer checks the typed data against the armed permit's stored quote and the decision-level conditions (§12), consumes the permit, then signs one EIP-3009 authorisation | `signed`; `signerCalls` = 1 | Any mismatch ⇒ refuse, count stays 0 |
| 9 | Gate/seller/facilitator | Retry with payment payload; facilitator verifies+settles USDC | `submitted` → `settled`/`failed`/`ambiguous` | Ambiguous keeps reservation (INV-014) |
| 10 | Case recorder | Correlate request, quote, evidence, decision, signer count, tx hash, HTTP result | `PaymentOutcome`, `PaymentCase` | Crash before write: attempt persisted before signing; reconcile on restart |
| 11 | Owner | Label a prior case `bad`/`good` with rationale (Trigger C) | Label revision appended | Unauthenticated: 401 |
| 12 | Regression engine | Dataset snapshot + baseline + candidates → deterministic report | `CandidatePolicy replayed` | Engine error: promotion blocked, v1 payments unaffected |
| 13 | Owner | Approve candidate bound to report hash → transactional activation | `PolicyVersion active`, old `superseded` | Hash mismatch/stale: rejected, prior version stays |
| 14 | Agent | New request; steps 2–10 with **fresh** evidence under vN+1 | New attempt with new decision | As above |

Action meanings `[08 §2]`: `HOLD` = no payment until resolved; `DENY` = attempt ends; `ASK_HUMAN` = paused until a scoped approval is recorded and revalidated; `CAP` = maximum authorised amount (§9).

## 6. Components

Package scope `@risksir/*`. Modules run in one backend process, not as network services `[08 §3]`. The signer's key isolation is **code-path isolation inside that process, enforced by static tests; it is not a process or security boundary**, and a compromised backend defeats it (§18, `[08 §7]`).

| Component | Responsibility | Inputs → outputs | Owned state | Trust boundary / failure effect | Module |
| --- | --- | --- | --- | --- | --- |
| Core domain | Types, money, canonical JSON, hashes, provenance | — | none (pure) | Wrong hash ⇒ invalid bindings | `packages/core/src/{types,money,canonical,fingerprint}` |
| Policy engine | Deterministic decision | policy+evidence+quote+context(+approval) → `Decision` | none (pure) | Bug misclassifies; versioned cases expose it | `packages/core/src/policy` |
| Regression engine | Replay + metrics | dataset+baseline+candidate → report | none (pure) | No signer capability; failure blocks promotion only | `packages/core/src/regression` |
| Intercepta adapter | Live screen, raw capture, normalise | `payTo` → `RiskEvidence` | raw snapshots | Any failure ⇒ HOLD; no cached pass | `apps/gate/src/intercepta` |
| x402 buyer gate | Parse, select, fingerprint, hook, reserve, retry | 402 → attempt/decision | attempts | Correctness-critical; bypass ⇒ unsafe signature | `apps/gate/src/x402` |
| Protected signer | Permit + decision checks, sign, call counter | armed signing permit + stored decision → signature | key (memory), permits, signer-call ledger | Only code path that reads `PAYER_PRIVATE_KEY` (static test, not a process boundary); failure ⇒ no payment | `apps/gate/src/signer` |
| Store | Attempts, decisions, reservations, cases, policies, audit | — | SQLite (better-sqlite3, synchronous) | DB down ⇒ no signing | `apps/gate/src/store` |
| Owner API | HTTP for console and demo commands | bearer token → JSON | none | Rechecks auth and every command | `apps/gate/src/api` |
| Buyer agent | Deterministic task runner | task → paid resource | task only | No key, no signer import | `apps/gate/src/agent` |
| Seller | x402 paid routes (`@x402/express`) | request → 402/200 | none | Untrusted counterparty | `apps/seller` |
| Console | One-page Vite+React UI | API → panels | none | Untrusted display | `apps/console` |

## 7. Data model

Conventions: money is `bigint` in code and a decimal string in JSON, matching `/^(0|[1-9][0-9]*)$/`; addresses are lowercase `0x` + 40 hex; timestamps are ISO-8601 UTC strings; every schema is a zod schema exported from `@risksir/core` with the inferred TS type. No untyped metadata blobs; the only opaque value is `RawIntercepta.body`. `[07 §6]`, `[08 §5]`

```ts
type AtomicAmount = string;            // decimal atomic units (USDC has 6 decimals)
type Address = `0x${string}`;          // lowercase
type Hex32 = `0x${string}`;            // 32-byte sha256 hex
type Provenance = 'real_live' | 'sponsor_fixture' | 'controlled_variant' | 'synthetic';
type Action = 'PAY' | 'CAP' | 'HOLD' | 'ASK_HUMAN' | 'DENY';
type Tier = 'CLEAR' | 'WARN' | 'BLOCK' | 'UNAVAILABLE';

interface Organisation { orgId: string; name: string; payerAddress: Address; agentIds: string[]; }

interface RiskProfile {                 // embedded, immutable, inside each PaymentPolicy
  orgId: string; profileVersion: number;
  network: 'eip155:84532'; asset: Address;               // allowlist of one (INV-006)
  maxPerPaymentAtomic: AtomicAmount; periodCapAtomic: AtomicAmount; periodSeconds: number;
  allowedServices: string[];            // resource URL prefixes; a quote is allowed iff its resourceUrl starts with one
  hardProhibitions: HardProhibition[];  // must equal HARD_PROHIBITIONS = all six values of HardProhibition
  reviewCapacityPerPeriod: number;
}
type HardProhibition = 'EVIDENCE_BLOCK' | 'NETWORK_NOT_ALLOWED' | 'ASSET_NOT_ALLOWED'
  | 'SCHEME_NOT_SUPPORTED' | 'OVER_PER_PAYMENT_CAP' | 'SERVICE_NOT_ALLOWED';

type Predicate =
  | { kind: 'evidenceTier'; in: Tier[] }                       // never UNAVAILABLE (handled before rules)
  | { kind: 'providerScore'; min?: number; max?: number }      // score meaning between 0 and 100 is unobserved (OPEN); any use is a Risksir policy choice
  | { kind: 'amount'; minAtomic?: AtomicAmount; maxAtomic?: AtomicAmount }   // inclusive
  | { kind: 'firstTimeCounterparty'; value: boolean }
  | { kind: 'service'; in: string[] }
  | { kind: 'budgetRemaining'; minAtomic?: AtomicAmount; maxAtomic?: AtomicAmount };
interface Rule { ruleId: string; description: string; when: Predicate[];   // AND; empty = always
                 then: { action: Action; capAtomic?: AtomicAmount } }     // capAtomic required iff CAP
interface PaymentPolicy {
  policyVersion: number; parentVersion: number | null;
  profile: RiskProfile; rules: Rule[];                 // ordered, first match wins
  defaultAction: 'HOLD' | 'ASK_HUMAN' | 'DENY';        // PAY/CAP as default is invalid (ADR-013)
  policyHash: Hex32;                                   // §8, over profile+rules+defaultAction+version numbers
}

interface CanonicalQuote {
  scheme: string; network: string;                     // CAIP-2, unvalidated here; allowlist enforced by policy AND signer
  asset: Address; amountAtomic: AtomicAmount; payTo: Address;
  resourceUrl: string; attemptId: string; maxTimeoutSeconds: number;
}
interface PaymentAttempt {
  attemptId: string; orgId: string; agentId: string; taskId: string; resourceUrl: string;
  status: 'created' | 'quoted' | 'screened' | 'decided' | 'awaiting_approval' | 'signed' | 'submitted'
    | 'settled' | 'failed' | 'ambiguous' | 'expired';
  quote: CanonicalQuote | null; quoteHash: Hex32 | null;
  policyVersion: number | null; evidenceId: string | null; decisionId: string | null;
  signerCalls: number;                                  // int >= 0, written only by the signer path
  createdAt: string; quotedAt: string | null;
  interceptaRequestedAt: string | null; interceptaReturnedAt: string | null;
  decidedAt: string | null; awaitingApprovalUntil: string | null;
  signerInvokedAt: string | null; submittedAt: string | null; settledAt: string | null;
  failure: { code: ReasonCode; message: string } | null;
}
interface RawIntercepta {                               // stored verbatim, NEVER request headers [G §5]
  rawId: string; provenance: Provenance; endpoint: string; address: Address;
  interpretedNetwork: 'evm-mainnet'; httpStatus: number | null; receivedAt: string; latencyMs: number;
  body: unknown; error: 'TIMEOUT' | 'NETWORK' | null;
}
interface RiskEvidence {                                // normalised; evidenceId unique per screen
  evidenceId: string; rawId: string | null; provenance: Provenance; address: Address;
  tier: Tier; providerScore: number | null; reasons: string[];      // provider labels verbatim
  unavailable: null | 'TIMEOUT' | 'HTTP_ERROR' | 'RATE_LIMITED' | 'MALFORMED' | 'STALE' | 'NO_KEY';
  capturedAt: string; mappingVersion: string;
}
interface Decision {
  decisionId: string; attemptId: string; quoteHash: Hex32; policyVersion: number; policyHash: Hex32;
  evidenceId: string | null;            // null ONLY when the local stage rejected before any screen; never signer-eligible then
  action: Action; reasons: { code: ReasonCode; ruleId: string | null }[];
  authorisedMaxAtomic: AtomicAmount | null; signerEligible: boolean;   // false for HOLD/DENY/ASK_HUMAN pending/CAP below quote
  approvalId: string | null; decidedAt: string; expiresAt: string;
  status: 'open' | 'consumed' | 'expired' | 'superseded';
}
interface Approval { approvalId: string; attemptId: string; quoteHash: Hex32; policyVersion: number;
  maxAmountAtomic: AtomicAmount; approvedAt: string; expiresAt: string;
  status: 'active' | 'consumed' | 'expired'; }
interface SigningPermit {               // armed by the gate for ONE attempt; consumed on use (§12)
  permitId: string; attemptId: string; decisionId: string;
  quote: CanonicalQuote; quoteHash: Hex32; policyVersion: number;
  armedAt: string; expiresAt: string;
  status: 'armed' | 'consumed' | 'revoked' | 'expired'; }
interface SpendReservation {            // the ONLY spend ledger (§12)
  reservationId: string; orgId: string; attemptId: string; periodKey: number;
  amountAtomic: AtomicAmount; status: 'reserved' | 'committed' | 'released' | 'reconciling';
  createdAt: string; expiresAt: string; committedAtomic: AtomicAmount | null; }
interface PaymentOutcome {                              // settlement and delivery are separate (INV-014)
  outcomeId: string; attemptId: string;
  settlementStatus: 'none' | 'pending' | 'settled' | 'failed' | 'ambiguous';
  txHash: Hex32 | null; facilitatorRef: string | null;
  deliveryStatus: 'unknown' | 'received' | 'not_received'; httpStatus: number | null; observedAt: string;
}
interface PaymentCase {
  caseId: string; orgId: string; provenance: Provenance; attemptId: string | null; fixtureId: string | null;
  quote: { amountAtomic: AtomicAmount; payTo: Address; network: string; asset: Address; resourceUrl: string; service: string };
  context: { firstTimeCounterparty: boolean; periodBudgetRemainingAtomic: AtomicAmount };
  evidence: RiskEvidence;                               // stored snapshot; replay never re-screens
  recorded: { action: Action; policyVersion: number; signerCalled: boolean } | null;
  label: 'good' | 'bad' | 'unknown'; labelRevisions: LabelRevision[]; createdAt: string;
}
interface LabelRevision { revision: number; label: 'good' | 'bad' | 'unknown';
  labelledBy: 'owner' | 'seed_script'; rationale: string; at: string; }
interface CandidatePolicy { candidateId: string; baseVersion: number; originatingCaseIds: string[];
  policy: PaymentPolicy; rationale: string; generatedBy: 'owner' | 'seed_script' | 'analyst';
  status: 'draft' | 'replayed' | 'rejected' | 'approved'; createdAt: string; }
interface CaseResult { caseId: string; provenance: Provenance; label: 'good' | 'bad' | 'unknown';
  baseline: Replayed; candidate: Replayed; }
interface Replayed { action: Action; reasons: ReasonCode[]; exposureAtomic: AtomicAmount; }
interface Metric { name: MetricName; numerator: string; denominator: string; }   // integers (counts or atomic sums)
interface RegressionReport { reportId: string; candidateHash: Hex32; baselineHash: Hex32; datasetHash: Hex32;
  engineVersion: string; caseResults: CaseResult[]; metrics: Metric[];
  provenanceMix: Record<Provenance, number>; reportHash: Hex32; generatedAt: string; }
interface PolicyVersion { policyVersion: number; policyHash: Hex32;
  status: 'draft' | 'replayed' | 'approved' | 'active' | 'superseded' | 'rolled_back';
  approvedReportHash: Hex32 | null; approvedBy: string | null; approvedAt: string | null;
  parentVersion: number | null; rollbackTarget: number | null; }
interface ActivePointer { orgId: string; policyVersion: number; transitionId: string; updatedAt: string; }
interface AuditEvent { eventId: string; seq: number; at: string; actor: 'owner' | 'agent' | 'system';
  type: AuditType;                                      // enumerated, see below
  refs: { attemptId?: string; decisionId?: string; evidenceId?: string; caseId?: string;
          candidateId?: string; reportHash?: string; policyVersion?: number; txHash?: string };
  payloadHash: Hex32; }
```

`AuditType` = `QuoteSelected | RiskScreenRequested | RiskScreenReturned | RiskScreenUnavailable | PolicyDecided | PermitArmed | ApprovalRecorded | AttemptExpired | SignerInvoked | SignerRefused | PaymentSubmitted | SettlementObserved | ResourceReturned | IncidentLabelled | RegressionCompleted | PolicyApproved | PolicyActivated | PolicyRolledBack` `[08 §6]`. These are **application** audit events, explicitly offchain.

## 8. Canonicalisation

One helper module (`packages/core/src/fingerprint.ts`) is the only code that hashes quotes, policies, datasets or reports (`CLAUDE.md` §7).

| Object | Fields hashed | Normalisation | Domain tag |
| --- | --- | --- | --- |
| Quote | `scheme, network, asset, amountAtomic, payTo, resourceUrl, attemptId, maxTimeoutSeconds` | addresses lowercase `0x…`; amounts decimal strings without leading zeros; `resourceUrl` as parsed `URL.href`; keys sorted | `risksir/quote/v1` |
| Policy | `policyVersion, parentVersion, profile, rules, defaultAction` (never `policyHash`) | canonical JSON | `risksir/policy/v1` |
| Dataset | array of `PaymentCase` **as evaluated** (case fields + latest label), sorted by `caseId` | canonical JSON | `risksir/dataset/v1` |
| Report | report minus `reportId`, `generatedAt`, `reportHash` | canonical JSON | `risksir/report/v1` |

- **Canonical JSON:** UTF-8, object keys sorted lexicographically by UTF-16 code unit at every depth, no whitespace, arrays keep order, numbers only finite integers or the fixed `providerScore` decimal via `JSON.stringify`, `undefined` rejected, `bigint` rejected (convert to decimal string first).
- **Hash:** `sha256( utf8(domainTag + "\n" + canonicalJson) )`, output `0x` + lowercase hex.
- Changing any quote field changes `quoteHash` (INV-005). The same inputs always give the same hash (test with fixed vectors). `attemptId` is inside the quote hash so a decision cannot be replayed on another attempt.

## 9. Policy DSL and decision semantics

Two **pure functions** (`CLAUDE.md` §7): `evaluateLocal(policy, quote)` (stage A, needs no evidence) and `evaluate(input)` (runs stage A first, then stage B). Time, evidence, context and approval are passed in.

```ts
interface EvaluateInput {
  policy: PaymentPolicy; quote: CanonicalQuote; quoteHash: Hex32;
  evidence: RiskEvidence | null;               // null only at stage A; null at stage B fails closed
  context: { firstTimeCounterparty: boolean; service: string;
             periodBudgetRemainingAtomic: AtomicAmount };   // remaining = cap - used (§12); excludes this attempt
  approval: Approval | null; now: string;       // now only for approval expiry and evidence freshness
}
```

**Stage A: local checks, run before any Intercepta call (no evidence needed). First hit ends evaluation.**

| Step | Check | Result | Reason code |
| --- | --- | --- | --- |
| 1 | `scheme != exact` | DENY | `SCHEME_NOT_SUPPORTED` |
| 2 | `network != profile.network` | DENY | `NETWORK_NOT_ALLOWED` |
| 3 | `asset != profile.asset` | DENY | `ASSET_NOT_ALLOWED` |
| 4 | `quote.resourceUrl` starts with no `allowedServices` prefix | DENY | `SERVICE_NOT_ALLOWED` |
| 5 | `amount > maxPerPaymentAtomic` | DENY | `OVER_PER_PAYMENT_CAP` |
| 5b | quote validity `maxTimeoutSeconds` outside `[1, QUOTE_MAX_VALIDITY_S]` (Appendix A) | HOLD | `QUOTE_INVALID` |

A quote rejected at stage A yields a `Decision` without evidence, is never signer-eligible and **costs no Intercepta call**.

**Stage B: evidence checks, run only after a live screen.**

| Step | Check | Result | Reason code |
| --- | --- | --- | --- |
| 6 | evidence `UNAVAILABLE`, or its `address` differs from `quote.payTo` (evidence of another subject is unusable) | HOLD | `EVIDENCE_UNAVAILABLE` |
| 7 | evidence older than `EVIDENCE_FRESHNESS_S` at `now`, or captured after `now` (clock skew fails closed) | HOLD | `EVIDENCE_STALE` |
| 8 | evidence tier `BLOCK` | DENY | `EVIDENCE_BLOCK` |
| 9 | `amount > periodBudgetRemainingAtomic` (`cap − used`, §12) | HOLD | `PERIOD_CAP_EXCEEDED` |
| 10 | first rule whose predicates all match | rule action | `RULE_MATCHED` + `ruleId` |
| 11 | no rule matched | `defaultAction` | `NO_RULE_MATCHED` |

Steps 1–5 and 8 are the **hard prohibitions**: no rule, candidate or human approval can override them (INV-015). Steps 6–9 come before rules so a rule can never turn missing evidence into a pass (INV-003). INV-001 applies to every attempt that can reach the signer: only quotes that pass stage A are screened, and only a stage-B result can be signer-eligible.

**Actions (exact semantics):**

| Action | Meaning | Signer eligible |
| --- | --- | --- |
| `PAY` | Amount ≤ per-payment cap, within budget, evidence usable. `authorisedMaxAtomic` = quote amount | yes |
| `CAP` | `capAtomic` is a **maximum authorised amount**. If `amount ≤ capAtomic`: eligible, `authorisedMaxAtomic = amount`. If `amount > capAtomic` on an `exact` quote: `signerEligible = false`, reason `CAP_BELOW_QUOTE`. **Never a unilateral price reduction.** A genuinely advertised cheaper requirement may be selected and screened again (OPEN, Q-010; MVP does not reselect) | only if `amount ≤ capAtomic` |
| `HOLD` | No payment until an issue is resolved; a new attempt is a new decision | never |
| `ASK_HUMAN` | Pending: the attempt enters `awaiting_approval` (window `APPROVAL_TTL_S`), not eligible. **Approval resume, all in order:** (1) the `Approval` binds this `attemptId`, this `quoteHash` and this `policyVersion`, is `active` and unexpired; (2) the gate obtains a current 402 for the same attempt whose quote hashes to the approved `quoteHash` (unmutated, INV-005); (3) a **fresh live Intercepta screen** is made; (4) the decision is **re-evaluated under the current active policy** with the approval passed in, and the rule result `ASK_HUMAN` becomes `PAY` (reason `HUMAN_APPROVED`) only if `amount ≤ maxAmountAtomic` and stage A and steps 6–9 pass; (5) only a `PAY` result continues to reservation, permit and signing; any other result is recorded as the new decision (`HOLD`/`DENY` ⇒ attempt `failed`; `ASK_HUMAN` again ⇒ stays `awaiting_approval`). Approval expiry, window expiry or a policy-version change moves the attempt to terminal `expired`. An approval is consumed when it leads to a permit. Hard prohibitions are never overridable | only via a valid approval resume |
| `DENY` | Attempt ends | never |

**Reason codes (closed set, `ReasonCode`):** `SCHEME_NOT_SUPPORTED, NETWORK_NOT_ALLOWED, ASSET_NOT_ALLOWED, SERVICE_NOT_ALLOWED, OVER_PER_PAYMENT_CAP, EVIDENCE_UNAVAILABLE, EVIDENCE_STALE, EVIDENCE_BLOCK, PERIOD_CAP_EXCEEDED, RULE_MATCHED, NO_RULE_MATCHED, CAP_BELOW_QUOTE, APPROVAL_PENDING, HUMAN_APPROVED, APPROVAL_EXPIRED, QUOTE_INVALID, QUOTE_MUTATED, POLICY_CHANGED, RESERVATION_FAILED, DECISION_EXPIRED, SIGNER_REFUSED, ENGINE_ERROR`.

**Candidate validity (checked before replay):** `hardProhibitions` complete; same `orgId`, `profile.network` and `profile.asset` as the base; `parentVersion` = base version and `policyVersion` > base; `maxPerPaymentAtomic` and `periodCapAtomic` not above the base's and `maxPerPaymentAtomic` ≤ the `[G §4]` per-payment limit (a candidate may tighten limits, never loosen them; ADR-013); `policyHash` matches the body; `defaultAction ∈ {HOLD, ASK_HUMAN, DENY}`; every `CAP` rule has `capAtomic`; rule ids unique. An invalid candidate cannot be replayed or approved.

Default demo policy v1 and candidates are in Appendix A (ADR-012).

## 10. Evidence normalisation

The tier mapping is **Risksir policy over observed fields**, not an Intercepta claim `[08 §9]`, `[ADR-007]`.

| Aspect | Contract |
| --- | --- |
| Endpoint | W3A `GET /api/public/v2/extension/account/{address}/quick-scan`, header `X-API-KEY`, base URL from `INTERCEPTA_BASE_URL` (observed working in Spike A with HTTP 200 on 6 calls: `https://api.web3antivirus.io`, no query string; ADR-017). The address is interpreted as an EVM **mainnet** address. Only read-only endpoints are ever called `[G §2]` |
| Subject | The exact selected `payTo`, interpreted as an EVM **mainnet** address even though settlement is on Base Sepolia `[08 §1]` |
| Parse | zod schema over the body **as observed at two points** (score 0 with no traits; score 100 with two traits): `{ toxicScore: number, traits: [{ risk: number, name: string, description: string }] }`. The 0–100 range comes from the docs and the two observed extremes only, and `txsCount` (documented) was **not** observed. Extra fields are ignored; anything else is `UNAVAILABLE(MALFORMED)` (`docs/spikes/SPIKE_A_INTERCEPTA.md`) |
| Tier | `CLEAR` = no disqualifying observed signal (**not** "safe"); `WARN`; `BLOCK`; `UNAVAILABLE`. Mapping `quickscan-v1` (ADR-017): `BLOCK` if `toxicScore ≥ 80` or any trait `risk ≥ 80`; `WARN` for any other non-zero signal; `CLEAR` only for score 0 with no traits. **The value 80 is a Risksir policy threshold (ADR-017), not an Intercepta verdict**; UI text and docs say so |
| Evidence status | **Observed (Spike A, `fixtures/intercepta/recorded/`):** endpoint, base origin, no query string, HTTP 200 with the `X-API-KEY` header, the body shape at scores 0 and 100, identical results across 3 repeated address pairs, latency 325–2814 ms. **OPEN — resolve with Spike A evidence:** what scores between 0 and 100 mean, the WARN band, where BLOCK should start, `txsCount`, behaviour without the header, 401/429/5xx bodies, rate limits. The WARN tier is exercised only by a labelled synthetic fixture |
| Unavailable | Error, timeout, non-2xx, 429, schema mismatch, or empty body ⇒ tier `UNAVAILABLE` with the matching `unavailable` code ⇒ HOLD. **No retry** (each call spends the 40-call budget `[G §5]`); a new attempt makes a new call |
| Freshness | `EVIDENCE_FRESHNESS_S = 30` between `capturedAt` and decision time; a decision expires after `DECISION_TTL_S = 60`. Both ADR-013 defaults |
| No reuse | Evidence is bound to one attempt. A previous pass is never reused for a new attempt (INV-003). The regression engine reads stored snapshots only |
| Storage | Every live response stored raw under `fixtures/intercepta/recorded/` (timestamp, endpoint, address, HTTP status, body; **no headers**) and in the DB with `provenance: real_live`. Hand-made responses live under `fixtures/intercepta/synthetic/` with `"provenance": "synthetic"` `[G §5]` |
| Budget | ≤ 40 live calls per agent session; on 429/quota, stop live calls and record it in `HANDOFF.md` `[G §5]` |

## 11. State machines

Illegal transitions throw and are never persisted (tested exhaustively).

**PaymentAttempt**

| From | To (allowed) |
| --- | --- |
| `created` | `quoted`, `failed` |
| `quoted` | `screened`, `decided` (stage-A rejection: a Decision without evidence), `failed` |
| `screened` | `decided`, `failed` |
| `decided` | `signed` (only if the decision is eligible and a permit is armed), `awaiting_approval` (`ASK_HUMAN` pending), `failed` (HOLD, DENY, CAP below quote, expired) |
| `awaiting_approval` | `decided` (approval resumed and re-evaluation produced a new decision), `awaiting_approval` (re-evaluation still `ASK_HUMAN`), `failed` (re-evaluation `HOLD`/`DENY`, or quote mutated), `expired` (approval or window expired, or the active policy version changed) |
| `signed` | `submitted`, `failed` |
| `submitted` | `settled`, `failed`, `ambiguous` |
| `ambiguous` | `settled`, `failed` (only via reconciliation) |
| `settled`, `failed`, `expired` | terminal |

**PolicyVersion**

| From | To |
| --- | --- |
| `draft` | `replayed` (a report exists for this exact policy hash); `approved` is **not** reachable directly |
| `replayed` | `approved` (owner approval bound to the report hash). A rejected candidate keeps its `CandidatePolicy.status = rejected`; editing a policy creates a new draft, never mutates one |
| `approved` | `active` (same transaction as approval, INV-010) |
| `active` | `superseded` (another version activated), `rolled_back` (owner rollback) |
| `superseded` | `active` (only as a rollback target, logged as a new pointer transition) |
| `rolled_back` | terminal |

**SpendReservation:** `reserved → committed | released | reconciling`; `reconciling → committed | released`. `released` only after confirmed non-settlement or an expired, unused authorisation; never on an HTTP timeout alone `[08 §7]`.

**Decision:** `open → consumed | expired | superseded` (superseded by an approval-resume re-evaluation or a policy-version change). **SigningPermit:** `armed → consumed | revoked | expired`. **Approval:** `active → consumed | expired`. **PaymentCase label:** `good | bad | unknown`; every change appends a `LabelRevision`, nothing is overwritten (INV-020).

## 12. Signing and payment semantics

**Isolation wording (INV-008).** The protected signer (`apps/gate/src/signer`) is the only **code path** that reads `PAYER_PRIVATE_KEY`. This is code-path isolation inside one backend process, enforced by static tests. It is **not** a process or security boundary: a compromised backend defeats it (`[08 §7]`).

**What the SDK sends.** The EIP-3009 typed data contains only `from, to, value, validAfter, validBefore, nonce` plus the domain `{ name, version, chainId, verifyingContract }` (observed, `@x402/evm` 2.27.0). It does **not** contain the scheme, resource URL or attemptId, so the signer **never recomputes the quote hash from typed data**. Binding to the attempt, resource and scheme comes from the permit below.

**Signing permit (single use).**

1. **Arm.** After a signer-eligible Decision and a successful reservation, the gate arms one `SigningPermit` for that attempt: `attemptId`, `decisionId`, the stored `CanonicalQuote`, `quoteHash`, `policyVersion`, `expiresAt` (= `decision.expiresAt`).
2. **Compare typed data to the stored quote (table A).**
3. **Check decision-level conditions (table B).**
4. **Consume.** Permit consumption, decision consumption, `signerCalls` increment and the signer-call ledger row happen in one transaction, then the signature is made. Any mismatch means refuse, the permit stays as it was and `signerCalls` stays 0.

| # | A. Typed data vs the permit's stored quote | Refusal reason |
| --- | --- | --- |
| A1 | `primaryType` and `types` are exactly `TransferWithAuthorization` (Permit2, permits and other messages are refused) | `SIGNER_REFUSED` |
| A2 | `to` equals `quote.payTo` | `QUOTE_MUTATED` |
| A3 | `value` equals `quote.amountAtomic` | `QUOTE_MUTATED` |
| A4 | `verifyingContract` equals `quote.asset` and the allowlisted USDC (`[G §2]`) | `ASSET_NOT_ALLOWED` |
| A5 | `chainId` is 84532 and `quote.network` is `eip155:84532` | `NETWORK_NOT_ALLOWED` |
| A6 | `from` equals the signer's own address | `SIGNER_REFUSED` |
| A7 | `validAfter ≤ now` and `now < validBefore ≤ now + quote.maxTimeoutSeconds + skew` (within the quote validity, not expired) | `QUOTE_MUTATED` |

| # | B. Permit and decision conditions | Refusal reason |
| --- | --- | --- |
| B1 | An `armed`, unexpired permit exists for this attempt and has not been consumed | `SIGNER_REFUSED` / `DECISION_EXPIRED` |
| B2 | The Decision exists, is `open`, `signerEligible`, unexpired, and its `evidenceId` resolves to stored evidence with a usable tier and `capturedAt ≤ decidedAt` (INV-001) | `DECISION_EXPIRED` / `SIGNER_REFUSED` |
| B3 | `decision.quoteHash` equals `attempt.quoteHash` and `permit.quoteHash`, and `hashQuote(permit.quote)` equals it | `QUOTE_MUTATED` |
| B4 | `decision.policyVersion` equals `permit.policyVersion` and the current active version (INV-017) | `POLICY_CHANGED` |
| B5 | A `SpendReservation` in `reserved` exists for this attempt and its amount equals `value` | `RESERVATION_FAILED` |
| B6 | `value ≤ decision.authorisedMaxAtomic` and within the `[G §4]` limits (0.10 USDC per payment, 1.00 total, 20 settlements per session) | `OVER_PER_PAYMENT_CAP` |
| B7 | The decision has not already produced a signature (single use, INV-024) | `SIGNER_REFUSED` |

- On success: `signerCalls` incremented, `signerInvokedAt` recorded (must be later than `interceptaReturnedAt`, INV-019), decision and permit `consumed`, then sign, and log a redacted line `signerCalls=<n>` with a hash and at most the first/last 6 characters of the signature `[G §1]`. On refusal: signer count unchanged and a `SignerRefused` audit event.
- The SDK receives only an object with `address` and `signTypedData`. The signer is used **in addition to** the SDK `onBeforePaymentCreation` hook (defence in depth, `CLAUDE.md` §7, ADR-015).
- **EIP-3009 nonce/replay:** the SDK generates the random 32-byte `nonce`; Risksir records it per attempt, never re-signs a decision, and never reuses a signed payload for a different attempt. Retrying after an ambiguous outcome is forbidden until the nonce state or receipt is reconciled `[08 §8]`.
- **Spend ledger (ADR-021).** `SpendReservation` rows are the **only** ledger. `used(period) = Σ amountAtomic over reservations with status ∈ {reserved, reconciling, committed}` in the same fixed period window (`periodKey = floor(epochSeconds / periodSeconds)`, ADR-013). `committed` means settled: settled payments are **not** summed separately, so nothing is double counted. Policy evaluation receives `remaining = cap − used`, which excludes the current attempt because it has no reservation yet. The reservation is created in **one serialised transaction** (synchronous better-sqlite3 `BEGIN IMMEDIATE`) that re-checks `used + amount ≤ cap`; if that fails the result is HOLD (`PERIOD_CAP_EXCEEDED` / `RESERVATION_FAILED`) and nothing is signed (INV-007). `released` rows are excluded.
- **Ambiguous settlement:** attempt `ambiguous`, reservation `reconciling`; reconcile from Base Sepolia receipt/nonce state through viem before releasing, committing or retrying.
- **Retry rules:** no automatic Intercepta retry (§10); no signing retry for the same decision; a fresh attempt repeats §5 steps 2–10 with fresh evidence; the HTTP retry after a valid signature is the single SDK payment retry only.
- **Settlement ordering:** the SDK default **authorization** flow (verify, resource handler, settle), ADR-018. Delivery is never inferred from settlement.
- **SDK compatibility (Q-012).** That the guarded signer works with the installed x402 SDK is proven for the pre-review implementation (M-004, live tx in `docs/evidence/`). The permit design in this section is **OPEN until M-004b re-proves it** against the installed SDK.

## 13. Regression semantics

- **Provenance** on every case and every evidence object: `real_live | sponsor_fixture | controlled_variant | synthetic`. Never relabelled (INV-020). Synthetic and fixture cases are never presented as real or live (INV-012).
- **Replay uses stored evidence snapshots only.** The engine has no network access, clock, randomness, or signer capability, and imports nothing from `apps/`. It never fabricates a past verdict.
- **Per case** `Replayed` is recorded for the baseline policy and each candidate using the same `evaluate()` as production (`now` = the evidence's `capturedAt`; freshness therefore never fires in replay).
- **Exposure model** (counterfactual, not a loss claim): `PAY` and eligible `CAP` ⇒ `exposure = amount`; `HOLD`, `DENY`, `CAP` below quote, and `ASK_HUMAN` (assumed not approved) ⇒ `0`.

| Metric (07 §16) | Numerator | Denominator |
| --- | --- | --- |
| `bad_cases_prevented` | bad cases with baseline exposure > 0 and candidate exposure = 0 | bad cases with baseline exposure > 0 |
| `bad_value_prevented` | Σ over bad of `max(0, baselineExposure − candidateExposure)` | Σ baseline exposure over bad |
| `bad_value_remaining` | Σ candidate exposure over bad | Σ baseline exposure over bad |
| `good_cases_changed` | good cases where candidate action ≠ baseline action or exposure differs | good cases |
| `good_value_delayed_or_denied` | Σ over good of `max(0, baselineExposure − candidateExposure)` | Σ baseline exposure over good |
| `human_reviews_added` | (candidate `ASK_HUMAN` count) − (baseline `ASK_HUMAN` count), signed | all cases |
| `auto_approval_rate` | cases with candidate action PAY or eligible CAP | all cases |
| `hold_rate` / `deny_rate` | candidate HOLD / DENY count | all cases |
| `bad_cases_weakened` (conflict check, 07 §5 Q5) | bad cases with baseline exposure = 0 and candidate exposure > 0 | bad cases |

- `unknown` labels are **excluded** from every prevention and friction metric above (they appear only in rate metrics over all cases) (INV-013). Every metric is shown with numerator and denominator; no ratio is hard-coded; metrics are recomputed at run time from case records.
- Each report is bound to `candidateHash`, `baselineHash`, `datasetHash`, `engineVersion` (`regression/1.0.0`); replay is deterministic, so identical inputs give an identical `reportHash` (tested; `generatedAt` and `reportId` are excluded from the hash).
- Replay reports counterfactual actions on labelled cases, **not** measured production loss `[08 §12]`.

## 14. Onchain/offchain boundary `[08 §4]`

| MUST be onchain | MAY be offchain | MUST be offchain |
| --- | --- | --- |
| USDC transfer, balance change and EIP-3009 nonce consumption on Base Sepolia | Signing of the EIP-3009 authorisation (offchain capability, enforced onchain) | Quote parsing, Intercepta screening, policy decision, spend-limit checks |
| Tx receipt (authoritative for transfer) | Receipt lookup for reconciliation | Budget reservations, policy versions, approvals, rollback, incident labels, audit events |
| — | — | Replay and comparison; delivery assessment (a transfer does not prove delivery) |

Risksir deploys **no smart contracts**, no onchain policy registry and no attestation. The policy store is a conventional company-owned database; nothing is claimed as decentralised or tamper-proof.

## 15. External dependencies

| Dependency | Capability used | Data crossing the boundary | Failure behaviour | Removal test |
| --- | --- | --- | --- | --- |
| **Intercepta (W3A)** `[08 §9]` | Read-only quick-scan of the selected `payTo` (deep scan if quick lacks usable reasons). Endpoint and base origin observed working (Spike A) | Out: the address + `X-API-KEY`. In: the risk result | Any failure ⇒ HOLD; never mocked in the qualifying demo | Removing it breaks the live-evidence promise and the prize requirement |
| **x402 SDK + seller middleware** (`@x402/core`, `@x402/fetch`, `@x402/evm` `ExactEvmScheme`, `onBeforePaymentCreation`, `@x402/express`). 2.27.0 verified from the installed packages (Spike B) | Parse real 402, selected requirement, pre-sign hook, payload creation, seller 402 + verify/settle | 402 body, signed authorisation, settlement response | Hook not effective ⇒ kill-condition check (07 §22) | Removing it makes this a risk dashboard, not an agent payment |
| **Facilitator** (`X402_FACILITATOR_URL`, x402.org test facilitator) | Verify + settle `exact` USDC | Signed payload; settlement result | Failure after signing ⇒ `ambiguous`, reconcile | No real settlement |
| **Base Sepolia RPC + USDC** (`BASE_SEPOLIA_RPC_URL`, contract in `[G §2]`, confirm in Spike B) | Receipt/nonce reads | Read-only calls | RPC down ⇒ cannot reconcile; reservation stays | No observable money movement |
| Local SQLite | Transactional state | — | Unavailable ⇒ no new signing | — |

The Intercepta endpoint is verified (Spike A); score meaning between 0 and 100 and error/rate-limit behaviour remain OPEN (§10). Token scan / EIP-712 message scan are optional and only claimed if proven compatible in Spike A/B (`[08 §11]`).

## 16. Failure semantics (every financially relevant failure fails closed)

| Failure | Detection | Action | Signer calls | Reservation |
| --- | --- | --- | --- | --- |
| Invalid 402 / unparsable body | zod fails | attempt `failed`, `QUOTE_INVALID` | 0 | none |
| Local-stage rejection (scheme, network, asset, cap, service, validity) | policy stage A | DENY or HOLD **before any Intercepta call** | 0 | none |
| Quote mutation after decision | signer tables A and B3 | `QUOTE_MUTATED`, new attempt needed | 0 | released |
| Intercepta timeout / error / 429 / malformed | adapter | evidence `UNAVAILABLE` ⇒ HOLD | 0 | released |
| Stale evidence | freshness check | HOLD `EVIDENCE_STALE` | 0 | released |
| DB unavailable | store throws | no decision, no signing | 0 | n/a |
| Concurrent over-budget attempts | `BEGIN IMMEDIATE` reservation | loser gets `PERIOD_CAP_EXCEEDED` HOLD | 0 for loser | winner only |
| Signer refusal (no armed permit, or any table A/B mismatch) | signer checks | attempt `failed` `SIGNER_REFUSED` | 0 | released |
| Facilitator failure before submit | SDK error | attempt `failed` | 1 if already signed, else 0 | released only if confirmed non-settled, else `reconciling` |
| Ambiguous settlement | no definite result | `ambiguous`; reconcile before any retry | 1 | `reconciling` |
| Paid but no resource | settle ok, HTTP fail | `settled` + delivery `not_received`; no refund promise | 1 | committed |
| Expired owner approval or approval window | `expiresAt <= now` | attempt `expired` (terminal), `APPROVAL_EXPIRED` | 0 | none |
| Approval resume with a mutated quote | resumed 402 hashes differently | `QUOTE_MUTATED`, attempt `failed` | 0 | none |
| Policy changed while attempt pending | signer check B4 / gate re-check | decision `superseded`, permit `revoked`, `POLICY_CHANGED`; an attempt in `awaiting_approval` becomes `expired` | 0 | released |
| Engine exception | catch at gate | HOLD `ENGINE_ERROR` | 0 | released |

## 17. Invariants (each objectively testable; may be refined, never weakened)

| ID | Statement |
| --- | --- |
| INV-001 | Every live payment attempt that can reach the signer gets a fresh live Intercepta screen of the exact selected `payTo` before any signer invocation. A quote rejected by a local check (stage A) is never signer-eligible and spends no Intercepta call. |
| INV-002 | HOLD, DENY, pending ASK_HUMAN (`awaiting_approval`), `expired`, a CAP below the quote amount and every error path each mean zero signer invocations for that attempt. |
| INV-003 | Missing, timed-out, errored, rate-limited, malformed or stale evidence means HOLD. A new attempt never reuses a cached pass. |
| INV-004 | The signer signs only under an armed, unexpired, single-use signing permit, and only when a stored Decision binds the identical canonical quote hash and the current active policy version, has not expired, and has a matching reservation. |
| INV-005 | Changing scheme, network, asset, amount, `payTo`, resource or validity changes the quote hash and invalidates any earlier decision or approval. |
| INV-006 | Signing happens only on `eip155:84532` with the allowlisted USDC contract. Any other network or asset means DENY, enforced inside the signer. |
| INV-007 | The quote amount never exceeds the per-payment cap, and `used(period)` (the sum of reservations in `reserved`, `reconciling` and `committed`, the only ledger) plus a new amount never exceeds the period cap, including under concurrency; the check and the insert are one serialised transaction. |
| INV-008 | `PAYER_PRIVATE_KEY` is read only inside the signer module (code-path isolation in one process, enforced by static tests; not a process boundary). Agent, buyer and regression code have no import path to the signer's key material. |
| INV-009 | Every Decision records the policy version, quote hash, action and reason codes, and the evidence ID whenever a live screen was made. A Decision without evidence (stage-A rejection) is never signer-eligible. |
| INV-010 | A candidate becomes active only through an explicit, authenticated owner approval bound to a regression report computed on the exact candidate hash and dataset hash. Activation and the pointer change happen in one DB transaction. |
| INV-011 | Approved policy versions are immutable. Rollback is a new, logged pointer transition to an earlier approved version. |
| INV-012 | Replay uses only stored evidence snapshots. Every case carries a provenance label, and synthetic or fixture cases are never presented as real or live. |
| INV-013 | Regression metrics are computed from case records at run time, never hard-coded, and `unknown` labels are excluded from prevention denominators. |
| INV-014 | Settlement status and delivery status are recorded and shown separately. An ambiguous settlement keeps its reservation until reconciled. |
| INV-015 | A human override never waives a hard prohibition. |
| INV-016 | No AI or LLM component can sign, approve or activate. |
| INV-017 | When the active policy version changes, decisions, approvals and signing permits made under the previous version stop being valid for signing, and any attempt in `awaiting_approval` under it becomes `expired`. |
| INV-018 | No secret value appears in logs, fixtures, docs or commits. |
| INV-019 | For every signed attempt `interceptaReturnedAt < signerInvokedAt`; a not-called signer has `signerInvokedAt = null`. |
| INV-020 | Provenance labels and label revisions are append-only; nothing is relabelled. |
| INV-021 | Only read-only Intercepta endpoints are called; no request stores headers. |
| INV-022 | Money is integer atomic units (`bigint` in code, decimal string in JSON); no floats. |
| INV-023 | The policy engine and regression engine are pure: no clock, network, randomness, DB or LLM. |
| INV-024 | Each decision yields at most one signature. |
| INV-025 | Exactly one active policy pointer per organisation. |
| INV-026 | Every owner-only endpoint rejects a missing or wrong bearer token; the agent has no route to those endpoints. |
| INV-027 | The typed data is checked against the stored quote of an armed permit (`to`, `value`, `verifyingContract`, `chainId`, `from`, validity); the permit is consumed on use, and every mismatch means refuse with `signerCalls` unchanged. The quote hash is never recomputed from typed data. |
| INV-028 | An approval resumes an attempt only when it binds the same `attemptId`, `quoteHash` and `policyVersion`, is unexpired, the resumed quote is unmutated, a fresh live screen is made and the decision is re-evaluated under the current active policy; only a `PAY` result may proceed to sign. |
| INV-029 | Local checks (scheme, network, asset, per-payment cap, service scope, quote validity) run before any Intercepta call. |

## 18. Security boundaries

- **Untrusted inputs:** 402 payloads, facilitator responses, Intercepta responses, seller HTTP bodies, HTTP request bodies, agent-provided task/context. All validated with zod at the boundary; agent-supplied context can never raise a cap `[08 §7]`.
- **Secrets** (`[G §1]`): `INTERCEPTA_API_KEY`, `PAYER_PRIVATE_KEY`, `OWNER_CONSOLE_TOKEN`. Referred to by name only; `.env` is never opened by agents. Loggers redact `X-API-KEY`, `Authorization`, private keys and full signed payloads. Never bypass the pre-commit hook.
- **Key isolation (code-path isolation, not a security boundary):** the key is read once inside `apps/gate/src/signer/key.ts` and kept in a closure. Static tests assert `PAYER_PRIVATE_KEY` occurs nowhere else, and that `packages/core/**`, `apps/gate/src/agent/**` and regression code cannot import from `signer/`. The buyer gate imports only `signer/public.ts`. Everything runs in one backend process, so this constrains accidental and agent-driven access only; a compromised backend, or anyone able to run code in the process, defeats it (`[08 §7]`). Do not describe it as a process or security boundary.
- **Owner auth:** bearer `OWNER_CONSOLE_TOKEN` compared in constant time; hackathon-grade but real (INV-026). Owner endpoints and demo-command endpoints share it. The agent process holds no owner token.
- **Local only:** seller, gate and console run on localhost; no tunnels or public deployment `[G §9]`.
- **Log redaction:** structured logs pass through one redaction function; tests assert secrets and headers never appear.

## 19. Interfaces (unfrozen details `OPEN`)

**Owner-console HTTP API** (`apps/gate`, JSON, all `Authorization: Bearer …`):

| Method + path | Purpose |
| --- | --- |
| `GET /api/state` | Org, active policy version, profile, signer-call totals |
| `GET /api/attempts`, `GET /api/attempts/:id` | Decision trace: quote, evidence + provenance + timestamps, policy version, action, reasons, signer calls, settlement, delivery |
| `POST /api/agent/run` `{scenario}` | Run the deterministic buyer agent for a named demo scenario (`pass`, `block`, `v2`) within `[G §4]` limits |
| `GET /api/cases`, `POST /api/cases/:id/label` | List cases with provenance; append a label revision (Trigger C) |
| `POST /api/candidates`, `GET /api/candidates` | Create/list candidate policies (validated, §9) |
| `POST /api/candidates/:id/replay` | Compute a `RegressionReport` |
| `POST /api/candidates/:id/approve` `{reportHash}` | Approve + activate atomically; 409 if hashes differ |
| `POST /api/policy/rollback` `{toVersion}` | New logged pointer transition |
| `POST /api/approvals` `{attemptId, quoteHash, maxAmountAtomic}` | ASK_HUMAN approval (expiring) |
| `GET /api/audit` | Audit events |

**Internal signer interface:** §12. **Seller routes** (`apps/seller`): `GET /paid/report/:variant` with `variant ∈ {safe, risky, alt}`; each route's `payTo` comes from `SELLER_PAY_TO_SAFE|RISKY|ALT`, price within `[G §4]`. **Buyer entry point:** `runBuyerTask(task)` in `apps/gate/src/agent`. **CLI:** `pnpm seed`, `pnpm reset`, `pnpm demo:pass`, `pnpm demo:block`, `pnpm demo:v2`, `pnpm demo:smoke`, `pnpm test:live`, `pnpm verify`. Exact response shapes `OPEN` until the milestone that builds them; any change updates this section.

**Environment variables** (from `.env.example`; purpose in `AGENTS.md`): `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `PAYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`, `OWNER_CONSOLE_TOKEN`.

## 20. UX contract `[07 §14.5]`

Judges must see the proof without explanation.

- **Header (always visible):** organisation, **active policy version (v1 or v2)**, network `Base Sepolia`, provenance legend.
- **Decision trace** per attempt, in order: selected quote (network, asset, amount, `payTo`, resource, quote hash); Intercepta evidence (tier, score, reasons, **provenance badge**, endpoint, timestamp; the tier is labelled "Risksir tier (policy threshold ADR-017), not an Intercepta verdict" and the raw score and trait names are shown as the provider returned them); policy version; action + reason codes; signer section; settlement status and delivery status (separate); Basescan link for a settled tx.
- **Signer badge:** a large, colour-coded badge `signer calls: 0` (neutral/green for a blocked path) or `signer calls: 1`. The Intercepta call timestamp is shown **before** the signer timestamp. When the signer was not called, **no signer timestamp is shown at all**.
- **Regression view:** each candidate's metrics with numerator/denominator and the case provenance mix; candidates side by side with v1; approve and rollback controls; never a single opaque score.
- **Incident labelling:** select a case, choose `good|bad|unknown`, add a rationale.
- Settings UI is minimal: read-only profile view, no large dashboard `[07 §18]`. No panel exists that does not influence a future payment.
- Any evidence or case from a mock, recording or synthetic source is visibly labelled as such; never shown as live.

## 21. Acceptance criteria

| ID | Criterion (observable) | Src |
| --- | --- | --- |
| AC-001 | A real HTTP 402 from the local x402 seller is received and parsed by the buyer; a requirement is selected | 07 §27.1, PA.1 |
| AC-002 | The exact selected quote (network, asset, amount, `payTo`, resource, hash) is shown in the trace | 07 §27.2 |
| AC-003 | A live Intercepta call is recorded before the signer; `interceptaReturnedAt < signerInvokedAt` | 07 §27.3, PA.2 |
| AC-004 | One payment settles on Base Sepolia; tx hash stored and linked to Basescan | 07 §27.4, PA.6 |
| AC-005 | One attempt is held or denied because of live Intercepta evidence, with a visible reason | 07 §27.5, PA.6 |
| AC-006 | The blocked attempt shows `signer calls: 0` and no signer timestamp | 07 §27.6, PA.5 |
| AC-007 | The company risk profile is explicit and visible | 07 §27.7 |
| AC-008 | The active policy version is visible on every screen and stored on every decision | 07 §27.8, INV-009 |
| AC-009 | At least one incident/regression case exists, labelled by an authenticated owner | 07 §27.9 |
| AC-010 | At least two valid candidate policies are replayed against the dataset | 07 §27.10 |
| AC-011 | Metrics with numerators/denominators are computed from case data; mutating the dataset changes them | 07 §27.11, INV-013 |
| AC-012 | The owner approves one candidate; it becomes policy vN+1 through one transaction bound to the report hash | 07 §27.12, INV-010 |
| AC-013 | vN+1 changes the decision on a **new** x402 attempt that has a fresh live Intercepta screen | 07 §27.13, 07 §13 L4 |
| AC-014 | Rollback restores the previous version as a new logged transition | 07 §27.14, INV-011 |
| AC-015 | Synthetic, fixture and controlled cases are labelled in DB, API and UI; never shown as real or live | 07 §27.15, INV-012 |
| AC-016 | README has setup and test instructions that work from a clean checkout | 07 §27.16 |
| AC-017 | README points to the Intercepta adapter, decision point, signer gate and regression engine files | 07 §27.17, 07 §14.8 |
| AC-018 | README contains 3–5 lines of Intercepta API feedback | 07 §27.18 |
| AC-019 | The screened address equals the selected quote `payTo`, interpreted as a mainnet address; the result determines the action | PA.2–4, 08 §1 |
| AC-020 | Same evidence with a different amount, counterparty history or profile yields a different authorised action | 07 §13 L2 |
| AC-021 | Intercepta timeout, error, 429 and malformed responses each produce HOLD with zero signer calls | 07 §14 SHOULD, INV-003 |
| AC-022 | A mutated quote invalidates the earlier decision and approval | 07 §14 SHOULD, INV-005 |
| AC-023 | Settlement status and delivery status appear separately | 07 §19, INV-014 |
| AC-024 | The public repository exists and is public before submission (human action) | 07 §14.8, PA |
| AC-025 | Concurrent attempts cannot exceed the period cap | 08 §11, INV-007 |
| AC-026 | `PAYER_PRIVATE_KEY` is unreachable from agent, buyer and regression code (static test) | 07 §19, INV-008 |
| AC-027 | An ambiguous settlement keeps its reservation until reconciled | 08 §8, INV-014 |
| AC-028 | Owner endpoints require the bearer token | 08 §7, INV-026 |
| AC-029 | Every live Intercepta response is stored raw with timestamp, endpoint, address and provenance, without headers | G §5, INV-021 |
| AC-030 | Each of `PAY`, `CAP`, `HOLD`, `ASK_HUMAN`, `DENY` is reachable and tested end to end in the engine | PA.4 |
| AC-031 | A stale approval, a signing permit or a decision from the previous policy version cannot sign | 08 §11, INV-017 |
| AC-032 | Regression engine and replay have no signer import and are deterministic (same report hash) | 07 §19, INV-023 |
| AC-033 | An `ASK_HUMAN` attempt sits in `awaiting_approval` with zero signer calls; a valid approval leads to a fresh live screen, a re-evaluation under the current policy and signing only on `PAY`; approval expiry or a policy-version change makes the attempt `expired` | 08 §2, INV-028 |
| AC-034 | The signing permit is single use and the typed data is checked against its stored quote; each mismatch (recipient, amount, asset, chain, payer, validity, quote hash, policy version, decision expiry, reservation, consumed or missing permit) refuses with `signerCalls = 0` | 08 §8, INV-027 |
| AC-035 | A quote rejected by a local check spends no Intercepta call and yields a Decision without evidence | review 2026-09-26, INV-029 |
| AC-036 | The spend ledger is the reservation rows only; remaining budget excludes the current attempt; the reservation transaction re-checks the cap | 08 §8, INV-007 |
| AC-037 | The permit-based guarded signer produces one valid signature that the installed x402 SDK and facilitator settle (re-proof of Q-012) | 07 §22, Q-012 |

## 22. Demo acceptance path `[07 §18]`

| Scene | What happens | ACs |
| --- | --- | --- |
| 1 Establish the company | Show explicit profile and active v1 | AC-007, AC-008 |
| 2 Successful payment | Real 402 → live screen of `SELLER_PAY_TO_SAFE` → v1 `PAY` → signer once → settles → tx link | AC-001–004, AC-019, AC-023, AC-029 |
| 3 Sponsor qualification hold | Real 402 for `SELLER_PAY_TO_RISKY` → live known-risk result → DENY/HOLD → `signer calls: 0` with reason | AC-005, AC-006, AC-019, AC-021 |
| 4 Regression | Open incident case (owner-labelled), run ≥2 candidates, compare metrics, approve one | AC-009–012, AC-015, AC-032 |
| 5 Policy evolution | Rollback shown; new 402 for `SELLER_PAY_TO_ALT` (first-time counterparty, amount above the first-payment band) → **fresh live screen** → v2 changes the decision | AC-013, AC-014, AC-020 |

**Scene 5 must be reproducible without an unobserved tier.** v2 keys on **observed tier + context predicates** (first-time counterparty and an amount band), never on a tier that Spike A has not seen. Because the ALT counterparty has never been paid, v1 would `PAY` the same quote; the "v1 would decide" line in the UI is a labelled pure preview, and the enforced change is the live v2 attempt.

## 23. Claim boundaries `[07 §26]`, `[08 §12]`

| May say | May not say |
| --- | --- |
| "Intercepta tells the agent what is risky; Risksir makes the organisation's payment policy learn from what happened." | "CLEAR means safe"; that Intercepta only has generic rules, cannot learn, or lacks custom rules |
| Live Intercepta evidence controlled the signing decision for the shown attempts | "First safe x402 layer"; "we invented backtesting" |
| Replay reports counterfactual actions on labelled cases with stated provenance | Replay metrics are real prevented losses |
| Testnet settlement with a mainnet address screened | Testnet settlement proves mainnet wrongdoing or the seller's real-world identity |
| Recorded, fixture or synthetic data, clearly labelled | Mocked or recorded evidence presented as live; "our AI knows better"; a policy activates because AI proposed it |

## 24. Non-goals `[07 §14 DO NOT]`, `[07 §28]`

New threat-detection model or scam database; wallet blacklist as the product; credit score or public reputation; escrow or refunds; smart contracts or an onchain policy registry; indexer, subgraph or oracle; multi-chain; extra sponsor integrations for prize count; MCP or skills layer; autonomous policy self-modification; any LLM with signing, approval or activation rights; a generic dashboard with no effect on a future payment; broad institutional AML; large ML models on fake data.

## 25. Open questions (genuine only)

| ID | Question | Why it matters / blocks | Who decides | Conservative default |
| --- | --- | --- | --- | --- |
| Q-001 | Exact Intercepta response fields, reasons, score semantics, tier thresholds | Evidence tiers, adapter parser, live pass/block (M-003) | Agent with Spike A evidence + ADR | **PARTLY RESOLVED 2026-09-26:** body shape observed at scores 0 and 100 (`fixtures/intercepta/recorded/`). **OPEN — resolve with Spike A evidence:** meaning of scores between 0 and 100, the WARN band, where BLOCK starts, `txsCount`. The 80 threshold is a Risksir policy threshold (ADR-017), not an Intercepta verdict |
| Q-002 | Correct Intercepta endpoint and base URL | Adapter | Agent, docs + Spike A | **RESOLVED 2026-09-26** by observation: quick-scan path on `https://api.web3antivirus.io` returned HTTP 200 on 6 calls (recorded files) |
| Q-003 | Is the sponsor known-risk address usable as a testnet `payTo`, and is the block tied to the quote? | Qualifying block (07 §22 kill condition) | **Human** (sponsor) | Label the blocked branch as a controlled merchant configuration; do not claim qualification |
| Q-004 | Does Intercepta already offer customer-specific historical replay / policy comparison? (Spike E, 07 §20) | Novelty gate, 07 §22.5 | **Human** (sponsor) | Treat novelty as hypothesis; never claim it |
| Q-005 | x402 package names/versions, `onBeforePaymentCreation` semantics, exact 402 and settlement shapes | Buyer gate, signer typed-data checks | Agent, Spike B + ADR | **RESOLVED 2026-09-26** (ADR-018): `@x402/*` 2.27.0, hook runs before signing, aborts throw |
| Q-006 | Settlement ordering (authorise-first vs upfront) | Ambiguity/reconciliation design | Agent, Spike B + ADR | **RESOLVED 2026-09-26** (ADR-018): authorization flow (default) with explicit `ambiguous` state |
| Q-007 | Does token scan / EIP-712 message scan accept this payload? | Optional claim only | Agent, Spike A/B | Claim address screening only |
| Q-008 | History/alert/webhook API for risk-state changes (Trigger B) | Optional trigger | Agent | Trigger B not built; Trigger C only |
| Q-009 | Is the payer wallet funded (Base Sepolia ETH + test USDC ≤ 20)? | Live payments | **Human** | **RESOLVED 2026-09-26**: 0.1 ETH and 19.99 test USDC observed by `wallet:status`; keep ≤ 20 |
| Q-010 | Reselect a cheaper advertised requirement after CAP-below-quote? | CAP completeness | Agent, if the 402 ever advertises more than one option | Do not reselect; CAP below quote = no signing |
| Q-011 | Intercepta timeout and rate limits | Adapter timeout, session budget | Agent, Spike A | `INTERCEPTA_TIMEOUT_MS = 8000` (our choice), no retry. Latency 325–2814 ms over 6 calls. **OPEN — resolve with Spike A evidence:** rate limits and 401/429/5xx bodies (unobserved, not in the docs) |
| Q-012 | Does the guarded signer work with the installed x402 SDK? | The whole signing boundary | Agent, M-004b evidence | **PROVEN for the pre-review implementation** (M-004, live tx `0x1cf9ae6f…8e6b`). The permit design in §12 is **OPEN** until M-004b re-proves it (AC-037) |

---

## Appendix A — Default constants and demo policy (ADR-012, ADR-013; tunable with an ADR)

USDC has 6 decimals: 0.01 USDC = `10000`.

| Constant | Value |
| --- | --- |
| `EVIDENCE_FRESHNESS_S` / `DECISION_TTL_S` / `APPROVAL_TTL_S` | 30 / 60 / 600 |
| `INTERCEPTA_TIMEOUT_MS` | 8000 |
| `QUOTE_MAX_VALIDITY_S` | 600 (a quote whose `maxTimeoutSeconds` is outside `[1, 600]` is HOLD `QUOTE_INVALID`, stage A) |
| Tier thresholds (ADR-017) | **Risksir policy threshold, not an Intercepta verdict:** `BLOCK` if score ≥ 80 or any trait risk ≥ 80; `WARN` for any other non-zero signal; `CLEAR` for score 0 with no traits |
| Period window | fixed, `periodSeconds = 86400` |
| Live limits `[G §4]` | 100000 per payment; 1000000 per session; 20 settlements |
| Profile v1 | `maxPerPaymentAtomic = 100000`, `periodCapAtomic = 500000`, `reviewCapacityPerPeriod = 20`, hard prohibitions = all of `HARD_PROHIBITIONS` |
| Policy v1 rules | `R1`: tier ∈ {CLEAR} → PAY. `R2`: tier ∈ {WARN} and amount ≤ 50000 → PAY. `R3`: tier ∈ {WARN} → ASK_HUMAN. Default `HOLD`. (BLOCK is hard-denied at step 8.) |
| Candidate A (blunt) | v1 plus, before `R1`: first-time counterparty → HOLD |
| Candidate B (balanced) | v1 plus, before `R1`: first-time counterparty and amount ≥ 30000 → CAP at 20000 |
| Candidate C (review) | v1 plus, before `R1`: first-time counterparty and amount ≥ 30000 → ASK_HUMAN |
| Seller prices | safe route 50000 (first-time counterparty, above the band ⇒ v1 `PAY`); risky route 10000 (never signed); alt route 50000 |
| Incident case | `controlled_variant` derived from a stored real evidence snapshot, first-time counterparty, amount 80000, owner label `bad` with rationale (CLEAR is not proof of merchant honesty) |

Every value is checked against `[G §4]` before a live run; a run that would exceed a limit aborts.
