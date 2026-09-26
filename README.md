# Risksir

**Regression testing for autonomous payment policies.**

Risksir is a closed-loop risk-policy engine for x402 agents: Intercepta supplies live payment risk, while each organisation can test, version and improve how its agents respond to that risk before money is signed.

> Intercepta tells the agent what is risky. Risksir makes sure the organisation's payment policy learns from what happened.

Built for ETHGlobal Tokyo 2026, Intercepta prize *Safe Agent-to-Agent Payments with x402*.

## The problem: knowing the risk does not prove the response is right

- Intercepta gives organisations live risk intelligence and programmable responses.
- But each organisation still has to decide how its agents should react in different payment contexts: the payment value, how familiar the counterparty is, the business context, its risk appetite and its capacity for human review.
- A policy that is **too loose** can allow unacceptable payments.
- A policy that is **too strict** can block legitimate payments and increase human review.
- When a decision goes wrong, simply changing the rule does not prove that the new rule is better.

**The core gap:** before a new payment policy controls real agent money, organisations need a way to test how it would have performed on past good and bad payments.

## The solution: every bad decision becomes a regression test

- Every x402 payment still receives a **fresh Intercepta risk check before signing**.
- Risksir applies the organisation's active response policy: **Pay, Cap, Hold, Review (`ASK_HUMAN`) or Deny**.
- Incidents and false positives become **regression cases**, each labelled by an authenticated owner and carrying its provenance.
- Proposed policy changes are **replayed** against past good and bad payments.
- Risksir measures the bad cases and value that would have been prevented, the legitimate payments affected and the human-review cost, each with its numerator and denominator.
- Only an **owner-approved, replay-tested** policy version enters the versioned policy store and controls future payments. Rollback exists.

Intercepta detects risk. Risksir governs and continuously validates how an autonomous payer reacts to it. It does not replace Intercepta's threat intelligence.

### The loop, as implemented

