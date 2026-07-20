import {
  EkyApiError,
  type ApprovedInvoiceEmailSmtpPrepareInput,
  type ApprovedInvoiceEmailSmtpSendResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getSendApprovedInvoiceEmailSmtpErrorMessage,
  sendApprovedInvoiceEmailSmtpWithClient,
} from './useSendApprovedInvoiceEmailSmtp.js';
import { uiText } from '../../../i18n/fi.js';

describe('sendApprovedInvoiceEmailSmtpWithClient', () => {
  it('uses preparation authorization before the real SMTP send', async () => {
    const input: ApprovedInvoiceEmailSmtpPrepareInput = {
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const result = {
      deliveredCc: 'copy@example.fi',
      deliveredTo: 'customer@example.fi',
      deliveryEventId: 'delivery-event-1',
      invoice: { id: 'invoice-1', status: 'sent' },
      provider: 'smtp',
      providerMessageId: '<message@example.fi>',
      resend: false,
      testMode: false,
    } as ApprovedInvoiceEmailSmtpSendResult;
    const apiClient = {
      prepareApprovedInvoiceEmailSmtp: vi.fn(async () => ({
        attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        cc: 'copy@example.fi',
        expiresAt: '2026-07-17T22:01:00.000Z',
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        recipient: 'customer@example.fi',
        resend: false,
        subject: input.subject,
      })),
      sendApprovedInvoiceEmailSmtp: vi.fn(async () => result),
    };

    await expect(
      sendApprovedInvoiceEmailSmtpWithClient(apiClient, 'invoice-1', input),
    ).resolves.toBe(result);
    expect(apiClient.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledWith(
      'invoice-1',
      input,
    );
    expect(apiClient.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledWith(
      'invoice-1',
      {
        ...input,
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
      },
    );
  });
});

describe('getSendApprovedInvoiceEmailSmtpErrorMessage', () => {
  it('shows a calm message when the native confirmation is cancelled', () => {
    const error = new EkyApiError('Sähköpostilähetys peruutettiin.', {
      responseBody: { technicalDetail: 'must-not-leak' },
      status: 409,
    });

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpCancelled);
    expect(message).not.toContain('technicalDetail');
  });

  it('warns against an automatic retry when the outcome is unknown', () => {
    const error = new EkyApiError(
      'Invoice email delivery outcome is unknown.',
      {
        responseBody: { stack: 'must-not-leak' },
        status: 502,
      },
    );

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpOutcomeUnknown);
    expect(message).not.toContain('stack');
  });

  it('uses a safe Finnish message for provider failures', () => {
    const error = new EkyApiError('Internal SMTP details', {
      responseBody: { password: 'must-not-leak' },
      status: 502,
    });

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpError);
    expect(message).not.toContain('password');
    expect(message).not.toContain('SMTP details');
  });
});
