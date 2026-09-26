import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-011 / T-015 (INV-023, INV-008, INV-016): static checks on the pure engines.
const srcDir = new URL('../src/', import.meta.url);
const enginesDirs = ['policy', 'regression'];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const banned: [string, RegExp][] = [
  ['Date.now', /\bDate\.now\b/],
  ['new Date', /\bnew Date\b/],
  ['Math.random', /\bMath\.random\b/],
  ['performance.now', /\bperformance\.now\b/],
  ['fetch', /\bfetch\s*\(/],
  ['process', /\bprocess\b/],
  ['timers', /\b(setTimeout|setInterval|setImmediate)\b/],
  ['random ids', /\b(randomUUID|randomBytes|getRandomValues)\b/],
  ['node builtins', /from\s+['"]node:/],
  ['require', /\brequire\s*\(/],
  ['other packages', /from\s+['"](?!\.{1,2}\/|zod['"])[^'"]+['"]/],
  ['app imports', /apps\//],
  ['signing capability or key', /PAYER_PRIVATE_KEY|privateKeyToAccount|signTypedData|signMessage|from\s+['"][^'"]*signer/i],
];

describe('engines are pure (INV-023) and have no signer capability (INV-008, AC-032)', () => {
  const dirs = enginesDirs.map((d) => new URL(`${d}/`, srcDir)).filter((u) => existsSync(u));

  it('checks at least the policy engine', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(1);
  });

  for (const dir of dirs) {
    for (const file of tsFiles(fileURLToPath(dir))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [name, re] of banned) {
        it(`${file.split(/[\\/]src[\\/]/)[1]} has no ${name}`, () => {
          expect(code).not.toMatch(re);
        });
      }
    }
  }
});

describe('packages/core does not import from apps or any LLM SDK (INV-016)', () => {
  const root = fileURLToPath(srcDir);
  it.each(tsFiles(root).map((f) => [f.split(/[\\/]src[\\/]/)[1] as string, f]))('%s', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/from\s+['"][^'"]*apps\//);
    expect(code).not.toMatch(/from\s+['"](@anthropic-ai|openai|@google\/generative-ai|langchain)/);
  });
});
