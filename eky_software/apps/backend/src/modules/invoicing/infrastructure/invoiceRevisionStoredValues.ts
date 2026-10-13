import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';

export const revisionNumberingModes = ['fiscalYearSequence', 'calendarYearSequence', 'plainSequence'] as const;
export const revisionReferenceTypes = ['finnishDomestic'] as const;
export const revisionPriceInputModes = ['net', 'gross'] as const;
export const revisionDiscountTypes = ['none', 'percentage', 'fixed'] as const;
export const revisionOrigins = ['approval', 'validatedLegacySnapshot', 'legacySnapshot'] as const;
export const revisionVatStates = ['authoritative', 'unavailable'] as const;

export function revisionProvenance(originValue: unknown, stateValue: unknown, hasVatGroups: boolean) {
  const origin = revisionMember(originValue, revisionOrigins);
  const state = revisionMember(stateValue, revisionVatStates);
  if (origin === 'legacySnapshot') {
    if (state !== 'unavailable' || hasVatGroups) fail();
    return { origin, vatBreakdownState: 'unavailable' } as const;
  }
  if (state !== 'authoritative') fail();
  return { origin, vatBreakdownState: 'authoritative' } as const;
}

export function revisionText(value: unknown): string {
  if (typeof value !== 'string') fail();
  return value;
}

export function revisionIdentifier(value: unknown): string {
  const result = revisionText(value);
  validateRevisionIdentifierContent(result.trim().length > 0);
  return result;
}

export function validateRevisionIdentifierContent(hasNonWhitespace: boolean): void {
  if (!hasNonWhitespace) fail();
}

export function revisionNullableText(value: unknown): string | null {
  return value === null ? null : revisionText(value);
}

export function revisionNullableIdentifier(value: unknown): string | null {
  return value === null ? null : revisionIdentifier(value);
}

export function revisionInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

export function revisionMember<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail();
  return value as T;
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
