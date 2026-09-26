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
- **Decision:** Any error, timeout, 429, malformed, empty or stale evidence is tier `UNAVAILABLE` ⇒ HOLD. Until Spike A records real responses the mapper returns `UNAVAILABLE(MALFORMED)` for every real response and accepts only files under `fixtures/intercepta/synthetic/` (superseded in part by ADR-017 and ADR-023 once responses were recorded). Tiers `CLEAR|WARN|BLOCK` are a Risksir mapping, never presented as an Intercepta claim. `CLEAR` means "no disqualifying observed signal", not "safe".
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
- **Decision:** `EVIDENCE_FRESHNESS_S=30`, `DECISION_TTL_S=60`, `APPROVAL_TTL_S=600`, `INTERCEPTA_TIMEOUT_MS=8000` with **no automatic retry** (calls are budgeted to 40 per session), fixed period windows (`periodKey = floor(epochSeconds / periodSeconds)`), `defaultAction ∈ {HOLD, ASK_HUMAN, DENY}` (a default that pays is invalid), an approval never bypasses hard prohibitions, evaluation order as in SPEC §9, evidence about a different address than the quote `payTo` is unusable (HOLD), evidence captured after `now` is stale, and a candidate may tighten limits but never loosen them (per-payment and period caps not above the base, per-payment not above the `[G §4]` limit).
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
- **Amended 2026-09-26 (human request):** plain `pnpm` now works. `corepack enable` still fails with EPERM for `C:\Program Files\nodejs`, so the shims were installed into the user-writable directory already on PATH with `corepack enable --install-directory "%APPDATA%\npm"` (no elevation, no global package install; `pnpm --version` prints 12.6.0 and `pnpm verify` is green). `corepack pnpm ...` keeps working.

## ADR-015 — Defence in depth: the viem account itself refuses to sign without a bound decision
- **Status:** Accepted. **Date:** 2026-09-26.
- **Decision:** In addition to the SDK `onBeforePaymentCreation` hook, the x402 client is given a guarded viem account whose `signTypedData` refuses unless a stored decision binds the identical quote (SPEC §12). The hook is never the only guard.
- **Rationale:** *Evidence:* `CLAUDE.md` §7; hook timing is unverified until Spike B (08 §11 P0). *Preference:* INV-002 must hold even if a hook misbehaves.
- **Alternatives:** hook only. **Why not chosen:** a hook bypass would break the product (07 §9).
- **Consequences:** typed-data field checks depend on the observed EIP-3009 typed data shape (Spike B).
- **Reversibility:** human-only (weakens INV-002/004). **Source:** `CLAUDE.md` §7, 07 §9, 08 §11.
- **Amended by ADR-019 and ADR-024 (human review 2026-09-26):** the guard is now a single-use signing permit checked against a stored quote, and its isolation is described as code-path isolation, not a security boundary.

## ADR-016 — TypeScript is pinned to ~6.0.3
- **Status:** Accepted (agent default). **Date:** 2026-09-26.
- **Context:** `npm view typescript version` returns 7.0.2, but `typescript-eslint@8.70.1` throws "does not support TS 7.0" at load, so `eslint` (part of `pnpm verify`) fails.
- **Decision:** Pin `typescript` to `~6.0.3` in the root `package.json`. Revisit when typescript-eslint supports TS >= 7.1 (issue linked in its error message).
- **Rationale:** *Evidence:* observed error output from `corepack pnpm verify` with TS 7.0.2, then green with 6.0.3. *Preference:* keep lint in the verify gate.
- **Alternatives:** run typescript-eslint against a side-by-side TS 6 API; drop typescript-eslint. **Why not chosen:** extra config / weaker lint.
- **Consequences:** none for runtime; tooling only.
- **Reversibility:** trivial. **Source:** observed output (M-000).

