import { ekyBusinessTimeZone } from './businessTimeZone.js';

const finnishDateTimeFormatter = new Intl.DateTimeFormat('fi-FI', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: ekyBusinessTimeZone,
});

export function formatFinnishDateTime(
  value: Date | string,
): string | null {
  const date = typeof value === 'string' ? new Date(value) : value;

  return Number.isFinite(date.getTime())
    ? finnishDateTimeFormatter.format(date)
    : null;
}
