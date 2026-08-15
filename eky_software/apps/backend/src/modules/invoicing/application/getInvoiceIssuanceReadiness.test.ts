import { describe, expect, it } from 'vitest';

import type { InvoiceIssuanceReadinessData } from '../domain/invoiceIssuanceReadiness.js';
import type { InvoiceIssuanceReadinessReader } from '../ports/invoiceIssuanceReadinessReader.js';
import { getInvoiceIssuanceReadiness } from './getInvoiceIssuanceReadiness.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

class FakeInvoiceIssuanceReadinessReader
  implements InvoiceIssuanceReadinessReader
{
  calls: Array<{ companyId: string; invoiceDraftId: string }> = [];

  constructor(private readonly data?: InvoiceIssuanceReadinessData) {}

  async getReadinessData(companyId: string, invoiceDraftId: string) {
    this.calls.push({ companyId, invoiceDraftId });
    return this.data;
  }
}

const completeData: InvoiceIssuanceReadinessData = {
  billingRecipientCity: 'Turku',
  billingRecipientName: 'Recipient Oy',
  billingRecipientPostalCode: '20100',
  billingRecipientStreetAddress: 'Recipient street 1',
  companyBusinessId: '1234567-8',
  companyCity: 'Turku',
  companyIban: 'FI2112345600000785',
  companyName: 'Seller Oy',
  companyPostalCode: '20100',
  companyStreetAddress: 'Seller street 1',
  companyVatNumber: 'FI12345678',
  customerCity: 'Turku',
  customerName: 'Customer Oy',
  customerPostalCode: '20100',
  customerStreetAddress: 'Customer street 1',
  hasActiveInvoiceNumberingSettings: true,
};

describe('getInvoiceIssuanceReadiness', () => {
  it('returns ready without writing when all issuance data exists', async () => {
    const reader = new FakeInvoiceIssuanceReadinessReader(completeData);

    await expect(
      getInvoiceIssuanceReadiness(
        { companyId: ' dev-company ', invoiceDraftId: ' draft-1 ' },
        reader,
      ),
    ).resolves.toEqual({ isReady: true, issues: [] });
    expect(reader.calls).toEqual([
      { companyId: 'dev-company', invoiceDraftId: 'draft-1' },
    ]);
  });

  it('returns only named issue codes for incomplete data', async () => {
    const reader = new FakeInvoiceIssuanceReadinessReader({
      ...completeData,
      companyIban: '',
      customerStreetAddress: ' ',
    });

    await expect(
      getInvoiceIssuanceReadiness(
        { companyId: 'dev-company', invoiceDraftId: 'draft-1' },
        reader,
      ),
    ).resolves.toEqual({
      isReady: false,
      issues: ['companyIbanMissing', 'customerAddressMissing'],
    });
  });

  it('reports missing active invoice numbering settings before approval', async () => {
    const reader = new FakeInvoiceIssuanceReadinessReader({
      ...completeData,
      hasActiveInvoiceNumberingSettings: false,
    });

    await expect(
      getInvoiceIssuanceReadiness(
        { companyId: 'dev-company', invoiceDraftId: 'draft-1' },
        reader,
      ),
    ).resolves.toEqual({
      isReady: false,
      issues: ['invoiceNumberingSettingsMissing'],
    });
  });

  it('uses the generic not-found result outside the company scope', async () => {
    const reader = new FakeInvoiceIssuanceReadinessReader();

    await expect(
      getInvoiceIssuanceReadiness(
        { companyId: 'other-company', invoiceDraftId: 'draft-1' },
        reader,
      ),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
  });
});
