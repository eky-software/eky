export const maximumInvoiceUnitLength = 8;

const invoiceUnitPattern = /^[\p{L}\p{N}.-]+$/u;

export function normalizeInvoiceUnit(value: string): string {
  return value.trim();
}

export function isValidInvoiceUnit(value: string): boolean {
  const normalizedValue = normalizeInvoiceUnit(value);

  return (
    normalizedValue.length > 0 &&
    normalizedValue.length <= maximumInvoiceUnitLength &&
    invoiceUnitPattern.test(normalizedValue)
  );
}
