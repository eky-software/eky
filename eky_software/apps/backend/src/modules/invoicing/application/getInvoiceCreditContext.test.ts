import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { getInvoiceCreditContext } from './getInvoiceCreditContext.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceCreditContextReader } from '../ports/invoiceCreditContextReader.js';

describe('getInvoiceCreditContext', () => {
  it('reads the context in the trusted company scope', async () => {
    const reader = createReader();
    const context = {
      sourceInvoiceId: 'invoice-1',
      creditInvoices: [],
      creditStatus: 'none' as const,
      remainingCreditableGrossCents: 12_550,
      activeCreditDraftId: null,
    };
    vi.mocked(reader.getInvoiceCreditContext).mockResolvedValue(context);

    await expect(
      getInvoiceCreditContext(
        { companyId: 'company-1', sourceInvoiceId: 'invoice-1' },
        reader,
      ),
    ).resolves.toEqual(context);
    expect(reader.getInvoiceCreditContext).toHaveBeenCalledWith(
      'company-1',
      'invoice-1',
    );
  });

  it('returns the same safe not-found error outside the company scope', async () => {
    const reader = createReader();

    await expect(
      getInvoiceCreditContext(
        { companyId: 'company-1', sourceInvoiceId: 'missing' },
        reader,
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);
  });

  it('validates identifiers before calling the reader', async () => {
    const reader = createReader();

    await expect(
      getInvoiceCreditContext(
        { companyId: 'company-1', sourceInvoiceId: '' },
        reader,
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(reader.getInvoiceCreditContext).not.toHaveBeenCalled();
  });
});

function createReader(): InvoiceCreditContextReader {
  return {
    getInvoiceCreditContext: vi.fn(async () => undefined),
  };
}