## ADR-017 — Intercepta quick-scan evidence mapping (`quickscan-v1`)
- **Status:** Accepted (agent default, resolves the OPEN item in ADR-007). **Date:** 2026-09-26.
- **Context:** Spike A observed `GET /api/public/v2/extension/account/{address}/quick-scan` returning `{ toxicScore, traits[{ risk, name, description }] }`. There is no verdict field. Observed scores: 0 with no traits (SAFE) and 100 with `known_scammer` (risk 100) and `attack_money_target` (risk 85) (RISKY). Two identical results per address.
- **Decision:** `BLOCK` when `toxicScore >= 80` or any trait `risk >= 80`; `WARN` for any other non-zero score or any trait; `CLEAR` only for score 0 with no traits; any body outside the observed schema is `UNAVAILABLE(MALFORMED)` (HOLD). Reasons are the trait names verbatim. Mapping version `quickscan-v1` is stored on every evidence record.
- **Rationale:** *Evidence:* `fixtures/intercepta/recorded/*` and `docs/spikes/SPIKE_A_INTERCEPTA.md`; only 0 and 100 were observed. *Preference:* the 80 threshold and "any signal is at least WARN" are the conservative reading (never turn an unseen signal into a pass).
- **Alternatives:** BLOCK only at exactly 100; use trait names as hard-block list. **Why not chosen:** 100 alone is too permissive for an unobserved band; a name list would rely on undocumented semantics.
- **Consequences:** The WARN band is unobserved, so demo Scene 5 relies on the observed CLEAR tier plus context predicates (SPEC §22). If a later live response falls in the mid band, add it to `fixtures/intercepta/recorded/` and revisit the threshold with a new ADR.
- **Reversibility:** easy: new ADR and a new `mappingVersion`. **Source:** SPIKE_A_INTERCEPTA.md, 08 §9, `CLAUDE.md` §5.
- **Amended by ADR-023 (human review 2026-09-26):** only the response shape at scores 0 and 100 is evidence. The 80 threshold and the WARN band are a Risksir policy default, not an Intercepta verdict, and the mid-band meaning is OPEN.

## ADR-018 — x402 stack, hook usage and settlement ordering (resolves Q-005, Q-006)
- **Status:** Accepted (agent default, resolves the spike-evidence OPEN items of ADR-003 and ADR-015). **Date:** 2026-09-26.
- **Context:** Spike B read the installed `@x402/core|fetch|evm|express` 2.27.0 sources and docs.x402.org, and ran a real Base Sepolia settlement.
- **Decision:** (1) Use `x402Client` + `ExactEvmScheme` (`@x402/evm/exact/client`) registered for `eip155:*`, wrapped by `wrapFetchWithPayment`. (2) The whole gate runs inside `onBeforePaymentCreation` (after requirement selection, before `scheme.createPaymentPayload`); returning `{ abort: true }` prevents signing. (3) The scheme receives only a guarded object `{ address, signTypedData }` (the protected signer), never a viem account. (4) SDK spend controls are tightened to `$0.10` per payment as an extra layer, but policy and signer enforce the network/asset/cap allowlist independently. (5) Keep the default **authorization** settlement ordering (verify, handler, settle); settlement and delivery are recorded separately. (6) `better-sqlite3` is used through its prebuilt binary; its `node-gyp` build script is disabled (`allowBuilds`) on this machine.
- **Rationale:** *Evidence:* `docs/spikes/SPIKE_B_X402.md` (source excerpts, live tx `0x1cf9ae6f...8e6b`, receipt check). *Preference:* keep SDK defaults where they are safe.
- **Alternatives:** `upfront` settlement; passing a viem `LocalAccount`; disabling SDK spend controls. **Why not chosen:** upfront settles before delivery is known; a raw account bypasses the guard; disabled controls remove a free layer.
- **Consequences:** Typed-data checks in the signer depend on the EIP-3009 shape observed in 2.27.0; a package upgrade must re-run the signer matrix.
- **Reversibility:** package or ordering change needs a new ADR and a re-run of the Spike B tests. **Source:** SPIKE_B_X402.md, `CLAUDE.md` section 4.

## ADR-019 — Single-use signing permit; typed data is checked against a stored quote (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** The EIP-3009 typed data contains only `from, to, value, validAfter, validBefore, nonce` and the domain `{ name, version, chainId, verifyingContract }` (observed, `@x402/evm` 2.27.0). It has no scheme, resource URL or attemptId, so a quote hash cannot be recomputed from it. The earlier SPEC wording said it could.
- **Decision:** The gate arms one single-use `SigningPermit` per attempt (`attemptId`, `decisionId`, stored `CanonicalQuote`, `quoteHash`, `policyVersion`, expiry). The signer (a) compares the typed data with that stored quote (`to == payTo`, `value == amount`, `verifyingContract == asset`, `chainId == 84532`, `from == payer`, `validBefore` within the quote validity and unexpired); (b) separately checks `decision.quoteHash == attempt.quoteHash`, the current active policy version, decision expiry and the held reservation; (c) consumes the permit atomically on use. Any mismatch refuses with `signerCalls` unchanged. One negative test per mismatch.
- **Rationale:** *Evidence:* installed SDK source (SPIKE_B_X402.md). *Preference:* bind the attempt/resource/scheme through data Risksir controls, not through fields the SDK never signs.
- **Alternatives:** keep the decision-id binding only; hash the typed data. **Why not chosen:** the former has no explicit single-use object and no stored quote to compare; the latter is impossible (fields are missing).
- **Consequences:** the current implementation (M-004) contradicts this wording in structure (no permit table, `authorise(decisionId)` binding) and gets fix milestone M-004b; Q-012 stays OPEN for the permit design until re-proven.
- **Reversibility:** human-only (INV-004/INV-027). **Source:** human review, SPEC §12, INV-027.

