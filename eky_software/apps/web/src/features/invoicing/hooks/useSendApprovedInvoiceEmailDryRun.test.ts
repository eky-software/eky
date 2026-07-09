import {
  EkyApiError,
  type ApprovedInvoiceEmailDryRunSendInput,
  type ApprovedInvoiceEmailDryRunSendResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getSendApprovedInvoiceEmailDryRunErrorMessage,
  sendApprovedInvoiceEmailDryRunWithClient,
} from './useSendApprovedInvoiceEmailDryRun.js';
import { uiText } from '../../../i18n/fi.js';

describe('sendApprovedInvoiceEmailDryRunWithClient', () => {
  it('sends edited dry-run email fields with api-client', async () => {
    const result = createApprovedInvoiceEmailDryRunSendResult();
    const input: ApprovedInvoiceEmailDryRunSendInput = {
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001 - muokattu',
      to: 'recipient@example.fi',
    };
    const apiClient = {
      sendApprovedInvoiceEmailDryRun: vi.fn(async () => result),
    };

    await expect(
      sendApprovedInvoiceEmailDryRunWithClient(apiClient, 'invoice-1', input),
    ).resolves.toBe(result);
    expect(apiClient.sendApprovedInvoiceEmailDryRun).toHaveBeenCalledWith(
      'invoice-1',
      input,
    );
  });
});

describe('getSendApprovedInvoiceEmailDryRunErrorMessage', () => {
  it('maps validation errors to a safe Finnish message', () => {
    const error = new EkyApiError('Invalid invoice email body.', {
      responseBody: { stack: 'secret stack' },
      status: 400,
    });

    const message = getSendApprovedInvoiceEmailDryRunErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailDryRunValidationError);
    expect(message).not.toContain('stack');
  });

  it('maps not found to a safe Finnish message', () => {
    const error = new EkyApiError('Approved invoice was not found.', {
      status: 404,
    });

    expect(getSendApprovedInvoiceEmailDryRunErrorMessage(error)).toBe(
      uiText.invoicing.approvedInvoiceNotFound,
    );
  });

  it('does not expose response body or stack details for unknown API errors', () => {
    const error = new EkyApiError('Unexpected backend stack trace', {
      responseBody: { stack: 'secret stack' },
      status: 502,
    });

    const message = getSendApprovedInvoiceEmailDryRunErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailDryRunSendError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

function createApprovedInvoiceEmailDryRunSendResult(): ApprovedInvoiceEmailDryRunSendResult {
  return {
    deliveryEventId: 'delivery-event-1',
    email: {
      attachment: {
        documentId: 'document-1',
        fileName: 'lasku-20260001.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
      },
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      provider: 'dryRun',
      subject: 'Lasku 20260001 - muokattu',
      to: 'recipient@example.fi',
    },
    providerResult: {
      provider: 'dryRun',
      providerMessageId: null,
    },
  };
}
