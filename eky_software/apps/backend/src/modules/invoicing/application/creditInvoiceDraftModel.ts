import { randomUUID } from 'node:crypto';

import {
  type CreditSourceLine,
  type RequestedCreditLine,
} from '../domain/calculateCreditInvoice.js';
import {
  calculateCreditInvoiceDraft,
  calculateRemainingCreditTotals,
  type CalculatedCreditDraft,
  type PreviousCreditAllocation,
  type RequestedManualCreditLine,
} from '../domain/calculateCreditInvoiceDraft.js';
import {
  calculateRemainingReverseChargeCreditTotals,
  calculateReverseChargeCreditInvoiceDraft,
  type RequestedReverseChargeManualCreditLine,
  type ReverseChargeCreditSourceLine,
  type ReverseChargePreviousCreditAllocation,
} from '../domain/calculateReverseChargeCreditInvoiceDraft.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import type { InvoiceDraft, InvoiceDraftLine } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  normalizeOptionalInvoiceTextWithLimit,
  normalizeRequiredInvoiceText,
  parseInvoiceUnit,
} from '../domain/invoiceDraftRules.js';
import { normalizeOptionalRefundIban } from '../domain/invoiceRefundIban.js';
import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../domain/approvedInvoiceView.js';
import type { InvoiceCreditAllocation } from '../ports/invoiceCreditDraftRepository.js';
import type {
  CreditInvoiceDraftLineView,
  CreditInvoiceDraftView,
  CreditInvoicePartyView,
} from './creditInvoiceDraftView.js';

const maximumShortTextLength = 500;
const maximumLongTextLength = 5_000;

export interface SourceCreditInvoiceDraftLineInput {
  lineType: 'source';
  sourceInvoiceLineId: string;
  description: string;
  quantityHundredths: number;
}

export interface ManualCreditInvoiceDraftLineInput {
  lineType: 'manual';
  description: string;
  quantityHundredths: number;
  unit: string;
  unitPriceCents: number;
  vatRateBasisPoints: number | null;
}

export type CreditInvoiceDraftLineInput =
  | SourceCreditInvoiceDraftLineInput
  | ManualCreditInvoiceDraftLineInput;

export interface PreparedCreditDraftContent {
  lines: InvoiceDraftLine[];
  totals: InvoiceDraft['totals'];
}

