import { randomUUID } from 'node:crypto';

import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type {
  InvoiceDraftLine,
} from '../domain/invoiceDraft.js';
import {
  normalizeOptionalIdentifier,
  normalizeOptionalInvoiceText,
  normalizeOptionalInvoiceTextWithLimit,
  normalizeRequiredInvoiceText,
  parseInvoiceUnit,
  requireIdentifier,
  resolveInvoiceDates,
  resolveLatePaymentInterestBasisPoints,
  resolvePaymentTermDays,
  resolveReminderPeriodDays,
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
  billingRecipientCustomerId?: string | null;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  reminderPeriodDays?: number;
  latePaymentInterestBasisPoints?: number;
  priceInputMode: PriceInputMode;
  subject?: string;
  orderNumber?: string;
  note?: string;
  deliveryAddressText?: string;
  lines: readonly InvoiceDraftLineInput[];
}

export interface PreparedInvoiceDraftContent {
  customerId: string;
  billingRecipientCustomerId: string | null;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  reminderPeriodDays: number;
  latePaymentInterestBasisPoints: number;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  deliveryAddressText: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
}

export function prepareInvoiceDraftContent(
  input: InvoiceDraftContentInput,
): PreparedInvoiceDraftContent {
  const customerId = requireIdentifier(input.customerId, 'Customer id');
  const billingRecipientCustomerId = normalizeOptionalIdentifier(
    input.billingRecipientCustomerId,
    'Billing recipient customer id',
  );

  if (input.lines.length === 0) {
    throw new InvoiceDraftValidationError(
      'Invoice draft must contain at least one line.',
    );
  }

  const paymentTermDays = resolvePaymentTermDays(input.paymentTermDays);
  const reminderPeriodDays = resolveReminderPeriodDays(
    input.reminderPeriodDays ?? 0,
  );
  const latePaymentInterestBasisPoints =
    resolveLatePaymentInterestBasisPoints(
      input.latePaymentInterestBasisPoints ?? 0,
    );
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
      sourceInvoiceLineId: null,
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
    billingRecipientCustomerId,
    invoiceDate: dates.invoiceDate,
    dueDate: dates.dueDate,
    paymentTermDays,
    reminderPeriodDays,
    latePaymentInterestBasisPoints,
    priceInputMode,
    subject: normalizeOptionalInvoiceText(input.subject),
    orderNumber: normalizeOptionalInvoiceText(input.orderNumber),
    note: normalizeOptionalInvoiceText(input.note),
    deliveryAddressText: normalizeOptionalInvoiceTextWithLimit(
      input.deliveryAddressText,
      'Delivery address text',
      500,
    ),
    lines,
    totals: calculateInvoiceTotals(lines),
  };
}
