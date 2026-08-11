import { describe, expect, it } from 'vitest';

import {
  requireCanonicalWindowsSystemRoot,
  WindowsSystemRootError,
} from './windowsSystemRoot.js';

describe('Windows system root', () => {
  it('accepts only an exact canonical absolute Windows root', () => {
    expect(requireCanonicalWindowsSystemRoot('C:\\Windows')).toBe(
      'C:\\Windows',
    );
    for (const value of [
      undefined,
      'Windows',
      'C:\\Windows\\..\\Windows',
      'C:\\Windows\\',
      'C:\\Windows\0suffix',
    ]) {
      expect(() => requireCanonicalWindowsSystemRoot(value)).toThrow(
        WindowsSystemRootError,
      );
    }
  });
});
