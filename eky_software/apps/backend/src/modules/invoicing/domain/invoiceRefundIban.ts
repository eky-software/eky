import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

export function normalizeOptionalRefundIban(value: string): string {
  const normalizedValue = value.replace(/\s+/g, '').toUpperCase();
  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length < 15 ||
    normalizedValue.length > 34 ||
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalizedValue) ||
    !hasValidIbanChecksum(normalizedValue)
  ) {
    throw new InvoiceDraftValidationError('Refund IBAN is invalid.');
  }

  return normalizedValue;
}

function hasValidIbanChecksum(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const character of rearranged) {
    const numericValue = /[0-9]/.test(character)
      ? character
      : String(character.charCodeAt(0) - 55);

    for (const digit of numericValue) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}
