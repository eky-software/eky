import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  cancelApprovedInvoiceWithClient,
  getCancelApprovedInvoiceErrorMessage,
} from './useCancelApprovedInvoice.js';
import { uiText } from '../../../i18n/fi.js';

describe('cancelApprovedInvoiceWithClient', () => {
  it('uses the api-client cancellation contract', async () => {
    const cancellation = {
      cancellationReason: 'Duplicate invoice',
      cancelledAt: '2026-07-23T18:00:00.000Z',
      cancelledBy: 'local-owner',
      invoiceId: 'invoice-1',
      invoiceKind: 'standard',
      invoiceNumber: '20260001',
      status: 'cancelled',
    } as const;
    const apiClient = {
      cancelApprovedInvoice: vi.fn(async () => cancellation),
    };
    const input = {
      cancellationReason: 'Duplicate invoice',
      confirmationInvoiceNumber: '20260001',
    };

    await expect(
      cancelApprovedInvoiceWithClient(apiClient, 'invoice-1', input),
    ).resolves.toBe(cancellation);
    expect(apiClient.cancelApprovedInvoice).toHaveBeenCalledWith(
      'invoice-1',
      input,
    );
  });
});

describe('getCancelApprovedInvoiceErrorMessage', () => {
  it.each([
    [400, uiText.invoicing.cancelApprovedInvoiceValidationError],
    [404, uiText.invoicing.approvedInvoiceNotFound],
    [409, uiText.invoicing.cancelApprovedInvoiceConflictError],
  ])('maps status %s to a safe Finnish message', (status, expectedMessage) => {
    expect(
      getCancelApprovedInvoiceErrorMessage(
        new EkyApiError('Technical backend message', { status }),
      ),
    ).toBe(expectedMessage);
  });

  it('does not expose response body or stack details', () => {
    const message = getCancelApprovedInvoiceErrorMessage(
      new EkyApiError('Unexpected backend stack trace', {
        responseBody: { stack: 'secret stack' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.cancelApprovedInvoiceError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});
