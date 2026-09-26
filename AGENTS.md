# AGENTS.md — Risksir technical operating guide

Short on purpose; reread every session. Product behaviour is in `SPEC.md`, rules in `CLAUDE.md`, hard limits in `OPERATIONAL_GUARDRAILS.md`. This file does not repeat them.

## Stack (detected 2026-09-26)

Node v24.18.0 (>= 20 required) · pnpm 12.6.0 (workspaces, pinned in `packageManager`) · TypeScript **~6.0.3** strict ESM (TS 7.0 breaks typescript-eslint, ADR-016) · vitest 5.0.2 · eslint 10.11 + typescript-eslint 8.70 · zod 4.6.5 · viem 2.56.9 · better-sqlite3 13.0.3 (prebuilt binary; build script disabled via `allowBuilds: false` in `pnpm-workspace.yaml`, no C++ toolchain here) · `@x402/core|fetch|evm|express` 2.27.0 · express 5.2.1 · tsx 4.23.15 · planned: Vite + React (recorded here when installed).

## Package manager rule

**pnpm only.** On this Windows machine plain `pnpm` is not on PATH (`corepack enable` gives EPERM), so run `corepack pnpm <cmd>` (ADR-014). Never use npm or yarn to install. pnpm auto-edits `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`); keep that.

## Repo map

| Path | Purpose |
| --- | --- |
| `packages/core` | `@risksir/core`: pure domain, fingerprint, policy engine, regression engine. No I/O |
| `apps/gate` | `@risksir/gate`: buyer agent, x402 gate, Intercepta adapter, protected signer (`src/signer/**` only), SQLite store, owner API |
| `apps/seller` | `@risksir/seller`: x402 paid routes |
| `apps/console` | `@risksir/console`: Vite + React owner console |
| `fixtures/intercepta/recorded/` | Real live responses only (no headers) |
| `fixtures/intercepta/synthetic/` | Hand-made responses, each with `"provenance": "synthetic"` |
| `fixtures/cases/` | Regression case datasets with provenance labels |
| `docs/spikes/` | `SPIKE_A/B/E` evidence notes |
| `scripts/` | `env-status.sh`, `guard-secrets.sh`, `live-guard.mjs`, `not-implemented.mjs` |
| `test/` | Repo-level hygiene tests |

## Commands

