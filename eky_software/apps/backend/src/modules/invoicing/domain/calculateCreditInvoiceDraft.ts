import { calculateInvoiceLine } from './calculateInvoiceLine.js';
import {
  calculateCreditInvoice,
  type CreditSourceLine,
  type RequestedCreditLine,
} from './calculateCreditInvoice.js';
import type {
  InvoiceTotals,
  InvoiceVatBreakdown,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCreditError } from './invoiceCreditError.js';
import { roundHalfUp } from './roundHalfUp.js';

const basisPointsScale = 10_000n;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export interface PreviousCreditAllocation {
  sourceInvoiceLineId: string | null;
  quantityHundredths: number;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface RequestedManualCreditLine {
  lineKey: string;
  quantityHundredths: number;
  unitPriceCents: number;
  vatRateBasisPoints: number;
}

export interface CalculatedCreditDraftLine {
  lineKey: string;
  sourceInvoiceLineId: string | null;
  quantityHundredths: number;
  unitPriceCents: number | null;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number | null;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface CalculatedCreditDraft {
  lines: CalculatedCreditDraftLine[];
  totals: InvoiceTotals;
}

type CalculatedNormalCreditDraftLine = CalculatedCreditDraftLine & {
  vatRateBasisPoints: number;
};

interface VatCapacity {
  priceInputMode: PriceInputMode;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export function calculateCreditInvoiceDraft(
  sourceLines: readonly CreditSourceLine[],
  previousAllocations: readonly PreviousCreditAllocation[],
  requestedSourceLines: readonly RequestedCreditLine[],
  requestedManualLines: readonly RequestedManualCreditLine[],
): CalculatedCreditDraft {
  if (requestedSourceLines.length + requestedManualLines.length === 0) {
    throw new InvoiceCreditError(
      'Credit invoice must contain at least one line.',
    );
  }

  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const capacities = createVatCapacities(sourceLines);
  validatePreviousAllocations(
    previousAllocations,
    sourceById,
    capacities,
  );

  const previousSourceAllocations = previousAllocations.flatMap(
    (allocation) =>
      allocation.sourceInvoiceLineId === null
        ? []
        : [
            {
              sourceInvoiceLineId: allocation.sourceInvoiceLineId,
              quantityHundredths: allocation.quantityHundredths,
              baseCents: allocation.baseCents,
              discountCents: allocation.discountCents,
              netCents: allocation.netCents,
              vatCents: allocation.vatCents,
              grossCents: allocation.grossCents,
            },
          ],
  );
  const sourceCalculation =
    requestedSourceLines.length === 0
      ? { lines: [] }
      : calculateCreditInvoice(
          sourceLines,
          previousSourceAllocations,
          requestedSourceLines,
        );
  const sourceCalculatedLines: CalculatedNormalCreditDraftLine[] =
    sourceCalculation.lines.map((line) => ({
      lineKey: line.sourceInvoiceLineId,
      sourceInvoiceLineId: line.sourceInvoiceLineId,
      quantityHundredths: line.quantityHundredths,
      unitPriceCents: null,
      priceInputMode: line.priceInputMode,
      vatRateBasisPoints: line.vatRateBasisPoints,
      baseCents: line.baseCents,
      discountCents: line.discountCents,
      netCents: line.netCents,
      vatCents: line.vatCents,
      grossCents: line.grossCents,
    }));
  const manualCalculatedLines = requestedManualLines.map((line) =>
    calculateManualLine(line, capacities),
  );
  const reconciledLines = reconcileCurrentVat(
    [...sourceCalculatedLines, ...manualCalculatedLines],
    previousAllocations,
  );

  requireWithinVatCapacity(
    previousAllocations,
    reconciledLines,
    capacities,
  );

  return {
    lines: reconciledLines,
    totals: sumCreditTotals(reconciledLines),
  };
}

export function calculateRemainingCreditTotals(
  sourceLines: readonly CreditSourceLine[],
  previousAllocations: readonly PreviousCreditAllocation[],
): InvoiceTotals {
  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const capacities = createVatCapacities(sourceLines);
  validatePreviousAllocations(
    previousAllocations,
    sourceById,
    capacities,
  );
  const usedByRate = sumPreviousByRate(previousAllocations);
  const vatBreakdown = [...capacities.entries()]
    .sort(([firstRate], [secondRate]) => firstRate - secondRate)
    .map(([vatRateBasisPoints, capacity]) => {
      const used = usedByRate.get(vatRateBasisPoints) ?? {
        priceInputMode: capacity.priceInputMode,
        netCents: 0,
        vatCents: 0,
        grossCents: 0,
      };

      return {
        vatRateBasisPoints,
        netCents: subtractSafe(capacity.netCents, used.netCents),
        vatCents: subtractSafe(capacity.vatCents, used.vatCents),
        grossCents: subtractSafe(capacity.grossCents, used.grossCents),
      };
    });

  return totalsFromBreakdown(vatBreakdown);
}

function calculateManualLine(
  line: RequestedManualCreditLine,
  capacities: ReadonlyMap<number, VatCapacity>,
): CalculatedNormalCreditDraftLine {
  requireIdentifier(line.lineKey, 'Manual credit line key');
  const capacity = capacities.get(line.vatRateBasisPoints);
  if (capacity === undefined) {
    throw new InvoiceCreditError(
      'Manual credit line VAT rate is not present on the source invoice.',
    );
  }

  const calculated = calculateInvoiceLine({
    quantityHundredths: line.quantityHundredths,
    unitPriceCents: line.unitPriceCents,
    vatRateBasisPoints: line.vatRateBasisPoints,
    priceInputMode: capacity.priceInputMode,
    discount: { type: 'none' },
  });
  if (calculated.grossCents === 0) {
    throw new InvoiceCreditError(
      'Manual credit line must have a positive value.',
    );
  }

  return {
    ...calculated,
    lineKey: line.lineKey,
    sourceInvoiceLineId: null,
    unitPriceCents: line.unitPriceCents,
  };
}

function createVatCapacities(
  sourceLines: readonly CreditSourceLine[],
): Map<number, VatCapacity> {
  const capacities = new Map<number, VatCapacity>();
  for (const line of sourceLines) {
    requireCreditAmounts(
      line.priceInputMode,
      line.vatRateBasisPoints,
      line.netCents,
      line.vatCents,
      line.grossCents,
      'Source invoice line',
    );
    const current = capacities.get(line.vatRateBasisPoints);
    if (
      current !== undefined &&
      current.priceInputMode !== line.priceInputMode
    ) {
      throw new InvoiceCreditError(
        'Source invoice VAT rate must use one price input mode.',
      );
    }

    capacities.set(line.vatRateBasisPoints, {
      priceInputMode: line.priceInputMode,
      netCents: addSafe(current?.netCents ?? 0, line.netCents),
      vatCents: addSafe(current?.vatCents ?? 0, line.vatCents),
      grossCents: addSafe(current?.grossCents ?? 0, line.grossCents),
    });
  }
  return capacities;
}

function validatePreviousAllocations(
  allocations: readonly PreviousCreditAllocation[],
  sourceById: ReadonlyMap<string, CreditSourceLine>,
  capacities: ReadonlyMap<number, VatCapacity>,
): void {
  for (const allocation of allocations) {
    if (
      !Number.isSafeInteger(allocation.quantityHundredths) ||
      allocation.quantityHundredths <= 0 ||
      !Number.isSafeInteger(allocation.baseCents) ||
      allocation.baseCents < 0 ||
      !Number.isSafeInteger(allocation.discountCents) ||
      allocation.discountCents < 0 ||
      allocation.discountCents > allocation.baseCents
    ) {
      throw new InvoiceCreditError(
        'Previous credit allocation values are invalid.',
      );
    }
    requireCreditAmounts(
      allocation.priceInputMode,
      allocation.vatRateBasisPoints,
      allocation.netCents,
      allocation.vatCents,
      allocation.grossCents,
      'Previous credit allocation',
    );
    const capacity = capacities.get(allocation.vatRateBasisPoints);
    if (
      capacity === undefined ||
      capacity.priceInputMode !== allocation.priceInputMode
    ) {
      throw new InvoiceCreditError(
        'Previous credit allocation VAT context is invalid.',
      );
    }

    if (allocation.sourceInvoiceLineId !== null) {
      const sourceLine = sourceById.get(allocation.sourceInvoiceLineId);
      if (
        sourceLine === undefined ||
        sourceLine.priceInputMode !== allocation.priceInputMode ||
        sourceLine.vatRateBasisPoints !== allocation.vatRateBasisPoints
      ) {
        throw new InvoiceCreditError(
          'Previous credit allocation source line is invalid.',
        );
      }
    }
  }

  requireWithinVatCapacity(allocations, [], capacities);
}

function reconcileCurrentVat(
  lines: readonly CalculatedNormalCreditDraftLine[],
  previousAllocations: readonly PreviousCreditAllocation[],
): CalculatedNormalCreditDraftLine[] {
  const previousByRate = sumPreviousByRate(previousAllocations);
  const currentIndexesByRate = new Map<number, number[]>();
  lines.forEach((line, index) => {
    const indexes = currentIndexesByRate.get(line.vatRateBasisPoints) ?? [];
    indexes.push(index);
    currentIndexesByRate.set(line.vatRateBasisPoints, indexes);
  });
  const result = [...lines];

  for (const [vatRateBasisPoints, indexes] of currentIndexesByRate) {
    const currentLines = indexes.map((index) => {
      const line = lines[index];
      if (line === undefined) {
        throw new InvoiceCreditError(
          'Credit invoice VAT allocation is incomplete.',
        );
      }
      return line;
    });
    const mode = currentLines[0]?.priceInputMode;
    if (
      mode === undefined ||
      currentLines.some((line) => line.priceInputMode !== mode)
    ) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }
    const previous = previousByRate.get(vatRateBasisPoints) ?? {
      priceInputMode: mode,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    if (previous.priceInputMode !== mode) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }

    if (mode === 'net') {
      const currentNetCents = sumLineAmount(currentLines, 'netCents');
      const cumulativeNetCents = addSafe(
        previous.netCents,
        currentNetCents,
      );
      const cumulativeVatCents = roundHalfUp(
        BigInt(cumulativeNetCents) * BigInt(vatRateBasisPoints),
        basisPointsScale,
      );
      const currentVatCents = subtractSafe(
        cumulativeVatCents,
        previous.vatCents,
      );
      const shares = distributeAmount(
        currentVatCents,
        currentLines.map((line) => line.netCents),
      );
      indexes.forEach((lineIndex, groupIndex) => {
        const line = result[lineIndex];
        const vatCents = shares[groupIndex] ?? 0;
        if (line === undefined) {
          throw new InvoiceCreditError(
            'Credit invoice VAT allocation is incomplete.',
          );
        }
        result[lineIndex] = {
          ...line,
          vatCents,
          grossCents: addSafe(line.netCents, vatCents),
        };
      });
      continue;
    }

    const currentGrossCents = sumLineAmount(currentLines, 'grossCents');
    const cumulativeGrossCents = addSafe(
      previous.grossCents,
      currentGrossCents,
    );
    const cumulativeNetCents = roundHalfUp(
      BigInt(cumulativeGrossCents) * basisPointsScale,
      basisPointsScale + BigInt(vatRateBasisPoints),
    );
    const currentNetCents = subtractSafe(
      cumulativeNetCents,
      previous.netCents,
    );
    const shares = distributeAmount(
      currentNetCents,
      currentLines.map((line) => line.grossCents),
    );
    indexes.forEach((lineIndex, groupIndex) => {
      const line = result[lineIndex];
      const netCents = shares[groupIndex] ?? 0;
      if (line === undefined) {
        throw new InvoiceCreditError(
          'Credit invoice VAT allocation is incomplete.',
        );
      }
      result[lineIndex] = {
        ...line,
        netCents,
        vatCents: line.grossCents - netCents,
      };
    });
  }

  return result;
}

function requireWithinVatCapacity(
  previousAllocations: readonly PreviousCreditAllocation[],
  currentLines: readonly CalculatedNormalCreditDraftLine[],
  capacities: ReadonlyMap<number, VatCapacity>,
): void {
  const usedByRate = sumPreviousByRate(previousAllocations);
  for (const line of currentLines) {
    const used = usedByRate.get(line.vatRateBasisPoints) ?? {
      priceInputMode: line.priceInputMode,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    if (used.priceInputMode !== line.priceInputMode) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }
    usedByRate.set(line.vatRateBasisPoints, {
      priceInputMode: used.priceInputMode,
      netCents: addSafe(used.netCents, line.netCents),
      vatCents: addSafe(used.vatCents, line.vatCents),
      grossCents: addSafe(used.grossCents, line.grossCents),
    });
  }

  for (const [vatRateBasisPoints, used] of usedByRate) {
    const capacity = capacities.get(vatRateBasisPoints);
    if (
      capacity === undefined ||
      capacity.priceInputMode !== used.priceInputMode ||
      used.netCents > capacity.netCents ||
      used.vatCents > capacity.vatCents ||
      used.grossCents > capacity.grossCents
    ) {
      throw new InvoiceCreditError(
        'Credit amount exceeds the remaining source invoice amount.',
      );
    }
  }
}

function sumPreviousByRate(
  allocations: readonly PreviousCreditAllocation[],
): Map<number, VatCapacity> {
  const result = new Map<number, VatCapacity>();
  for (const allocation of allocations) {
    const current = result.get(allocation.vatRateBasisPoints);
    if (
      current !== undefined &&
      current.priceInputMode !== allocation.priceInputMode
    ) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }
    result.set(allocation.vatRateBasisPoints, {
      priceInputMode: allocation.priceInputMode,
      netCents: addSafe(current?.netCents ?? 0, allocation.netCents),
      vatCents: addSafe(current?.vatCents ?? 0, allocation.vatCents),
      grossCents: addSafe(current?.grossCents ?? 0, allocation.grossCents),
    });
  }
  return result;
}

function sumCreditTotals(
  lines: readonly CalculatedNormalCreditDraftLine[],
): InvoiceTotals {
  const byRate = new Map<number, InvoiceVatBreakdown>();
  for (const line of lines) {
    const current = byRate.get(line.vatRateBasisPoints);
    byRate.set(line.vatRateBasisPoints, {
      vatRateBasisPoints: line.vatRateBasisPoints,
      netCents: addSafe(current?.netCents ?? 0, line.netCents),
      vatCents: addSafe(current?.vatCents ?? 0, line.vatCents),
      grossCents: addSafe(current?.grossCents ?? 0, line.grossCents),
    });
  }
  return totalsFromBreakdown(
    [...byRate.values()].sort(
      (first, second) =>
        first.vatRateBasisPoints - second.vatRateBasisPoints,
    ),
  );
}

function totalsFromBreakdown(
  vatBreakdown: InvoiceVatBreakdown[],
): InvoiceTotals {
  return {
    netTotalCents: vatBreakdown.reduce(
      (sum, row) => addSafe(sum, row.netCents),
      0,
    ),
    vatTotalCents: vatBreakdown.reduce(
      (sum, row) => addSafe(sum, row.vatCents),
      0,
    ),
    grossTotalCents: vatBreakdown.reduce(
      (sum, row) => addSafe(sum, row.grossCents),
      0,
    ),
    vatBreakdown,
  };
}

function distributeAmount(totalAmount: number, weights: readonly number[]) {
  const totalWeight = weights.reduce(addSafe, 0);
  if (totalWeight === 0) {
    throw new InvoiceCreditError(
      'Credit invoice tax cannot be allocated to zero-value lines.',
    );
  }

  let cumulativeWeight = 0;
  let previousTarget = 0;
  return weights.map((weight) => {
    cumulativeWeight = addSafe(cumulativeWeight, weight);
    const target = roundHalfUp(
      BigInt(totalAmount) * BigInt(cumulativeWeight),
      BigInt(totalWeight),
    );
    const allocation = subtractSafe(target, previousTarget);
    previousTarget = target;
    return allocation;
  });
}

function sumLineAmount(
  lines: readonly CalculatedNormalCreditDraftLine[],
  field: 'netCents' | 'grossCents',
): number {
  return lines.reduce((sum, line) => addSafe(sum, line[field]), 0);
}

function requireCreditAmounts(
  mode: PriceInputMode,
  vatRateBasisPoints: number,
  netCents: number,
  vatCents: number,
  grossCents: number,
  fieldName: string,
): void {
  if (
    (mode !== 'net' && mode !== 'gross') ||
    !Number.isSafeInteger(vatRateBasisPoints) ||
    vatRateBasisPoints < 0 ||
    [netCents, vatCents, grossCents].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    BigInt(netCents) + BigInt(vatCents) !== BigInt(grossCents)
  ) {
    throw new InvoiceCreditError(`${fieldName} amounts are invalid.`);
  }
}

function requireIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0 || value.length > 200) {
    throw new InvoiceCreditError(`${fieldName} is invalid.`);
  }
}

function addSafe(first: number, second: number): number {
  const result = BigInt(first) + BigInt(second);
  if (result > maximumSafeInteger) {
    throw new InvoiceCreditError(
      'Credit invoice amount exceeds the safe integer range.',
    );
  }
  return Number(result);
}

function subtractSafe(target: number, used: number): number {
  const result = target - used;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InvoiceCreditError(
      'Credit amount exceeds the remaining source invoice amount.',
    );
  }
  return result;
}
