# EXECUTION_PLAN — Risksir

Status vocabulary: `TODO | IN_PROGRESS | BLOCKED | VERIFIED`. Evidence words: `implemented < unit-tested < integration-tested < live-verified`. A milestone is `VERIFIED` only with the evidence its Validation section requires (`TEST_PLAN.md` §7 for live ones). `M-005` and `M-010` are never `VERIFIED` without live evidence.

Local command note: plain `pnpm` is not on PATH on this machine, so commands are written `pnpm …` and run as `corepack pnpm …` (ADR-014).

Refinements to the bootstrap skeleton (dependency order kept, prize path first):
- **M-004** introduces a minimal SQLite `store` (attempts, evidence, decisions, reservations behind interfaces) because the signer must check a *stored* decision and reservation (INV-004). **M-006** extends the same store (cases, policies, audit, concurrency proof, reconciliation).
- **M-007** is a hard dependency of **M-008** (a candidate approval needs a report) and **M-009** is a dependency of **M-010/M-011** (the demo needs the console); both are added to the critical path below.

---

# M-000 — Scaffold
Status: VERIFIED
Needs credentials: none
## Objective
pnpm workspace, TypeScript strict ESM, vitest, minimal eslint, green `pnpm verify`, CI running it, minimal README, `AGENTS.md`.
## Why (SPEC / AC / INV references)
SPEC §6 module map; `CLAUDE.md` §7; AC-016 (README base); INV-018 (secret hygiene stays intact).
## Dependencies
none
## Scope
Root `package.json` (`packageManager` pinned to the detected pnpm), `pnpm-workspace.yaml`, `tsconfig.base.json`, workspaces `packages/core`, `apps/gate`, `apps/seller`, `apps/console` (stubs that typecheck), vitest + eslint config, root scripts `verify`, `test`, `typecheck`, `lint`, `test:live` (refuses without `LIVE=1`), `demo:smoke` (placeholder that fails loudly until M-011), `.github/workflows/ci.yml` running `pnpm verify`, minimal `README.md`, `AGENTS.md`, `.gitattributes` (`*.sh text eol=lf`), `fixtures/` skeleton with `.gitkeep`.
## Out of scope
Any product logic.
## Likely components
Root config, `packages/core`, `apps/*` empty shells.
## Acceptance (AC-xxx, INV-xxx)
AC-016 (partial); INV-018.
## Validation (exact commands and evidence required)
`corepack pnpm install`, `corepack pnpm verify` green, `corepack pnpm test:live` exits non-zero without `LIVE=1`, `bash scripts/env-status.sh`. Evidence: command output summary.
## Commit boundary
One commit: `feat(repo): scaffold pnpm workspace with green verify and CI`.
## Evidence (filled in when VERIFIED)
Level: integration-tested (offline). 2026-09-26: `corepack pnpm install` ok (pnpm 12.6.0); `corepack pnpm verify` = `tsc --noEmit` + `eslint .` + `vitest run` green (2 files, 4 tests). `test:live` exits 1 without `LIVE=1` and exits 1 with `LIVE=1` (no live tests yet); `demo:smoke` exits 1 by design. `bash scripts/env-status.sh` shows all names SET. TypeScript pinned to ~6.0.3 (ADR-016). CI file `.github/workflows/ci.yml` added but not yet observed running on GitHub.