## ADR-020 — `awaiting_approval` and `expired` attempt states; approval resume (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** `ASK_HUMAN` was modelled as a HOLD-like `failed` end state, which loses the pending approval and makes the approval flow unimplementable.
- **Decision:** Add non-terminal `awaiting_approval` and terminal `expired`. An approval binds `attemptId`, `quoteHash`, `policyVersion` and an expiry. On approval: the approval must be active and unexpired; the gate obtains a current 402 for the same attempt whose quote must hash to the approved quote; a **fresh live Intercepta screen** is made; the decision is **re-evaluated under the current active policy**; only a `PAY` result reserves, arms a permit and signs, any other result is recorded as the new action. Approval or window expiry, or a policy-version change, makes the attempt `expired`. Hard prohibitions are never overridable. INV-017 is extended and INV-028 added.
- **Rationale:** *Evidence:* 08 §2 (approval "applies to this exact attempt and expires"; recheck live evidence before a delayed signature). *Preference:* the smallest state additions that keep the flow explicit.
- **Alternatives:** keep ASK_HUMAN as `failed` and require a brand-new attempt. **Why not chosen:** loses approval binding to the attempt and quote.
- **Consequences:** state tables, schema, store, gate and tests change (M-004b and M-008); the resumed request obtains a new 402, and the attemptId inside the quote hash keeps the approval bound to the same attempt.
- **Reversibility:** human-only (semantics of the five actions). **Source:** human review, SPEC §9, §11, INV-017, INV-028.

## ADR-021 — Spend ledger: reservation rows only (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Decision:** `SpendReservation` rows are the only ledger. `used(period) = Σ amountAtomic where status ∈ {reserved, reconciling, committed}`; `committed` means settled and settled payments are never summed separately. Policy evaluation receives `remaining = cap − used`, which excludes the current attempt (no reservation yet). The reservation is created in one serialised transaction that re-checks `used + amount ≤ cap`; failure means HOLD. `released` rows are excluded.
- **Rationale:** *Evidence:* 08 §8, 08 §11 P1 (concurrent attempts). *Preference:* one ledger cannot drift or double count.
- **Alternatives:** separate settled-spend table plus reservations. **Why not chosen:** double counting risk (the previous SPEC text summed settled plus committed).
- **Consequences:** the store sums `amountAtomic` (not `committedAtomic`) and requires `committedAtomic == amountAtomic` for `exact`; tests for release, commit, remaining and the re-check (T-035).
- **Reversibility:** with an ADR; INV-007 stays. **Source:** human review, SPEC §12, INV-007.

## ADR-022 — Local checks run before the Intercepta call (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** The earlier SPEC screened every parseable quote so that every Decision carried an evidence id. That spends the 40-call live budget on quotes that are rejected locally anyway.
- **Decision:** Stage A runs first and needs no evidence: scheme, network and asset allowlist, per-payment cap, service scope and quote validity (`QUOTE_MAX_VALIDITY_S = 600`). A rejected quote gets `DENY` or `HOLD` with **no Intercepta call**. INV-001 applies to attempts that can reach the signer. INV-009 is refined: a Decision records the evidence id whenever a screen was made, and a Decision without evidence is never signer-eligible. INV-029 added.
- **Rationale:** *Evidence:* `[G §5]` call budget; SPEC review. *Preference:* do not spend a live call where the answer cannot change the outcome.
- **Alternatives:** screen everything. **Why not chosen:** wastes budget; the human directed otherwise.
- **Consequences:** `evaluateLocal` split, `Decision.evidenceId` nullable with an eligibility refine, gate order change (M-004b). The wrong-network/asset integration tests must assert zero Intercepta calls.
- **Reversibility:** human-only (INV-001/INV-009 wording). **Source:** human review, SPEC §5, §9, INV-001, INV-009, INV-029.

