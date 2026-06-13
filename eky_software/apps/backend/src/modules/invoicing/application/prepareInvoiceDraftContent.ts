import { randomUUID } from 'node:crypto';

import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type {
  InvoiceDraftLine,
} from '../domain/invoiceDraft.js';
import {
  normalizeOptionalInvoiceText,
  normalizeRequiredInvoiceText,
  parseInvoiceUnit,
  requireIdentifier,
  resolveInvoiceDates,
  resolvePaymentTermDays,
} from '../domain/invoiceDraftRules.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';

export interface InvoiceDraftLineInput {
  code?: string;
  description: string;
  quantityHundredths: number;
  unit: string;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraftContentInput {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  priceInputMode: PriceInputMode;
  subject?: string;
  orderNumber?: string;
  note?: string;
  lines: readonly InvoiceDraftLineInput[];
}

export interface PreparedInvoiceDraftContent {
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
}

export function prepareInvoiceDraftContent(
  input: InvoiceDraftContentInput,
): PreparedInvoiceDraftContent {
  const customerId = requireIdentifier(input.customerId, 'Customer id');

  if (input.lines.length === 0) {
    throw new InvoiceDraftValidationError(
      'Invoice draft must contain at least one line.',
    );
  }

  const paymentTermDays = resolvePaymentTermDays(input.paymentTermDays);
  const dates = resolveInvoiceDates(
    input.invoiceDate,
    input.dueDate,
    paymentTermDays,
  );
  const priceInputMode = input.priceInputMode;
  const lines = input.lines.map((line, index) => {
    const calculatedLine = calculateInvoiceLine({
      quantityHundredths: line.quantityHundredths,
      unitPriceCents: line.unitPriceCents,
      vatRateBasisPoints: line.vatRateBasisPoints,
      priceInputMode,
      discount: line.discount,
    });

    return {
      ...calculatedLine,
      id: randomUUID(),
      position: index + 1,
      code: normalizeOptionalInvoiceText(line.code),
      description: normalizeRequiredInvoiceText(
        line.description,
        'Invoice line description',
      ),
      unit: parseInvoiceUnit(line.unit),
      discount: line.discount,
    };
  });

  return {
    customerId,
    invoiceDate: dates.invoiceDate,
    dueDate: dates.dueDate,
    paymentTermDays,
    priceInputMode,
    subject: normalizeOptionalInvoiceText(input.subject),
    orderNumber: normalizeOptionalInvoiceText(input.orderNumber),
    note: normalizeOptionalInvoiceText(input.note),
    lines,
    totals: calculateInvoiceTotals(lines),
  };
}
