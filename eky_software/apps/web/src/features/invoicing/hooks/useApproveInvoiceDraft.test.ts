import {
  EkyApiError,
  type ApprovedInvoiceResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  approveInvoiceDraftWithClient,
  getApproveInvoiceDraftErrorMessage,
} from './useApproveInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

describe('approveInvoiceDraftWithClient', () => {
  it('calls approveInvoiceDraft with only the draft id', async () => {
    const approvedInvoice = createApprovedInvoiceResult();
    const apiClient = {
      approveInvoiceDraft: vi.fn(async () => approvedInvoice),
    };

    await expect(
      approveInvoiceDraftWithClient(apiClient, 'draft-1'),
    ).resolves.toBe(approvedInvoice);

    expect(apiClient.approveInvoiceDraft).toHaveBeenCalledWith('draft-1');
    expect(apiClient.approveInvoiceDraft).not.toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        actorUserId: expect.anything(),
        approvedAt: expect.anything(),
        companyId: expect.anything(),
        invoiceNumber: expect.anything(),
        referenceNumber: expect.anything(),
        referenceNumberType: expect.anything(),
      }),
    );
  });
});

describe('getApproveInvoiceDraftErrorMessage', () => {
  it('returns a safe not found message for 404 errors', () => {
    const message = getApproveInvoiceDraftErrorMessage(
      new EkyApiError('SQLITE_SECRET_PATH', {
        responseBody: {
          stack: 'secret stack',
        },
        status: 404,
      }),
    );

    expect(message).toBe(uiText.invoicing.approveDraftNotFound);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('returns a generic safe message for unknown API errors', () => {
    const message = getApproveInvoiceDraftErrorMessage(
      new EkyApiError('SQLITE_INTERNAL_SECRET', {
        responseBody: {
          responseBody: 'raw body',
          stack: 'secret stack',
        },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.approveDraftError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });

  it('returns a generic safe message for non-API errors', () => {
    expect(
      getApproveInvoiceDraftErrorMessage(new Error('stack trace')),
    ).toBe(uiText.invoicing.approveDraftError);
  });
});

function createApprovedInvoiceResult(): ApprovedInvoiceResult {
  return {
    draftId: 'draft-1',
    invoiceId: 'invoice-1',
    invoiceNumber: '2026001',
    numberingMode: 'calendarYearSequence',
    referenceNumber: '20260015',
    referenceNumberType: 'finnishDomestic',
    sequenceNumber: 1,
    sequenceScope: '2026',
    status: 'approved',
  };
}
