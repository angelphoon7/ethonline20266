import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('repo hygiene (INV-018)', () => {
  it('gitignores .env but keeps .env.example', () => {
    const lines = read('.gitignore').split(/\r?\n/);
    expect(lines).toContain('.env');
    expect(lines).toContain('!.env.example');
  });

  it('.env.example carries names only, never values for secret variables', () => {
    const secretNames = ['INTERCEPTA_API_KEY', 'PAYER_PRIVATE_KEY', 'OWNER_CONSOLE_TOKEN'];
    const lines = read('.env.example').split(/\r?\n/);
    for (const name of secretNames) {
      expect(lines, `${name} must be present`).toContain(`${name}=`);
    }
  });

  it('.env.example lists exactly the variable names SPEC section 19 names', () => {
    const declared = read('.env.example')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => l.split('=')[0])
      .sort();
    expect(declared).toEqual(
      [
        'BASE_SEPOLIA_RPC_URL',
        'INTERCEPTA_API_KEY',
        'INTERCEPTA_BASE_URL',
        'OWNER_CONSOLE_TOKEN',
        'PAYER_PRIVATE_KEY',
        'SELLER_PAY_TO_ALT',
        'SELLER_PAY_TO_RISKY',
        'SELLER_PAY_TO_SAFE',
        'X402_FACILITATOR_URL',
      ].sort(),
    );
  });
});
