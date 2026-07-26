import type {
  CalculatedCreditDraft,
  CalculatedCreditDraftLine,
} from './calculateCreditInvoiceDraft.js';
import type { RequestedCreditLine } from './calculateCreditInvoice.js';
import { calculateReverseChargeInvoiceLine } from './calculateReverseChargeInvoice.js';
import { InvoiceCreditError } from './invoiceCreditError.js';
import { roundHalfUp } from './roundHalfUp.js';

export interface ReverseChargeCreditSourceLine {
  id: string;
  lineOrder: number;
  quantityHundredths: number;
  priceInputMode: 'net';
  vatRateBasisPoints: null;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: 0;
  grossCents: number;
}

export interface ReverseChargePreviousCreditAllocation {
  sourceInvoiceLineId: string | null;
  quantityHundredths: number;
  priceInputMode: 'net';
  vatRateBasisPoints: null;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: 0;
  grossCents: number;
}

export interface RequestedReverseChargeManualCreditLine {
  lineKey: string;
  quantityHundredths: number;
  unitPriceCents: number;
}

interface AllocationTotal {
  quantityHundredths: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
}

export function calculateReverseChargeCreditInvoiceDraft(
  sourceLines: readonly ReverseChargeCreditSourceLine[],
  previousAllocations: readonly ReverseChargePreviousCreditAllocation[],
  requestedSourceLines: readonly RequestedCreditLine[],
  requestedManualLines: readonly RequestedReverseChargeManualCreditLine[],
): CalculatedCreditDraft {
  if (requestedSourceLines.length + requestedManualLines.length === 0) {
    throw new InvoiceCreditError(
      'Credit invoice must contain at least one line.',
    );
  }

  const sourceById = validateSourceLines(sourceLines);
  const previousBySource = validatePreviousAllocations(
    sourceLines,
    previousAllocations,
    sourceById,
  );
  const requestedIds = new Set<string>();
  const sourceCredits = requestedSourceLines.map((requested) => {
    if (requestedIds.has(requested.sourceInvoiceLineId)) {
      throw new InvoiceCreditError(
        'Credit invoice source lines must be unique.',
      );
    }
    requestedIds.add(requested.sourceInvoiceLineId);

    const source = sourceById.get(requested.sourceInvoiceLineId);
    if (source === undefined) {
      throw new InvoiceCreditError('Credit invoice source line is invalid.');
    }
    requirePositiveSafeInteger(
      requested.quantityHundredths,
      'Credit quantity',
    );

    const previous =
      previousBySource.get(source.id) ?? createEmptyAllocation();
    const cumulativeQuantity = addSafe(
      previous.quantityHundredths,
      requested.quantityHundredths,
    );
    if (cumulativeQuantity > source.quantityHundredths) {
      throw new InvoiceCreditError(
        'Credit quantity exceeds the remaining source line quantity.',
      );
    }

    const cumulativeBase = allocate(
      source.baseCents,
      cumulativeQuantity,
      source.quantityHundredths,
    );
    const cumulativeNet = allocate(
      source.netCents,
      cumulativeQuantity,
      source.quantityHundredths,
    );
    const baseCents = subtract(cumulativeBase, previous.baseCents);
    const netCents = subtract(cumulativeNet, previous.netCents);
    const discountCents = baseCents - netCents;

    if (discountCents < 0) {
      throw new InvoiceCreditError(
        'Calculated reverse charge credit line is invalid.',
      );
    }

    return {
      lineKey: source.id,
      sourceInvoiceLineId: source.id,
      quantityHundredths: requested.quantityHundredths,
      unitPriceCents: null,
      priceInputMode: 'net' as const,
      vatRateBasisPoints: null,
      baseCents,
      discountCents,
      netCents,
      vatCents: 0,
      grossCents: netCents,
    };
  });
  const manualCredits = requestedManualLines.map((requested) => {
    const calculated = calculateReverseChargeInvoiceLine({
      quantityHundredths: requested.quantityHundredths,
      unitPriceCents: requested.unitPriceCents,
      priceInputMode: 'net',
      discount: { type: 'none' },
    });

    return {
      ...calculated,
      lineKey: requested.lineKey,
      sourceInvoiceLineId: null,
      unitPriceCents: requested.unitPriceCents,
    };
  });
  const lines: CalculatedCreditDraftLine[] = [
    ...sourceCredits,
    ...manualCredits,
  ];
  requireWithinInvoiceCapacity(sourceLines, previousAllocations, lines);

  return {
    lines,
    totals: sumReverseChargeCreditTotals(lines),
  };
}

export function calculateRemainingReverseChargeCreditTotals(
  sourceLines: readonly ReverseChargeCreditSourceLine[],
  previousAllocations: readonly ReverseChargePreviousCreditAllocation[],
) {
  const sourceById = validateSourceLines(sourceLines);
  validatePreviousAllocations(sourceLines, previousAllocations, sourceById);
  const sourceNet = sourceLines.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );
  const creditedNet = previousAllocations.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );
  const remainingNet = subtract(sourceNet, creditedNet);

  return {
    netTotalCents: remainingNet,
    vatTotalCents: 0,
    grossTotalCents: remainingNet,
    vatBreakdown: [],
  };
}

