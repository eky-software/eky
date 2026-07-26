import type {
  CalculatedInvoiceLine,
  InvoiceLineCalculationInput,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import {
  calculateInvoiceLineBase,
  requireNonNegativeSafeInteger,
} from './invoiceLineBaseCalculation.js';
import { roundHalfUp } from './roundHalfUp.js';

const basisPointsScale = 10_000n;

function requirePriceInputMode(priceInputMode: PriceInputMode): void {
  if (priceInputMode !== 'net' && priceInputMode !== 'gross') {
    throw new InvoiceCalculationError('Price input mode must be net or gross.');
  }
}

export function calculateInvoiceLine(
  input: InvoiceLineCalculationInput,
): CalculatedInvoiceLine {
  requireNonNegativeSafeInteger(input.vatRateBasisPoints, 'VAT rate');
  requirePriceInputMode(input.priceInputMode);

  const { baseCents, discountCents, discountedBaseCents } =
    calculateInvoiceLineBase(input);

  if (input.priceInputMode === 'net') {
    const netCents = discountedBaseCents;
    const vatCents = roundHalfUp(
      BigInt(netCents) * BigInt(input.vatRateBasisPoints),
      basisPointsScale,
    );
    const grossCents = netCents + vatCents;

    if (!Number.isSafeInteger(grossCents)) {
      throw new InvoiceCalculationError('Calculated amount exceeds the safe integer range.');
    }

    return {
      quantityHundredths: input.quantityHundredths,
      unitPriceCents: input.unitPriceCents,
      vatRateBasisPoints: input.vatRateBasisPoints,
      priceInputMode: input.priceInputMode,
      baseCents,
      discountCents,
      netCents,
      vatCents,
      grossCents,
    };
  }

  const grossCents = discountedBaseCents;
  const netCents = roundHalfUp(
    BigInt(grossCents) * basisPointsScale,
    basisPointsScale + BigInt(input.vatRateBasisPoints),
  );
  const vatCents = grossCents - netCents;

  return {
    quantityHundredths: input.quantityHundredths,
    unitPriceCents: input.unitPriceCents,
    vatRateBasisPoints: input.vatRateBasisPoints,
    priceInputMode: input.priceInputMode,
    baseCents,
    discountCents,
    netCents,
    vatCents,
    grossCents,
  };
}
