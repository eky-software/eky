import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretReader } from '../../../../modules/companySettings/ports/companyEmailSecretReader.js';
import { SmtpTransportError } from '../../smtp/smtpErrors.js';
import type { SmtpMessageDeliveryInput } from '../../smtp/smtpTypes.js';
import type { SmtpTransportSecuritySummary } from '../../smtp/smtpTransportSecurity.js';
import { DnaSmtpEmailDeliveryProvider } from './dnaSmtpEmailDeliveryProvider.js';
import type {
  DnaSmtpEmailInput,
  DnaSmtpTestEmailInput,
} from './dnaSmtpTypes.js';

describe('DnaSmtpEmailDeliveryProvider', () => {
  it('uses only the trusted test recipient and a stable attempt Message-ID', async () => {
    let transportInput: SmtpMessageDeliveryInput | undefined;
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async (input) => {
        transportInput = {
          ...input,
          message: Buffer.from(input.message),
        };
        return { accepted: true, providerMessageId: 'synthetic-message-id' };
      },
    });

    await expect(provider.sendTestEmail(createInput())).resolves.toEqual({
      deliveredTo: 'safe-recipient@example.com',
      provider: 'smtp',
      providerMessageId: 'synthetic-message-id',
      testMode: true,
    });

    expect(transportInput?.envelope).toEqual({
      from: 'billing@example.com',
      recipients: ['safe-recipient@example.com'],
    });
    const message =
      transportInput === undefined
        ? ''
        : Buffer.from(transportInput.message).toString('ascii');
    expect(message).toContain('To: safe-recipient@example.com');
    expect(message).toContain('Message-ID: <attempt-1@example.com>');
    expect(message).not.toContain('actual-customer@example.com');
    expect(message).not.toContain('copy@example.com');
    expect(message).not.toContain('Cc:');
  });

  it('delivers an invoice only to the validated customer and optional Cc', async () => {
    let transportInput: SmtpMessageDeliveryInput | undefined;
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async (input) => {
        transportInput = {
          ...input,
          message: Buffer.from(input.message),
        };
        return { accepted: true, providerMessageId: 'synthetic-message-id' };
      },
    });

    await expect(provider.sendEmail(createCustomerInput())).resolves.toEqual({
      deliveredCc: 'copy@example.com',
      deliveredTo: 'customer@example.com',
      provider: 'smtp',
      providerMessageId: 'synthetic-message-id',
      testMode: false,
    });
    expect(transportInput?.envelope).toEqual({
      from: 'billing@example.com',
      recipients: ['customer@example.com', 'copy@example.com'],
    });
    const message = Buffer.from(transportInput?.message ?? []).toString('ascii');
    expect(message).toContain('To: customer@example.com');
    expect(message).toContain('Cc: copy@example.com');
    expect(message).toContain('Message-ID: <attempt-1@example.com>');
  });

  it.each([
    { emailDeliveryProvider: 'dryRun' },
    { emailTestRecipientOverride: '' },
    { emailTestRecipientOverride: 'not-an-email' },
    { emailUsername: 'not-an-email' },
    { emailUsername: 'other@example.com' },
    { attemptId: 'bad@attempt' },
  ])('fails before reading the secret for an invalid profile: %o', async (override) => {
    const getSecret = vi.fn(async () => 'synthetic-password');
    const transport = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: { getSecret },
      transport,
    });

    await expect(
      provider.sendTestEmail({
        ...createInput(),
        ...override,
      } as DnaSmtpTestEmailInput),
    ).rejects.toMatchObject({ code: 'DNA_SMTP_CONFIGURATION_INVALID' });
    expect(getSecret).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails safely when the secret is not configured', async () => {
    const transport = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader(null),
      transport,
    });

    await expect(provider.sendTestEmail(createInput())).rejects.toMatchObject({
      code: 'DNA_SMTP_SECRET_NOT_CONFIGURED',
      technicalErrorCode: null,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('maps SMTP errors without exposing server responses or the password', async () => {
    const recordFailure = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async () => {
        throw new SmtpTransportError(
          'SMTP_OUTCOME_UNKNOWN',
          'finalAcceptance',
          'outcomeUnknown',
        );
      },
      transportDiagnostics: {
        recordConnectionSecured: vi.fn(),
        recordDeliveryCompleted: vi.fn(),
        recordFailure,
      },
    });

    const error = await provider.sendTestEmail(createInput()).catch((value) => value);

    expect(error).toMatchObject({
      code: 'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN',
      technicalErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    });
    expect(JSON.stringify(error)).not.toContain('synthetic-password');
    expect(recordFailure).toHaveBeenCalledWith({
      durationMs: expect.any(Number),
      errorCode: 'SMTP_OUTCOME_UNKNOWN',
      operationId: 'attempt-1',
      outcome: 'outcomeUnknown',
      phase: 'finalAcceptance',
    });
  });

  it('rejects header injection before reading the secret', async () => {
    const getSecret = vi.fn(async () => 'synthetic-password');
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: { getSecret },
      transport: vi.fn(),
    });

    await expect(
      provider.sendTestEmail({
        ...createInput(),
        subject: 'Invoice\r\nBcc: victim@example.com',
      }),
    ).rejects.toMatchObject({ code: 'DNA_SMTP_MESSAGE_INVALID' });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('records bounded transport diagnostics for a completed delivery', async () => {
    const recordConnectionSecured = vi.fn();
    const recordDeliveryCompleted = vi.fn();
    const recordFailure = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async (_input, options) => {
        options?.onConnectionSecured?.({
          ...transportSecurity,
          durationMs: 12,
        });
        return {
          accepted: true,
          providerMessageId: 'synthetic-message-id',
          transportSecurity,
        };
      },
      transportDiagnostics: {
        recordConnectionSecured,
        recordDeliveryCompleted,
        recordFailure,
      },
    });

    await provider.sendEmail(createCustomerInput());

    expect(recordConnectionSecured).toHaveBeenCalledWith({
      ...transportSecurity,
      durationMs: 12,
      operationId: 'attempt-1',
    });
    expect(recordDeliveryCompleted).toHaveBeenCalledWith({
      ...transportSecurity,
      durationMs: expect.any(Number),
      operationId: 'attempt-1',
    });
    expect(
      JSON.stringify([
        recordConnectionSecured.mock.calls,
        recordDeliveryCompleted.mock.calls,
      ]),
    ).not.toContain('synthetic-password');
    expect(
      JSON.stringify([
        recordConnectionSecured.mock.calls,
        recordDeliveryCompleted.mock.calls,
      ]),
    ).not.toContain('customer@example.com');
  });

  it('does not change a successful delivery when diagnostics fail', async () => {
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async (_input, options) => {
        options?.onConnectionSecured?.({
          ...transportSecurity,
          durationMs: 12,
        });
        return {
          accepted: true,
          providerMessageId: 'synthetic-message-id',
          transportSecurity,
        };
      },
      transportDiagnostics: {
        recordConnectionSecured() {
          throw new Error('synthetic diagnostics failure');
        },
        recordDeliveryCompleted() {
          throw new Error('synthetic diagnostics failure');
        },
        recordFailure() {
          throw new Error('synthetic diagnostics failure');
        },
      },
    });

    await expect(provider.sendEmail(createCustomerInput())).resolves.toMatchObject({
      deliveredTo: 'customer@example.com',
      providerMessageId: 'synthetic-message-id',
    });
  });

  it('preserves a secured transport summary for a later SMTP failure', async () => {
    const recordFailure = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async (_input, options) => {
        options?.onConnectionSecured?.({
          ...transportSecurity,
          durationMs: 12,
        });
        throw new SmtpTransportError(
          'SMTP_AUTHENTICATION_FAILED',
          'authentication',
        );
      },
      transportDiagnostics: {
        recordConnectionSecured: vi.fn(),
        recordDeliveryCompleted: vi.fn(),
        recordFailure,
      },
    });

    await expect(provider.sendEmail(createCustomerInput())).rejects.toMatchObject({
      technicalErrorCode: 'SMTP_AUTHENTICATION_FAILED',
    });
    expect(recordFailure).toHaveBeenCalledWith({
      durationMs: expect.any(Number),
      errorCode: 'SMTP_AUTHENTICATION_FAILED',
      operationId: 'attempt-1',
      outcome: 'failed',
      phase: 'authentication',
      transportSecurity,
    });
  });

  it('does not change the original SMTP failure when diagnostics fail', async () => {
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async () => {
        throw new SmtpTransportError('SMTP_TIMEOUT', 'connect');
      },
      transportDiagnostics: {
        recordConnectionSecured: vi.fn(),
        recordDeliveryCompleted: vi.fn(),
        recordFailure() {
          throw new Error('synthetic diagnostics failure');
        },
      },
    });

    await expect(provider.sendEmail(createCustomerInput())).rejects.toMatchObject({
      technicalErrorCode: 'SMTP_TIMEOUT',
    });
  });
});

const transportSecurity: SmtpTransportSecuritySummary = Object.freeze({
  cipherName: 'TLS_AES_256_GCM_SHA384',
  peerCertificateFingerprint256: Array.from(
    { length: 32 },
    (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
  ).join(':'),
  remoteAddress: '192.0.2.10',
  remoteFamily: 'IPv4',
  smtpProfile: 'dnaSmtp',
  targetPort: 465,
  tlsVersion: 'TLSv1.3',
});

function createInput() {
  return {
    attemptId: 'attempt-1',
    body: 'Synthetic test message',
    companyId: 'company-1',
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.com',
    emailSenderName: 'Example Builder Oy',
    emailTestRecipientOverride: 'safe-recipient@example.com',
    emailUsername: 'billing@example.com',
    pdfContent: Buffer.from('%PDF-1.7\nsynthetic', 'ascii'),
    pdfFileName: 'invoice-2026001.pdf',
    subject: 'Invoice 2026001',
  };
}

function createCustomerInput(): DnaSmtpEmailInput {
  return {
    ...createInput(),
    cc: 'copy@example.com',
    to: 'customer@example.com',
  };
}

function createSecretReader(secret: string | null): CompanyEmailSecretReader {
  return {
    getSecret: async () => secret,
  };
}
