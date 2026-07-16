import { describe, expect, it } from 'vitest';

import {
  dnaSmtpConnectionProfile,
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

  it('exposes no configurable fallback host, STARTTLS, or alternate port', () => {
    expect(Object.keys(dnaSmtpConnectionProfile).sort()).toEqual([
      'connectionTimeoutMilliseconds',
      'host',
      'idleTimeoutMilliseconds',
      'minVersion',
      'port',
      'servername',
    ]);
    expect(JSON.stringify(dnaSmtpConnectionProfile)).not.toContain('587');
    expect(JSON.stringify(dnaSmtpConnectionProfile)).not.toContain('25');
    expect(JSON.stringify(dnaSmtpConnectionProfile)).not.toContain(
      'smtp.dnainternet.net',
    );
  });
});
