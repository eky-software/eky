import { describe, expect, it, vi } from 'vitest';

import { createDnaSmtpOperationalDiagnostics } from './dnaSmtpOperationalDiagnostics.js';

const transportDiagnostic = {
  cipherName: 'TLS_AES_256_GCM_SHA384',
  durationMs: 25,
  operationId: 'attempt-1',
  peerCertificateFingerprint256: Array.from(
    { length: 32 },
    (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
  ).join(':'),
  remoteAddress: '192.0.2.10',
  remoteFamily: 'IPv4' as const,
  smtpProfile: 'dnaSmtp' as const,
  targetPort: 465 as const,
  tlsVersion: 'TLSv1.3' as const,
};

describe('createDnaSmtpOperationalDiagnostics', () => {
  it('writes bounded connection and delivery events to the detailed local log', () => {
    const write = vi.fn();
    const diagnostics = createDnaSmtpOperationalDiagnostics({
      operationalIdentity: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        runtimeInstanceId:
          '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: { write },
    });

    diagnostics.recordConnectionSecured(transportDiagnostic);
    diagnostics.recordDeliveryCompleted(transportDiagnostic);

    expect(write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ...transportDiagnostic,
        eventName: 'smtp.connectionSecured',
        level: 'info',
        stage: 'connect',
      }),
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ...transportDiagnostic,
        eventName: 'smtp.deliveryCompleted',
        level: 'info',
        stage: 'delivery',
      }),
    );
  });

  it('does not let a diagnostic logger failure escape', () => {
    const diagnostics = createDnaSmtpOperationalDiagnostics({
      operationalIdentity: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'abcdef123456',
        runtimeInstanceId:
          '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: {
        write() {
          throw new Error('synthetic logger failure');
        },
      },
    });

    expect(() =>
      diagnostics.recordConnectionSecured(transportDiagnostic),
    ).not.toThrow();
  });
});
