import type {
  CalculatedInvoiceLine,
  InvoiceLineCalculationInput,
  InvoiceLineDiscount,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { roundHalfUp } from './roundHalfUp.js';

const quantityScale = 100n;
const basisPointsScale = 10_000n;

function requireNonNegativeSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvoiceCalculationError(`${fieldName} must be a safe integer.`);
  }

  if (value < 0) {
    throw new InvoiceCalculationError(`${fieldName} cannot be negative.`);
  }
}

function requirePriceInputMode(priceInputMode: PriceInputMode): void {
  if (priceInputMode !== 'net' && priceInputMode !== 'gross') {
    throw new InvoiceCalculationError('Price input mode must be net or gross.');
  }
}

function calculateDiscountCents(
  baseCents: number,
  discount: InvoiceLineDiscount,
): number {
  if (discount.type === 'none') {
    return 0;
  }

  if (discount.type === 'percentage') {
    requireNonNegativeSafeInteger(discount.basisPoints, 'Discount basis points');

    if (discount.basisPoints > Number(basisPointsScale)) {
      throw new InvoiceCalculationError('Discount cannot exceed the line value.');
    }

    return roundHalfUp(
      BigInt(baseCents) * BigInt(discount.basisPoints),
      basisPointsScale,
    );
  }

  if (discount.type === 'fixed') {
    requireNonNegativeSafeInteger(discount.amountCents, 'Discount amount');
    return discount.amountCents;
  }

  throw new InvoiceCalculationError('Discount type is invalid.');
}

export function calculateInvoiceLine(
  input: InvoiceLineCalculationInput,
): CalculatedInvoiceLine {
  requireNonNegativeSafeInteger(input.quantityHundredths, 'Quantity');
  requireNonNegativeSafeInteger(input.unitPriceCents, 'Unit price');
  requireNonNegativeSafeInteger(input.vatRateBasisPoints, 'VAT rate');
  requirePriceInputMode(input.priceInputMode);

  const baseCents = roundHalfUp(
    BigInt(input.unitPriceCents) * BigInt(input.quantityHundredths),
    quantityScale,
  );
  const discountCents = calculateDiscountCents(baseCents, input.discount);

  if (discountCents > baseCents) {
    throw new InvoiceCalculationError('Discount cannot exceed the line value.');
  }

  const discountedBaseCents = baseCents - discountCents;

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