# M-001 — Core domain
Status: VERIFIED
Needs credentials: none
## Objective
zod types and inferred TS types for SPEC §7, money units, canonical JSON, the single fingerprint helper, provenance labels.
## Why (SPEC / AC / INV references)
SPEC §7, §8; AC-015; INV-005, INV-020, INV-022.
## Dependencies
M-000
## Scope
`packages/core/src/{types,money,canonical,fingerprint,provenance}.ts`; fixed hash vectors; tests T-001, T-002, T-003, T-004 (hash parts), T-016.
## Out of scope
Policy and regression logic; I/O.
## Likely components
`packages/core`.
## Acceptance (AC-xxx, INV-xxx)
AC-015, AC-022 (hash part); INV-005, INV-020, INV-022.
## Validation (exact commands and evidence required)
`pnpm --filter @risksir/core test`, then `pnpm verify` green. Evidence: test names passing.
## Commit boundary
`feat(core): add domain types, money, canonical quote fingerprint and provenance labels`.
## Evidence (filled in when VERIFIED)
Level: unit-tested. 2026-09-26: `corepack pnpm verify` green (tsc + eslint + vitest): 6 files, 102 tests. T-001 (money), T-002 (canonical JSON), T-003 (quote hash changes per field; golden vector `0xc2998300…fca9c` equals an independently built tag + canonical string), T-004 (policy/dataset/report hashes; report hash ignores `reportId`/`generatedAt`), T-016 (provenance survives parse/JSON round trip, relabel rejected, non-live evidence rejected in a `real_live` case, label revisions append-only). zod 4.6.5. Schema refinements also enforce INV-019 (signer timestamp after Intercepta return), INV-009 (decision completeness), INV-002 (HOLD/DENY/ASK_HUMAN never eligible), INV-015 (complete hard-prohibition set).

# M-002 — Deterministic policy engine v1
Status: VERIFIED
Needs credentials: none
## Objective
Pure `evaluate()` with the five actions, fail-closed, reason codes, candidate validation, profile schema; tiers provisional (ADR-007).
## Why (SPEC / AC / INV references)
SPEC §9; AC-007, AC-020, AC-030; INV-002, INV-003, INV-009, INV-015, INV-023.
## Dependencies
M-001
## Scope
`packages/core/src/policy`; the demo policy v1 and candidates A/B/C from Appendix A as typed data; tests T-005…T-011 (tests first for the fail-closed and hard-prohibition rows).
## Out of scope
Intercepta, signing, persistence.
## Likely components
`packages/core/src/policy`.
## Acceptance (AC-xxx, INV-xxx)
AC-007 (data), AC-020 (engine part), AC-030; INV-002, INV-003, INV-009, INV-015, INV-023.
## Validation (exact commands and evidence required)
`pnpm --filter @risksir/core test` and `pnpm verify` green; T-011 static purity check passes.
## Commit boundary
`feat(policy): add deterministic five-action policy engine with fail-closed evidence handling`.
## Evidence (filled in when VERIFIED)
Level: unit-tested. 2026-09-26: `corepack pnpm verify` green: 9 files, 228 tests. `packages/core/src/policy/{evaluate,candidate,demo}.ts`. T-005 (five actions reachable), T-006 (steps 1–11 table + precedence + hard prohibitions beat a catch-all PAY rule), T-007 (UNAVAILABLE ×6 codes, stale, future timestamp, wrong-address evidence ⇒ HOLD; `evaluateFailClosed` ⇒ `ENGINE_ERROR`), T-008 (CAP eligible ≤ cap, `CAP_BELOW_QUOTE` above), T-009 (approval valid ⇒ PAY; wrong hash/version/expired/over-max/wrong attempt ⇒ not eligible; approval never overrides hard prohibitions), T-010 (candidate validation), T-011 (static purity: no Date.now/new Date/Math.random/fetch/process/node builtins/signer API in `policy` and `regression`), AC-020 engine part (same CLEAR evidence: v1 PAY, A HOLD, B CAP below quote, C ASK_HUMAN). Mutation check: disabling the UNAVAILABLE check made 8 tests fail, restored afterwards. Evidence tiers remain provisional (ADR-007).