function validateSourceLines(
  lines: readonly ReverseChargeCreditSourceLine[],
): Map<string, ReverseChargeCreditSourceLine> {
  const sourceById = new Map<string, ReverseChargeCreditSourceLine>();

  for (const line of lines) {
    if (
      line.id.length === 0 ||
      sourceById.has(line.id) ||
      !Number.isSafeInteger(line.lineOrder) ||
      line.lineOrder < 1 ||
      !Number.isSafeInteger(line.quantityHundredths) ||
      line.quantityHundredths <= 0 ||
      line.priceInputMode !== 'net' ||
      line.vatRateBasisPoints !== null ||
      !isNonNegativeSafeInteger(line.baseCents) ||
      !isNonNegativeSafeInteger(line.discountCents) ||
      !isNonNegativeSafeInteger(line.netCents) ||
      !isNonNegativeSafeInteger(line.grossCents) ||
      line.vatCents !== 0 ||
      line.discountCents > line.baseCents ||
      line.baseCents - line.discountCents !== line.netCents ||
      line.netCents !== line.grossCents
    ) {
      throw new InvoiceCreditError(
        'Reverse charge source invoice line is invalid.',
      );
    }
    sourceById.set(line.id, line);
  }

  return sourceById;
}

function validatePreviousAllocations(
  sourceLines: readonly ReverseChargeCreditSourceLine[],
  allocations: readonly ReverseChargePreviousCreditAllocation[],
  sourceById: ReadonlyMap<string, ReverseChargeCreditSourceLine>,
): Map<string, AllocationTotal> {
  const totals = new Map<string, AllocationTotal>();

  for (const allocation of allocations) {
    if (
      !Number.isSafeInteger(allocation.quantityHundredths) ||
      allocation.quantityHundredths <= 0 ||
      allocation.priceInputMode !== 'net' ||
      allocation.vatRateBasisPoints !== null ||
      !isNonNegativeSafeInteger(allocation.baseCents) ||
      !isNonNegativeSafeInteger(allocation.discountCents) ||
      !isNonNegativeSafeInteger(allocation.netCents) ||
      !isNonNegativeSafeInteger(allocation.grossCents) ||
      allocation.vatCents !== 0 ||
      allocation.discountCents > allocation.baseCents ||
      allocation.baseCents - allocation.discountCents !==
        allocation.netCents ||
      allocation.netCents !== allocation.grossCents
    ) {
      throw new InvoiceCreditError(
        'Previous reverse charge credit allocation is invalid.',
      );
    }
    if (allocation.sourceInvoiceLineId === null) {
      continue;
    }

    const source = sourceById.get(allocation.sourceInvoiceLineId);
    if (source === undefined) {
      throw new InvoiceCreditError(
        'Previous credit allocation source line is invalid.',
      );
    }
    const previous =
      totals.get(allocation.sourceInvoiceLineId) ?? createEmptyAllocation();
    const next = {
      quantityHundredths: addSafe(
        previous.quantityHundredths,
        allocation.quantityHundredths,
      ),
      baseCents: addSafe(previous.baseCents, allocation.baseCents),
      discountCents: addSafe(
        previous.discountCents,
        allocation.discountCents,
      ),
      netCents: addSafe(previous.netCents, allocation.netCents),
    };
    if (
      next.quantityHundredths > source.quantityHundredths ||
      next.baseCents > source.baseCents ||
      next.netCents > source.netCents
    ) {
      throw new InvoiceCreditError(
        'Previous credits exceed the source invoice line.',
      );
    }
    totals.set(allocation.sourceInvoiceLineId, next);
  }

  requireWithinInvoiceCapacity(sourceLines, allocations, []);
  return totals;
}

function requireWithinInvoiceCapacity(
  sourceLines: readonly ReverseChargeCreditSourceLine[],
  previousAllocations: readonly ReverseChargePreviousCreditAllocation[],
  currentLines: readonly CalculatedCreditDraftLine[],
): void {
  const sourceNet = sourceLines.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );
  const previousNet = previousAllocations.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );
  const currentNet = currentLines.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );

  if (addSafe(previousNet, currentNet) > sourceNet) {
    throw new InvoiceCreditError(
      'Credit invoice exceeds the remaining source invoice amount.',
    );
  }
}

function sumReverseChargeCreditTotals(
  lines: readonly CalculatedCreditDraftLine[],
) {
  const netTotalCents = lines.reduce((sum, line) => {
    if (
      line.vatRateBasisPoints !== null ||
      line.vatCents !== 0 ||
      line.netCents !== line.grossCents
    ) {
      throw new InvoiceCreditError(
        'Calculated reverse charge credit line is invalid.',
      );
    }

    return addSafe(sum, line.netCents);
  }, 0);

  return {
    netTotalCents,
    vatTotalCents: 0,
    grossTotalCents: netTotalCents,
    vatBreakdown: [],
  };
}

function allocate(total: number, quantity: number, capacity: number): number {
  if (capacity <= 0) {
    throw new InvoiceCreditError('Credit source line capacity is invalid.');
  }

  return roundHalfUp(BigInt(total) * BigInt(quantity), BigInt(capacity));
}

function requirePositiveSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvoiceCreditError(`${fieldName} must be a positive integer.`);
  }
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new InvoiceCreditError('Credit amount exceeds safe integer range.');
  }
  return result;
}

function subtract(left: number, right: number): number {
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InvoiceCreditError('Credit allocation is invalid.');
  }
  return result;
}

function createEmptyAllocation(): AllocationTotal {
  return {
    quantityHundredths: 0,
    baseCents: 0,
    discountCents: 0,
    netCents: 0,
  };
}
