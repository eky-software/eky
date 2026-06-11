import type {
  CalculatedInvoiceLine,
  InvoiceTotals,
  InvoiceVatBreakdown,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

interface MutableVatBreakdown {
  netCents: bigint;
  vatCents: bigint;
  grossCents: bigint;
}

function toSafeInteger(value: bigint): number {
  if (value > maximumSafeInteger) {
    throw new InvoiceCalculationError('Calculated amount exceeds the safe integer range.');
  }

  return Number(value);
}

function validateCalculatedLine(line: CalculatedInvoiceLine): void {
  const monetaryValues = [
    line.baseCents,
    line.discountCents,
    line.netCents,
    line.vatCents,
    line.grossCents,
  ];

  if (
    !Number.isSafeInteger(line.vatRateBasisPoints) ||
    line.vatRateBasisPoints < 0 ||
    monetaryValues.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new InvoiceCalculationError(
      'Calculated invoice line values must be non-negative safe integers.',
    );
  }

  if (line.netCents + line.vatCents !== line.grossCents) {
    throw new InvoiceCalculationError(
      'Calculated invoice line net, VAT, and gross amounts do not reconcile.',
    );
  }
}

function addToVatBreakdown(
  breakdownByRate: Map<number, MutableVatBreakdown>,
  line: CalculatedInvoiceLine,
): void {
  const existingBreakdown = breakdownByRate.get(line.vatRateBasisPoints);

  if (existingBreakdown) {
    existingBreakdown.netCents += BigInt(line.netCents);
    existingBreakdown.vatCents += BigInt(line.vatCents);
    existingBreakdown.grossCents += BigInt(line.grossCents);
    return;
  }

  breakdownByRate.set(line.vatRateBasisPoints, {
    netCents: BigInt(line.netCents),
    vatCents: BigInt(line.vatCents),
    grossCents: BigInt(line.grossCents),
  });
}

function createVatBreakdown(
  breakdownByRate: Map<number, MutableVatBreakdown>,
): InvoiceVatBreakdown[] {
  return [...breakdownByRate.entries()]
    .sort(([firstRate], [secondRate]) => firstRate - secondRate)
    .map(([vatRateBasisPoints, breakdown]) => ({
      vatRateBasisPoints,
      netCents: toSafeInteger(breakdown.netCents),
      vatCents: toSafeInteger(breakdown.vatCents),
      grossCents: toSafeInteger(breakdown.grossCents),
    }));
}

export function calculateInvoiceTotals(
  lines: readonly CalculatedInvoiceLine[],
): InvoiceTotals {
  let netTotalCents = 0n;
  let vatTotalCents = 0n;
  let grossTotalCents = 0n;
  const breakdownByRate = new Map<number, MutableVatBreakdown>();

  for (const line of lines) {
    validateCalculatedLine(line);
    netTotalCents += BigInt(line.netCents);
    vatTotalCents += BigInt(line.vatCents);
    grossTotalCents += BigInt(line.grossCents);
    addToVatBreakdown(breakdownByRate, line);
  }

  return {
    netTotalCents: toSafeInteger(netTotalCents),
    vatTotalCents: toSafeInteger(vatTotalCents),
    grossTotalCents: toSafeInteger(grossTotalCents),
    vatBreakdown: createVatBreakdown(breakdownByRate),
  };
}