## ADR-023 — Evidence gate for Spike A claims (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** Each item marked resolved by Spike A was checked against `docs/spikes/SPIKE_A_INTERCEPTA.md` and the six raw files in `fixtures/intercepta/recorded/` (all `real_live`, HTTP 200).
- **Decision:** *Real (kept resolved):* endpoint path and base origin `https://api.web3antivirus.io` (recorded `endpoint`, no query string); HTTP 200 with the `X-API-KEY` header; body shape `{ toxicScore, traits[{ risk, name, description }] }` at scores 0 and 100; reproducibility over 3 address pairs; latency 325–2814 ms. *Reverted to OPEN (not supported by the files):* meaning of scores between 0 and 100, the WARN band, where BLOCK should start (the value 80), `txsCount`, behaviour without the header, 401/429/5xx bodies, rate limits. Every score threshold is labelled "Risksir policy threshold (ADR-017), not an Intercepta verdict", including UI text.
- **Rationale:** *Evidence:* the six recorded files contain only scores 0 and 100 and no non-200 status. *Preference:* claim only what the data shows.
- **Alternatives:** keep Q-001 fully resolved. **Why not chosen:** the mapping's thresholds are not derived from observed data.
- **Consequences:** SPEC §10 and §25 (Q-001 partly resolved, Q-011 OPEN for rate limits), SPIKE_A doc and EXECUTION_PLAN M-003 evidence corrected; UI text rule in SPEC §20.
- **Reversibility:** an OPEN item closes with new recorded evidence plus an ADR. **Source:** human review, `fixtures/intercepta/recorded/*`.

## ADR-024 — Key isolation is code-path isolation, not a security boundary (human review 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Decision:** Describe the signer's key isolation as code-path isolation inside one backend process, enforced by static tests (only the signer reads `PAYER_PRIVATE_KEY`; agent, core and regression code cannot import it). It is not a process or security boundary; a compromised backend defeats it (08 §7).
- **Rationale:** *Evidence:* 08 §7 states the MVP is centrally trusted for correctness. *Preference:* do not overclaim.
- **Alternatives:** a separate signer process. **Why not chosen:** out of MVP scope (08 §3), and it would not remove the trust in the backend that arms permits.
- **Consequences:** wording changes in SPEC §6, §12, §18, INV-008, and README/claims later; no code change.
- **Reversibility:** wording only. **Source:** human review, 08 §7.

## ADR-025 — One static public showcase site on Vercel (explicit human approval 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** CLAUDE.md section 6 makes a public deployment a stop condition. The human approved ONE public deployment for the hackathon submission link: a static, read-only site (`apps/site`) deployed through Vercel's GitHub integration.
- **Decision:** `apps/site` is a Vite + React static build with no backend, no API route, no serverless function and no environment variable. It shows only redacted evidence already recorded (`scripts/export-site-data.ts` writes `apps/site/public/data/*.json` from the local case store). It never signs, pays or calls Intercepta, and every trace says "Recorded from a live run on <timestamp>". No Vercel CLI is run by the agent. The approval covers this site only and relaxes no other guardrail (the owner console and owner API stay localhost-only).
- **Rationale:** *Preference:* judges need a link; evidence must not be presented as live.
- **Alternatives:** no public page. **Why not chosen:** the human asked for it.
- **Consequences:** `vercel.json` at the repo root, `pnpm export:site`, site tests that scan the data and the build output for secret-like names, keys and signature-shaped values. Re-run `pnpm export:site` after new live runs and review the diff before committing.
- **Reversibility:** delete the Vercel project. **Source:** human instruction, CLAUDE.md section 6.

## ADR-026 — Payer balance ceiling raised from 20 to 100 test USDC (human instruction 2026-09-26)
- **Status:** Accepted (explicit human instruction). **Date:** 2026-09-26.
- **Context:** `OPERATIONAL_GUARDRAILS.md` section 3 capped the payer wallet at 20 test USDC. The wallet held 39.4 to 39.7 test USDC (testnet faucet top-ups), so `LIVE=1 pnpm demo:smoke` failed on the balance. The human asked for a higher ceiling.
- **Decision:** The balance ceiling is 100 test USDC (`PAYER_BALANCE_CEILING_ATOMIC` in `packages/core/src/constants.ts`, checked by the preflight). Nothing else changes: the wallet must still be a fresh dedicated Base Sepolia wallet that never held mainnet funds, and the spending limits stay 0.10 USDC per payment, 1.00 USDC and 20 settlements per session and 40 live Intercepta calls per session.
- **Rationale:** *Evidence:* testnet USDC has no monetary value and the per-session spend limits, not the balance, bound what a run can spend. *Preference:* the human's explicit choice.
- **Alternatives:** remove the ceiling. **Why not chosen:** a high ceiling keeps a hygiene check against accidentally funding the wallet heavily; the human can raise it again by editing the one constant.
- **Consequences:** guardrail text, preflight, runbook and README updated; the preflight test now covers the new bounds.
- **Reversibility:** edit the constant and the guardrail text. **Source:** human instruction.

### Addendum to ADR-025 (human instruction 2026-09-26): console login page as a preview on the same site
The owner console's login page is built into the same static site at `/console/` (`pnpm build:site` also runs the console's `build:hosted`). On any host other than localhost the console is a preview: the token field and Connect are disabled, no API client is created and no token is ever sent; it says to run `pnpm demo:up`. No backend, no keys, no new Vercel project or setting. The live demo runs only on the human's machine.
