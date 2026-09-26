AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 1. (Optional) Run `corepack enable` once in an admin shell so plain `pnpm` works; until then everything runs as `corepack pnpm`. 2. Confirm the payer wallet (public address printed by M-004) holds Base Sepolia ETH and ≤ 20 test USDC. 3. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator. 4. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 5. Make the GitHub repo public before submission.

# HANDOFF — Risksir

Last updated: 2026-09-26 (bootstrap run). If this file disagrees with the repository, the repository wins.

## 1. Current Objective

Bootstrap contract is written. Next: build `M-000` (scaffold) then continue down the critical path in `EXECUTION_PLAN.md`. Prize path first: M-000 → M-005.

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`.
- Pushed: `215f766` (agent pack and frozen docs). The contract commit adds `REPO_AUDIT.md`, `SPEC.md`, `DECISIONS.md`, `TEST_PLAN.md`, `EXECUTION_PLAN.md`, `HANDOFF.md`.
- No application code exists yet.

## 3. VERIFIED Working

- Remote reachable and `main` pushed (`git push -u origin HEAD`, exit 0). Hooks path is `.githooks`; the pre-commit secret guard ran on the first commit.
- `bash scripts/env-status.sh`: all nine variable **names** are SET (values never inspected).
- Tools: Node v24.18.0, npm 11.16.0, corepack 0.35.0, pnpm 12.6.0 via `corepack pnpm`.

## 4. Implemented, Not Verified

Nothing. The docs are a contract, not evidence.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint | none yet (no code) |
| unit / integration | none yet |
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
- `.gitattributes` is missing, so LF/CRLF warnings appear; M-000 adds `*.sh text eol=lf`.
- git identity is `angelphoon7@gmail.com`; the session account email differs. Confirm the address is linked to the GitHub account so commits are attributed.

## 8. Blockers

- Human decision: none. Credentials: none missing by name. Technical: none yet. External: sponsor confirmations (HUMAN_ACTIONS 3–4) and wallet funding (2).

## 9. Recent Decisions

ADR-001…ADR-015 in `DECISIONS.md` (name, Intercepta load-bearing, rail, offchain governance, triggers A+C, deterministic engines, fail-closed + tier mapping, CAP semantics, stack, autonomous mode, credential-free-first, demo thresholds, engine defaults, `corepack pnpm`, signer defence in depth).

## 10. Next

1. M-000: pnpm workspace, TS strict, vitest, eslint, CI, README, `AGENTS.md`, `.gitattributes`; `corepack pnpm verify` green.
2. M-001: core domain types, money, canonical fingerprint, provenance.
3. M-002: deterministic policy engine with tests first for fail-closed rows.
4. M-003 (Spike A): live Intercepta screen of SAFE and RISKY; record raw responses; write the tier-mapping ADR.
5. M-004 (Spike B): seller, gate, protected signer; then M-005 prize checkpoint.

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
