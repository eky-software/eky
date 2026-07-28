export const activityBusinessTimeZone = 'Europe/Helsinki';

const helsinkiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: activityBusinessTimeZone,
  year: 'numeric',
});

export interface ActivityMonthUtcRange {
  from: string;
  to: string;
}

export function formatHelsinkiCalendarMonth(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Activity date is invalid.');
  }

  const parts = readHelsinkiDateTimeParts(date);
  return `${parts.year}-${padTwoDigits(parts.month)}`;
}

export function getHelsinkiCalendarMonthUtcRange(
  month: string,
): ActivityMonthUtcRange {
  if (!isActivityCalendarMonth(month)) {
    throw new RangeError('Activity month is invalid.');
  }

  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const nextMonth =
    monthNumber === 12
      ? { month: 1, year: year + 1 }
      : { month: monthNumber + 1, year };

  return {
    from: helsinkiLocalMidnightToUtc(year, monthNumber, 1).toISOString(),
    to: helsinkiLocalMidnightToUtc(
      nextMonth.year,
      nextMonth.month,
      1,
    ).toISOString(),
  };
}

export function isActivityCalendarMonth(value: string): boolean {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 9999;
}

interface HelsinkiDateTimeParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

function helsinkiLocalMidnightToUtc(
  year: number,
  month: number,
  day: number,
): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const local = readHelsinkiDateTimeParts(new Date(candidate));
    const displayedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const adjustment = targetAsUtc - displayedAsUtc;

    if (adjustment === 0) {
      break;
    }
    candidate += adjustment;
  }

  const result = new Date(candidate);
  const local = readHelsinkiDateTimeParts(result);
  if (
    local.year !== year ||
    local.month !== month ||
    local.day !== day ||
    local.hour !== 0 ||
    local.minute !== 0 ||
    local.second !== 0
  ) {
    throw new RangeError('Helsinki calendar boundary could not be resolved.');
  }

  return result;
}

function readHelsinkiDateTimeParts(date: Date): HelsinkiDateTimeParts {
  const parts = helsinkiDateTimeFormatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    day: readNumericPart(values, 'day'),
    hour: readNumericPart(values, 'hour'),
    minute: readNumericPart(values, 'minute'),
    month: readNumericPart(values, 'month'),
    second: readNumericPart(values, 'second'),
    year: readNumericPart(values, 'year'),
  };
}

function readNumericPart(
  values: ReadonlyMap<string, string>,
  name: string,
): number {
  const value = values.get(name);
  if (value === undefined) {
    throw new RangeError(`Helsinki date part ${name} is missing.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new RangeError(`Helsinki date part ${name} is invalid.`);
  }
  return parsed;
}

function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
