export const invoicePaymentBusinessTimeZone = 'Europe/Helsinki';

export interface InvoicePaymentClock {
  now(): Date;
}

export const systemInvoicePaymentClock: InvoicePaymentClock = Object.freeze({
  now: () => new Date(),
});

const helsinkiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: invoicePaymentBusinessTimeZone,
  year: 'numeric',
});

export function getHelsinkiCalendarDate(date: Date): string {
  const parts = new Map(
    helsinkiDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}
