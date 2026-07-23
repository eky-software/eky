import {
  EkyApiError,
  type ApprovedCreditInvoiceResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  approveCreditInvoiceDraftWithClient,
  getApproveCreditInvoiceDraftErrorMessage,
} from './useApproveCreditInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

describe('approveCreditInvoiceDraftWithClient', () => {
  it('sends only the credit draft id through the API client', async () => {
    const approvedInvoice = createResult();
    const apiClient = {
      approveCreditInvoiceDraft: vi.fn(async () => approvedInvoice),
    };

    await expect(
      approveCreditInvoiceDraftWithClient(apiClient, 'draft-1'),
    ).resolves.toBe(approvedInvoice);
    expect(apiClient.approveCreditInvoiceDraft).toHaveBeenCalledWith('draft-1');
  });
});

describe('getApproveCreditInvoiceDraftErrorMessage', () => {
  it('maps a changed credit capacity to a safe conflict message', () => {
    const message = getApproveCreditInvoiceDraftErrorMessage(
      new EkyApiError('SQLITE_CONSTRAINT_SECRET', {
        responseBody: { stack: 'secret stack' },
        status: 409,
      }),
    );

    expect(message).toBe(uiText.invoicing.creditDraftApprovalConflict);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('does not expose unknown API response details', () => {
    const message = getApproveCreditInvoiceDraftErrorMessage(
      new EkyApiError('internal path', {
        responseBody: { path: 'D:/secret/path', stack: 'secret stack' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.creditDraftApprovalError);
    expect(message).not.toContain('path');
    expect(message).not.toContain('stack');
  });
});

function createResult(): ApprovedCreditInvoiceResult {
  return {
    invoiceId: 'credit-invoice-1',
    draftId: 'draft-1',
    invoiceNumber: '20260002',
    sequenceNumber: 2,
    sequenceScope: 'calendar-year:2026',
    numberingMode: 'calendarYearSequence',
    status: 'approved',
  };
}
