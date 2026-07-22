export interface InvoiceVatRate {
  rateBasisPoints: number;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export interface InvoiceVatRatesView {
  vatRates: InvoiceVatRate[];
  isPersisted: boolean;
}

export interface UpdateInvoiceVatRatesRequest {
  vatRates: InvoiceVatRate[];
}

export interface InvoiceVatRatesApi {
  getInvoiceVatRates(): Promise<InvoiceVatRatesView>;
  updateInvoiceVatRates(
    input: UpdateInvoiceVatRatesRequest,
  ): Promise<InvoiceVatRatesView>;
}
