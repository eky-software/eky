export function formatFinnishCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  return match === null ? null : `${match[3]}.${match[2]}.${match[1]}`;
}
