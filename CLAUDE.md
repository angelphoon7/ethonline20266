# CLAUDE.md — Risksir

> These are the permanent operating rules for Claude Code in this repository and stay the same across sessions.
> The current state is in `HANDOFF.md`. The product contract is in `SPEC.md`. Hard safety limits are in `OPERATIONAL_GUARDRAILS.md`.

**Risksir** is a closed-loop risk-policy engine for autonomous x402 buyer agents. Live Intercepta evidence decides whether an agent's x402 payment is signed. Incidents become regression cases, and only replay-tested, owner-approved policy versions govern future payments.
**Target:** ETHGlobal Tokyo 2026, the Intercepta prize *Safe Agent-to-Agent Payments with x402*.

---

## 1. Mode of operation

- Work **autonomously**. Don't ask permission for normal engineering decisions, and don't stop after each file. Finish each milestone end to end.
- Every verified milestone ends with a commit **and a push** to GitHub (§9).
- **Bootstrap mode:** if `SPEC.md` or `EXECUTION_PLAN.md` doesn't exist, run `prompts/00_BOOTSTRAP.md`.
- **Build mode:** otherwise, run `prompts/NEXT.md`.
- Stop only for the reasons in §6. When you stop, follow §10.

## 2. The load-bearing core (never trade away)

Work in this priority order whenever time or scope conflict:

1. **Sponsor path (Layer 1).** Every real payment attempt follows this path:
   - A real x402 `402` arrives and one requirement is selected.
   - **A live Intercepta call screens the exact selected `payTo` before any signer call.**
   - Evidence, the active policy and the payment context produce exactly one of `PAY | CAP | HOLD | ASK_HUMAN | DENY`.
   - Only an approved attempt reaches the protected signer.

   HOLD, DENY and pending ASK_HUMAN mean **zero signer calls**. Missing or unusable evidence means HOLD.
2. **Qualifying demo.** Show one settled testnet payment and one Intercepta-driven hold or deny with a visible reason and a signer count of 0.
3. **Company context (Layer 2).** The same evidence with a different amount, counterparty history or profile gives a different authorised action.
4. **Regression loop (Layers 3–4).** The chain runs as follows:
   - An incident leads to at least 2 candidate policies.
   - Each candidate is replayed over labelled cases, and trade-off metrics are computed from the data.
   - The owner approves one, which becomes policy vN+1.
   - vN+1 changes the decision on a **new x402 attempt with a fresh live Intercepta screen**.
   - Rollback exists.

Don't polish Layers 3–4 while Layer 1 is broken. The regression loop is what sets Risksir apart. It doesn't replace the sponsor path.

## 3. Session start

1. Read `CLAUDE.md`, `HANDOFF.md` and `EXECUTION_PLAN.md`, then the parts of `SPEC.md`, `AGENTS.md`, `OPERATIONAL_GUARDRAILS.md` and `TEST_PLAN.md` that apply to the task.
2. Run `git status`, `git log --oneline -15` and `bash scripts/env-status.sh`. Never open `.env` itself.
3. If `HANDOFF.md` disagrees with the repository, the repository wins. Correct `HANDOFF.md` first.

## 4. Source of truth (highest first)

1. Explicit human instruction in the current session
2. `SPEC.md`
3. `docs/PRIZE_ANCHOR_INTERCEPTA.md` and `docs/07_PROJECT_FREEZE.md`
4. `docs/08_SYSTEM_DEPENDENCY_DESIGN.md`
5. Official x402 and Intercepta (W3A) documentation for the **installed** versions
6. `DECISIONS.md`
7. Existing code
8. `HANDOFF.md`

- If code disagrees with SPEC, the code is wrong.
- SPEC refines 07 and 08. It may not contradict the prize anchor, the freeze's non-goals (07 §14 "DO NOT", §28) or the claim boundaries (08 §12). If it does, correct SPEC toward the freeze.
- Don't rely on remembered SDK behaviour. Check the installed package types and source, and the docs.

## 5. Decision authority

**Decide yourself without asking:**
- file layout, internal APIs, helper structure
- library choice within the default stack, test organisation, error types, UI layout
- labelled fixture content
- refactors that preserve behaviour

**Decide yourself, then record an ADR in `DECISIONS.md` (Status: Accepted, agent default, human may override):**
- OPEN SPEC items whose effect is internal
- OPEN items marked "resolve with spike evidence", once the evidence is recorded
- demo thresholds scaled to testnet amounts
- the mapping from observed Intercepta fields to evidence tiers

**Human only, so stop (§6):**
- changing the user promise, the semantics of the five actions, the trust boundary, payment semantics, the sponsor dependency or the acceptance criteria
- weakening any `INV-xxx`

## 6. Stop conditions (set `AGENT_STATUS: HUMAN_REQUIRED`)

Stop only when **no unblocked milestone remains** and one of these blocks progress. Items marked ⛔ stop you immediately.

