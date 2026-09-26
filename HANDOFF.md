AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 1. (Optional) Run `corepack enable` once in an admin shell so plain `pnpm` works; until then everything runs as `corepack pnpm`. 2. Keep the payer wallet `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` at or below 20 test USDC (currently 19.94). 3. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator. 4. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 5. Make the GitHub repo public before submission.

# HANDOFF — Risksir

Last updated: 2026-09-26 (CI repair for `a97e48b`). If this file disagrees with the repository, the repository wins.

## 1. Current Objective

Bootstrap contract written and pushed; M-000–M-005 VERIFIED: the **prize path is done and live-verified** (real 402, live Intercepta, one settled Base Sepolia payment, one Intercepta-driven DENY with signerCalls=0, persisted traces). Next: M-006 (store hardening, reconciliation), M-007 (regression engine and dataset), M-008 (policy lifecycle), M-009 (console), then M-010 (Layer 4 live proof).

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`.
- Pushed through `a97e48b` (M-003 Intercepta adapter and Spike A evidence), following the contract, scaffold, core domain and policy commits.
- Scaffold, core domain, policy engine and Intercepta adapter present. Concurrent, uncommitted M-004 work is outside the CI repair and its validation evidence.

## 3. VERIFIED Working

- Remote reachable and `main` pushed (`git push -u origin HEAD`, exit 0). Hooks path is `.githooks`; the pre-commit secret guard ran on the first commit.
- `bash scripts/env-status.sh`: all nine variable **names** are SET (values never inspected).
- Tools: Node v24.18.0, npm 11.16.0, corepack 0.35.0, pnpm 12.6.0 via `corepack pnpm`.
- M-004/M-005 (Spike B + prize checkpoint): live pass tx `0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b` (Base Sepolia block 47331424, RPC receipt success, USDC Transfer 50000 payer to SAFE, `signerCalls=1`); live block attempt `aae1f854-7804-4135-b0c1-c811d182cad0` DENY `signerCalls=0`. Evidence: `docs/evidence/M-005_*`, `docs/spikes/SPIKE_B_X402.md`, ADR-018. Payer wallet 19.94 test USDC after.
- M-003 (Spike A): live-verified Intercepta address screen. SAFE `toxicScore 0` ⇒ CLEAR, RISKY `toxicScore 100` (`known_scammer`, `attack_money_target`) ⇒ BLOCK; two reproducible pairs, raw files in `fixtures/intercepta/recorded/`, 4 of 40 calls used; `docs/spikes/SPIKE_A_INTERCEPTA.md`, ADR-017.
- M-002: deterministic five-action policy engine, candidate validation and demo policies unit-tested (228 tests total, mutation-checked).
- M-001: core domain (money, canonical JSON, the single hash helper, zod schemas, provenance) unit-tested: 102 tests green.
- M-000: `corepack pnpm verify` green offline (tsc + eslint + vitest, 4 tests); `test:live` refuses without `LIVE=1`; `demo:smoke` fails by design until M-011. TypeScript pinned to ~6.0.3 (ADR-016).

## 4. Implemented, Not Verified

M-004 dependency, seller, store and signer work is present in the working tree; it is not part of the CI repair or the verified M-003 snapshot.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint | green (`corepack pnpm verify`, 2026-09-26) |
| unit / integration | 350 tests green (core, policy engine, Intercepta adapter + mapper, signer matrix, key isolation, live-session guard, gate integration against a real local seller + stub facilitator) |
| live | `LIVE=1 pnpm test:live` T-060 passed (Intercepta); `LIVE=1 pnpm demo:block` and `demo:pass` ran 2026-09-26 (see evidence) |
| demo smoke | not run |

CI repair validation: an isolated export of `a97e48b` plus the two CI fixes passes `CI=true corepack pnpm install --frozen-lockfile --offline` and `corepack pnpm verify` (11 files, 265 tests). The exported lockfile is unchanged; no live calls were made. A fresh GitHub run must confirm the Linux result after push.

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | **live**, inside the payment flow (6 of 40 calls used this session: `data/intercepta-calls.json`) |
| x402 seller | **live** local `@x402/express` seller on 127.0.0.1 (real 402 and settlement); stub facilitator in tests only |
| Facilitator | **live** (the facilitator configured in `X402_FACILITATOR_URL`; one successful settle observed; failure modes only via the stub) |
| Base Sepolia RPC + payer wallet | **live**: funded (19.94 test USDC, 0.1 ETH after the run); payer public address `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` |

## 7. Known Issues

- Plain `pnpm` is not on PATH (`corepack enable` gives EPERM); use `corepack pnpm` (ADR-014).
- `gh` CLI not installed; pushes use the credential manager.
- CI [run 36245757448](https://github.com/angelphoon7/ethonline20266/actions/runs/36245757448) for `a97e48b` failed at dependency installation. Reproduced `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`: `allowBuilds.esbuild` was still a placeholder. Set it to `true`; then fixed the previously hidden lint error by importing `URL` from `node:url` in `scripts/live-guard.mjs`. Local isolated verification is green; remote confirmation pending push.
- git identity is `angelphoon7@gmail.com`; the session account email differs. Confirm the address is linked to the GitHub account so commits are attributed.

## 8. Blockers

- Human decision: none. Credentials: none missing. Technical: none. External: sponsor confirmations (HUMAN_ACTIONS 3–4). The wallet is funded (HUMAN_ACTION 2 satisfied).

## 9. Recent Decisions

ADR-001…ADR-017 in `DECISIONS.md` (name, Intercepta load-bearing, rail, offchain governance, triggers A+C, deterministic engines, fail-closed + tier mapping, CAP semantics, stack, autonomous mode, credential-free-first, demo thresholds, engine defaults, `corepack pnpm`, signer defence in depth, TypeScript ~6.0.3, Intercepta tier mapping).

## 10. Next

1. M-006: two-connection reservation concurrency test, chain-based reconciliation of ambiguous settlements, label revisions and audit events.
2. M-007: regression engine (SPEC section 13) and the labelled dataset built from stored snapshots (use the two real_live cases from `docs/evidence`).
3. M-008: candidate approval, atomic activation, rollback, owner API with bearer auth.
4. M-009: owner console (decision trace, signer badge, regression comparison).
5. M-010: live Layer 4 proof (approved v2 changes a fresh ALT attempt; rollback).

## 11. Do Not Repeat

- Do not open `.env`; use `bash scripts/env-status.sh`.
- Do not run `corepack enable` (EPERM); use `corepack pnpm`.
- Do not create a second "first commit"; `215f766` already exists and is pushed (no history rewrite).
- Do not guess x402 hook behaviour; read the installed package types. Intercepta fields are now observed (Spike A); the mid band (score 1–99), 401/429/5xx and rate limits are still unobserved.
- `data/intercepta-calls.json` counts live Intercepta calls (6/40 used) and `data/live-session.json` the live spend (1 settlement, 0.05 USDC); delete them only at a new session start.
- Do not re-run `demo:pass` needlessly: each run spends 0.05 test USDC and the SAFE payTo is no longer a first-time counterparty in `data/risksir.db`.

## 12. SPEC Review Checklist (asynchronous, non-blocking; skim on GitHub)

- [ ] SPEC §9 evaluation order and hard prohibitions (steps 1–11), and the CAP-below-quote semantics.
- [ ] SPEC §12 signer checks 1–7 and the fixed-window budget model.
- [ ] SPEC §13 metric definitions and the counterfactual exposure model (ASK_HUMAN assumed not approved).
- [ ] SPEC Appendix A demo thresholds and candidates A/B/C (ADR-012).
- [ ] SPEC §21–22 AC list and the demo scene mapping; Scene 5 uses observed tier + context predicates only.
- [ ] SPEC §25 open questions and their conservative defaults.
- [ ] `EXECUTION_PLAN.md` additions: M-007 and M-009 on the critical path; a minimal SQLite store introduced in M-004.
