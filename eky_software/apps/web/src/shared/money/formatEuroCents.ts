const euroCentsFormatter = new Intl.NumberFormat('fi-FI', {
  currency: 'EUR',
  style: 'currency',
});

export function formatEuroCents(cents: number): string {
  return euroCentsFormatter.format(cents / 100);
}
