# DECISIONS — Risksir architecture decision records

Each ADR extracts a decision that already exists in `docs/07_PROJECT_FREEZE.md` (07), `docs/08_SYSTEM_DEPENDENCY_DESIGN.md` (08), `docs/PRIZE_ANCHOR_INTERCEPTA.md` (PA), `OPERATIONAL_GUARDRAILS.md` (G), the bootstrap prompt, or is an agent default under `CLAUDE.md` §5 (the human may override). No history is invented. "Evidence" means something observed or documented; "Preference" is a judgement.

Status vocabulary: Accepted | Accepted (agent default) | Open. New ADRs append at the bottom.

---

## ADR-001 — The name is Risksir
- **Status:** Accepted. **Date:** 2026-09-26.
- **Context:** Earlier drafts used other names; 07 fixes the public name.
- **Decision:** Product, repo, package scope `@risksir/*`, UI and docs all say **Risksir**.
- **Rationale:** *Evidence:* 07 header "Project name: Risksir". *Preference:* one name avoids stale strings.
- **Alternatives:** keep a codename. **Why not chosen:** 07 names it final.
- **Consequences:** a grep for old names must return nothing (bootstrap Step 7).
- **Reversibility:** easy (search/replace). **Source:** 07, `CLAUDE.md`.

## ADR-002 — The Intercepta pre-sign path is load-bearing; the regression loop is the differentiation
- **Status:** Accepted. **Date:** 2026-09-26.
- **Context:** The prize needs a live Intercepta call before signing that changes the action; the freeze adds a closed regression loop.
- **Decision:** Layer 1 (live Intercepta screen of the exact `payTo` before any signer call) has top priority and works without the regression subsystem. Layers 3–4 are built after Layer 1 works and never replace it.
- **Rationale:** *Evidence:* PA states the pre-sign path "exists independently of the regression subsystem"; 07 §13 says only Layer 1 working is "a sponsor integration". *Preference:* protect the qualifying demo first.
- **Alternatives:** build the loop first. **Why not chosen:** the prize is unreachable without Layer 1.
- **Consequences:** `EXECUTION_PLAN.md` keeps the prize path first (M-003…M-005).
- **Reversibility:** human-only (sponsor dependency). **Source:** PA, 07 §13, `CLAUDE.md` §2.

## ADR-003 — Payment rail: x402 `exact` EIP-3009 USDC on Base Sepolia via the official TypeScript SDK and test facilitator
- **Status:** Accepted. **Date:** 2026-09-26.
- **Context:** A real 402 and testnet settlement are required; mainnet funds are forbidden.
- **Decision:** `exact` scheme, network `eip155:84532`, official USDC contract from `[G §2]` (confirmed against x402 docs in Spike B), packages named in 08 §9 (`@x402/core`, `@x402/fetch`, `@x402/evm`, `@x402/express`), facilitator from `X402_FACILITATOR_URL`.
- **Rationale:** *Evidence:* 08 §9 and §11, `[G §2]`. Package names and versions are **unverified** until Spike B.
- **Alternatives:** Permit2; another chain. **Why not chosen:** Permit2 reopens the signer threat model (08 §6); multi-chain is a non-goal.
- **Consequences:** ADR to record exact versions and hook semantics after Spike B.
- **Reversibility:** network substitution possible with human approval. **Source:** 08 §6, §9, `[G §2]`.

## ADR-004 — Governance stays offchain; no smart contracts
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** Policy versions, approvals, rollback, labels and audit live in a company-owned SQLite database. No contracts, no onchain policy registry, no attestation.
- **Rationale:** *Evidence:* 08 §4 ("Optional public policy attestation: Excluded"), 07 §28. *Preference:* nothing onchain improves the frozen promise.
- **Alternatives:** onchain registry. **Why not chosen:** adds a transaction without improving the promise or sponsor fit.
- **Consequences:** Risksir is trusted offchain governance around an onchain payment; never claimed as decentralised.
- **Reversibility:** requires explicit architecture review. **Source:** 08 §4, §12.

## ADR-005 — MVP feedback triggers are A and C; Trigger B is optional
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** Build Trigger A (live pre-sign decision) and Trigger C (owner incident/dispute label). Trigger B (later re-screen) only if time remains and the API supports it. Trigger D is not built.
- **Rationale:** *Evidence:* 07 §7 "Implement A + one of B/C"; API support for history/webhooks is not established (07 §20). *Preference:* C needs no unverified API.
- **Alternatives:** A+B. **Why not chosen:** depends on unverified Intercepta capabilities.
- **Consequences:** incident cases come from owner labels with provenance.
- **Reversibility:** easy. **Source:** 07 §7, 08 §11.

