/**
 * Starts the local seller on localhost only (OPERATIONAL_GUARDRAILS section 9). Reads the merchant `payTo`
 * addresses and the facilitator URL from the environment. Run: corepack pnpm --filter @risksir/seller start
 */
import { routesFromEnv } from './env.js';
import { createSellerApp } from './server.js';

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';
const port = Number(process.env.SELLER_PORT ?? 4021);
const routes = routesFromEnv(process.env);

if (routes.length === 0) {
  console.error('no SELLER_PAY_TO_* variable is set; refusing to start');
  process.exit(1);
}

createSellerApp({ facilitatorUrl, routes }).listen(port, '127.0.0.1', () => {
  console.log(`seller listening on http://127.0.0.1:${port} with routes: ${routes.map((r) => r.variant).join(', ')}`);
});
