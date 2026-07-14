import { describe, expect, it } from 'vitest';

import {
  createDesktopRuntimeSession,
  isDesktopRuntimeSession,
} from './runtimeSession.js';

describe('desktop runtime session', () => {
  it('creates a fresh 256-bit base64url session', () => {
    const firstSession = createDesktopRuntimeSession();
    const secondSession = createDesktopRuntimeSession();

    expect(firstSession).not.toBe(secondSession);
    expect(isDesktopRuntimeSession(firstSession)).toBe(true);
    expect(Buffer.from(firstSession, 'base64url')).toHaveLength(32);
  });

  it.each([
    undefined,
    '',
    'a'.repeat(42),
    'a'.repeat(44),
    `${'a'.repeat(42)}+`,
  ])('rejects malformed session values', (value) => {
    expect(isDesktopRuntimeSession(value)).toBe(false);
  });
});