export function createInitialCreditDraft(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
  createdAt: string,
): InvoiceDraft {
  const invoiceDate = parseCreditDraftTimestamp(createdAt);
  const remainingTotals = calculateRemainingTotals(
    sourceInvoice,
    previousAllocations,
  );

  if (remainingTotals.grossTotalCents === 0) {
    throw new InvoiceCreditError(
      'Source invoice has no remaining creditable lines.',
    );
  }

  const requestedLines =
    previousAllocations.some(
      (allocation) => allocation.sourceInvoiceLineId === null,
    )
      ? []
      : createRemainingRequestedLines(sourceInvoice, previousAllocations);
  const content =
    requestedLines.length === 0
      ? {
          lines: [],
          totals: {
            netTotalCents: 0,
            vatTotalCents: 0,
            grossTotalCents: 0,
            vatBreakdown: [],
          },
        }
      : prepareCreditDraftContent(
          sourceInvoice,
          previousAllocations,
          requestedLines.map((line) => {
            const sourceLine = getSourceLine(
              sourceInvoice,
              line.sourceInvoiceLineId,
            );

            return {
              ...line,
              lineType: 'source' as const,
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
    taxTreatment: sourceInvoice.taxTreatment,
    performancePeriod: sourceInvoice.performancePeriod,
    subject: createCreditSubject(sourceInvoice),
    orderNumber: sourceInvoice.orderNumber,
    note: createCreditNote(sourceInvoice),
    deliveryAddressText: sourceInvoice.deliveryAddressText,
    refundIban: '',
    ...content,
    createdAt,
    updatedAt: createdAt,
  };
}

export function prepareUpdatedCreditDraft(
  existingDraft: InvoiceDraft,
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
  input: {
    subject: string;
    note: string;
    refundIban: string;
    lines: readonly CreditInvoiceDraftLineInput[];
    updatedAt: string;
  },
): InvoiceDraft {
  if (
    existingDraft.taxTreatment !== sourceInvoice.taxTreatment ||
    JSON.stringify(existingDraft.performancePeriod) !==
      JSON.stringify(sourceInvoice.performancePeriod)
  ) {
    throw new InvoiceDraftValidationError(
      'Credit invoice tax treatment must match the source invoice.',
    );
  }

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
    refundIban: normalizeOptionalRefundIban(input.refundIban),
    lines: content.lines,
    totals: content.totals,
    updatedAt: input.updatedAt,
  };
}

export function toCreditInvoiceDraftView(
  draft: InvoiceDraft,
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
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
    draft.lines.flatMap((line) =>
      line.sourceInvoiceLineId === null
        ? []
        : [[line.sourceInvoiceLineId, line] as const],
    ),
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
      lineType: 'source',
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

  for (const draftLine of draft.lines) {
    if (draftLine.sourceInvoiceLineId !== null) {
      continue;
    }

    lines.push({
      id: draftLine.id,
      lineType: 'manual',
      sourceInvoiceLineId: null,
      isIncluded: true,
      position: draftLine.position,
      code: draftLine.code,
      description: draftLine.description,
      quantityHundredths: draftLine.quantityHundredths,
      maximumQuantityHundredths: null,
      unit: draftLine.unit,
      unitPriceCents: draftLine.unitPriceCents,
      vatRateBasisPoints: draftLine.vatRateBasisPoints,
      discount: draftLine.discount,
      baseCents: draftLine.baseCents,
      discountCents: draftLine.discountCents,
      netCents: draftLine.netCents,
      vatCents: draftLine.vatCents,
      grossCents: draftLine.grossCents,
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
    taxTreatment: draft.taxTreatment,
    performancePeriod: draft.performancePeriod,
    subject: draft.subject,
    orderNumber: draft.orderNumber,
    note: draft.note,
    deliveryAddressText: draft.deliveryAddressText,
    refundIban: draft.refundIban,
    lines,
    totals: draft.totals,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function prepareCreditDraftContent(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
  inputLines: readonly CreditInvoiceDraftLineInput[],
): PreparedCreditDraftContent {
  if (inputLines.length === 0) {
    throw new InvoiceDraftValidationError(
      'Credit invoice draft must contain at least one line.',
    );
  }

  const sourceInputs = inputLines.filter(
    (line): line is SourceCreditInvoiceDraftLineInput =>
      line.lineType === 'source',
  );
  const manualInputs = inputLines.filter(
    (line): line is ManualCreditInvoiceDraftLineInput =>
      line.lineType === 'manual',
  );
  const requestedSourceLines: RequestedCreditLine[] = sourceInputs.map(
    (line) => ({
      sourceInvoiceLineId: line.sourceInvoiceLineId,
      quantityHundredths: line.quantityHundredths,
    }),
  );
  const manualInputByKey = new Map<
    string,
    ManualCreditInvoiceDraftLineInput
  >();
  const calculated =
    sourceInvoice.taxTreatment === 'reverseChargeConstruction'
      ? calculateReverseChargeInvoiceDraftContent(
          sourceInvoice,
          previousAllocations,
          requestedSourceLines,
          manualInputs,
          manualInputByKey,
        )
      : calculateNormalInvoiceDraftContent(
          sourceInvoice,
          previousAllocations,
          requestedSourceLines,
          manualInputs,
          manualInputByKey,
        );
  const sourceLineById = new Map(
    sourceInvoice.lines.map((line) => [line.id, line]),
  );
  const existingLineBySourceId = new Map(
    sourceInputs.map((line) => [line.sourceInvoiceLineId, line]),
  );
  const lines = calculated.lines.map((line, index): InvoiceDraftLine => {
    if (line.sourceInvoiceLineId === null) {
      const inputLine = manualInputByKey.get(line.lineKey);
      if (inputLine === undefined || line.unitPriceCents === null) {
        throw new InvoiceDraftValidationError(
          'Manual credit invoice line is invalid.',
        );
      }

      return {
        ...line,
        id: randomUUID(),
        position: index + 1,
        code: '',
        description: normalizeRequiredInvoiceText(
          normalizeOptionalInvoiceTextWithLimit(
            inputLine.description,
            'Manual credit invoice line description',
            maximumLongTextLength,
          ),
          'Manual credit invoice line description',
        ),
        unit: parseInvoiceUnit(inputLine.unit),
        unitPriceCents: line.unitPriceCents,
        discount: { type: 'none' },
      };
    }

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

function calculateNormalInvoiceDraftContent(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
  requestedSourceLines: readonly RequestedCreditLine[],
  manualInputs: readonly ManualCreditInvoiceDraftLineInput[],
  manualInputByKey: Map<string, ManualCreditInvoiceDraftLineInput>,
): CalculatedCreditDraft {
  const requestedManualLines: RequestedManualCreditLine[] = manualInputs.map(
    (line, index) => {
      if (line.vatRateBasisPoints === null) {
        throw new InvoiceDraftValidationError(
          'Normal VAT manual credit line requires a VAT rate.',
        );
      }

      const lineKey = `manual-${index}`;
      manualInputByKey.set(lineKey, line);
      return {
        lineKey,
        quantityHundredths: line.quantityHundredths,
        unitPriceCents: line.unitPriceCents,
        vatRateBasisPoints: line.vatRateBasisPoints,
      };
    },
  );

  return calculateCreditInvoiceDraft(
    toNormalCreditSourceLines(sourceInvoice),
    toNormalPreviousCreditAllocations(previousAllocations),
    requestedSourceLines,
    requestedManualLines,
  );
}

function calculateReverseChargeInvoiceDraftContent(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
  requestedSourceLines: readonly RequestedCreditLine[],
  manualInputs: readonly ManualCreditInvoiceDraftLineInput[],
  manualInputByKey: Map<string, ManualCreditInvoiceDraftLineInput>,
): CalculatedCreditDraft {
  const requestedManualLines: RequestedReverseChargeManualCreditLine[] =
    manualInputs.map((line, index) => {
      if (line.vatRateBasisPoints !== null) {
        throw new InvoiceDraftValidationError(
          'Reverse charge manual credit line cannot contain a VAT rate.',
        );
      }

      const lineKey = `manual-${index}`;
      manualInputByKey.set(lineKey, line);
      return {
        lineKey,
        quantityHundredths: line.quantityHundredths,
        unitPriceCents: line.unitPriceCents,
      };
    });

  return calculateReverseChargeCreditInvoiceDraft(
    toReverseChargeCreditSourceLines(sourceInvoice),
    toReverseChargePreviousAllocations(previousAllocations),
    requestedSourceLines,
    requestedManualLines,
  );
}

function calculateRemainingTotals(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
): InvoiceDraft['totals'] {
  return sourceInvoice.taxTreatment === 'reverseChargeConstruction'
    ? calculateRemainingReverseChargeCreditTotals(
        toReverseChargeCreditSourceLines(sourceInvoice),
        toReverseChargePreviousAllocations(previousAllocations),
      )
    : calculateRemainingCreditTotals(
        toNormalCreditSourceLines(sourceInvoice),
        toNormalPreviousCreditAllocations(previousAllocations),
      );
}

function createRemainingRequestedLines(
  sourceInvoice: ApprovedInvoiceView,
  previousAllocations: readonly InvoiceCreditAllocation[],
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

function toNormalPreviousCreditAllocations(
  allocations: readonly InvoiceCreditAllocation[],
): PreviousCreditAllocation[] {
  return allocations.map((allocation) => {
    if (allocation.vatRateBasisPoints === null) {
      throw new InvoiceDraftValidationError(
        'Stored normal VAT credit allocation is invalid.',
      );
    }

    return {
      ...allocation,
      vatRateBasisPoints: allocation.vatRateBasisPoints,
    };
  });
}

function toReverseChargePreviousAllocations(
  allocations: readonly InvoiceCreditAllocation[],
): ReverseChargePreviousCreditAllocation[] {
  return allocations.map((allocation) => {
    if (
      allocation.vatRateBasisPoints !== null ||
      allocation.priceInputMode !== 'net' ||
      allocation.vatCents !== 0 ||
      allocation.netCents !== allocation.grossCents
    ) {
      throw new InvoiceDraftValidationError(
        'Stored reverse charge credit allocation is invalid.',
      );
    }

    return {
      ...allocation,
      priceInputMode: 'net',
      vatRateBasisPoints: null,
      vatCents: 0,
    };
  });
}

function toNormalCreditSourceLines(
  sourceInvoice: ApprovedInvoiceView,
): CreditSourceLine[] {
  if (sourceInvoice.taxTreatment !== 'normalVat') {
    throw new InvoiceDraftValidationError(
      'Normal VAT credit source invoice is invalid.',
    );
  }

  return sourceInvoice.lines.map((line) => {
    if (line.vatRateBasisPoints === null) {
      throw new InvoiceDraftValidationError(
        'Normal VAT credit source line is invalid.',
      );
    }

    return {
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
    };
  });
}

function toReverseChargeCreditSourceLines(
  sourceInvoice: ApprovedInvoiceView,
): ReverseChargeCreditSourceLine[] {
  if (
    sourceInvoice.taxTreatment !== 'reverseChargeConstruction' ||
    sourceInvoice.priceInputMode !== 'net'
  ) {
    throw new InvoiceDraftValidationError(
      'Reverse charge credit source invoice is invalid.',
    );
  }

  return sourceInvoice.lines.map((line) => {
    if (
      line.vatRateBasisPoints !== null ||
      line.vatCents !== 0 ||
      line.netCents !== line.grossCents
    ) {
      throw new InvoiceDraftValidationError(
        'Reverse charge credit source line is invalid.',
      );
    }

    return {
      id: line.id,
      lineOrder: line.lineOrder,
      quantityHundredths: line.quantityHundredths,
      priceInputMode: 'net',
      vatRateBasisPoints: null,
      baseCents: line.baseCents,
      discountCents: line.discountCents,
      netCents: line.netCents,
      vatCents: 0,
      grossCents: line.grossCents,
    };
  });
}

function sumPreviousQuantities(
  previousAllocations: readonly InvoiceCreditAllocation[],
): Map<string, number> {
  const quantities = new Map<string, number>();

  for (const allocation of previousAllocations) {
    if (allocation.sourceInvoiceLineId === null) {
      continue;
    }
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
