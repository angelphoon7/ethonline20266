# WRAP — Prepare a clean handoff for a fresh session

Don't start new features.

1. Check `git status` and finish or cleanly park the change in progress. A `wip(...)` commit is allowed only if `HANDOFF.md` says what is broken.
2. Run only the validation needed to establish the current state: `pnpm verify`. Run live checks only if the handoff claims live status.
3. Update the milestone statuses and evidence in `EXECUTION_PLAN.md`.
4. Update `HANDOFF.md`:
   - The first two lines are `AGENT_STATUS` and `HUMAN_ACTIONS`.
   - Separate VERIFIED from implemented.
   - Record the current blockers.
   - List the next actions (5 or fewer, ordered).
   - Fill in "Do Not Repeat".
5. Make sure no secret values appear in the docs or the diff. The pre-commit hook enforces this too.
6. Commit as `chore(handoff): session wrap` and run `git push origin HEAD`.

A fresh session must be able to continue by reading only `CLAUDE.md`, `SPEC.md`, `HANDOFF.md` and `EXECUTION_PLAN.md`, without this conversation. Don't claim anything is verified without evidence.
