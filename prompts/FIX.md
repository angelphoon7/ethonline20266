# FIX — Investigate and fix a bug (not a redesign)

The human describes the bug as **Observed** behaviour and **Expected** behaviour. It is passed in as the command argument, or written below this line.

---

1. Reproduce the failure first, or otherwise establish evidence that it exists.
2. Find the root cause.
3. Identify which SPEC requirement or `INV-xxx` is violated. If SPEC doesn't define the expected behaviour, **stop and surface the ambiguity**. Don't guess product behaviour.
4. Where practical, add a regression test that fails before the fix.
5. Implement the smallest correct fix. Don't hide the bug behind a broad refactor.
6. Run the narrow tests, then `pnpm verify`, and check for regressions in nearby code.
7. Commit as `fix(<area>): <behaviour restored>`, listing the INV and AC IDs, then run `git push origin HEAD`.
8. Update `HANDOFF.md` if the project state changed materially.
