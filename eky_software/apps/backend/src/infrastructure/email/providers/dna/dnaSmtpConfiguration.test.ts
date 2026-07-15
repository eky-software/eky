import { describe, expect, it } from 'vitest';

import {
  dnaSmtpConnectionProfile,
  isExactDnaSmtpProfile,
} from './dnaSmtpConfiguration.js';

describe('DNA SMTP configuration', () => {
  it('locks the first adapter to implicit TLS on the primary DNA host', () => {
    expect(dnaSmtpConnectionProfile).toEqual({
      connectionTimeoutMilliseconds: 10_000,
      host: 'smtp.dnamail.fi',
      idleTimeoutMilliseconds: 20_000,
      minVersion: 'TLSv1.2',
      port: 465,
      servername: 'smtp.dnamail.fi',
    });
  });

  it.each([
    { emailDeliveryProvider: 'dryRun' },
    { emailSmtpHost: 'smtp.dnainternet.net' },
    { emailSmtpHost: 'attacker.example' },
    { emailSmtpPort: 25 },
    { emailSmtpPort: 587 },
    { emailSmtpSecurity: 'starttls' },
  ])('rejects a profile override: %o', (override) => {
    expect(
      isExactDnaSmtpProfile({
        emailDeliveryProvider: 'smtp',
        emailSmtpHost: 'smtp.dnamail.fi',
        emailSmtpPort: 465,
        emailSmtpSecurity: 'tls',
        ...override,
      }),
    ).toBe(false);
  });
});
