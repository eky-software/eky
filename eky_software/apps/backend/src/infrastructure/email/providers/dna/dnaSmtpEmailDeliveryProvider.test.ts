import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretReader } from '../../../../modules/companySettings/ports/companyEmailSecretReader.js';
import { SmtpTransportError } from '../../smtp/smtpErrors.js';
import type { SmtpMessageDeliveryInput } from '../../smtp/smtpTypes.js';
import { DnaSmtpEmailDeliveryProvider } from './dnaSmtpEmailDeliveryProvider.js';

describe('DnaSmtpEmailDeliveryProvider', () => {
  it('forces the test recipient and removes the requested recipient and cc', async () => {
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
    expect(message).not.toContain('actual-customer@example.com');
    expect(message).not.toContain('copy@example.com');
    expect(message).not.toContain('Cc:');
  });

  it.each([
    { emailDeliveryProvider: 'dryRun' },
    { emailSmtpHost: 'attacker.example' },
    { emailSmtpPort: 587 },
    { emailSmtpSecurity: 'starttls' },
    { emailTestRecipientOverride: '' },
    { emailTestRecipientOverride: 'not-an-email' },
    { emailUsername: 'not-an-email' },
  ])('fails before reading the secret for an invalid profile: %o', async (override) => {
    const getSecret = vi.fn(async () => 'synthetic-password');
    const transport = vi.fn();
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: { getSecret },
      transport,
    });

    await expect(
      provider.sendTestEmail({ ...createInput(), ...override }),
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
    const provider = new DnaSmtpEmailDeliveryProvider({
      companyEmailSecretReader: createSecretReader('synthetic-password'),
      transport: async () => {
        throw new SmtpTransportError(
          'SMTP_OUTCOME_UNKNOWN',
          'finalAcceptance',
          'outcomeUnknown',
        );
      },
    });

    const error = await provider.sendTestEmail(createInput()).catch((value) => value);

    expect(error).toMatchObject({
      code: 'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN',
      technicalErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    });
    expect(JSON.stringify(error)).not.toContain('synthetic-password');
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
});

function createInput() {
  return {
    body: 'Synthetic test message',
    cc: 'copy@example.com',
    companyId: 'company-1',
    emailDeliveryProvider: 'smtp',
    emailSenderAddress: 'billing@example.com',
    emailSenderName: 'Example Builder Oy',
    emailSmtpHost: 'smtp.dnamail.fi',
    emailSmtpPort: 465,
    emailSmtpSecurity: 'tls',
    emailTestRecipientOverride: 'safe-recipient@example.com',
    emailUsername: 'billing@example.com',
    pdfContent: Buffer.from('%PDF-1.7\nsynthetic', 'ascii'),
    pdfFileName: 'invoice-2026001.pdf',
    requestedTo: 'actual-customer@example.com',
    subject: 'Invoice 2026001',
  };
}

function createSecretReader(secret: string | null): CompanyEmailSecretReader {
  return {
    getSecret: async () => secret,
  };
}
