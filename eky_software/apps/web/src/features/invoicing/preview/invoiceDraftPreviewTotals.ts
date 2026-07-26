import type { InvoiceLineDiscount } from '@eky/api-client';

import {
  parseEuroCents,
  parsePercentageBasisPoints,
  parseQuantityHundredths,
} from '../form/invoiceDraftFormMapping.js';
import type { InvoiceRowForm } from '../form/invoiceRowFormState.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';

const quantityScale = 100n;
const basisPointsScale = 10_000n;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export interface InvoiceDraftPreviewVatBreakdown {
  grossCents: number;
  netCents: number;
  vatCents: number;
  vatRateBasisPoints: number;
}

export type InvoiceDraftPreviewTotals =
  | {
      grossTotalCents: number;
      isAvailable: true;
      netTotalCents: number;
      vatBreakdown: InvoiceDraftPreviewVatBreakdown[];
      vatTotalCents: number;
    }
  | {
      isAvailable: false;
    };

interface PreviewLineTotals {
  grossCents: number;
  netCents: number;
  priceInputMode: NewInvoiceFormState['priceInputMode'];
  vatCents: number;
  vatRateBasisPoints: number | null;
}

interface MutableVatBreakdown {
  grossInputCents: bigint;
  priceInputMode: NewInvoiceFormState['priceInputMode'];
  grossCents: bigint;
  netCents: bigint;
  vatCents: bigint;
}

export function calculateInvoiceDraftPreviewTotals(
  form: NewInvoiceFormState,
): InvoiceDraftPreviewTotals {
  try {
    const lineTotals: PreviewLineTotals[] = [];

    for (const row of form.lines) {
      const line = calculatePreviewLine(
        row,
        form.priceInputMode,
        form.taxTreatment,
      );

      if (line === null) {
        return { isAvailable: false };
      }

      lineTotals.push(line);
    }

    return calculatePreviewTotals(lineTotals);
  } catch {
    return { isAvailable: false };
  }
}

function calculatePreviewLine(
  row: InvoiceRowForm,
  priceInputMode: NewInvoiceFormState['priceInputMode'],
  taxTreatment: NewInvoiceFormState['taxTreatment'],
): PreviewLineTotals | null {
  const quantityHundredths = parseQuantityHundredths(row.quantity);
  const unitPriceCents = parseEuroCents(row.unitPrice);
  const discount = parsePreviewDiscount(row);

  if (
    quantityHundredths === null ||
    quantityHundredths <= 0 ||
    unitPriceCents === null ||
    discount === null
  ) {
    return null;
  }

  const baseCents = roundHalfUp(
    BigInt(unitPriceCents) * BigInt(quantityHundredths),
    quantityScale,
  );
  const discountCents = calculateDiscountCents(baseCents, discount);

  if (discountCents === null || discountCents > baseCents) {
    return null;
  }

  const discountedBaseCents = baseCents - discountCents;

  if (taxTreatment === 'reverseChargeConstruction') {
    if (priceInputMode !== 'net' || row.vatRateBasisPoints !== null) {
      return null;
    }

    return toPreviewLineTotals(null, priceInputMode, {
      grossCents: discountedBaseCents,
      netCents: discountedBaseCents,
      vatCents: 0,
    });
  }

  if (
    row.vatRateBasisPoints === null ||
    !Number.isSafeInteger(row.vatRateBasisPoints) ||
    row.vatRateBasisPoints <= 0
  ) {
    return null;
  }

  if (priceInputMode === 'net') {
    const netCents = discountedBaseCents;
    const vatCents = roundHalfUp(
      BigInt(netCents) * BigInt(row.vatRateBasisPoints),
      basisPointsScale,
    );
    const grossCents = netCents + vatCents;

    return toPreviewLineTotals(row.vatRateBasisPoints, priceInputMode, {
      grossCents,
      netCents,
      vatCents,
    });
  }

  const grossCents = discountedBaseCents;
  const netCents = roundHalfUp(
    BigInt(grossCents) * basisPointsScale,
    basisPointsScale + BigInt(row.vatRateBasisPoints),
  );
  const vatCents = grossCents - netCents;

  return toPreviewLineTotals(row.vatRateBasisPoints, priceInputMode, {
    grossCents,
    netCents,
    vatCents,
  });
}

function parsePreviewDiscount(row: InvoiceRowForm): InvoiceLineDiscount | null {
  if (row.discountType === 'none') {
    return { type: 'none' };
  }

  if (row.discountType === 'percentage') {
    const basisPoints = parsePercentageBasisPoints(row.discountValue);

    if (basisPoints === null || basisPoints > 10_000) {
      return null;
    }

    return {
      basisPoints,
      type: 'percentage',
    };
  }

  const amountCents = parseEuroCents(row.discountValue);

  if (amountCents === null) {
    return null;
  }

  return {
    amountCents,
    type: 'fixed',
  };
}

