import { describe, expect, it } from 'vitest';

import { parseSmtpCapabilities } from './smtpCapabilityParser.js';

describe('parseSmtpCapabilities', () => {
  it('reads only supported authentication mechanisms', () => {
    const result = parseSmtpCapabilities({
      code: 250,
      lines: [
        { code: 250, separator: '-', text: 'smtp.example.test' },
        { code: 250, separator: '-', text: 'AUTH=LOGIN PLAIN XOAUTH2' },
        { code: 250, separator: ' ', text: 'SIZE 1000000' },
      ],
    });

    expect([...result.authenticationMethods]).toEqual(['LOGIN', 'PLAIN']);
    expect([...result.extensions]).toEqual(['AUTH', 'SIZE']);
  });
});