## ADR-006 — Engines are deterministic; AI is optional and non-authoritative
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** Policy engine and regression engine are pure functions with time and data passed in. No LLM signs, approves or activates. An analyst that only explains or proposes is optional (COULD).
- **Rationale:** *Evidence:* 07 §1 "AI role", 07 §19, `CLAUDE.md` §7/§11. *Preference:* reproducible reports.
- **Alternatives:** LLM proposes and activates. **Why not chosen:** breaks INV-016.
- **Consequences:** INV-016, INV-023 with tests.
- **Reversibility:** human-only. **Source:** 07 §1, §19.

## ADR-007 — Fail closed on missing evidence; the tier mapping is Risksir policy over observed fields
- **Status:** Accepted (agent default for the mapping). **Date:** 2026-09-26.
- **Context:** 08 §9 says the quick-scan is a toxic score, **not** a guaranteed `CLEAR/WARN/BLOCK` schema; 07 uses those names only as examples.
- **Decision:** Any error, timeout, 429, malformed, empty or stale evidence is tier `UNAVAILABLE` ⇒ HOLD. Until Spike A records real responses the mapper returns `UNAVAILABLE(MALFORMED)` for every real response and accepts only files under `fixtures/intercepta/synthetic/`. Tiers `CLEAR|WARN|BLOCK` are a Risksir mapping, never presented as an Intercepta claim. `CLEAR` means "no disqualifying observed signal", not "safe".
- **Rationale:** *Evidence:* 08 §9, 07 §8, 07 §19. *Preference:* the most conservative option consistent with the freeze.
- **Alternatives:** guess field names; treat unknown as CLEAR. **Why not chosen:** guessing violates `CLAUDE.md` §4; unknown-as-pass violates INV-003.
- **Consequences:** an ADR after Spike A records observed fields and thresholds.
- **Reversibility:** mapping change = new ADR + `mappingVersion` bump. **Source:** 07 §8, 08 §9, `CLAUDE.md` §5.

## ADR-008 — CAP is a maximum authorised amount, never a price reduction
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** `CAP` sets `capAtomic`. An `exact` quote at or below the cap is eligible; above it the attempt is not signer-eligible (reason `CAP_BELOW_QUOTE`) unless a genuinely advertised cheaper requirement is newly selected and screened again (not implemented in MVP, Q-010).
- **Rationale:** *Evidence:* 08 §2 last paragraph; x402 `exact` prices are fixed by the seller. *Preference:* avoid inventing payment semantics.
- **Alternatives:** silently sign a lower amount. **Why not chosen:** the seller would reject it and it changes payment semantics.
- **Consequences:** INV-002 counts CAP-below-quote as zero signer calls.
- **Reversibility:** human-only (semantics of the five actions). **Source:** 08 §2.

## ADR-009 — Default stack and owner authentication
- **Status:** Accepted (stack selected by the human in the bootstrap prompt). **Date:** 2026-09-26.
- **Decision:** Node (installed version ≥ 20), pnpm workspaces, TypeScript strict ESM, vitest, minimal eslint, zod, viem. `packages/core` (pure), `apps/gate` (buyer agent, x402 gate, Intercepta adapter, protected signer in `src/signer/**`, SQLite via better-sqlite3, owner HTTP API), `apps/seller` (`@x402/express`), `apps/console` (Vite + React). Owner auth is a bearer `OWNER_CONSOLE_TOKEN`, hackathon-grade but real.
- **Rationale:** *Evidence:* bootstrap prompt "Default stack", 08 §10 (SQLite adequate if serialised). *Preference:* synchronous SQLite makes reservations serial.
- **Alternatives:** Postgres, separate signer service. **Why not chosen:** more moving parts (08 §3 says modules with a key boundary suffice).
- **Consequences:** deviations need an ADR citing a verified SDK constraint.
- **Reversibility:** with an ADR. **Source:** bootstrap prompt, 08 §3, §10.

## ADR-010 — Autonomous mode: no review gate; commit and push to `main`
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** No human review gate between contract and build. Every verified milestone is committed and pushed to `main`; the human reviews asynchronously on GitHub. `pnpm verify` must be green before a feature push.
- **Rationale:** *Evidence:* `CLAUDE.md` §1/§9, bootstrap prompt. *Preference:* conservative product choices because nobody gates them.
- **Alternatives:** PR per milestone. **Why not chosen:** solo hackathon repo, human choice.
- **Consequences:** the pre-commit secret guard is mandatory and never bypassed.
- **Reversibility:** human instruction. **Source:** `CLAUDE.md` §1, §9.

