import type {
  InvoiceTotals,
  InvoiceVatBreakdown,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCreditError } from './invoiceCreditError.js';
import { roundHalfUp } from './roundHalfUp.js';

const basisPointsScale = 10_000n;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export interface CreditSourceLine {
  id: string;
  lineOrder: number;
  quantityHundredths: number;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface PreviousCreditLineAllocation {
  sourceInvoiceLineId: string;
  quantityHundredths: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface RequestedCreditLine {
  sourceInvoiceLineId: string;
  quantityHundredths: number;
}

export interface CalculatedCreditLine {
  sourceInvoiceLineId: string;
  quantityHundredths: number;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface CalculatedCreditInvoice {
  lines: CalculatedCreditLine[];
  totals: InvoiceTotals;
}

interface CreditLineCapacity {
  sourceInvoiceLineId: string;
  quantityHundredths: number;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number;
  baseCents: number;
  discountedInputCents: number;
}

interface MutableVatGroup {
  mode: PriceInputMode;
  lines: CreditSourceLine[];
}

interface PreviousAllocationTotal {
  quantityHundredths: number;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export function calculateCreditInvoice(
  sourceLines: readonly CreditSourceLine[],
  previousAllocations: readonly PreviousCreditLineAllocation[],
  requestedLines: readonly RequestedCreditLine[],
): CalculatedCreditInvoice {
  if (requestedLines.length === 0) {
    throw new InvoiceCreditError(
      'Credit invoice must contain at least one line.',
    );
  }

  const capacities = createCreditLineCapacities(sourceLines);
  const previousBySourceLine = sumPreviousAllocations(
    previousAllocations,
    capacities,
  );
  const requestedSourceLineIds = new Set<string>();

  const lines = requestedLines.map((requestedLine) => {
    if (requestedSourceLineIds.has(requestedLine.sourceInvoiceLineId)) {
      throw new InvoiceCreditError(
        'Credit invoice source lines must be unique.',
      );
    }
    requestedSourceLineIds.add(requestedLine.sourceInvoiceLineId);

    const capacity = capacities.get(requestedLine.sourceInvoiceLineId);
    if (capacity === undefined) {
      throw new InvoiceCreditError('Credit invoice source line is invalid.');
    }

    requirePositiveSafeInteger(
      requestedLine.quantityHundredths,
      'Credit quantity',
    );

    const previous = previousBySourceLine.get(
      requestedLine.sourceInvoiceLineId,
    ) ?? createEmptyPreviousAllocation();
    const cumulativeQuantity =
      previous.quantityHundredths + requestedLine.quantityHundredths;

    if (
      !Number.isSafeInteger(cumulativeQuantity) ||
      cumulativeQuantity > capacity.quantityHundredths
    ) {
      throw new InvoiceCreditError(
        'Credit quantity exceeds the remaining source line quantity.',
      );
    }

    return allocateCreditLine(capacity, previous, cumulativeQuantity);
  });
  const reconciledLines = allocateCurrentTaxByVatRate(
    lines,
    previousAllocations,
    capacities,
  );

  return {
    lines: reconciledLines,
    totals: calculateCreditInvoiceTotals(reconciledLines),
  };
}

export function calculateCreditInvoiceTotals(
  lines: readonly CalculatedCreditLine[],
): InvoiceTotals {
  const breakdownByRate = new Map<number, InvoiceVatBreakdown>();
  let netTotalCents = 0n;
  let vatTotalCents = 0n;
  let grossTotalCents = 0n;

  for (const line of lines) {
    validateCalculatedCreditLine(line);

    netTotalCents += BigInt(line.netCents);
    vatTotalCents += BigInt(line.vatCents);
    grossTotalCents += BigInt(line.grossCents);

    const previous = breakdownByRate.get(line.vatRateBasisPoints);
    breakdownByRate.set(line.vatRateBasisPoints, {
      vatRateBasisPoints: line.vatRateBasisPoints,
      netCents: addSafeIntegers(previous?.netCents ?? 0, line.netCents),
      vatCents: addSafeIntegers(previous?.vatCents ?? 0, line.vatCents),
      grossCents: addSafeIntegers(previous?.grossCents ?? 0, line.grossCents),
    });
  }

  return {
    netTotalCents: toSafeInteger(netTotalCents),
    vatTotalCents: toSafeInteger(vatTotalCents),
    grossTotalCents: toSafeInteger(grossTotalCents),
    vatBreakdown: [...breakdownByRate.values()].sort(
      (first, second) =>
        first.vatRateBasisPoints - second.vatRateBasisPoints,
    ),
  };
}

function createCreditLineCapacities(
  sourceLines: readonly CreditSourceLine[],
): Map<string, CreditLineCapacity> {
  const sourceLineIds = new Set<string>();
  const groupsByRate = new Map<number, MutableVatGroup>();

  for (const line of sourceLines) {
    validateSourceLine(line);

    if (sourceLineIds.has(line.id)) {
      throw new InvoiceCreditError('Source invoice line ids must be unique.');
    }
    sourceLineIds.add(line.id);

    if (line.quantityHundredths === 0 || line.grossCents === 0) {
      continue;
    }

    const existingGroup = groupsByRate.get(line.vatRateBasisPoints);
    if (existingGroup !== undefined) {
      if (existingGroup.mode !== line.priceInputMode) {
        throw new InvoiceCreditError(
          'Source lines with the same VAT rate must use one price input mode.',
        );
      }
      existingGroup.lines.push(line);
      continue;
    }

    groupsByRate.set(line.vatRateBasisPoints, {
      mode: line.priceInputMode,
      lines: [line],
    });
  }

  const capacities = new Map<string, CreditLineCapacity>();

  for (const [vatRateBasisPoints, group] of groupsByRate) {
    for (const line of [...group.lines].sort(
      (first, second) => first.lineOrder - second.lineOrder,
    )) {
      const discountedInputCents = line.baseCents - line.discountCents;

      capacities.set(line.id, {
        sourceInvoiceLineId: line.id,
        quantityHundredths: line.quantityHundredths,
        priceInputMode: line.priceInputMode,
        vatRateBasisPoints,
        baseCents: line.baseCents,
        discountedInputCents,
      });
    }
  }

  return capacities;
}

function sumPreviousAllocations(
  previousAllocations: readonly PreviousCreditLineAllocation[],
  capacities: ReadonlyMap<string, CreditLineCapacity>,
): Map<string, PreviousAllocationTotal> {
  const totals = new Map<string, PreviousAllocationTotal>();

  for (const allocation of previousAllocations) {
    const capacity = capacities.get(allocation.sourceInvoiceLineId);
    if (capacity === undefined) {
      throw new InvoiceCreditError(
        'Previous credit allocation source line is invalid.',
      );
    }
    validatePreviousAllocation(allocation);

    const previous =
      totals.get(allocation.sourceInvoiceLineId) ??
      createEmptyPreviousAllocation();
    totals.set(allocation.sourceInvoiceLineId, {
      quantityHundredths: addSafeIntegers(
        previous.quantityHundredths,
        allocation.quantityHundredths,
      ),
      baseCents: addSafeIntegers(previous.baseCents, allocation.baseCents),
      discountCents: addSafeIntegers(
        previous.discountCents,
        allocation.discountCents,
      ),
      netCents: addSafeIntegers(previous.netCents, allocation.netCents),
      vatCents: addSafeIntegers(previous.vatCents, allocation.vatCents),
      grossCents: addSafeIntegers(previous.grossCents, allocation.grossCents),
    });
  }

  for (const [sourceInvoiceLineId, total] of totals) {
    const capacity = capacities.get(sourceInvoiceLineId);
    if (
      capacity === undefined ||
      total.quantityHundredths > capacity.quantityHundredths ||
      total.baseCents > capacity.baseCents ||
      total.discountCents > capacity.baseCents ||
      total.baseCents - total.discountCents < 0 ||
      (capacity.priceInputMode === 'net' &&
        (total.netCents > capacity.discountedInputCents ||
          total.baseCents - total.discountCents !== total.netCents)) ||
      (capacity.priceInputMode === 'gross' &&
        (total.grossCents > capacity.discountedInputCents ||
          total.baseCents - total.discountCents !== total.grossCents))
    ) {
      throw new InvoiceCreditError(
        'Previous credits exceed the source invoice line.',
      );
    }
  }

  return totals;
}

function allocateCreditLine(
  capacity: CreditLineCapacity,
  previous: PreviousAllocationTotal,
  cumulativeQuantity: number,
): CalculatedCreditLine {
  const cumulativeBaseCents = allocateCumulativeAmount(
    capacity.baseCents,
    cumulativeQuantity,
    capacity.quantityHundredths,
  );
  const cumulativeInputCents = allocateCumulativeAmount(
    capacity.discountedInputCents,
    cumulativeQuantity,
    capacity.quantityHundredths,
  );
  const baseCents = subtractAllocation(
    cumulativeBaseCents,
    previous.baseCents,
  );
  const discountedInputCents = subtractAllocation(
    cumulativeInputCents,
    capacity.priceInputMode === 'net'
      ? previous.netCents
      : previous.grossCents,
  );
  const discountCents = baseCents - discountedInputCents;
  const netCents =
    capacity.priceInputMode === 'net' ? discountedInputCents : 0;
  const grossCents =
    capacity.priceInputMode === 'gross' ? discountedInputCents : netCents;
  const vatCents = grossCents - netCents;

  if (
    discountCents < 0 ||
    (capacity.priceInputMode === 'net' &&
      discountedInputCents !== netCents) ||
    (capacity.priceInputMode === 'gross' &&
      discountedInputCents !== grossCents)
  ) {
    throw new InvoiceCreditError(
      'Calculated credit line amounts do not reconcile.',
    );
  }

  return {
    sourceInvoiceLineId: capacity.sourceInvoiceLineId,
    quantityHundredths:
      cumulativeQuantity - previous.quantityHundredths,
    priceInputMode: capacity.priceInputMode,
    vatRateBasisPoints: capacity.vatRateBasisPoints,
    baseCents,
    discountCents,
    netCents,
    vatCents,
    grossCents,
  };
}

function allocateCurrentTaxByVatRate(
  lines: readonly CalculatedCreditLine[],
  previousAllocations: readonly PreviousCreditLineAllocation[],
  capacities: ReadonlyMap<string, CreditLineCapacity>,
): CalculatedCreditLine[] {
  const currentByRate = new Map<number, CalculatedCreditLine[]>();

  for (const line of lines) {
    const group = currentByRate.get(line.vatRateBasisPoints) ?? [];
    group.push(line);
    currentByRate.set(line.vatRateBasisPoints, group);
  }

  const previousByRate = new Map<
    number,
    { mode: PriceInputMode; netCents: number; vatCents: number; grossCents: number }
  >();
  for (const allocation of previousAllocations) {
    const capacity = capacities.get(allocation.sourceInvoiceLineId);
    if (capacity === undefined) {
      throw new InvoiceCreditError(
        'Previous credit allocation source line is invalid.',
      );
    }
    const previous = previousByRate.get(capacity.vatRateBasisPoints) ?? {
      mode: capacity.priceInputMode,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    if (previous.mode !== capacity.priceInputMode) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }
    previousByRate.set(capacity.vatRateBasisPoints, {
      mode: previous.mode,
      netCents: addSafeIntegers(previous.netCents, allocation.netCents),
      vatCents: addSafeIntegers(previous.vatCents, allocation.vatCents),
      grossCents: addSafeIntegers(previous.grossCents, allocation.grossCents),
    });
  }

  const reconciledBySourceLine = new Map<string, CalculatedCreditLine>();
  for (const [vatRateBasisPoints, currentLines] of currentByRate) {
    const mode = currentLines[0]?.priceInputMode;
    if (mode === undefined) {
      continue;
    }
    if (currentLines.some((line) => line.priceInputMode !== mode)) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }

    const previous = previousByRate.get(vatRateBasisPoints) ?? {
      mode,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    if (previous.mode !== mode) {
      throw new InvoiceCreditError(
        'Credit lines with the same VAT rate must use one price input mode.',
      );
    }

    const orderedLines = [...currentLines].sort((first, second) =>
      first.sourceInvoiceLineId.localeCompare(second.sourceInvoiceLineId),
    );

    if (mode === 'net') {
      const currentNetCents = sumLineAmount(orderedLines, 'netCents');
      const cumulativeNetCents = addSafeIntegers(
        previous.netCents,
        currentNetCents,
      );
      const cumulativeVatCents = roundHalfUp(
        BigInt(cumulativeNetCents) * BigInt(vatRateBasisPoints),
        basisPointsScale,
      );
      const currentVatCents = subtractAllocation(
        cumulativeVatCents,
        previous.vatCents,
      );
      const vatShares = distributeAmount(
        currentVatCents,
        orderedLines.map((line) => line.netCents),
      );

      orderedLines.forEach((line, index) => {
        const vatCents = vatShares[index] ?? 0;
        reconciledBySourceLine.set(line.sourceInvoiceLineId, {
          ...line,
          vatCents,
          grossCents: addSafeIntegers(line.netCents, vatCents),
        });
      });
      continue;
    }

    const currentGrossCents = sumLineAmount(orderedLines, 'grossCents');
    const cumulativeGrossCents = addSafeIntegers(
      previous.grossCents,
      currentGrossCents,
    );
    const cumulativeNetCents = roundHalfUp(
      BigInt(cumulativeGrossCents) * basisPointsScale,
      basisPointsScale + BigInt(vatRateBasisPoints),
    );
    const currentNetCents = subtractAllocation(
      cumulativeNetCents,
      previous.netCents,
    );
    const netShares = distributeAmount(
      currentNetCents,
      orderedLines.map((line) => line.grossCents),
    );

    orderedLines.forEach((line, index) => {
      const netCents = netShares[index] ?? 0;
      reconciledBySourceLine.set(line.sourceInvoiceLineId, {
        ...line,
        netCents,
        vatCents: line.grossCents - netCents,
      });
    });
  }

  return lines.map((line) => {
    const reconciled = reconciledBySourceLine.get(line.sourceInvoiceLineId);
    if (reconciled === undefined) {
      throw new InvoiceCreditError(
        'Credit invoice VAT allocation is incomplete.',
      );
    }
    return reconciled;
  });
}

function distributeAmount(
  totalAmount: number,
  weights: readonly number[],
): number[] {
  const totalWeight = weights.reduce(addSafeIntegers, 0);
  if (totalWeight === 0) {
    if (totalAmount !== 0) {
      throw new InvoiceCreditError(
        'Credit invoice tax cannot be allocated to zero-value lines.',
      );
    }
    return weights.map(() => 0);
  }

  let cumulativeWeight = 0;
  let previousTarget = 0;
  return weights.map((weight) => {
    cumulativeWeight = addSafeIntegers(cumulativeWeight, weight);
    const target = roundHalfUp(
      BigInt(totalAmount) * BigInt(cumulativeWeight),
      BigInt(totalWeight),
    );
    const allocation = subtractAllocation(target, previousTarget);
    previousTarget = target;
    return allocation;
  });
}

function sumLineAmount(
  lines: readonly CalculatedCreditLine[],
  field: 'netCents' | 'grossCents',
): number {
  return lines.reduce(
    (sum, line) => addSafeIntegers(sum, line[field]),
    0,
  );
}

function allocateCumulativeAmount(
  capacityCents: number,
  cumulativeQuantity: number,
  sourceQuantity: number,
): number {
  return roundHalfUp(
    BigInt(capacityCents) * BigInt(cumulativeQuantity),
    BigInt(sourceQuantity),
  );
}

function validateSourceLine(line: CreditSourceLine): void {
  requireIdentifier(line.id, 'Source invoice line id');
  requirePositiveSafeInteger(line.lineOrder, 'Source line order');
  requireNonNegativeSafeInteger(
    line.quantityHundredths,
    'Source quantity',
  );
  requireNonNegativeSafeInteger(
    line.vatRateBasisPoints,
    'Source VAT rate',
  );
  requireNonNegativeSafeInteger(line.baseCents, 'Source base amount');
  requireNonNegativeSafeInteger(
    line.discountCents,
    'Source discount amount',
  );
  requireNonNegativeSafeInteger(line.netCents, 'Source net amount');
  requireNonNegativeSafeInteger(line.vatCents, 'Source VAT amount');
  requireNonNegativeSafeInteger(line.grossCents, 'Source gross amount');

  if (
    line.discountCents > line.baseCents ||
    line.netCents + line.vatCents !== line.grossCents ||
    (line.priceInputMode !== 'net' && line.priceInputMode !== 'gross') ||
    (line.priceInputMode === 'net' &&
      line.baseCents - line.discountCents !== line.netCents) ||
    (line.priceInputMode === 'gross' &&
      line.baseCents - line.discountCents !== line.grossCents)
  ) {
    throw new InvoiceCreditError(
      'Source invoice line amounts do not reconcile.',
    );
  }
}

function validatePreviousAllocation(
  allocation: PreviousCreditLineAllocation,
): void {
  requireIdentifier(
    allocation.sourceInvoiceLineId,
    'Previous source invoice line id',
  );
  requirePositiveSafeInteger(
    allocation.quantityHundredths,
    'Previous credit quantity',
  );
  requireNonNegativeSafeInteger(
    allocation.baseCents,
    'Previous base amount',
  );
  requireNonNegativeSafeInteger(
    allocation.discountCents,
    'Previous discount amount',
  );
  requireNonNegativeSafeInteger(
    allocation.netCents,
    'Previous net amount',
  );
  requireNonNegativeSafeInteger(
    allocation.vatCents,
    'Previous VAT amount',
  );
  requireNonNegativeSafeInteger(
    allocation.grossCents,
    'Previous gross amount',
  );

  if (
    allocation.discountCents > allocation.baseCents ||
    allocation.netCents + allocation.vatCents !== allocation.grossCents
  ) {
    throw new InvoiceCreditError(
      'Previous credit allocation amounts do not reconcile.',
    );
  }
}

function validateCalculatedCreditLine(line: CalculatedCreditLine): void {
  requirePositiveSafeInteger(line.quantityHundredths, 'Credit quantity');
  requireNonNegativeSafeInteger(line.netCents, 'Credit net amount');
  requireNonNegativeSafeInteger(line.vatCents, 'Credit VAT amount');
  requireNonNegativeSafeInteger(line.grossCents, 'Credit gross amount');

  if (line.netCents + line.vatCents !== line.grossCents) {
    throw new InvoiceCreditError(
      'Credit invoice line net, VAT, and gross amounts do not reconcile.',
    );
  }
}

function createEmptyPreviousAllocation(): PreviousAllocationTotal {
  return {
    quantityHundredths: 0,
    baseCents: 0,
    discountCents: 0,
    netCents: 0,
    vatCents: 0,
    grossCents: 0,
  };
}

function requireIdentifier(value: string, fieldName: string): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 200
  ) {
    throw new InvoiceCreditError(`${fieldName} is invalid.`);
  }
}

function requirePositiveSafeInteger(value: number, fieldName: string): void {
  requireNonNegativeSafeInteger(value, fieldName);
  if (value === 0) {
    throw new InvoiceCreditError(`${fieldName} must be positive.`);
  }
}

function requireNonNegativeSafeInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvoiceCreditError(
      `${fieldName} must be a non-negative safe integer.`,
    );
  }
}

function addSafeIntegers(first: number, second: number): number {
  const result = BigInt(first) + BigInt(second);
  return toSafeInteger(result);
}

function subtractAllocation(target: number, previous: number): number {
  const result = target - previous;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InvoiceCreditError(
      'Previous credits exceed the cumulative credit allocation.',
    );
  }
  return result;
}

function toSafeInteger(value: bigint): number {
  if (value < 0n || value > maximumSafeInteger) {
    throw new InvoiceCreditError(
      'Credit invoice amount exceeds the safe integer range.',
    );
  }
  return Number(value);
}