- A credential or funding is missing: `INTERCEPTA_API_KEY`, a funded `PAYER_PRIVATE_KEY` or `SELLER_PAY_TO_RISKY`. Finish credential-free milestones first.
- ⛔ You observe a kill condition from 07 §22, for example Intercepta can't be placed before the actual signer, or the x402 flow can bypass the guard. Record the evidence. Don't pivot or redesign.
- ⛔ An action would do any of the following:
  - sign on any network other than Base Sepolia
  - touch mainnet funds
  - exceed the spend limits
  - create, delete or change the visibility of a GitHub repository
  - deploy anything publicly
- Two authoritative sources (§4 items 1–4) conflict on load-bearing behaviour.
- The same failure persists after 3 materially different fix attempts.

## 7. Engineering rules

- Use TypeScript strict, ESM and a pnpm workspace. Validate every external input with zod: 402 payloads, Intercepta responses and HTTP bodies.
- Money is integer atomic units: `bigint` in code, a decimal string in JSON. Never use floats for money.
- The policy engine and the regression engine are **pure deterministic functions**. No clock, network, randomness or LLM inside them. Pass time and data in.
- There is exactly one canonical quote-fingerprint helper. Nothing else hashes quotes.
- `PAYER_PRIVATE_KEY` is read **only** inside the signer module. Agent, buyer and regression code must have no import path to it, and a test enforces this.
- Wrap the signer so that it refuses to sign unless a stored decision binds the identical quote. This is defence in depth, on top of any SDK hook.
- Store every live Intercepta response raw, without request headers, together with its timestamp, endpoint, address and provenance.
- Every case and every piece of evidence carries one provenance label: `real_live | sponsor_fixture | controlled_variant | synthetic`. Never relabel.
- Search the codebase before creating anything. Prefer small vertical slices over broad scaffolding.

## 8. Milestone loop

For each milestone in `EXECUTION_PLAN.md`:

1. Mark it IN_PROGRESS and list the governing `AC-xxx` and `INV-xxx`.
2. Inspect the relevant code and implement the smallest coherent slice. Write safety tests first for the signer, reservations, the policy and promotion.
3. Run the narrow tests, fix failures, then run `pnpm verify`, which must be green.
4. On live milestones, run the live check within the guardrail limits and save the evidence: raw response path, tx hash and signer-count log.
5. Review `git status` and `git diff`, and leave unrelated changes out.
6. Update `EXECUTION_PLAN.md` (status and evidence) and `HANDOFF.md` in the same commit.
7. Commit (§9), then push.
8. Continue with the next unblocked milestone.

Status vocabulary, weakest to strongest: `implemented` < `unit-tested` < `integration-tested` < `live-verified`. Mark a milestone `VERIFIED` only with the evidence its Validation section requires. Never write "works", "done", "verified" or "settled" without evidence.

## 9. Git

- Branch: `main`, since this is a solo hackathon repo. After every verified milestone, commit and run `git push origin HEAD`.
- Use conventional commits such as `feat(gate): …`, `test(policy): …`, `docs(spec): …` or `chore(handoff): …`. The subject states the behaviour completed. The body lists the AC/INV IDs and the evidence.
- Stage explicit paths. Never commit `.env*` (except `.env.example`), keys, database files, `node_modules` or build output.
- The pre-commit hook (`.githooks/pre-commit`, which runs `scripts/guard-secrets.sh`) blocks secrets. Never bypass it. `--no-verify` is forbidden.
- Also forbidden:
  - force push
  - `--amend` on pushed commits
  - rebase, `reset --hard`, `clean`
  - any history rewrite
  - `gh repo create`, `gh repo delete`, `gh repo edit`
- If the push fails because there's no remote or no auth, keep committing locally, add `PUSH PENDING` to HANDOFF `HUMAN_ACTIONS` and continue.
- If `pnpm verify` is red, don't push feature commits. Before stopping, a `wip(...)` commit is allowed only if `HANDOFF.md` says what is broken.

## 10. Stop protocol (end of session, stop condition or low context)

1. Run `pnpm verify` and record the result.
2. Update `EXECUTION_PLAN.md` and `HANDOFF.md`. The first two lines of `HANDOFF.md` must be:
   ```
   AGENT_STATUS: CONTINUE | HUMAN_REQUIRED | ALL_DONE
   HUMAN_ACTIONS: <numbered concrete actions, or "none">
   ```
3. Commit and push.
4. Write a final message of 15 lines or fewer: milestones completed, evidence, commits, `AGENT_STATUS`, `HUMAN_ACTIONS`.

If your context is getting long, finish the current milestone, run this protocol and end. A fresh session continues from `HANDOFF.md`.

## 11. Never build (these reopen the freeze)

- a new threat-detection model or scam database
- a wallet blacklist as the product
- credit scoring or public reputation
- escrow or refunds
- smart contracts or an onchain policy registry
- an indexer, subgraph or oracle
- multi-chain support
- other sponsor integrations added for prize count
- an MCP or skills layer
- autonomous policy self-modification
- any LLM with signing, approval or activation rights
- a generic dashboard with no effect on a future payment

## 12. Never claim

- "CLEAR means safe"
- that Intercepta lacks custom rules or can't learn
- that we invented backtesting
- "first safe x402 layer"
- replay metrics as real prevented losses
- testnet settlement as proof of mainnet crime
- mocked or recorded evidence as live