# M-003 — SPIKE A (P0): Intercepta adapter and live semantics
Status: VERIFIED
Needs credentials: `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`
## Objective
Adapter for the read-only address screen; live screen of the SAFE and RISKY `payTo`; record raw responses; finalise the evidence mapping from **observed** fields.
## Why (SPEC / AC / INV references)
SPEC §10, Q-001/Q-002/Q-011; 08 §11 P0 row 1, Step 9 item 1; AC-019, AC-021, AC-029; INV-001, INV-003, INV-021.
## Dependencies
M-001, M-002
## Scope
`apps/gate/src/intercepta` (client with `X-API-KEY`, timeout, zod parse, raw capture, no retry, header-free storage, redaction), synthetic fixtures under `fixtures/intercepta/synthetic/`, ≤ 40 live calls, the L2 tests T-027/T-028, the live check T-060, `docs/spikes/SPIKE_A_INTERCEPTA.md` (goal, commands, raw evidence paths, observed result, 07 §22 kill-condition check, SPEC OPEN items resolved with ADR IDs), an ADR for the tier mapping, SPEC §10 updated.
## Out of scope
x402, signing, policy changes beyond the mapping.
## Likely components
`apps/gate/src/intercepta`, `fixtures/intercepta/**`, `docs/spikes`.
## Acceptance (AC-xxx, INV-xxx)
AC-019 (address screened), AC-021 (adapter part), AC-029; INV-003, INV-021.
## Validation (exact commands and evidence required)
`pnpm verify` green; `LIVE=1 pnpm test:live -- intercepta` prints `INTERCEPTA calls used: n/40`. Evidence: raw response file paths and timestamps for SAFE and RISKY, plus a note on whether the RISKY subject can be tied to a quote `payTo` (Q-003). Stop with `HUMAN_REQUIRED` on a 07 §22 kill condition or on 429/quota.
## Commit boundary
`feat(intercepta): add live address-screen adapter and record Spike A evidence` (recorded fixtures committed; no headers, no key).
## Evidence (filled in when VERIFIED)
Level: live-verified for the address screen (adapter path only; not yet in a payment flow). 2026-09-26, 4 of 40 live calls.
- Raw responses (`real_live`, no headers): `fixtures/intercepta/recorded/2026-09-26T13-33-52-198Z_0x87cff22e…cb1a.json` (SAFE: HTTP 200, 1336 ms, `toxicScore 0`, `traits []`), `…13-33-55-020Z_0x39308ae4…2fed.json` (RISKY: HTTP 200, 2814 ms, `toxicScore 100`, `known_scammer` 100, `attack_money_target` 85), plus a second identical pair from T-060 at `13-35-25-957Z` / `13-35-26-286Z`.
- `LIVE=1 corepack pnpm test:live` passed (T-060: SAFE ⇒ CLEAR, RISKY ⇒ BLOCK through the production adapter and mapper). `corepack pnpm verify` green: 11 files, 265 tests (T-027, T-028, mapper tests on the recorded files).
- Mapping `quickscan-v1` (ADR-017). `docs/spikes/SPIKE_A_INTERCEPTA.md` written; SPEC §10/§25 updated (Q-001, Q-002 resolved). Kill-condition check: none observed; placement before the signer is untested until M-004; Q-003 (sponsor confirmation that RISKY may be a testnet `payTo`) remains a human action. Mid band, 401/429/5xx and rate limits were not observed live.

# M-004 — SPIKE B (P0): x402 seller, buyer gate, protected signer
Status: TODO
Needs credentials: `PAYER_PRIVATE_KEY` (funded), `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`
## Objective
Local x402 seller (Base Sepolia `exact` USDC), buyer gate with a pre-sign hook, protected signer with a call counter and guarded viem account. A pass signs once and settles; deny, timeout and mutation sign zero times.
## Why (SPEC / AC / INV references)
SPEC §5, §12, §16; 08 §11 P0 rows 2–3, Step 9 item 2; ADR-003, ADR-015; AC-001–AC-006, AC-022, AC-026; INV-001, INV-002, INV-004, INV-005, INV-006, INV-008, INV-019, INV-024.
## Dependencies
M-001, M-002, M-003
## Scope
`apps/seller` (`@x402/express`, routes `safe|risky|alt`, prices from Appendix A), `apps/gate/src/{x402,signer,store,agent}`, minimal SQLite store for attempts/evidence/decisions/reservations behind interfaces, the stub facilitator and local integration tests T-023, T-024, T-025, T-040–T-047, T-053, `docs/spikes/SPIKE_B_X402.md` (package names/versions verified from **installed** packages and docs.x402.org, hook semantics, typed-data shape, settlement ordering ADR), SPEC OPEN items Q-005/Q-006 resolved. A public-address script inside the signer module prints the payer address and checks Base Sepolia funding without printing the key.
## Out of scope
Regression, console, ambiguous reconciliation beyond the state model.
## Likely components
`apps/seller`, `apps/gate/src/{x402,signer,store,agent,api}`.
## Acceptance (AC-xxx, INV-xxx)
AC-001–AC-006, AC-022, AC-026; INV-001, INV-002, INV-004–INV-006, INV-008, INV-019, INV-024.
## Validation (exact commands and evidence required)
`pnpm verify` green (offline); live: `LIVE=1 pnpm test:live -- x402` within `[G §4]` limits printing the run banner. Evidence: settled tx hash, `signerCalls=1` for the pass, `signerCalls=0` for deny/timeout/mutation. `HUMAN_REQUIRED` if the wallet is unfunded or a 07 §22 kill condition appears (guard bypass).
## Commit boundary
`feat(gate): add x402 seller, pre-sign buyer gate and protected signer with zero-call guarantees`.
## Evidence (filled in when VERIFIED)
—

