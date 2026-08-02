import {
  validateInvoiceNumberingSettings,
  type InvoiceNumberingMode,
} from './invoiceNumbering.js';
import { InvoiceNumberingError } from './invoiceNumberingError.js';
import { maximumFinnishDomesticReferenceBaseLength } from './invoiceReferenceNumber.js';

export interface InvoiceNumberingSeriesCandidate {
  mode: InvoiceNumberingMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
}

export interface MinimumSafeInvoiceSequenceNumberInput {
  existingInvoiceNumbers: readonly string[];
  target: InvoiceNumberingSeriesCandidate;
}

export interface MinimumSafeInvoiceSequenceNumberResult {
  capacity: 'available' | 'exhausted';
  maximumSequenceNumber: number;
  minimumSafeFirstSequenceNumber: number | null;
}

const minimumSupportedInvoiceYear = 1;
const maximumSupportedInvoiceYear = 9999;
const maximumYearPrefixLength = String(maximumSupportedInvoiceYear).length;
const maximumYearBasedSequenceDigits =
  maximumFinnishDomesticReferenceBaseLength - maximumYearPrefixLength;
const maximumYearBasedSequenceNumber = Number(
  '9'.repeat(maximumYearBasedSequenceDigits),
);
const maximumPlainSequenceNumber = Math.min(
  Number.MAX_SAFE_INTEGER,
  Number('9'.repeat(maximumFinnishDomesticReferenceBaseLength)),
);

function requireNumericInvoiceNumber(invoiceNumber: string): void {
  if (
    !/^\d+$/.test(invoiceNumber) ||
    invoiceNumber.length > maximumFinnishDomesticReferenceBaseLength
  ) {
    throw new InvoiceNumberingError(
      'Existing invoice numbers must contain 1 to 19 digits.',
    );
  }
}

function formatSequenceNumber(
  sequenceNumber: bigint,
  sequencePadding: number,
): string {
  return sequenceNumber.toString().padStart(sequencePadding, '0');
}

function parseProducedSequenceNumber(
  sequenceText: string,
  sequencePadding: number,
  maximumSequenceNumber: bigint,
): bigint | undefined {
  if (!/^\d+$/.test(sequenceText)) {
    return undefined;
  }

  const sequenceNumber = BigInt(sequenceText);

  if (
    sequenceNumber < 1n ||
    sequenceNumber > maximumSequenceNumber ||
    formatSequenceNumber(sequenceNumber, sequencePadding) !== sequenceText
  ) {
    return undefined;
  }

  return sequenceNumber;
}

function getMaximumSequenceNumber(mode: InvoiceNumberingMode): number {
  return mode === 'plainSequence'
    ? maximumPlainSequenceNumber
    : maximumYearBasedSequenceNumber;
}

function isSupportedYearPrefix(
  prefixText: string,
  target: InvoiceNumberingSeriesCandidate,
): boolean {
  if (!/^\d+$/.test(prefixText)) {
    return false;
  }

  const prefix = Number(prefixText);

  if (!Number.isSafeInteger(prefix) || String(prefix) !== prefixText) {
    return false;
  }

  const minimumPrefix =
    target.mode === 'fiscalYearSequence' &&
    target.fiscalYearStartMonth > 1
      ? minimumSupportedInvoiceYear - 1
      : minimumSupportedInvoiceYear;

  return prefix >= minimumPrefix && prefix <= maximumSupportedInvoiceYear;
}

function findLargestCollidingSequenceNumber(
  invoiceNumber: string,
  target: InvoiceNumberingSeriesCandidate,
  maximumSequenceNumber: bigint,
): bigint | undefined {
  if (target.mode === 'plainSequence') {
    return parseProducedSequenceNumber(
      invoiceNumber,
      target.sequencePadding,
      maximumSequenceNumber,
    );
  }

  let largestCollision: bigint | undefined;
  const maximumPrefixLength = Math.min(
    maximumYearPrefixLength,
    invoiceNumber.length - 1,
  );

  for (let prefixLength = 1; prefixLength <= maximumPrefixLength; prefixLength += 1) {
    const prefixText = invoiceNumber.slice(0, prefixLength);

    if (!isSupportedYearPrefix(prefixText, target)) {
      continue;
    }

    const sequenceNumber = parseProducedSequenceNumber(
      invoiceNumber.slice(prefixLength),
      target.sequencePadding,
      maximumSequenceNumber,
    );

    if (
      sequenceNumber !== undefined &&
      (largestCollision === undefined || sequenceNumber > largestCollision)
    ) {
      largestCollision = sequenceNumber;
    }
  }

  return largestCollision;
}

export function calculateMinimumSafeInvoiceSequenceNumber(
  input: MinimumSafeInvoiceSequenceNumberInput,
): MinimumSafeInvoiceSequenceNumberResult {
  validateInvoiceNumberingSettings({
    ...input.target,
    firstSequenceNumber: 1,
  });

  const maximumSequenceNumber = getMaximumSequenceNumber(input.target.mode);
  const maximumSequenceNumberBigInt = BigInt(maximumSequenceNumber);
  let largestCollision = 0n;

  for (const invoiceNumber of input.existingInvoiceNumbers) {
    requireNumericInvoiceNumber(invoiceNumber);
    const collision = findLargestCollidingSequenceNumber(
      invoiceNumber,
      input.target,
      maximumSequenceNumberBigInt,
    );

    if (collision !== undefined && collision > largestCollision) {
      largestCollision = collision;
    }
  }

  if (largestCollision >= maximumSequenceNumberBigInt) {
    return {
      capacity: 'exhausted',
      maximumSequenceNumber,
      minimumSafeFirstSequenceNumber: null,
    };
  }

  return {
    capacity: 'available',
    maximumSequenceNumber,
    minimumSafeFirstSequenceNumber: Number(largestCollision + 1n),
  };
}

export function validateInvoiceNumberingSeriesFirstSequenceNumber(
  selectedFirstSequenceNumber: number,
  result: MinimumSafeInvoiceSequenceNumberResult,
): void {
  if (
    result.capacity !== 'available' ||
    result.minimumSafeFirstSequenceNumber === null
  ) {
    throw new InvoiceNumberingError(
      'Invoice numbering series has no safe remaining capacity.',
    );
  }

  if (
    !Number.isSafeInteger(selectedFirstSequenceNumber) ||
    selectedFirstSequenceNumber < result.minimumSafeFirstSequenceNumber ||
    selectedFirstSequenceNumber > result.maximumSequenceNumber
  ) {
    throw new InvoiceNumberingError(
      'First sequence number is outside the safe range.',
    );
  }
}
