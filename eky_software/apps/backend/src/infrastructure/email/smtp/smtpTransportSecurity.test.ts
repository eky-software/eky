import { describe, expect, it } from 'vitest';

import { tryReadSmtpTransportSecuritySummary } from './smtpTransportSecurity.js';

const fingerprint256 = Array.from(
  { length: 32 },
  (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
).join(':');

describe('tryReadSmtpTransportSecuritySummary', () => {
  it('returns a bounded DNA SMTP transport summary for validated TLS metadata', () => {
    expect(
      tryReadSmtpTransportSecuritySummary(createSocket(), {
        smtpProfile: 'dnaSmtp',
        targetPort: 465,
      }),
    ).toEqual({
      cipherName: 'TLS_AES_256_GCM_SHA384',
      peerCertificateFingerprint256: fingerprint256,
      remoteAddress: '192.0.2.10',
      remoteFamily: 'IPv4',
      smtpProfile: 'dnaSmtp',
      targetPort: 465,
      tlsVersion: 'TLSv1.3',
    });
  });

  it.each([
    {
      name: 'an obsolete TLS version',
      override: { protocol: 'TLSv1.1' },
    },
    {
      name: 'an unapproved cipher',
      override: { cipherName: 'TLS_RSA_WITH_AES_128_CBC_SHA' },
    },
    {
      name: 'a malformed certificate fingerprint',
      override: { fingerprint: 'not-a-fingerprint' },
    },
    {
      name: 'a missing remote address',
      override: { remoteAddress: undefined },
    },
    {
      name: 'a mismatched remote family',
      override: { remoteFamily: 'IPv6' },
    },
  ])('omits the diagnostic summary for $name', ({ override }) => {
    expect(
      tryReadSmtpTransportSecuritySummary(createSocket(override), {
        smtpProfile: 'dnaSmtp',
        targetPort: 465,
      }),
    ).toBeUndefined();
  });

  it('accepts an IPv6 peer only with a matching family', () => {
    expect(
      tryReadSmtpTransportSecuritySummary(
        createSocket({
          remoteAddress: '2001:db8::10',
          remoteFamily: 'IPv6',
        }),
        {
          smtpProfile: 'dnaSmtp',
          targetPort: 465,
        },
      ),
    ).toMatchObject({
      remoteAddress: '2001:db8::10',
      remoteFamily: 'IPv6',
    });
  });

  it('omits diagnostics if the runtime metadata accessor fails', () => {
    expect(
      tryReadSmtpTransportSecuritySummary(
        {
          ...createSocket(),
          getCipher() {
            throw new Error('synthetic metadata failure');
          },
        },
        {
          smtpProfile: 'dnaSmtp',
          targetPort: 465,
        },
      ),
    ).toBeUndefined();
  });
});

function createSocket(
  override: {
    cipherName?: string;
    fingerprint?: string;
    protocol?: string;
    remoteAddress?: string | undefined;
    remoteFamily?: string;
  } = {},
) {
  const remoteAddress =
    'remoteAddress' in override
      ? override.remoteAddress
      : '192.0.2.10';

  return {
    getCipher: () => ({
      name: override.cipherName ?? 'TLS_AES_256_GCM_SHA384',
      standardName:
        override.cipherName ?? 'TLS_AES_256_GCM_SHA384',
      version: 'TLSv1.3',
    }),
    getPeerCertificate: () => ({
      fingerprint256: override.fingerprint ?? fingerprint256,
    }),
    getProtocol: () => override.protocol ?? 'TLSv1.3',
    remoteAddress,
    remoteFamily: override.remoteFamily ?? 'IPv4',
  };
}
