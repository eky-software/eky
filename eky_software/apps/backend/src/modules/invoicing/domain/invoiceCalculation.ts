export type PriceInputMode = 'net' | 'gross';

export type InvoiceLineDiscount =
  | { type: 'none' }
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; amountCents: number };

export interface InvoiceLineCalculationInput {
  quantityHundredths: number;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  priceInputMode: PriceInputMode;
  discount: InvoiceLineDiscount;
}

export interface CalculatedInvoiceLine {
  quantityHundredths: number;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  priceInputMode: PriceInputMode;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceVatBreakdown {
  vatRateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceTotals {
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  vatBreakdown: InvoiceVatBreakdown[];
}
