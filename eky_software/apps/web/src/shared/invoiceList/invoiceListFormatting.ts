import { formatFinnishCalendarDate } from '../date/formatFinnishCalendarDate.js';
import { formatEuroCents } from '../money/formatEuroCents.js';

export function formatInvoiceListCurrency(cents: number): string {
  return formatEuroCents(cents);
}

export function formatInvoiceListDate(value: string): string {
  const datePart = value.slice(0, 10);

  return formatFinnishCalendarDate(datePart) ?? value;
}
