export const activityBusinessTimeZone = 'Europe/Helsinki';

const helsinkiMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  month: '2-digit',
  timeZone: activityBusinessTimeZone,
  year: 'numeric',
});

export function getHelsinkiActivityMonth(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Activity date is invalid.');
  }

  const parts = new Map(
    helsinkiMonthFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');

  if (year === undefined || month === undefined) {
    throw new RangeError('Helsinki activity month could not be resolved.');
  }
  return `${year}-${month}`;
}
