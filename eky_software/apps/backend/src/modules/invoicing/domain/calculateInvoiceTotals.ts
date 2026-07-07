import type {
  CalculatedInvoiceLine,
  PriceInputMode,
  InvoiceTotals,
  InvoiceVatBreakdown,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { roundHalfUp } from './roundHalfUp.js';

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
const basisPointsScale = 10_000n;

interface MutableVatBreakdown {
  grossInputCents: bigint;
  mode: PriceInputMode;
  netCents: bigint;
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
    if (existingBreakdown.mode !== line.priceInputMode) {
      throw new InvoiceCalculationError(
        'Invoice lines with the same VAT rate must use one price input mode.',
      );
    }

    existingBreakdown.grossInputCents += BigInt(line.grossCents);
    existingBreakdown.netCents += BigInt(line.netCents);
    return;
  }

  breakdownByRate.set(line.vatRateBasisPoints, {
    grossInputCents: BigInt(line.grossCents),
    mode: line.priceInputMode,
    netCents: BigInt(line.netCents),
  });
}

function createVatBreakdown(
  breakdownByRate: Map<number, MutableVatBreakdown>,
): InvoiceVatBreakdown[] {
  return [...breakdownByRate.entries()]
    .sort(([firstRate], [secondRate]) => firstRate - secondRate)
    .map(([vatRateBasisPoints, breakdown]) => {
      if (breakdown.mode === 'gross') {
        const grossCents = toSafeInteger(breakdown.grossInputCents);
        const netCents = roundHalfUp(
          BigInt(grossCents) * basisPointsScale,
          basisPointsScale + BigInt(vatRateBasisPoints),
        );
        const vatCents = grossCents - netCents;

        return {
          vatRateBasisPoints,
          netCents,
          vatCents,
          grossCents,
        };
      }

      const netCents = toSafeInteger(breakdown.netCents);
      const vatCents = roundHalfUp(
        BigInt(netCents) * BigInt(vatRateBasisPoints),
        basisPointsScale,
      );
      const grossCents = netCents + vatCents;

      if (!Number.isSafeInteger(grossCents)) {
        throw new InvoiceCalculationError(
          'Calculated amount exceeds the safe integer range.',
        );
      }

      return {
        vatRateBasisPoints,
        netCents,
        vatCents,
        grossCents,
      };
    });
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
    addToVatBreakdown(breakdownByRate, line);
  }

  const vatBreakdown = createVatBreakdown(breakdownByRate);

  for (const breakdown of vatBreakdown) {
    netTotalCents += BigInt(breakdown.netCents);
    vatTotalCents += BigInt(breakdown.vatCents);
    grossTotalCents += BigInt(breakdown.grossCents);
  }

  return {
    netTotalCents: toSafeInteger(netTotalCents),
    vatTotalCents: toSafeInteger(vatTotalCents),
    grossTotalCents: toSafeInteger(grossTotalCents),
    vatBreakdown,
  };
}