VERIFIED (run 2026-09-26): `corepack pnpm install`, `corepack pnpm verify` (tsc + eslint + vitest, offline, green), `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, `LIVE=1 corepack pnpm test:live` (runs `*.live.test.ts`; refuses without `LIVE=1`), `LIVE=1 corepack pnpm --filter @risksir/gate spike:a` (observe-only Intercepta probe), `corepack pnpm demo:smoke` (placeholder, exits 1 until M-011), `bash scripts/env-status.sh`.
Live/read-only tools (need `.env`, run through the root scripts): `corepack pnpm wallet:status` (public payer address and balances), `LIVE=1 corepack pnpm demo:pass|demo:block` (live Intercepta + real Base Sepolia payment within guardrails), `corepack pnpm verify:tx <hash>` (RPC receipt check), `corepack pnpm trace:export` (stored decision traces), `corepack pnpm --filter @risksir/seller start` (local seller). Not yet defined: console `dev`/`build`, `seed`, `reset`, `demo:v2`, `demo:smoke`.

## Framework-docs rule

Do not rely on remembered SDK behaviour. Before using x402, viem, better-sqlite3 or the W3A API, read the **installed** package types/source and the official docs (docs.x402.org, docs.web3antivirus.io, viem.sh), and record what you found in the spike note or an ADR.

## Abstractions that must be reused (created in the named milestone)

| Abstraction | Home | Milestone |
| --- | --- | --- |
| Attempt/permit/approval/reservation/decision/policy state machines (`assertTransition`) | `packages/core/src/state.ts` | M-004b ✓ |
| Money (`bigint` atomic units, decimal strings): `parseAtomic`, `formatAtomic`, `usdcStringToAtomic` | `packages/core/src/money.ts` | M-001 ✓ |
| The one quote/policy/dataset/report hash helper: `hashQuote`, `sealPolicy`, `hashDataset`, `sealReport` (+ `canonicalJson`) | `packages/core/src/fingerprint.ts`, `canonical.ts` | M-001 ✓ |
| zod schemas for every type in SPEC §7 (+ provenance helpers) | `packages/core/src/types.ts`, `provenance.ts` | M-001 ✓ |
| `evaluateLocal()` (stage A) / `evaluate()` / `evaluateFailClosed()` policy engine, `validateCandidate()`, demo policy v1 and candidates A/B/C | `packages/core/src/policy` | M-002 ✓ |
| Intercepta client `screenAddress()`, `quickScanMapper`, `FileBudget`, `writeRecordedResponse()` | `apps/gate/src/intercepta` | M-003 ✓ |
| Signer interface: `createProtectedSigner(deps).forAttempt(attemptId)` returns `{ address, signTypedData }` only (the gate arms a `SigningPermit` in the store; the signer checks it, tables A/B of SPEC §12); `SignerRefusedError`; `payerPublicAddress`; `readWalletStatus` | `apps/gate/src/signer/public.ts` (only entry point; `key.ts` and `guard.ts` are internal) | M-004 ✓ |
| SQLite `Store` (attempts with enforced state machines, evidence, decisions, reservations = the only spend ledger, signing permits, approvals, signer ledger, cases with label revisions, audit events, policies, active pointer) and its `SignerStore` view | `apps/gate/src/store/store.ts` | M-004 ✓, M-004b ✓ (M-006 extends) |
| `createGate(deps)` buyer gate: `run(task)`, `resumeWithApproval(attemptId, approvalId, task)`, `expireOverdue()`; local stage (`evaluateLocalFailClosed`) runs before any Intercepta call; `runBuyerTask`, `scenarioTask` | `apps/gate/src/x402/gate.ts`, `apps/gate/src/agent/runner.ts` | M-004 ✓ |
| `LiveSession` limits and `formatBanner` | `apps/gate/src/live/session.ts` | M-004 ✓ |

Search before creating; never add a second hash or money helper.

## Generated files (do not edit by hand)

`pnpm-lock.yaml`, everything under `node_modules/`, `dist/`, `build/`, `coverage/`, `data/*.db`, and files under `fixtures/intercepta/recorded/` (written by the live adapter only).

## Environment variables (names only; never open `.env`)

| Name | Purpose | Class |
| --- | --- | --- |
| `INTERCEPTA_API_KEY` | `X-API-KEY` for the W3A API | live-only, secret |
| `INTERCEPTA_BASE_URL` | W3A base URL (confirm in Spike A) | live-only |
| `PAYER_PRIVATE_KEY` | Fresh Base Sepolia payer key, read only in `apps/gate/src/signer` | live-only, secret |
| `BASE_SEPOLIA_RPC_URL` | Receipt/nonce reads | live-only |
| `X402_FACILITATOR_URL` | x402 test facilitator | live-only |
| `SELLER_PAY_TO_SAFE` / `_RISKY` / `_ALT` | Merchant `payTo` addresses (receive-only) | required for the demo |
| `OWNER_CONSOLE_TOKEN` | Bearer token for the owner API | required, secret |

Offline tests need none of them.

## External services, mocks and safe local behaviour

| Service | Mock available | Safe local behaviour |
| --- | --- | --- |
| Intercepta | recorded/synthetic fixtures (labelled, never live) | Missing key/URL ⇒ tier `UNAVAILABLE` ⇒ HOLD |
| x402 seller | local `apps/seller` | localhost only |
| Facilitator | stub in tests | offline tests never call a live facilitator |
| Base Sepolia RPC | none | reconciliation disabled offline |

## Chain config source

One module (`apps/gate/src/chain.ts`, M-004 ✓) holds `eip155:84532` and the USDC address from `OPERATIONAL_GUARDRAILS.md` §2, confirmed against docs.x402.org. The signer enforces it independently.

## Git hygiene

Explicit paths only (`git add <paths>`); conventional commits; commit and `git push origin HEAD` after every verified milestone; never `--no-verify`, force push, amend pushed commits, rebase, `reset --hard`, `clean`; `.env*` is never staged (hook: `.githooks/pre-commit`).
