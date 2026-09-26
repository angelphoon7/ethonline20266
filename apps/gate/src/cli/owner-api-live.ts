/** `pnpm owner-api:live`: the owner API with the live gate wired in (sets LIVE=1 so it also works from PowerShell). */
process.env.LIVE = '1';
await import('./owner-api.js');
export {};
