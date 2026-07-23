export const invoiceKinds = ['standard', 'credit'] as const;

export type InvoiceKind = (typeof invoiceKinds)[number];

export function isInvoiceKind(value: unknown): value is InvoiceKind {
  return (
    typeof value === 'string' &&
    invoiceKinds.includes(value as InvoiceKind)
  );
}
