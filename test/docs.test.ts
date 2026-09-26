import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

// T-090 (AC-016, AC-017, AC-018): the README points to the integration files, has setup and test steps and the API feedback.
describe('README (T-090)', () => {
  const rows = [...readme.matchAll(/^\| (.+?) \| \[([^\]]+)\]\(([^)#]+)#L(\d+)\) \| `([^`]+)` \|$/gm)].map((m) => ({ what: m[1] as string, path: m[3] as string, line: Number(m[4]), symbol: m[5] as string }));

  it('names the Intercepta adapter, decision point, signer gate and regression engine, each linking to a real line holding the symbol', () => {
    const wanted = ['screenAddress', 'evaluate', 'createProtectedSigner', 'runRegression'];
    for (const w of wanted) expect(rows.map((r) => r.symbol), w).toContain(w);
    for (const r of rows) {
      expect(existsSync(join(root, r.path)), `${r.path} exists`).toBe(true);
      const lines = readFileSync(join(root, r.path), 'utf8').split(/\r?\n/);
      expect(lines[r.line - 1], `${r.path}#L${r.line} should mention ${r.symbol}`).toContain(r.symbol);
    }
  });

  it('has setup and test instructions that name real scripts and env example variables', () => {
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    for (const s of ['verify', 'test:live', 'demo:smoke', 'demo:reset', 'demo:pass', 'demo:block', 'demo:v2', 'demo:failure', 'owner-api:live', 'dev:console']) {
      expect(readme, s).toContain(`pnpm ${s}`);
      expect(scripts[s], `package.json script ${s}`).toBeDefined();
    }
    const names = readFileSync(join(root, '.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([A-Z][A-Z0-9_]+)=/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    for (const n of names) expect(readme, n).toContain(n);
  });

  it('has 3 to 5 lines of Intercepta API feedback, marked as a draft for human review', () => {
    const section = /## Intercepta API feedback\s+([\s\S]*?)\n## /.exec(readme)?.[1] ?? '';
    expect(section).toContain('DRAFT — human to review before submission');
    const items = section.split(/\r?\n/).filter((l) => /^\d+\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it('states the claim boundaries and the workflow line', () => {
    expect(readme).toMatch(/CLEAR does not mean safe/);
    expect(readme).toMatch(/not an Intercepta verdict/);
    expect(readme).toMatch(/not real prevented losses/);
    expect(readme).toMatch(/code-path isolation/);
    expect(readme.trimEnd().endsWith('Built with an autonomous Claude Code workflow (`CLAUDE.md`, `prompts/`).')).toBe(true);
  });

  it('does not contain a secret-looking value', () => {
    expect(readme).not.toMatch(/PRIVATE_KEY=\S/);
    expect(readme).not.toMatch(/INTERCEPTA_API_KEY=\S/);
    expect(readme).not.toMatch(/OWNER_CONSOLE_TOKEN=\S/);
  });

  it('local links point to files that exist', () => {
    const links = [...readme.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1] as string);
    for (const l of links) expect(existsSync(join(root, l)), l).toBe(true);
  });
});
