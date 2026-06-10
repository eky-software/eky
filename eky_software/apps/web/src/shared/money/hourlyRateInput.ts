export function euroInputToCents(value: string): number | null {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const normalizedValue = trimmedValue.replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizedValue);

  if (match === null) {
    throw new Error('Invalid hourly rate.');
  }

  const euroPart = Number.parseInt(match[1] ?? '0', 10);
  const centPart = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
  const cents = euroPart * 100 + centPart;

  if (!Number.isSafeInteger(cents)) {
    throw new Error('Invalid hourly rate.');
  }

  return cents;
}

export function centsToEuroInput(cents: number | null): string {
  if (cents === null) {
    return '';
  }

  return (cents / 100).toFixed(2).replace('.', ',');
}
