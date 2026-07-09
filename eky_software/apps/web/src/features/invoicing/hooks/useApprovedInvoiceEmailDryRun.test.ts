import { EkyApiError, type ApprovedInvoiceEmailPreview } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getApprovedInvoiceEmailDryRunErrorMessage,
  prepareApprovedInvoiceEmailDryRunWithClient,
} from './useApprovedInvoiceEmailDryRun.js';
import { uiText } from '../../../i18n/fi.js';

describe('prepareApprovedInvoiceEmailDryRunWithClient', () => {
  it('prepares a dry-run email with api-client', async () => {
    const email = createApprovedInvoiceEmailPreview();
    const apiClient = {
      prepareApprovedInvoiceEmailDryRun: vi.fn(async () => email),
    };

    await expect(
      prepareApprovedInvoiceEmailDryRunWithClient(apiClient, 'invoice-1'),
    ).resolves.toBe(email);
    expect(apiClient.prepareApprovedInvoiceEmailDryRun).toHaveBeenCalledWith(
      'invoice-1',
    );
  });
});

describe('getApprovedInvoiceEmailDryRunErrorMessage', () => {
  it('maps not found to a safe Finnish message', () => {
    const error = new EkyApiError('Approved invoice was not found.', {
      status: 404,
    });

    expect(getApprovedInvoiceEmailDryRunErrorMessage(error)).toBe(
      uiText.invoicing.approvedInvoiceNotFound,
    );
  });

  it('does not expose response body or stack details', () => {
    const error = new EkyApiError('Unexpected backend stack trace', {
      responseBody: { stack: 'secret stack' },
      status: 500,
    });

    const message = getApprovedInvoiceEmailDryRunErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailPrepareError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

function createApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}
