# NEXT — Run the next Risksir milestone autonomously

Follow `CLAUDE.md` exactly.

## 1. Orient

- Read `CLAUDE.md`, `HANDOFF.md` and `EXECUTION_PLAN.md`.
- Run `git status`, `git log --oneline -15` and `bash scripts/env-status.sh`.
- If `SPEC.md` or `EXECUTION_PLAN.md` is missing, run `prompts/00_BOOTSTRAP.md` instead and stop reading this file.
- If `HANDOFF.md` doesn't match the repository, correct it first and commit as `chore(handoff): reconcile with repo state`.

## 2. Select

1. Take the first milestone on the **CRITICAL PATH** that meets all three conditions:
   - its status is TODO or IN_PROGRESS
   - its dependencies are VERIFIED
   - its required credentials show as SET
2. If there is none, take the first unblocked credential-free milestone.
3. If there is none of those either, run the stop protocol (`CLAUDE.md` §10):
   - `AGENT_STATUS: ALL_DONE` if every milestone is VERIFIED
   - otherwise `AGENT_STATUS: HUMAN_REQUIRED`, with exact `HUMAN_ACTIONS`

## 3. Execute (`CLAUDE.md` §8)

- Read the governing SPEC sections, the `AC-xxx` and `INV-xxx`, and the matching `TEST_PLAN.md` rows.
- Inspect the existing code and reuse before creating.
- Implement the smallest coherent vertical slice. For safety-relevant behaviour (signer, reservations, policy, promotion), write or extend the tests first.
- Run the narrow tests, fix failures, then run `pnpm verify` until it's green.
- On a live milestone, stay within `OPERATIONAL_GUARDRAILS.md` §4–§5. Save the raw evidence, and record tx hashes and signer counts.
- If the milestone is a spike, write `docs/spikes/SPIKE_<X>.md` with:
  - the goal
  - the exact commands
  - the raw evidence file paths
  - the observed result
  - a kill-condition check against 07 §22
  - the SPEC OPEN items it resolves, with ADR IDs

  Then update SPEC and DECISIONS to match.

## 4. Close

- Review `git diff`. Update `EXECUTION_PLAN.md` (status and evidence) and `HANDOFF.md` in the same commit.
- Commit with a conventional message whose body lists the AC and INV IDs and the evidence. Then run `git push origin HEAD`.

## 5. Continue

- Complete **up to 3 milestones** in this session, or fewer if your context is getting long. Then run the stop protocol (`CLAUDE.md` §10) with `AGENT_STATUS: CONTINUE`. A fresh session picks up from `HANDOFF.md`.
- Don't ask the human about anything that `SPEC.md`, `DECISIONS.md` or `CLAUDE.md` §5 already lets you decide.
- Final message: 15 lines or fewer, in the format of `CLAUDE.md` §10.
