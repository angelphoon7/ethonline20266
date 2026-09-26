import { describe, expect, it } from 'vitest';
import { DEMO_SERVICE_BASE, demoCandidates, demoPolicyV1, demoProfile } from '@risksir/core';
import { PRESETS } from '../src/presets';

// The console's rule JSON must equal the demo candidates in core (SPEC Appendix A), so the UI cannot drift from the spec.
describe('candidate presets', () => {
  it('equal the rules of the demo candidates A, B and C', () => {
    const core = demoCandidates(demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)));
    expect(PRESETS.map((p) => p.key)).toEqual(['A', 'B', 'C']);
    for (const preset of PRESETS) {
      const c = core.find((x) => x.key === preset.key);
      expect(preset.rules).toEqual(JSON.parse(JSON.stringify(c?.policy.rules)));
      expect(preset.rationale).toBe(c?.rationale);
    }
  });
});
