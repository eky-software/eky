export const invoicePaymentBusinessTimeZone = 'Europe/Helsinki';

export function getHelsinkiPaymentDate(date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invoice payment date could not be resolved.');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: invoicePaymentBusinessTimeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError('Invoice payment date could not be resolved.');
  }

  return `${year}-${month}-${day}`;
}
