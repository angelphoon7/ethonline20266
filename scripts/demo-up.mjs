// `pnpm demo:up`: one command for the interactive demo (localhost only, testnet only).
//   1. pnpm demo:reset        (skip with --no-reset when you only restart the servers mid-demo)
//   2. LIVE=1 pnpm demo:smoke (stops if it fails; --ignore-smoke continues anyway)
//   3. starts the owner API with the live gate and the console, then opens the console in your browser
// `--no-open` does not open the browser. Ctrl+C stops both servers. The owner token is never read here: you paste it in the console.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout } from 'node:timers';

const args = new Set(process.argv.slice(2));
const run = (label, script, env = {}) => {
  console.log(`\n> ${label}`);
  const r = spawnSync('pnpm', [script], { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  return r.status === 0;
};

if (!args.has('--no-reset') && !run('pnpm demo:reset', 'demo:reset')) {
  console.error('\nreset failed or was refused. Fix that first (stop any running owner API, or run pnpm reconcile).');
  process.exit(1);
}
if (!args.has('--skip-smoke')) {
  const ok = run('LIVE=1 pnpm demo:smoke', 'demo:smoke', { LIVE: '1' });
  if (!ok && !args.has('--ignore-smoke')) {
    console.error('\nsmoke check failed, so the servers were not started. Fix the FAIL lines above, or start anyway with: pnpm demo:up --no-reset --ignore-smoke');
    process.exit(1);
  }
}

const children = [];
const start = (name, script) => {
  const child = spawn('pnpm', [script], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  const pipe = (stream, out) => stream.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => out(tag + l)));
  pipe(child.stdout, console.log);
  pipe(child.stderr, console.error);
  child.on('exit', (code) => {
    console.error(`${tag}stopped (exit ${code}). Stopping everything.`);
    stop(code ?? 1);
  });
  children.push(child);
};

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.pid) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const waitForPort = (port, tries = 60) =>
  new Promise((resolve, reject) => {
    const attempt = (n) => {
      const s = createConnection({ port, host: '127.0.0.1' });
      s.once('connect', () => {
        s.destroy();
        resolve();
      });
      s.once('error', () => {
        s.destroy();
        if (n <= 0) reject(new Error(`port ${port} did not open`));
        else setTimeout(() => attempt(n - 1), 500);
      });
    };
    attempt(tries);
  });

start('owner-api', 'owner-api:live');
start('console', 'dev:console');
try {
  await Promise.all([waitForPort(4100), waitForPort(5173)]);
} catch (err) {
  console.error(String(err));
  stop(1);
}
const url = 'http://127.0.0.1:5173';
console.log(`\nReady: ${url}\nPaste your OWNER_CONSOLE_TOKEN in the console and click Connect. Header should read Policy v1. Ctrl+C stops everything.\n`);
if (!args.has('--no-open')) spawnSync('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', shell: false });