## ADR-011 — Credential-free modules may be built before the P0 spikes pass
- **Status:** Accepted (human-accepted risk). **Date:** 2026-09-26.
- **Context:** 08 §11/§12 exit gate says do not start full implementation until P0 passes.
- **Decision:** Build M-000…M-002 and M-006…M-009 before Spikes A/B complete, for time reasons. A kill condition (07 §22) still stops the build immediately.
- **Rationale:** *Evidence:* bootstrap prompt names this deviation. *Preference:* time.
- **Alternatives:** wait for the spikes. **Why not chosen:** the credentials exist (`env-status` shows all names SET) but time is short; the human accepted the risk.
- **Consequences:** engines may need adjustment after Spike A/B; risk recorded in `EXECUTION_PLAN.md` P0/P1 risks.
- **Reversibility:** n/a. **Source:** bootstrap prompt.

## ADR-012 — Demo policy thresholds are scaled to testnet amounts
- **Status:** Accepted (agent default). **Date:** 2026-09-26.
- **Context:** 07 §3 examples use 100 USDC; `[G §4]` caps a live payment at 0.10 USDC and a session at 1.00 USDC / 20 settlements.
- **Decision:** Use the constants in SPEC Appendix A (all in USDC atomic units, 6 decimals). Profile v1 caps: 100000 per payment, 500000 per period. Candidates A/B/C and the incident case are defined there.
- **Rationale:** *Evidence:* `[G §4]`, 07 §3 ("illustrative"). *Preference:* the smallest numbers that still show a different decision at 0.05 vs 0.01 USDC.
- **Alternatives:** larger simulated amounts. **Why not chosen:** live spend limits.
- **Consequences:** re-check against `[G §4]` before every live run.
- **Reversibility:** easy, new ADR. **Source:** `[G §4]`, 07 §3, §17.

## ADR-013 — Engine and gate defaults
- **Status:** Accepted (agent default). **Date:** 2026-09-26.
- **Decision:** `EVIDENCE_FRESHNESS_S=30`, `DECISION_TTL_S=60`, `APPROVAL_TTL_S=600`, `INTERCEPTA_TIMEOUT_MS=8000` with **no automatic retry** (calls are budgeted to 40 per session), fixed period windows (`periodKey = floor(epochSeconds / periodSeconds)`), `defaultAction ∈ {HOLD, ASK_HUMAN, DENY}` (a default that pays is invalid), an approval never bypasses hard prohibitions, evaluation order as in SPEC §9.
- **Rationale:** *Evidence:* 08 §8 (short validity window, residual time-of-check gap), `[G §5]`. *Preference:* smallest windows that a demo can meet; fixed windows are simpler to reserve against than rolling ones.
- **Alternatives:** rolling windows, retries. **Why not chosen:** complexity and budget burn.
- **Consequences:** documented residual gap between screen and settlement (08 §8).
- **Reversibility:** easy, new ADR. **Source:** 08 §8, `[G §5]`.

## ADR-014 — pnpm is invoked as `corepack pnpm` on this machine
- **Status:** Accepted (agent default). **Date:** 2026-09-26.
- **Context:** `corepack enable` fails with `EPERM` writing `C:\Program Files\nodejs\pnpx`; `corepack pnpm --version` works (pnpm 12.6.0, downloaded on first use). Guardrails forbid global installs other than enabling pnpm via corepack.
- **Decision:** Use `corepack pnpm ...` for install/verify commands here; scripts and docs also work with plain `pnpm` where it is available. `packageManager` is pinned in the root `package.json` to the detected version.
- **Rationale:** *Evidence:* observed EPERM and the working command (REPO_AUDIT).
- **Alternatives:** run an elevated shell; `npm i -g pnpm`. **Why not chosen:** needs elevation / violates `[G §8]`.
- **Consequences:** a human may run `corepack enable` once in an admin shell (HUMAN_ACTIONS, optional).
- **Reversibility:** trivial. **Source:** REPO_AUDIT, `[G §8]`.

## ADR-015 — Defence in depth: the viem account itself refuses to sign without a bound decision
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** In addition to the SDK `onBeforePaymentCreation` hook, the x402 client is given a guarded viem account whose `signTypedData` refuses unless a stored decision binds the identical quote (SPEC §12). The hook is never the only guard.
- **Rationale:** *Evidence:* `CLAUDE.md` §7; hook timing is unverified until Spike B (08 §11 P0). *Preference:* INV-002 must hold even if a hook misbehaves.
- **Alternatives:** hook only. **Why not chosen:** a hook bypass would break the product (07 §9).
- **Consequences:** typed-data field checks depend on the observed EIP-3009 typed data shape (Spike B).
- **Reversibility:** human-only (weakens INV-002/004). **Source:** `CLAUDE.md` §7, 07 §9, 08 §11.
