import { InvoiceCalculationError } from './invoiceCalculationError.js';

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n) {
    throw new InvoiceCalculationError('Rounding numerator cannot be negative.');
  }

  if (denominator <= 0n) {
    throw new InvoiceCalculationError('Rounding denominator must be positive.');
  }

  const roundedValue = (numerator + denominator / 2n) / denominator;

  if (roundedValue > maximumSafeInteger) {
    throw new InvoiceCalculationError('Calculated amount exceeds the safe integer range.');
  }

  return Number(roundedValue);
}
