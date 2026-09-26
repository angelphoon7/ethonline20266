AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 1. (Optional) Run `corepack enable` once in an admin shell so plain `pnpm` works; until then everything runs as `corepack pnpm`. 2. Confirm the payer wallet (public address printed by M-004) holds Base Sepolia ETH and ≤ 20 test USDC. 3. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator. 4. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 5. Make the GitHub repo public before submission.

# HANDOFF — Risksir

Last updated: 2026-09-26 (bootstrap run). If this file disagrees with the repository, the repository wins.

## 1. Current Objective

Bootstrap contract written and pushed; M-000 (scaffold), M-001 (core domain) and M-002 (policy engine) VERIFIED. Next: M-003 (Spike A, live Intercepta), then down the critical path in `EXECUTION_PLAN.md`. Prize path first: M-003 → M-005.

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`.
- Pushed: `215f766` (agent pack and frozen docs). The contract commit adds `REPO_AUDIT.md`, `SPEC.md`, `DECISIONS.md`, `TEST_PLAN.md`, `EXECUTION_PLAN.md`, `HANDOFF.md`.
- Scaffold present (workspace, tooling, CI, README, `AGENTS.md`); no product logic yet.

## 3. VERIFIED Working

- Remote reachable and `main` pushed (`git push -u origin HEAD`, exit 0). Hooks path is `.githooks`; the pre-commit secret guard ran on the first commit.
- `bash scripts/env-status.sh`: all nine variable **names** are SET (values never inspected).
- Tools: Node v24.18.0, npm 11.16.0, corepack 0.35.0, pnpm 12.6.0 via `corepack pnpm`.
- M-002: deterministic five-action policy engine, candidate validation and demo policies unit-tested (228 tests total, mutation-checked).
- M-001: core domain (money, canonical JSON, the single hash helper, zod schemas, provenance) unit-tested: 102 tests green.
- M-000: `corepack pnpm verify` green offline (tsc + eslint + vitest, 4 tests); `test:live` refuses without `LIVE=1`; `demo:smoke` fails by design until M-011. TypeScript pinned to ~6.0.3 (ADR-016).

## 4. Implemented, Not Verified

Nothing. The docs are a contract, not evidence.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint | green (`corepack pnpm verify`, 2026-09-26) |
| unit / integration | 228 tests green (core domain, policy engine, hygiene); no gate tests yet |
| live | not run |
| demo smoke | not run |

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | none (key SET, unvalidated; endpoint/schema unknown until Spike A) |
| x402 seller | none |
| Facilitator | none (`X402_FACILITATOR_URL` SET, untested) |
| Base Sepolia RPC + payer wallet | none (funding unverified) |

## 7. Known Issues

- Plain `pnpm` is not on PATH (`corepack enable` gives EPERM); use `corepack pnpm` (ADR-014).
- `gh` CLI not installed; pushes use the credential manager.
- `.gitattributes` added in M-000 (`*.sh` and hooks forced to LF); CI workflow not yet observed running on GitHub.
- git identity is `angelphoon7@gmail.com`; the session account email differs. Confirm the address is linked to the GitHub account so commits are attributed.

## 8. Blockers

- Human decision: none. Credentials: none missing by name. Technical: none yet. External: sponsor confirmations (HUMAN_ACTIONS 3–4) and wallet funding (2).

## 9. Recent Decisions

ADR-001…ADR-016 in `DECISIONS.md` (name, Intercepta load-bearing, rail, offchain governance, triggers A+C, deterministic engines, fail-closed + tier mapping, CAP semantics, stack, autonomous mode, credential-free-first, demo thresholds, engine defaults, `corepack pnpm`, signer defence in depth, TypeScript ~6.0.3).

## 10. Next

1. M-003 (Spike A): Intercepta adapter, live screen of SAFE and RISKY (≤ 40 calls), record raw responses, write the tier-mapping ADR.
2. M-004 (Spike B): seller, gate, protected signer (needs a funded payer wallet).
3. M-005 prize checkpoint (live pass + live block).
4. M-006/M-007: store hardening and regression engine (credential-free).
5. M-008/M-009: lifecycle and console.

## 11. Do Not Repeat

- Do not open `.env`; use `bash scripts/env-status.sh`.
- Do not run `corepack enable` (EPERM); use `corepack pnpm`.
- Do not create a second "first commit"; `215f766` already exists and is pushed (no history rewrite).
- Do not guess Intercepta field names or x402 hook behaviour; read the response and the installed package types.

## 12. SPEC Review Checklist (asynchronous, non-blocking; skim on GitHub)

- [ ] SPEC §9 evaluation order and hard prohibitions (steps 1–11), and the CAP-below-quote semantics.
- [ ] SPEC §12 signer checks 1–7 and the fixed-window budget model.
- [ ] SPEC §13 metric definitions and the counterfactual exposure model (ASK_HUMAN assumed not approved).
- [ ] SPEC Appendix A demo thresholds and candidates A/B/C (ADR-012).
- [ ] SPEC §21–22 AC list and the demo scene mapping; Scene 5 uses observed tier + context predicates only.
- [ ] SPEC §25 open questions and their conservative defaults.
- [ ] `EXECUTION_PLAN.md` additions: M-007 and M-009 on the critical path; a minimal SQLite store introduced in M-004.