# M-005 — PRIZE CHECKPOINT
Status: TODO
Needs credentials: all live variables
## Objective
One live pass (tx hash), one live Intercepta-driven block (`signerCalls=0`), and persisted decision traces.
## Why (SPEC / AC / INV references)
`[PA]` points 1–6; SPEC §22 Scenes 2–3; AC-001–AC-006, AC-019, AC-023, AC-029; INV-001, INV-002, INV-019.
## Dependencies
M-004
## Scope
Run the live pass on the SAFE route and the live block on the RISKY route under v1; persist traces; store the `real_live` cases and raw evidence; write the evidence into this file and `HANDOFF.md`.
## Out of scope
Regression.
## Likely components
`apps/gate` CLI `demo:pass`, `demo:block`.
## Acceptance (AC-xxx, INV-xxx)
AC-004, AC-005, AC-006, AC-019, AC-023, AC-029; INV-001, INV-002.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:pass` then `LIVE=1 pnpm demo:block`. Evidence: raw Intercepta response paths + timestamps, Base Sepolia tx hash, `signerCalls=0` log line for the block, trace rows from the DB. Never mark VERIFIED without all of them.
## Commit boundary
`test(live): record prize-path pass and Intercepta-driven block evidence`.
## Evidence (filled in when VERIFIED)
—

# M-006 — Case store, reservations, reconciliation
Status: TODO
Needs credentials: none (live check optional)
## Objective
Extend the M-004 store: cases with label revisions, serialised spend reservations with a concurrency proof, ambiguous-settlement reconciliation, separate settlement and delivery status, audit events.
## Why (SPEC / AC / INV references)
SPEC §7, §11, §12, §16; 08 §8, §11 P1 rows; AC-009, AC-025, AC-027; INV-007, INV-014, INV-020.
## Dependencies
M-004
## Scope
Migrations, `BEGIN IMMEDIATE` reservations, reconciliation module (facilitator status + viem receipt/nonce read), tests T-020, T-021, T-022, T-031, T-032, T-048, T-049, T-052.
## Out of scope
Regression and console.
## Likely components
`apps/gate/src/store`.
## Acceptance (AC-xxx, INV-xxx)
AC-025, AC-027, AC-023; INV-007, INV-014, INV-020.
## Validation (exact commands and evidence required)
`pnpm verify` green; T-021 uses two DB connections against one file.
## Commit boundary
`feat(store): add serialised reservations, reconciliation and append-only case labels`.
## Evidence (filled in when VERIFIED)
—

# M-007 — Regression engine and labelled dataset
Status: TODO
Needs credentials: none
## Objective
Pure regression engine, exposure model and metrics (SPEC §13); labelled dataset of `real_live` (from M-005), `sponsor_fixture`, `controlled_variant` and `synthetic` cases with computed metrics.
## Why (SPEC / AC / INV references)
SPEC §13, Appendix A; AC-009–AC-011, AC-015, AC-032; INV-012, INV-013, INV-023.
## Dependencies
M-002 (engine), M-005 (for the `real_live` cases; the rest can proceed earlier)
## Scope
`packages/core/src/regression`, seed script producing cases from stored evidence snapshots only, T-012–T-015.
## Out of scope
Approval and activation.
## Likely components
`packages/core/src/regression`, `fixtures/cases`, `apps/gate` seed CLI.
## Acceptance (AC-xxx, INV-xxx)
AC-010, AC-011, AC-015, AC-032; INV-012, INV-013, INV-023.
## Validation (exact commands and evidence required)
`pnpm verify` green; mutation test proves metrics change with data.
## Commit boundary
`feat(regression): add deterministic replay engine, metrics and labelled case dataset`.
## Evidence (filled in when VERIFIED)
—

# M-008 — Policy lifecycle
Status: TODO
Needs credentials: none
## Objective
Candidates, report binding, authenticated owner approval, atomic activation, rollback, stale-approval invalidation, audit events, owner API for all of it.
## Why (SPEC / AC / INV references)
SPEC §9, §11, §19; AC-012, AC-014, AC-028, AC-031; INV-010, INV-011, INV-017, INV-025, INV-026.
## Dependencies
M-006, M-007
## Scope
Store transitions, owner API routes, T-029, T-030.
## Out of scope
UI.
## Likely components
`apps/gate/src/{store,api}`.
## Acceptance (AC-xxx, INV-xxx)
AC-012, AC-014, AC-028, AC-031; INV-010, INV-011, INV-017, INV-025, INV-026.
## Validation (exact commands and evidence required)
`pnpm verify` green.
## Commit boundary
`feat(policy): add candidate approval, atomic activation and rollback with report binding`.
## Evidence (filled in when VERIFIED)
—

# M-009 — Owner console
Status: TODO
Needs credentials: none
## Objective
Vite + React one-page console: profile view, live trace, incident labelling (Trigger C), regression comparison, approve, rollback; UX contract in SPEC §20.
## Why (SPEC / AC / INV references)
SPEC §20; AC-002, AC-003, AC-006–AC-008, AC-015; INV-012, INV-019.
## Dependencies
M-008
## Scope
`apps/console` with the always-visible policy version header, signer-call badge, provenance badges, separate settlement/delivery, Basescan link, T-054.
## Out of scope
Settings editor, analytics.
## Likely components
`apps/console`.
## Acceptance (AC-xxx, INV-xxx)
AC-006, AC-007, AC-008, AC-015; INV-012, INV-019.
## Validation (exact commands and evidence required)
`pnpm verify` green; console build succeeds; run locally and view.
## Commit boundary
`feat(console): add owner console with decision trace, regression comparison and approval`.
## Evidence (filled in when VERIFIED)
—

# M-010 — Layer 4 proof
Status: TODO
Needs credentials: all live variables
## Objective
An approved v2 changes a **new** x402 decision that has a fresh live Intercepta screen; rollback from v2 to v1 demonstrated.
## Why (SPEC / AC / INV references)
SPEC §22 Scenes 4–5; AC-009–AC-014, AC-020; INV-010, INV-011, INV-017.
## Dependencies
M-005, M-008, M-009
## Scope
Live run: incident label → ≥2 candidates replayed → approve → new ALT attempt under v2 → different decision; rollback; record evidence.
## Out of scope
New product features.
## Likely components
`apps/gate` CLI `demo:v2`.
## Acceptance (AC-xxx, INV-xxx)
AC-012, AC-013, AC-014, AC-020; INV-010, INV-011.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:v2` within `[G §4]`. Evidence: raw Intercepta response path + timestamp for the v2 attempt, decision rows showing v1 vs v2, `signerCalls` log, report hash, audit events. Never mark VERIFIED without them.
## Commit boundary
`test(live): record policy v2 changing a freshly screened x402 decision`.
## Evidence (filled in when VERIFIED)
—

