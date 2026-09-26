import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkKeyIsolation } from './helpers/keyIsolation.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// T-025 (INV-008, AC-026): PAYER_PRIVATE_KEY and signer imports are confined.
describe('key isolation over the real repository', () => {
  it('has no violations', () => {
    expect(checkKeyIsolation(repoRoot)).toEqual([]);
  });
});

describe('the isolation checker catches violations (self-test)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'risksir-iso-'));
    dirs.push(root);
    for (const [rel, content] of Object.entries(files)) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    return root;
  }

  it('is clean for a well-formed tree', () => {
    const root = tree({
      'apps/gate/src/signer/key.ts': "const k = process.env.PAYER_PRIVATE_KEY; import { privateKeyToAccount } from 'viem/accounts';",
      'apps/gate/src/x402/gate.ts': "import { createProtectedSigner } from '../signer/public.js';",
      'apps/gate/src/agent/runner.ts': "import { runPaid } from '../x402/gate.js';",
    });
    expect(checkKeyIsolation(root)).toEqual([]);
  });

  it('flags PAYER_PRIVATE_KEY outside the signer', () => {
    const root = tree({ 'apps/gate/src/x402/gate.ts': 'const k = process.env.PAYER_PRIVATE_KEY;' });
    expect(checkKeyIsolation(root).join()).toMatch(/references PAYER_PRIVATE_KEY/);
  });

  it('flags key derivation outside the signer', () => {
    const root = tree({ 'apps/gate/src/cli/x.ts': "import { privateKeyToAccount } from 'viem/accounts'; privateKeyToAccount('0x');" });
    expect(checkKeyIsolation(root).join()).toMatch(/derives a key/);
  });

  it('flags the agent or core importing the signer, even signer/public', () => {
    const root = tree({
      'apps/gate/src/agent/runner.ts': "import { createProtectedSigner } from '../signer/public.js';",
      'packages/core/src/policy/x.ts': "import x from '../../../apps/gate/src/signer/public.js';",
      'packages/core/src/regression/y.ts': "import x from '../signer.js';",
    });
    const v = checkKeyIsolation(root);
    expect(v.filter((x) => /agent\/core\/regression code imports the signer/.test(x))).toHaveLength(3);
  });

  it('flags imports of signer internals from other gate code', () => {
    const root = tree({ 'apps/gate/src/x402/gate.ts': "import { loadAccount } from '../signer/key.js';" });
    expect(checkKeyIsolation(root).join()).toMatch(/signer internals/);
  });

  it('ignores mentions inside comments', () => {
    const root = tree({ 'apps/gate/src/x402/gate.ts': '// PAYER_PRIVATE_KEY is read only in the signer\n/* privateKeyToAccount */ export {};' });
    expect(checkKeyIsolation(root)).toEqual([]);
  });
});
