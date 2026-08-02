import { InvoiceNumberingError } from './invoiceNumberingError.js';

export type ReferenceNumberType = 'finnishDomestic' | 'none';

const finnishDomesticReferenceWeights = [7, 3, 1] as const;
const maximumFinnishDomesticReferenceNumberLength = 20;
export const maximumFinnishDomesticReferenceBaseLength =
  maximumFinnishDomesticReferenceNumberLength - 1;

export function createFinnishDomesticReferenceNumber(baseDigits: string): string {
  validateReferenceDigits(
    baseDigits,
    'Reference number base',
    maximumFinnishDomesticReferenceBaseLength,
  );

  const checkDigit = calculateFinnishDomesticReferenceCheckDigit(baseDigits);

  return `${baseDigits}${checkDigit}`;
}

export function validateFinnishDomesticReferenceNumber(value: string): void {
  validateReferenceDigits(
    value,
    'Reference number',
    maximumFinnishDomesticReferenceNumberLength,
  );

  if (value.length < 2) {
    throw new InvoiceNumberingError('Reference number must include a check digit.');
  }

  const baseDigits = value.slice(0, -1);
  const expectedReferenceNumber = createFinnishDomesticReferenceNumber(baseDigits);

  if (value !== expectedReferenceNumber) {
    throw new InvoiceNumberingError('Reference number check digit is invalid.');
  }
}

function calculateFinnishDomesticReferenceCheckDigit(baseDigits: string): number {
  let sum = 0;

  for (let index = baseDigits.length - 1; index >= 0; index -= 1) {
    const digit = Number(baseDigits[index]);
    const weightIndex = ((baseDigits.length - 1 - index) %
      finnishDomesticReferenceWeights.length) as 0 | 1 | 2;
    const weight = finnishDomesticReferenceWeights[weightIndex];

    sum += digit * weight;
  }

  return (10 - (sum % 10)) % 10;
}

function validateReferenceDigits(
  value: string,
  label: string,
  maximumLength: number,
): void {
  if (value.length === 0) {
    throw new InvoiceNumberingError(`${label} must not be empty.`);
  }

  if (!/^\d+$/.test(value)) {
    throw new InvoiceNumberingError(`${label} must contain only digits.`);
  }

  if (value.length > maximumLength) {
    throw new InvoiceNumberingError(`${label} must be ${maximumLength} digits or less.`);
  }
}
