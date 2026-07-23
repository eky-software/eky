import { randomUUID } from 'node:crypto';

import {
  calculateCreditInvoice,
  type CreditSourceLine,
  type PreviousCreditLineAllocation,
  type RequestedCreditLine,
} from '../domain/calculateCreditInvoice.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import type { InvoiceDraft, InvoiceDraftLine } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  normalizeOptionalInvoiceTextWithLimit,
  normalizeRequiredInvoiceText,
} from '../domain/invoiceDraftRules.js';
import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../domain/approvedInvoiceView.js';
import type {
  CreditInvoiceDraftLineView,
  CreditInvoiceDraftView,
  CreditInvoicePartyView,
} from './creditInvoiceDraftView.js';

const maximumShortTextLength = 500;
const maximumLongTextLength = 5_000;

export interface CreditInvoiceDraftLineInput {
  sourceInvoiceLineId: string;
  description: string;
  quantityHundredths: number;
}

export interface PreparedCreditDraftContent {
  lines: InvoiceDraftLine[];
  totals: InvoiceDraft['totals'];
}

export function createInitialCreditDraft(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly PreviousCreditLineAllocation[],
  createdAt: string,
): InvoiceDraft {
  const invoiceDate = parseCreditDraftTimestamp(createdAt);
  const requestedLines = createRemainingRequestedLines(
    sourceInvoice,
    previousAllocations,
  );

  if (requestedLines.length === 0) {
    throw new InvoiceCreditError(
      'Source invoice has no remaining creditable lines.',
    );
  }

  const content = prepareCreditDraftContent(
    sourceInvoice,
    previousAllocations,
    requestedLines.map((line) => {
      const sourceLine = getSourceLine(sourceInvoice, line.sourceInvoiceLineId);

      return {
        ...line,
        description: sourceLine.description,
      };
    }),
  );

  return {
    id: randomUUID(),
    companyId: sourceInvoice.companyId,
    invoiceKind: 'credit',
    creditedInvoiceId: sourceInvoice.id,
    customerId: sourceInvoice.customerId,
    billingRecipientCustomerId: sourceInvoice.billingRecipientCustomerId,
    status: 'draft',
    invoiceDate,
    dueDate: invoiceDate,
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: sourceInvoice.priceInputMode,
    subject: createCreditSubject(sourceInvoice),
    orderNumber: sourceInvoice.orderNumber,
    note: createCreditNote(sourceInvoice),
    deliveryAddressText: sourceInvoice.deliveryAddressText,
    ...content,
    createdAt,
    updatedAt: createdAt,
  };
}

export function prepareUpdatedCreditDraft(
  existingDraft: InvoiceDraft,
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly PreviousCreditLineAllocation[],
  input: {
    subject: string;
    note: string;
    lines: readonly CreditInvoiceDraftLineInput[];
    updatedAt: string;
  },
): InvoiceDraft {
  const content = prepareCreditDraftContent(
    sourceInvoice,
    previousAllocations,
    input.lines,
  );

  return {
    ...existingDraft,
    subject: normalizeOptionalInvoiceTextWithLimit(
      input.subject,
      'Credit invoice subject',
      maximumShortTextLength,
    ),
    note: normalizeOptionalInvoiceTextWithLimit(
      input.note,
      'Credit invoice note',
      maximumLongTextLength,
    ),
    lines: content.lines,
    totals: content.totals,
    updatedAt: input.updatedAt,
  };
}

