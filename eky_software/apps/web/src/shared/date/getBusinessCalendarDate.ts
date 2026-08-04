import { ekyBusinessTimeZone } from './businessTimeZone.js';

const businessCalendarDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: ekyBusinessTimeZone,
  year: 'numeric',
});

export function getBusinessCalendarDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Business calendar date is invalid.');
  }

  const parts = new Map(
    businessCalendarDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError('Business calendar date could not be resolved.');
  }

  return `${year}-${month}-${day}`;
}