| Stage | What happens | Where |
| --- | --- | --- |
| 1. Detect | A live Intercepta screen of the exact selected `payTo`, before any signer call | [`screenAddress`](apps/gate/src/intercepta/client.ts#L37) |
| 2. Respond | The active policy, the organisation profile and the payment context give exactly one of `PAY`, `CAP`, `HOLD`, `ASK_HUMAN`, `DENY` | [`evaluate`](packages/core/src/policy/evaluate.ts#L170) |
| 3. Observe | Quote, evidence, decision, signer calls, settlement and delivery are stored and audited; the owner labels incidents and false positives (there is no automatic detection) | [`gate.ts`](apps/gate/src/x402/gate.ts#L75) |
| 4. Test | Candidate policies are replayed over the labelled cases, deterministically | [`runRegression`](packages/core/src/regression/engine.ts#L22) |
| 5. Validate | Metrics with numerators and denominators: bad cases and value prevented, good cases changed, human reviews added, hold and deny rates | [`metrics.ts`](packages/core/src/regression/metrics.ts) |
| 6. Reuse | The owner approves one candidate, bound to its report; it becomes policy vN+1 in one transaction, immutable, with rollback | [`approveCandidate`](apps/gate/src/policy/lifecycle.ts#L165) |

The replay is counterfactual evidence on labelled cases, not a measure of real prevented loss (see the claim boundaries below).

## How it works

```text
every payment attempt
  x402 402 response -> exact selected payTo
    -> local checks (network, asset, cap, service, quote validity)
    -> LIVE Intercepta screen of that payTo, before any signer call
    -> active policy + organisation profile + payment context
    -> exactly one of PAY | CAP | HOLD | ASK_HUMAN | DENY
    -> only an approved attempt reaches the protected signer (single-use signing permit)

after an incident
  owner labels a case -> at least two candidate policies
    -> replay over labelled cases, metrics with numerators and denominators
    -> owner approves one, bound to its report -> policy vN+1 (rollback exists)
    -> the next x402 attempt gets a fresh live screen and is decided by vN+1
```

`HOLD`, `DENY` and a pending `ASK_HUMAN` mean zero signer calls. Missing or unusable Intercepta evidence means `HOLD`.

## Where the integration lives

| What | File | Symbol |
| --- | --- | --- |
| Intercepta API call (quick-scan of the exact `payTo`, 8 s timeout, no retry, raw response stored without headers) | [apps/gate/src/intercepta/client.ts](apps/gate/src/intercepta/client.ts#L37) | `screenAddress` |
| Score and traits to Risksir evidence tier (`quickscan-v1`, a Risksir policy threshold) | [apps/gate/src/intercepta/mapping.ts](apps/gate/src/intercepta/mapping.ts#L33) | `quickScanMapper` |
| The live screen is made before any signing, inside the x402 SDK hook | [apps/gate/src/x402/gate.ts](apps/gate/src/x402/gate.ts#L225) | `deps.screen` |
| Policy decision point (pure, deterministic) | [packages/core/src/policy/evaluate.ts](packages/core/src/policy/evaluate.ts#L170) | `evaluate` |
| Local checks that run before any Intercepta call | [packages/core/src/policy/evaluate.ts](packages/core/src/policy/evaluate.ts#L144) | `evaluateLocal` |
| Signer gate (single-use permit, typed data checked against the stored quote) | [apps/gate/src/signer/guard.ts](apps/gate/src/signer/guard.ts#L87) | `createProtectedSigner` |
| Regression engine (pure replay and metrics) | [packages/core/src/regression/engine.ts](packages/core/src/regression/engine.ts#L22) | `runRegression` |
| Owner approval bound to a report, atomic activation | [apps/gate/src/policy/lifecycle.ts](apps/gate/src/policy/lifecycle.ts#L165) | `approveCandidate` |
| Rollback as a new logged transition | [apps/gate/src/policy/lifecycle.ts](apps/gate/src/policy/lifecycle.ts#L215) | `rollbackPolicy` |

## Setup

Requirements: Node >= 20 and pnpm 12 (through corepack; on Windows `corepack enable` may need an administrator shell, or use `corepack pnpm ...`).

```bash
pnpm install
cp .env.example .env        # fill in the values; never commit .env
git config core.hooksPath .githooks   # the pre-commit hook blocks secrets
```

Environment variable names (values are yours and are never printed by any script; check with `bash scripts/env-status.sh`): `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `PAYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`, `OWNER_CONSOLE_TOKEN`. Use a **fresh Base Sepolia test wallet** with a little test ETH and at most 100 test USDC; it must never have held mainnet funds. Only Base Sepolia (`eip155:84532`) is ever signed on.

## Tests

```bash
pnpm verify                       # offline: typecheck, lint, all unit and integration tests (no network)
LIVE=1 pnpm test:live             # live Intercepta screens; spends calls of the 40-call session budget
LIVE=1 pnpm demo:smoke            # preflight: seller 402, facilitator, balance, limits, one live screen
```

## Run

```bash
pnpm demo:reset                   # clean start: policy v1 and 19 labelled cases (previous database is backed up)
LIVE=1 pnpm demo:pass             # real 402 -> live Intercepta -> PAY -> one signer call -> Base Sepolia settlement
LIVE=1 pnpm demo:block            # known-risk payTo -> live Intercepta BLOCK -> DENY, signer calls: 0
LIVE=1 pnpm demo:v2               # label incident, replay A/B/C, approve B, new payment under v2, rollback
pnpm demo:failure                 # simulated Intercepta timeout -> HOLD, signer calls: 0
pnpm demo:up                      # one command: reset, preflight, start the owner API and the console, open the browser
pnpm owner-api:live               # owner API with the live gate (127.0.0.1:4100, bearer OWNER_CONSOLE_TOKEN)
pnpm dev:console                  # owner console (127.0.0.1:5173) with Run scene buttons
```

The live runs are limited to 0.10 USDC per payment, 1.00 USDC and 20 settlements per session and 40 live Intercepta calls (`OPERATIONAL_GUARDRAILS.md`). The full demo procedure is [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

## What was demonstrated (recorded evidence)

All on Base Sepolia, 2026-09-26. Every settled payment was re-checked read-only against the chain (`pnpm verify:tx`). Nothing below was mocked; recorded means stored, not re-run.

| Claim | Evidence |
| --- | --- |
| Real 402, live Intercepta before the signer, one settled payment | tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`, `signerCalls=1` ([docs/evidence/M-004b_traces.json](docs/evidence/M-004b_traces.json)) |
| Intercepta-driven deny, zero signer calls | known-risk `payTo`: score 100, `known_scammer`, `DENY`, `signerCalls=0` (same file) |
| An approved policy v2 changes a new, freshly screened payment | v2 `CAP` below the quote, `signerCalls=0`; after rollback the same kind of attempt is paid under v1, tx `0xe06c820156f36f06d5a26a55fd6ee974448ae79c35d892c2f26c56dd3e4c70fa` ([docs/evidence/M-010_v2_run.json](docs/evidence/M-010_v2_run.json)) |
| The loop reproduces after a reset | txs `0x5f4d70a1...a4c5`, `0x3d0602d0...ecd8`, `0x2ba64242...b4ab` ([docs/evidence/M-011_v2_rerun_after_reset.json](docs/evidence/M-011_v2_rerun_after_reset.json)) |
| Fail closed on a real Intercepta timeout | one real 8 s timeout produced `HOLD`, `signerCalls=0` (`fixtures/intercepta/recorded/2026-09-26T15-45-44-474Z_0x39308ae4...json`) |

Raw Intercepta responses (no request headers) are stored under [fixtures/intercepta/recorded/](fixtures/intercepta/recorded/). The static site shows these traces with their recording times.

## Trust model and claim boundaries

- **CLEAR does not mean safe.** It means no disqualifying signal was returned for that address at that time. It says nothing about a merchant's honesty or delivery; settlement and delivery are shown separately.
- The tiers CLEAR, WARN and BLOCK are a **Risksir policy threshold** on Intercepta's `toxicScore` and traits (`quickscan-v1`, ADR-017), not an Intercepta verdict. Only scores 0 and 100 were ever observed; the WARN band rests on a labelled synthetic fixture.
- Replay metrics are **counterfactual** results on labelled cases with stated provenance. They are not real prevented losses.
- A testnet settlement with a screened mainnet address is two separate observations. It does not prove mainnet wrongdoing or a seller's real-world identity.
- The buyer agent is a deterministic task runner: no LLM has signing, approval or activation rights, and a policy becomes active only after replay and explicit owner approval.
- The signer is the only code path that reads the payer key. That is code-path isolation inside one backend process, enforced by static tests. It is not a process or security boundary, and the backend is trusted for correctness in this MVP.
- Not claimed: that Intercepta lacks custom rules or cannot learn, that we invented backtesting, or that this is the first safe x402 layer.


## Intercepta API feedback

DRAFT — human to review before submission. Written only from what we observed while integrating.

1. `quick-scan` returned only `toxicScore` 0 and 100 in all 20 successful live screens we recorded (14 at 0, 6 at 100); the docs give no score bands or recommended block threshold, so we had to choose one ourselves (80) and label it as our own policy threshold. A documented score/trait severity scale would remove that guesswork.
2. The docs list `txsCount` on traits, but none of the traits we received included it.
3. We found no documented error codes, rate limits or timeouts. One call timed out after 8 s (no HTTP status) while successful calls took 131 to 3216 ms. A documented 429/5xx body and a stated latency target would help pre-signing integrations decide their own timeout and fail-closed behaviour.
4. Repeated calls for the same address were identical and the trait names are stable, readable reasons: very usable as evidence to show a human. The plain GET-by-address shape was easy to place before an x402 signer.
5. The response has no field for which chain the address was interpreted on, and we screen an address that we settle on a testnet; an explicit network parameter or echo in the response would make "screen the payment recipient" unambiguous.

## Documents

| File | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Binding engineering contract (acceptance criteria and invariants) |
| [`DECISIONS.md`](DECISIONS.md) | Architecture decision records |
| [`TEST_PLAN.md`](TEST_PLAN.md) | How each AC and INV is proven |
| [`FINAL_VALIDATION.md`](FINAL_VALIDATION.md) | The submission checklist, PASS or FAIL with evidence |
| [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) | How to run and present the demo |
| [`OPERATIONAL_GUARDRAILS.md`](OPERATIONAL_GUARDRAILS.md) | Hard limits (networks, spend, secrets) |
| [`AGENTS.md`](AGENTS.md) | Technical operating guide |

Built with an autonomous Claude Code workflow (`CLAUDE.md`, `prompts/`).
