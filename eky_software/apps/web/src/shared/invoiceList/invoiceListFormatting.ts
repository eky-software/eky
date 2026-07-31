const invoiceListCurrencyFormatter = new Intl.NumberFormat('fi-FI', {
  currency: 'EUR',
  style: 'currency',
});

export function formatInvoiceListCurrency(cents: number): string {
  return invoiceListCurrencyFormatter.format(cents / 100);
}

export function formatInvoiceListDate(value: string): string {
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (match === null) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}
