import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from '@risksir/core';

describe('workspace smoke', () => {
  it('resolves @risksir/core through the pnpm workspace', () => {
    expect(PROJECT_NAME).toBe('Risksir');
  });
});
