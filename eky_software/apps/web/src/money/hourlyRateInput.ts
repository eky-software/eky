export function euroInputToCents(value: string): number | null {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const normalizedValue = trimmedValue.replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(normalizedValue)) {
    throw new Error('Invalid hourly rate.');
  }

  return Math.round(Number(normalizedValue) * 100);
}

export function centsToEuroInput(cents: number | null): string {
  if (cents === null) {
    return '';
  }

  return (cents / 100).toFixed(2).replace('.', ',');
}
