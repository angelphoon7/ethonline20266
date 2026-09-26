// `pnpm test:live` entry point. Live tests spend Intercepta calls and testnet funds,
// so they never run by accident (OPERATIONAL_GUARDRAILS §4-§5, TEST_PLAN §2).
if (process.env.LIVE !== '1') {
  console.error('test:live refused: set LIVE=1 to run live checks (limits: OPERATIONAL_GUARDRAILS §4-§5).');
  process.exit(1);
}
console.error('test:live: no live tests are registered yet (first ones arrive with M-003).');
process.exit(1);
