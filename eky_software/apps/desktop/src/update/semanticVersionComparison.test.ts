import { describe, expect, it } from 'vitest';

import { compareSemanticVersions } from './semanticVersionComparison.js';

describe('semantic version comparison', () => {
  it('orders core, prerelease and release versions using SemVer precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(compareSemanticVersions(ordered[index]!, ordered[index - 1]!)).toBe(1);
    }
  });

  it('ignores build metadata and rejects invalid versions', () => {
    expect(compareSemanticVersions('1.0.0+one', '1.0.0+two')).toBe(0);
    expect(
      compareSemanticVersions(
        '999999999999999999999999999999999999.0.0',
        '999999999999999999999999999999999998.0.0',
      ),
    ).toBe(1);
    expect(() => compareSemanticVersions('01.0.0', '1.0.0')).toThrow(
      'SEMANTIC_VERSION_INVALID',
    );
  });
});
