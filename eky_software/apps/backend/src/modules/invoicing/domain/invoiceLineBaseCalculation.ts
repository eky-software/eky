import type { InvoiceLineDiscount } from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { roundHalfUp } from './roundHalfUp.js';

const quantityScale = 100n;
const basisPointsScale = 10_000n;

export interface InvoiceLineBaseCalculationInput {
  quantityHundredths: number;
  unitPriceCents: number;
  discount: InvoiceLineDiscount;
}

export interface InvoiceLineBaseCalculation {
  baseCents: number;
  discountCents: number;
  discountedBaseCents: number;
}

export function calculateInvoiceLineBase(
  input: InvoiceLineBaseCalculationInput,
): InvoiceLineBaseCalculation {
  requireNonNegativeSafeInteger(input.quantityHundredths, 'Quantity');
  requireNonNegativeSafeInteger(input.unitPriceCents, 'Unit price');

  const baseCents = roundHalfUp(
    BigInt(input.unitPriceCents) * BigInt(input.quantityHundredths),
    quantityScale,
  );
  const discountCents = calculateDiscountCents(baseCents, input.discount);

  if (discountCents > baseCents) {
    throw new InvoiceCalculationError(
      'Discount cannot exceed the line value.',
    );
  }

  return {
    baseCents,
    discountCents,
    discountedBaseCents: baseCents - discountCents,
  };
}

export function requireNonNegativeSafeInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvoiceCalculationError(`${fieldName} must be a safe integer.`);
  }

  if (value < 0) {
    throw new InvoiceCalculationError(`${fieldName} cannot be negative.`);
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
    requireNonNegativeSafeInteger(
      discount.basisPoints,
      'Discount basis points',
    );

    if (discount.basisPoints > Number(basisPointsScale)) {
      throw new InvoiceCalculationError(
        'Discount cannot exceed the line value.',
      );
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
