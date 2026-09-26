# M-005 prize checkpoint: evidence (2026-09-26)

`[PA]` points covered by real (not mocked) runs. Guardrail limits respected (0.05 USDC per payment; session 1/20 settlements, 0.05/1.00 USDC; Intercepta 6 of 40 calls at the time of the runs).

| `[PA]` point | Evidence |
| --- | --- |
| 1 Agent receives an x402 payment requirement | Real HTTP 402 from the local `@x402/express` seller on both runs (`resourceUrl` in the traces) |
| 2 Live Intercepta call before the payer can sign | `evidence.provenance = real_live`; pass: Intercepta returned `13:58:54.189Z`, signer invoked `13:58:54.207Z`. Raw responses: `fixtures/intercepta/recorded/2026-09-26T13-58-54-181Z_0x87cff22e916a4d70675e5b3056c1df6bd401cb1a.json`, `fixtures/intercepta/recorded/2026-09-26T13-58-41-611Z_0x39308ae43e5dda98db5fb17d005c5c764e5a2fed.json` |
| 3–4 Evidence + active policy give one of the five actions | pass: policy v1 `PAY` (rule R1, CLEAR); block: policy v1 `DENY` (`EVIDENCE_BLOCK`, `known_scammer`, `attack_money_target`, `toxicScore 100`) |
| 5 Held or denied payment ⇒ zero signer calls | block: `attempt=aae1f854-7804-4135-b0c1-c811d182cad0 status=failed action=DENY signerCalls=0 settlement=none` |
| 6 One successful payment and one blocked payment | pass: `attempt=392a270f-8a18-485e-b3df-9a81b6607feb status=settled action=PAY signerCalls=1 settlement=settled delivery=received tx=0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b` |

- Settlement: Base Sepolia tx `0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b` (https://sepolia.basescan.org/tx/0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b). RPC receipt check: `docs/evidence/M-005_tx_receipt_check.json` (`status: success`, block 47331424, USDC Transfer 50000 atomic payer → SAFE payTo).
- Persisted decision traces: `docs/evidence/M-005_prize_checkpoint_traces.json` (exported from the SQLite store by `corepack pnpm trace:export`).
- Claim boundary: the screened addresses are interpreted as EVM **mainnet** addresses while settlement is on Base Sepolia; this does not prove the seller's real-world identity, and `CLEAR` is not proof of honesty (SPEC §23). Whether the RISKY address may officially be used as a merchant `payTo` (Q-003) still needs sponsor confirmation.
