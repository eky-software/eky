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
          customerId: ' customer-1 ',
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
      customerId: 'customer-1',
      creditState: 'all',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 20,
      offset: 20,
      paymentState: 'all',
      sort: 'invoiceDateDesc',
    });
  });

  it('passes the requested credit-state filter to the reader', async () => {
    const reader = createReader();

    await listSentInvoiceGroups(
      {
        companyId: 'dev-company',
        creditState: 'credited',
        page: 1,
        pageSize: 20,
        sort: 'invoiceDateDesc',
      },
      reader,
    );

    expect(reader.listSentInvoiceGroups).toHaveBeenCalledWith(
      expect.objectContaining({ creditState: 'credited' }),
    );
  });

  it('passes the requested payment-state filter to the reader', async () => {
    const reader = createReader();

    await listSentInvoiceGroups(
      {
        companyId: 'dev-company',
        page: 1,
        pageSize: 20,
        paymentState: 'paid',
        sort: 'invoiceDateDesc',
      },
      reader,
    );

    expect(reader.listSentInvoiceGroups).toHaveBeenCalledWith(
      expect.objectContaining({ paymentState: 'paid' }),
    );
  });

  it('rejects an unsupported credit-state filter before calling the reader', async () => {
    const reader = createReader();

    await expect(
      listSentInvoiceGroups(
        {
          companyId: 'dev-company',
          creditState: 'other' as 'credited',
          page: 1,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(reader.listSentInvoiceGroups).not.toHaveBeenCalled();
  });

  it('rejects an unsupported payment-state filter before calling the reader', async () => {
    const reader = createReader();

    await expect(
      listSentInvoiceGroups(
        {
          companyId: 'dev-company',
          page: 1,
          pageSize: 20,
          paymentState: 'other' as 'paid',
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(reader.listSentInvoiceGroups).not.toHaveBeenCalled();
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

  it('rejects an invalid customer filter before calling the reader', async () => {
    const reader = createReader();

    await expect(
      listSentInvoiceGroups(
        {
          companyId: 'dev-company',
          customerId: 'x'.repeat(201),
          page: 1,
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
