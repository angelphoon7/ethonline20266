# UI_FEEDBACK — Correct the user experience without changing protocol behaviour

The human describes the **current experience** and the **desired experience** from the user's point of view. It is passed in as the command argument, or written below this line.

---

- The human decides **what** should change. You decide **how**.
- Don't change the underlying protocol, the policy semantics, the signer behaviour or SPEC behaviour.
- If the feedback conflicts with `SPEC.md`, stop and surface the conflict before changing anything.
- Inspect the console architecture, then implement the UX correction.
- The UX contract in SPEC §20 must still hold: the decision trace shows the quote, the evidence and its provenance, the policy version, the action and reasons, the signer count, and the settlement and delivery statuses separately.
- Run `pnpm verify` and `pnpm demo:smoke` if it exists. Then commit as `feat(console): …` or `fix(console): …` and run `git push origin HEAD`.