# M-011 — Demo hardening
Status: TODO
Needs credentials: all live variables (for smoke)
## Objective
Seed and reset scripts, fail-closed demo, `pnpm demo:smoke`, `DEMO_RUNBOOK.md`; follows `prompts/DEMO_AND_SUBMISSION.md`.
## Why (SPEC / AC / INV references)
SPEC §22; AC-001–AC-006, AC-013; `[G §4]`.
## Dependencies
M-010
## Scope
Scripts, runbook, fallbacks labelled as recorded (never live), reset procedure.
## Out of scope
New features.
## Likely components
`apps/gate` CLI, docs.
## Acceptance (AC-xxx, INV-xxx)
Reproducibility of AC-004, AC-005, AC-013.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:smoke`; reset then re-run; evidence: output summary and tx hash.
## Commit boundary
`feat(demo): add seed, reset, smoke script and runbook`.
## Evidence (filled in when VERIFIED)
—

# M-012 — Submission
Status: TODO
Needs credentials: none
## Objective
README and `FINAL_VALIDATION.md` checked line by line against 07 §27; follows `prompts/DEMO_AND_SUBMISSION.md`.
## Why (SPEC / AC / INV references)
AC-016, AC-017, AC-018, AC-024; SPEC §23.
## Dependencies
M-011
## Scope
README (setup, tests, file map to Intercepta adapter / decision point / signer / regression engine, 3–5 lines of Intercepta API feedback written from **observed** behaviour, claim boundaries), `FINAL_VALIDATION.md`, T-090.
## Out of scope
Making the repo public (human action).
## Likely components
Docs.
## Acceptance (AC-xxx, INV-xxx)
AC-016, AC-017, AC-018.
## Validation (exact commands and evidence required)
`pnpm verify` green; every 07 §27 line marked with evidence or an honest gap.
## Commit boundary
`docs: add README and final validation against the demo checklist`.
## Evidence (filled in when VERIFIED)
—

---

## CRITICAL PATH

M-000 → M-001 → M-002 → M-003 → M-004 → M-005 → M-006 → M-007 → M-008 → M-009 → M-010 → M-011 → M-012.
(The bootstrap skeleton lists M-005 → M-006 → M-008 → M-010; M-007 and M-009 are added because M-008 needs a regression report and M-010/M-011 need the console.) The **prize path** is M-000…M-005 and comes first. Never mark M-005 or M-010 `VERIFIED` without live evidence. A 07 §22 kill condition stops the build (`CLAUDE.md` §6); do not redesign around it.

## WORK THAT CAN PROCEED WHILE BLOCKED ON CREDENTIALS

Credential names are all SET at bootstrap (`env-status`), so nothing is blocked by a missing name. If a live milestone hits an unfunded wallet, a 429/quota, or a sponsor answer, continue with: M-006 (store, reservations, reconciliation), M-007 (engine and the non-`real_live` dataset), M-008 (lifecycle and owner API), M-009 (console). Return to the critical path as soon as the blocker clears.

## P0/P1 RISKS (08 §11) and the milestone that retires each

| Risk | Pri | Retired by |
| --- | --- | --- |
| Live Intercepta signal on the exact selected `payTo` is decisive and reproducible | P0 | M-003, confirmed M-005 |
| Protected x402 signing boundary is interceptable and non-bypassable | P0 | M-004 |
| Exact EVM USDC path settles on the chosen facilitator | P0 | M-004, confirmed M-005 |
| Sponsor known-risk mainnet address can be truthfully tied to a runnable testnet merchant quote | P0 | M-003 (Q-003, human sponsor confirmation) |
| Signed-but-unconfirmed payment reconciles before reservation release or retry | P1 | M-006 |
| Concurrent attempts cannot overshoot the period limit | P1 | M-004 (basic), M-006 (proof) |
| Owner approval/version activation binds future signer decisions; stale approvals invalidated | P1 | M-008, M-010 |
| Intercepta already offers the same replay/optimisation (differentiation gate) | P1 | Spike E, human action, tracked in `HANDOFF.md`; not blocking |
| Token scan / EIP-712 message scan compatibility | P1 if mandatory, else P2 | M-003/M-004 (optional; claim only if proven) |
| Risk-state change API | P2 | Not built (ADR-005) |
| Field names, timeouts, freshness, rate limits | P2 | M-003 |
