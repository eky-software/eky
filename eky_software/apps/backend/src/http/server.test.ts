import { describe, expect, it } from 'vitest';

import { getServerHostname, getServerPort } from './server.js';

describe('backend server configuration', () => {
  it('uses only the IPv4 loopback hostname', () => {
    expect(getServerHostname(undefined)).toBe('127.0.0.1');
    expect(getServerHostname('127.0.0.1')).toBe('127.0.0.1');
    expect(() => getServerHostname('0.0.0.0')).toThrow(
      'Backend hostname must be the IPv4 loopback address.',
    );
  });

  it('allows the operating system to allocate port zero', () => {
    expect(getServerPort('0')).toBe(0);
    expect(getServerPort('65535')).toBe(65535);
    expect(() => getServerPort('-1')).toThrow('Invalid PORT value');
    expect(() => getServerPort('65536')).toThrow('Invalid PORT value');
  });
});
