import { describe, expect, it, vi } from 'vitest';

import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';
import { listSentInvoiceGroups } from './listSentInvoiceGroups.js';

describe('listSentInvoiceGroups', () => {
  it('passes a company-scoped root pagination query to the reader', async () => {
    const reader = createReader();
    vi.mocked(reader.listSentInvoiceGroups).mockResolvedValue({
      groups: [],
      totalCount: 41,
    });

    await expect(
      listSentInvoiceGroups(
        {
          companyId: 'dev-company',
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
          page: 2,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).resolves.toEqual({
      groups: [],
      page: 2,
      pageSize: 20,
      totalCount: 41,
      totalPages: 3,
    });
    expect(reader.listSentInvoiceGroups).toHaveBeenCalledWith({
      companyId: 'dev-company',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 20,
      offset: 20,
      sort: 'invoiceDateDesc',
    });
  });

  it('rejects invalid pagination before calling the reader', async () => {
    const reader = createReader();

    await expect(
      listSentInvoiceGroups(
        {
          companyId: 'dev-company',
          page: 0,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(reader.listSentInvoiceGroups).not.toHaveBeenCalled();
  });
});

function createReader(): SentInvoiceGroupReader {
  return {
    listSentInvoiceGroups: vi.fn(async () => ({
      groups: [],
      totalCount: 0,
    })),
  };
}