function calculateDiscountCents(
  baseCents: number,
  discount: InvoiceLineDiscount,
): number | null {
  if (discount.type === 'none') {
    return 0;
  }

  if (discount.type === 'percentage') {
    return roundHalfUp(
      BigInt(baseCents) * BigInt(discount.basisPoints),
      basisPointsScale,
    );
  }

  return discount.amountCents;
}

function calculatePreviewTotals(
  lines: readonly PreviewLineTotals[],
): InvoiceDraftPreviewTotals {
  let grossTotalCents = 0n;
  let netTotalCents = 0n;
  let vatTotalCents = 0n;
  const breakdownByRate = new Map<number, MutableVatBreakdown>();

  for (const line of lines) {
    if (line.vatRateBasisPoints === null) {
      grossTotalCents += BigInt(line.grossCents);
      netTotalCents += BigInt(line.netCents);
      vatTotalCents += BigInt(line.vatCents);
      continue;
    }

    addVatBreakdown(breakdownByRate, line);
  }

  const vatBreakdown = createVatBreakdown(breakdownByRate);

  for (const breakdown of vatBreakdown) {
    grossTotalCents += BigInt(breakdown.grossCents);
    netTotalCents += BigInt(breakdown.netCents);
    vatTotalCents += BigInt(breakdown.vatCents);
  }

  return {
    grossTotalCents: toSafeNumber(grossTotalCents),
    isAvailable: true,
    netTotalCents: toSafeNumber(netTotalCents),
    vatBreakdown,
    vatTotalCents: toSafeNumber(vatTotalCents),
  };
}

function addVatBreakdown(
  breakdownByRate: Map<number, MutableVatBreakdown>,
  line: PreviewLineTotals,
): void {
  if (line.vatRateBasisPoints === null) {
    throw new Error('Reverse charge rows do not use VAT breakdowns.');
  }

  const existingBreakdown = breakdownByRate.get(line.vatRateBasisPoints);

  if (existingBreakdown) {
    if (existingBreakdown.priceInputMode !== line.priceInputMode) {
      throw new Error('Invoice preview rows must use one price input mode per VAT rate.');
    }

    existingBreakdown.grossInputCents += BigInt(line.grossCents);
    existingBreakdown.grossCents += BigInt(line.grossCents);
    existingBreakdown.netCents += BigInt(line.netCents);
    existingBreakdown.vatCents += BigInt(line.vatCents);
    return;
  }

  breakdownByRate.set(line.vatRateBasisPoints, {
    grossInputCents: BigInt(line.grossCents),
    priceInputMode: line.priceInputMode,
    grossCents: BigInt(line.grossCents),
    netCents: BigInt(line.netCents),
    vatCents: BigInt(line.vatCents),
  });
}

function createVatBreakdown(
  breakdownByRate: Map<number, MutableVatBreakdown>,
): InvoiceDraftPreviewVatBreakdown[] {
  return [...breakdownByRate.entries()]
    .sort(([firstRate], [secondRate]) => firstRate - secondRate)
    .map(([vatRateBasisPoints, breakdown]) => {
      if (breakdown.priceInputMode === 'gross') {
        const grossCents = toSafeNumber(breakdown.grossInputCents);
        const netCents = roundHalfUp(
          BigInt(grossCents) * basisPointsScale,
          basisPointsScale + BigInt(vatRateBasisPoints),
        );

        return {
          grossCents,
          netCents,
          vatCents: grossCents - netCents,
          vatRateBasisPoints,
        };
      }

      const netCents = toSafeNumber(breakdown.netCents);
      const vatCents = roundHalfUp(
        BigInt(netCents) * BigInt(vatRateBasisPoints),
        basisPointsScale,
      );

      return {
        grossCents: netCents + vatCents,
        netCents,
        vatCents,
        vatRateBasisPoints,
      };
    });
}

function toPreviewLineTotals(
  vatRateBasisPoints: number | null,
  priceInputMode: NewInvoiceFormState['priceInputMode'],
  values: {
    grossCents: number;
    netCents: number;
    vatCents: number;
  },
): PreviewLineTotals | null {
  if (
    !Number.isSafeInteger(values.grossCents) ||
    !Number.isSafeInteger(values.netCents) ||
    !Number.isSafeInteger(values.vatCents)
  ) {
    return null;
  }

  return {
    grossCents: values.grossCents,
    netCents: values.netCents,
    priceInputMode,
    vatCents: values.vatCents,
    vatRateBasisPoints,
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedValue =
    remainder * 2n >= denominator
      ? quotient + 1n
      : quotient;

  return toSafeNumber(roundedValue);
}

function toSafeNumber(value: bigint): number {
  if (value > maximumSafeInteger) {
    throw new Error('Invoice preview amount exceeds safe integer range.');
  }

  return Number(value);
}
