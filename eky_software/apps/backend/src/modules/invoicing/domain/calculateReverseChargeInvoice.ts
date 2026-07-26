import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import { InvoiceCalculationError } from './invoiceCalculationError.js';
import { calculateInvoiceLineBase } from './invoiceLineBaseCalculation.js';

export interface ReverseChargeInvoiceLineCalculationInput {
  quantityHundredths: number;
  unitPriceCents: number;
  priceInputMode: PriceInputMode;
  discount: InvoiceLineDiscount;
}

export interface CalculatedReverseChargeInvoiceLine {
  quantityHundredths: number;
  unitPriceCents: number;
  vatRateBasisPoints: null;
  priceInputMode: 'net';
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: 0;
  grossCents: number;
}

export interface CalculatedReverseChargeInvoice {
  lines: CalculatedReverseChargeInvoiceLine[];
  totals: InvoiceTotals;
}

export function calculateReverseChargeInvoice(
  inputs: readonly ReverseChargeInvoiceLineCalculationInput[],
): CalculatedReverseChargeInvoice {
  const lines = inputs.map(calculateReverseChargeInvoiceLine);
  const netTotalCents = lines.reduce(
    (sum, line) => addSafe(sum, line.netCents),
    0,
  );

  return {
    lines,
    totals: {
      netTotalCents,
      vatTotalCents: 0,
      grossTotalCents: netTotalCents,
      vatBreakdown: [],
    },
  };
}

export function calculateReverseChargeInvoiceLine(
  input: ReverseChargeInvoiceLineCalculationInput,
): CalculatedReverseChargeInvoiceLine {
  if (input.priceInputMode !== 'net') {
    throw new InvoiceCalculationError(
      'Reverse charge invoices must use net price input.',
    );
  }

  const { baseCents, discountCents, discountedBaseCents } =
    calculateInvoiceLineBase(input);

  return {
    quantityHundredths: input.quantityHundredths,
    unitPriceCents: input.unitPriceCents,
    vatRateBasisPoints: null,
    priceInputMode: 'net',
    baseCents,
    discountCents,
    netCents: discountedBaseCents,
    vatCents: 0,
    grossCents: discountedBaseCents,
  };
}

function addSafe(left: number, right: number): number {
  const result = left + right;

  if (!Number.isSafeInteger(result)) {
    throw new InvoiceCalculationError(
      'Calculated amount exceeds the safe integer range.',
    );
  }

  return result;
}
