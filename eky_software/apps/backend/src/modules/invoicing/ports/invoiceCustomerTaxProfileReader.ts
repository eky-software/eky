import type { InvoiceCustomerTaxProfile } from '../domain/invoiceTaxTreatment.js';

export interface InvoiceCustomerTaxProfileReader {
  getTaxProfile(
    customerId: string,
    companyId: string,
  ): Promise<InvoiceCustomerTaxProfile | undefined>;
}
