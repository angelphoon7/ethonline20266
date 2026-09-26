# AGENTS.md — Risksir technical operating guide

Short on purpose; reread every session. Product behaviour is in `SPEC.md`, rules in `CLAUDE.md`, hard limits in `OPERATIONAL_GUARDRAILS.md`. This file does not repeat them.

## Stack (detected 2026-09-26)

Node v24.18.0 (>= 20 required) · pnpm 12.6.0 (workspaces, pinned in `packageManager`) · TypeScript **~6.0.3** strict ESM (TS 7.0 breaks typescript-eslint, ADR-016) · vitest 5.0.2 · eslint 10.11 + typescript-eslint 8.70 · zod 4.6.5 (in `@risksir/core`) · planned: viem, better-sqlite3, `@x402/*`, Vite + React (versions are recorded here when each is first installed).

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

VERIFIED (run 2026-09-26): `corepack pnpm install`, `corepack pnpm verify` (tsc + eslint + vitest, offline, green), `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm test:live` (refuses without `LIVE=1`; currently exits 1 because no live test exists), `corepack pnpm demo:smoke` (placeholder, exits 1 until M-011), `bash scripts/env-status.sh`.
Not yet defined: per-app `dev`/`build` (added with the app that needs them, then listed here).

## Framework-docs rule

Do not rely on remembered SDK behaviour. Before using x402, viem, better-sqlite3 or the W3A API, read the **installed** package types/source and the official docs (docs.x402.org, docs.web3antivirus.io, viem.sh), and record what you found in the spike note or an ADR.

## Abstractions that must be reused (created in the named milestone)

| Abstraction | Home | Milestone |
| --- | --- | --- |
| Money (`bigint` atomic units, decimal strings): `parseAtomic`, `formatAtomic`, `usdcStringToAtomic` | `packages/core/src/money.ts` | M-001 ✓ |
| The one quote/policy/dataset/report hash helper: `hashQuote`, `sealPolicy`, `hashDataset`, `sealReport` (+ `canonicalJson`) | `packages/core/src/fingerprint.ts`, `canonical.ts` | M-001 ✓ |
| zod schemas for every type in SPEC §7 (+ provenance helpers) | `packages/core/src/types.ts`, `provenance.ts` | M-001 ✓ |
| `evaluate()` policy engine | `packages/core/src/policy` | M-002 |
| Intercepta client | `apps/gate/src/intercepta` | M-003 |
| Signer interface (`createGuardedAccount`, `runWithDecision`) | `apps/gate/src/signer/public.ts` | M-004 |

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

One module (created in M-004, `apps/gate/src/chain.ts`) holds `eip155:84532` and the USDC address from `OPERATIONAL_GUARDRAILS.md` §2, confirmed against docs.x402.org. The signer enforces it independently.

## Git hygiene

Explicit paths only (`git add <paths>`); conventional commits; commit and `git push origin HEAD` after every verified milestone; never `--no-verify`, force push, amend pushed commits, rebase, `reset --hard`, `clean`; `.env*` is never staged (hook: `.githooks/pre-commit`).
