import {
  EkyApiError,
  type ApprovedInvoiceEmailSmtpTestSendInput,
  type ApprovedInvoiceEmailSmtpTestSendResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getSendApprovedInvoiceEmailSmtpTestErrorMessage,
  sendApprovedInvoiceEmailSmtpTestWithClient,
} from './useSendApprovedInvoiceEmailSmtpTest.js';
import { uiText } from '../../../i18n/fi.js';

describe('sendApprovedInvoiceEmailSmtpTestWithClient', () => {
  it('uses the controlled SMTP test api-client operation', async () => {
    const result: ApprovedInvoiceEmailSmtpTestSendResult = {
      deliveredTo: 'safe-test@example.fi',
      deliveryEventId: 'delivery-event-1',
      provider: 'smtp',
      providerMessageId: '<message-1@example.fi>',
      testMode: true,
    };
    const input: ApprovedInvoiceEmailSmtpTestSendInput = {
      body: 'Hei,\n\nLiitteenä testilasku.',
      cc: 'customer-copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const apiClient = {
      sendApprovedInvoiceEmailSmtpTest: vi.fn(async () => result),
    };

    await expect(
      sendApprovedInvoiceEmailSmtpTestWithClient(
        apiClient,
        'invoice-1',
        input,
      ),
    ).resolves.toBe(result);
    expect(apiClient.sendApprovedInvoiceEmailSmtpTest).toHaveBeenCalledWith(
      'invoice-1',
      input,
    );
  });
});

describe('getSendApprovedInvoiceEmailSmtpTestErrorMessage', () => {
  it('warns not to retry when the delivery outcome is unknown', () => {
    const error = new EkyApiError(
      'Invoice email delivery outcome is unknown.',
      {
        responseBody: { stack: 'secret stack' },
        status: 502,
      },
    );

    const message = getSendApprovedInvoiceEmailSmtpTestErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpTestOutcomeUnknown);
    expect(message).not.toContain('stack');
  });

  it('uses a safe Finnish message for other provider failures', () => {
    const error = new EkyApiError('Internal SMTP details', {
      responseBody: { password: 'must-not-leak' },
      status: 502,
    });

    const message = getSendApprovedInvoiceEmailSmtpTestErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpTestError);
    expect(message).not.toContain('password');
    expect(message).not.toContain('SMTP details');
  });
});
