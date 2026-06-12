import { randomUUID } from 'node:crypto';

import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  normalizeOptionalInvoiceText,
  normalizeRequiredInvoiceText,
  parseInvoiceUnit,
  requireIdentifier,
  resolveInvoiceDates,
  resolvePaymentTermDays,
} from '../domain/invoiceDraftRules.js';
import type {
  InvoiceLineDiscount,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';

export interface SaveInvoiceDraftLineInput {
  code?: string;
  description: string;
  quantityHundredths: number;
  unit: string;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
}

export interface SaveInvoiceDraftInput {
  companyId: string;
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  priceInputMode: PriceInputMode;
  subject?: string;
  orderNumber?: string;
  note?: string;
  lines: readonly SaveInvoiceDraftLineInput[];
}

export interface SaveInvoiceDraftDependencies {
  customerAccessReader: CustomerAccessReader;
  invoiceDraftRepository: InvoiceDraftRepository;
}

export async function saveInvoiceDraft(
  input: SaveInvoiceDraftInput,
  dependencies: SaveInvoiceDraftDependencies,
): Promise<InvoiceDraft> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const customerId = requireIdentifier(input.customerId, 'Customer id');
  const customerBelongsToCompany =
    await dependencies.customerAccessReader.belongsToCompany(
      customerId,
      companyId,
    );

  if (!customerBelongsToCompany) {
    throw new InvoiceDraftValidationError(
      'Customer is not available for invoicing.',
    );
  }

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
  const now = new Date().toISOString();
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
  const totals = calculateInvoiceTotals(lines);
  const draft: InvoiceDraft = {
    id: randomUUID(),
    companyId,
    customerId,
    status: 'draft',
    invoiceDate: dates.invoiceDate,
    dueDate: dates.dueDate,
    paymentTermDays,
    priceInputMode,
    subject: normalizeOptionalInvoiceText(input.subject),
    orderNumber: normalizeOptionalInvoiceText(input.orderNumber),
    note: normalizeOptionalInvoiceText(input.note),
    lines,
    totals,
    createdAt: now,
    updatedAt: now,
  };

  return dependencies.invoiceDraftRepository.saveDraft(draft);
}
