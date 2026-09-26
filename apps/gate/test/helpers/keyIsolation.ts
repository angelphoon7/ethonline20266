import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Static key-isolation checks (INV-008, T-025). Scans production source trees only (never tests) and returns violations:
 *  1. PAYER_PRIVATE_KEY may appear only under apps/gate/src/signer/.
 *  2. Key derivation (privateKeyToAccount, generatePrivateKey, mnemonicToAccount) may appear only there.
 *  3. Agent, core and regression code cannot import the signer at all.
 *  4. Everything else may import only signer/public, never signer/key or signer/guard internals.
 */
const SIGNER_DIR = ['apps', 'gate', 'src', 'signer'].join('/');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
    return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [p] : [];
  });
}

export function sourceRoots(root: string): string[] {
  const apps = existsSync(join(root, 'apps')) ? readdirSync(join(root, 'apps')) : [];
  const packages = existsSync(join(root, 'packages')) ? readdirSync(join(root, 'packages')) : [];
  return [...apps.map((a) => join(root, 'apps', a, 'src')), ...packages.map((p) => join(root, 'packages', p, 'src'))];
}

export function checkKeyIsolation(root: string): string[] {
  const violations: string[] = [];
  for (const dir of sourceRoots(root)) {
    for (const file of walk(dir)) {
      const rel = relative(root, file).split(sep).join('/');
      const inSigner = rel.startsWith(`${SIGNER_DIR}/`);
      const code = stripComments(readFileSync(file, 'utf8'));

      if (!inSigner) {
        if (/PAYER_PRIVATE_KEY/.test(code)) violations.push(`${rel}: references PAYER_PRIVATE_KEY outside the signer module`);
        if (/\b(privateKeyToAccount|generatePrivateKey|mnemonicToAccount)\b/.test(code)) {
          violations.push(`${rel}: derives a key/account outside the signer module`);
        }
      }

      const imports = [...code.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
      const noSigner = rel.startsWith('packages/') || rel.startsWith('apps/gate/src/agent/') || /(^|\/)regression\//.test(rel);
      for (const spec of imports) {
        if (!/signer/.test(spec)) continue;
        if (inSigner) continue;
        if (noSigner) violations.push(`${rel}: agent/core/regression code imports the signer (${spec})`);
        else if (!/(^|\/)signer\/public(\.js)?$/.test(spec)) violations.push(`${rel}: imports signer internals (${spec}); only signer/public is allowed`);
      }
    }
  }
  return violations;
}