export function toCreditInvoiceDraftView(
  draft: InvoiceDraft,
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly PreviousCreditLineAllocation[],
): CreditInvoiceDraftView {
  if (draft.invoiceKind !== 'credit' || draft.creditedInvoiceId === null) {
    throw new InvoiceDraftValidationError(
      'Invoice draft is not a credit invoice draft.',
    );
  }

  const previousQuantityBySourceLine = sumPreviousQuantities(
    previousAllocations,
  );
  const draftLineBySourceLine = new Map(
    draft.lines.map((line) => [line.sourceInvoiceLineId, line]),
  );
  const lines: CreditInvoiceDraftLineView[] = [];

  for (const sourceLine of sourceInvoice.lines) {
    if (!isCreditableSourceLine(sourceLine)) {
      continue;
    }

    const maximumQuantityHundredths =
      sourceLine.quantityHundredths -
      (previousQuantityBySourceLine.get(sourceLine.id) ?? 0);

    if (maximumQuantityHundredths <= 0) {
      continue;
    }

    const draftLine = draftLineBySourceLine.get(sourceLine.id);
    lines.push({
      id: draftLine?.id ?? null,
      sourceInvoiceLineId: sourceLine.id,
      isIncluded: draftLine !== undefined,
      position: sourceLine.lineOrder,
      code: sourceLine.code,
      description: draftLine?.description ?? sourceLine.description,
      quantityHundredths: draftLine?.quantityHundredths ?? 0,
      maximumQuantityHundredths,
      unit: sourceLine.unit,
      unitPriceCents: sourceLine.unitPriceCents,
      vatRateBasisPoints: sourceLine.vatRateBasisPoints,
      discount: sourceLine.discount,
      baseCents: draftLine?.baseCents ?? 0,
      discountCents: draftLine?.discountCents ?? 0,
      netCents: draftLine?.netCents ?? 0,
      vatCents: draftLine?.vatCents ?? 0,
      grossCents: draftLine?.grossCents ?? 0,
    });
  }

  return {
    id: draft.id,
    invoiceKind: 'credit',
    creditedInvoiceId: sourceInvoice.id,
    creditedInvoiceNumber: sourceInvoice.invoiceNumber,
    creditedInvoiceDate: sourceInvoice.invoiceDate,
    customer: toCustomerParty(sourceInvoice),
    billingRecipient: toBillingRecipientParty(sourceInvoice),
    invoiceDate: draft.invoiceDate,
    dueDate: draft.dueDate,
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: draft.priceInputMode,
    subject: draft.subject,
    orderNumber: draft.orderNumber,
    note: draft.note,
    deliveryAddressText: draft.deliveryAddressText,
    lines,
    totals: draft.totals,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function prepareCreditDraftContent(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly PreviousCreditLineAllocation[],
  inputLines: readonly CreditInvoiceDraftLineInput[],
): PreparedCreditDraftContent {
  if (inputLines.length === 0) {
    throw new InvoiceDraftValidationError(
      'Credit invoice draft must contain at least one line.',
    );
  }

  const requestedLines: RequestedCreditLine[] = inputLines.map((line) => ({
    sourceInvoiceLineId: line.sourceInvoiceLineId,
    quantityHundredths: line.quantityHundredths,
  }));
  const calculated = calculateCreditInvoice(
    toCreditSourceLines(sourceInvoice),
    previousAllocations,
    requestedLines,
  );
  const sourceLineById = new Map(
    sourceInvoice.lines.map((line) => [line.id, line]),
  );
  const existingLineBySourceId = new Map(
    inputLines.map((line) => [line.sourceInvoiceLineId, line]),
  );
  const lines = calculated.lines.map((line, index): InvoiceDraftLine => {
    const sourceLine = sourceLineById.get(line.sourceInvoiceLineId);
    const inputLine = existingLineBySourceId.get(line.sourceInvoiceLineId);

    if (sourceLine === undefined || inputLine === undefined) {
      throw new InvoiceDraftValidationError(
        'Credit invoice source line is invalid.',
      );
    }

    return {
      ...line,
      id: randomUUID(),
      position: index + 1,
      code: sourceLine.code,
      description: normalizeRequiredInvoiceText(
        normalizeOptionalInvoiceTextWithLimit(
          inputLine.description,
          'Credit invoice line description',
          maximumLongTextLength,
        ),
        'Credit invoice line description',
      ),
      unit: sourceLine.unit,
      unitPriceCents: sourceLine.unitPriceCents,
      discount: sourceLine.discount,
    };
  });

  return {
    lines,
    totals: calculated.totals,
  };
}

function createRemainingRequestedLines(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly PreviousCreditLineAllocation[],
): RequestedCreditLine[] {
  const previousQuantityBySourceLine = sumPreviousQuantities(
    previousAllocations,
  );

  return sourceInvoice.lines.flatMap((line) => {
    if (!isCreditableSourceLine(line)) {
      return [];
    }

    const remainingQuantity =
      line.quantityHundredths -
      (previousQuantityBySourceLine.get(line.id) ?? 0);

    return remainingQuantity > 0
      ? [{ sourceInvoiceLineId: line.id, quantityHundredths: remainingQuantity }]
      : [];
  });
}

function toCreditSourceLines(
  sourceInvoice: ApprovedInvoiceView,
): CreditSourceLine[] {
  return sourceInvoice.lines.map((line) => ({
    id: line.id,
    lineOrder: line.lineOrder,
    quantityHundredths: line.quantityHundredths,
    priceInputMode: sourceInvoice.priceInputMode,
    vatRateBasisPoints: line.vatRateBasisPoints,
    baseCents: line.baseCents,
    discountCents: line.discountCents,
    netCents: line.netCents,
    vatCents: line.vatCents,
    grossCents: line.grossCents,
  }));
}

function sumPreviousQuantities(
  previousAllocations: readonly PreviousCreditLineAllocation[],
): Map<string, number> {
  const quantities = new Map<string, number>();

  for (const allocation of previousAllocations) {
    const next =
      (quantities.get(allocation.sourceInvoiceLineId) ?? 0) +
      allocation.quantityHundredths;

    if (!Number.isSafeInteger(next) || next < 0) {
      throw new InvoiceDraftValidationError(
        'Stored credit allocation is invalid.',
      );
    }

    quantities.set(allocation.sourceInvoiceLineId, next);
  }

  return quantities;
}

function isCreditableSourceLine(line: ApprovedInvoiceViewLine): boolean {
  return line.quantityHundredths > 0 && line.grossCents > 0;
}

function getSourceLine(
  invoice: ApprovedInvoiceView,
  sourceInvoiceLineId: string,
): ApprovedInvoiceViewLine {
  const line = invoice.lines.find(
    (candidate) => candidate.id === sourceInvoiceLineId,
  );

  if (line === undefined) {
    throw new InvoiceDraftValidationError(
      'Credit invoice source line is invalid.',
    );
  }

  return line;
}

function parseCreditDraftTimestamp(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new InvoiceDraftValidationError(
      'Credit invoice draft timestamp must be valid.',
    );
  }

  return parsed.toISOString().slice(0, 10);
}

function createCreditSubject(sourceInvoice: ApprovedInvoiceView): string {
  const originalSubject = sourceInvoice.subject.trim();

  return originalSubject === ''
    ? `Hyvitys laskulle ${sourceInvoice.invoiceNumber}`
    : `Hyvitys: ${originalSubject} (lasku ${sourceInvoice.invoiceNumber})`;
}

function createCreditNote(sourceInvoice: ApprovedInvoiceView): string {
  const reference = `Hyvittää laskua ${sourceInvoice.invoiceNumber}.`;
  const originalNote = sourceInvoice.note.trim();

  return originalNote === '' ? reference : `${reference}\n\n${originalNote}`;
}

function toCustomerParty(
  invoice: ApprovedInvoiceView,
): CreditInvoicePartyView {
  return {
    customerId: invoice.customerId,
    customerNumber: invoice.customerNumberSnapshot,
    name: invoice.customerNameSnapshot,
    businessId: invoice.customerBusinessIdSnapshot,
    email: invoice.customerEmailSnapshot,
    phone: invoice.customerPhoneSnapshot,
    streetAddress: invoice.customerStreetAddressSnapshot,
    postalCode: invoice.customerPostalCodeSnapshot,
    city: invoice.customerCitySnapshot,
  };
}

function toBillingRecipientParty(
  invoice: ApprovedInvoiceView,
): CreditInvoicePartyView {
  return {
    customerId: invoice.billingRecipientCustomerId,
    customerNumber: invoice.billingRecipientCustomerNumberSnapshot,
    name: invoice.billingRecipientNameSnapshot,
    businessId: invoice.billingRecipientBusinessIdSnapshot,
    email: invoice.billingRecipientEmailSnapshot,
    phone: invoice.billingRecipientPhoneSnapshot,
    streetAddress: invoice.billingRecipientStreetAddressSnapshot,
    postalCode: invoice.billingRecipientPostalCodeSnapshot,
    city: invoice.billingRecipientCitySnapshot,
  };
}
