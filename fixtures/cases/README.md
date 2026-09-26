# Regression case dataset

Built by `apps/gate/src/dataset/build.ts` (`corepack pnpm seed`) from stored evidence only. Nothing is fetched.

| Provenance | Source | Meaning |
| --- | --- | --- |
| `real_live` | `real_live_manifest.json` + the recorded Intercepta files it names | Four real demo attempts (2 paid, 2 blocked) with the exact evidence Intercepta returned |
| `controlled_variant` | The stored SAFE (CLEAR) and RISKY (BLOCK) evidence snapshots, with a changed amount, counterparty history or budget | Context variants for the replay engine. **Not real payments** and their evidence is labelled `controlled_variant` |
| `synthetic` | `fixtures/intercepta/synthetic/quick-scan-warn-midband.json` and a constructed UNAVAILABLE snapshot | The WARN band was never observed live; these exist only to exercise the engine |
| `sponsor_fixture` | none yet | Reserved for a sponsor-confirmed known-risk address (open question Q-003) |

Labels are `good | bad | unknown` with append-only revisions. Seeded labels are made by `seed_script` and say why; the owner's incident label (Trigger C) is added later through the owner API. Replay reports are counterfactual actions on these labels, **not** measured loss prevented.
