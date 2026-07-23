import type {
  CreditInvoiceDraft,
  CreditInvoiceDraftLineInput,
  InvoiceLineDiscount,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';

import {
  parseEuroCents,
  parseQuantityHundredths,
} from './invoiceDraftFormMapping.js';
import { normalizeInvoiceUnit } from './invoiceUnitValidation.js';

const maximumSubjectLength = 500;
const maximumLongTextLength = 5_000;

interface CreditInvoiceDraftLineFormBase {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
  savedGrossCents: number;
}

export interface SourceCreditInvoiceDraftLineForm
  extends CreditInvoiceDraftLineFormBase {
  lineType: 'source';
  sourceInvoiceLineId: string;
  isIncluded: boolean;
  maximumQuantityHundredths: number;
}

export interface ManualCreditInvoiceDraftLineForm
  extends CreditInvoiceDraftLineFormBase {
  lineType: 'manual';
}

export type CreditInvoiceDraftLineForm =
  | SourceCreditInvoiceDraftLineForm
  | ManualCreditInvoiceDraftLineForm;

export interface CreditInvoiceDraftForm {
  subject: string;
  note: string;
  refundIban: string;
  availableVatRates: number[];
  lines: CreditInvoiceDraftLineForm[];
}

export type CreditInvoiceDraftFormError =
  | 'description'
  | 'lines'
  | 'note'
  | 'quantity'
  | 'refundIban'
  | 'subject'
  | 'unit'
  | 'unitPrice'
  | 'vatRate';

export interface CreditInvoiceDraftFormValidation {
  errors: CreditInvoiceDraftFormError[];
  input: UpdateCreditInvoiceDraftInput | null;
}

export function hydrateCreditInvoiceDraftForm(
  draft: CreditInvoiceDraft,
): CreditInvoiceDraftForm {
  const availableVatRates = [
    ...new Set(
      draft.lines
        .filter((line) => line.lineType === 'source')
        .map((line) => line.vatRateBasisPoints),
    ),
  ].sort((first, second) => first - second);

  return {
    subject: draft.subject,
    note: draft.note,
    refundIban: formatIbanInput(draft.refundIban),
    availableVatRates,
    lines: draft.lines.map((line, index) => {
      const base = {
        key:
          line.id ??
          line.sourceInvoiceLineId ??
          `manual-saved-${index}`,
        description: line.description,
        quantity: formatCreditQuantityInput(line.quantityHundredths),
        unit: line.unit,
        unitPrice: formatEuroInput(line.unitPriceCents),
        vatRateBasisPoints: line.vatRateBasisPoints,
        discount: line.discount,
        savedGrossCents: line.grossCents,
      };

      return line.lineType === 'manual'
        ? {
            ...base,
            lineType: 'manual' as const,
          }
        : {
            ...base,
            lineType: 'source' as const,
            sourceInvoiceLineId: line.sourceInvoiceLineId,
            isIncluded: line.isIncluded,
            maximumQuantityHundredths: line.maximumQuantityHundredths,
          };
    }),
  };
}

export function createManualCreditLineForm(
  form: CreditInvoiceDraftForm,
): ManualCreditInvoiceDraftLineForm {
  return {
    key: `manual-${nextManualLineNumber(form.lines)}`,
    lineType: 'manual',
    description: '',
    quantity: '1,00',
    unit: 'kpl',
    unitPrice: '',
    vatRateBasisPoints: form.availableVatRates[0] ?? 0,
    discount: { type: 'none' },
    savedGrossCents: 0,
  };
}

export function validateAndMapCreditInvoiceDraftForm(
  form: CreditInvoiceDraftForm,
): CreditInvoiceDraftFormValidation {
  const errors = new Set<CreditInvoiceDraftFormError>();
  const subject = form.subject.trim();
  const note = form.note.trim();
  const refundIban = normalizeOptionalIban(form.refundIban);
  const includedLines = form.lines.filter(
    (line) => line.lineType === 'manual' || line.isIncluded,
  );

  if (subject.length > maximumSubjectLength) {
    errors.add('subject');
  }

  if (note.length > maximumLongTextLength) {
    errors.add('note');
  }

  if (refundIban === null) {
    errors.add('refundIban');
  }

  if (includedLines.length === 0) {
    errors.add('lines');
  }

  const lines: CreditInvoiceDraftLineInput[] = [];
  for (const line of includedLines) {
    const description = line.description.trim();
    const quantityHundredths = parseQuantityHundredths(line.quantity);

    if (
      description.length === 0 ||
      description.length > maximumLongTextLength
    ) {
      errors.add('description');
    }

    if (quantityHundredths === null || quantityHundredths <= 0) {
      errors.add('quantity');
      continue;
    }

    if (line.lineType === 'source') {
      if (quantityHundredths > line.maximumQuantityHundredths) {
        errors.add('quantity');
        continue;
      }

      if (
        description.length > 0 &&
        description.length <= maximumLongTextLength
      ) {
        lines.push({
          lineType: 'source',
          sourceInvoiceLineId: line.sourceInvoiceLineId,
          description,
          quantityHundredths,
        });
      }
      continue;
    }

    const unitPriceCents = parseEuroCents(line.unitPrice);
    let unit: string | null = null;
    try {
      unit = normalizeInvoiceUnit(line.unit);
    } catch {
      errors.add('unit');
    }

    if (unitPriceCents === null || unitPriceCents <= 0) {
      errors.add('unitPrice');
    }
    if (!form.availableVatRates.includes(line.vatRateBasisPoints)) {
      errors.add('vatRate');
    }

    if (
      description.length > 0 &&
      description.length <= maximumLongTextLength &&
      unit !== null &&
      unitPriceCents !== null &&
      unitPriceCents > 0 &&
      form.availableVatRates.includes(line.vatRateBasisPoints)
    ) {
      lines.push({
        lineType: 'manual',
        description,
        quantityHundredths,
        unit,
        unitPriceCents,
        vatRateBasisPoints: line.vatRateBasisPoints,
      });
    }
  }

  return errors.size === 0 && refundIban !== null
    ? {
        errors: [],
        input: {
          subject,
          note,
          refundIban,
          lines,
        },
      }
    : {
        errors: [...errors],
        input: null,
      };
}

export function formatCreditQuantityInput(
  quantityHundredths: number,
): string {
  const whole = Math.floor(quantityHundredths / 100);
  const fraction = String(quantityHundredths % 100).padStart(2, '0');

  return `${whole},${fraction}`;
}

function formatEuroInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}

function normalizeOptionalIban(value: string): string | null {
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (normalized === '') {
    return '';
  }
  if (
    normalized.length < 15 ||
    normalized.length > 34 ||
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)
  ) {
    return null;
  }

  const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[0-9]/.test(character)
      ? character
      : String(character.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1 ? normalized : null;
}

function formatIbanInput(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

function nextManualLineNumber(
  lines: readonly CreditInvoiceDraftLineForm[],
): number {
  let candidate = 1;
  const keys = new Set(lines.map((line) => line.key));
  while (keys.has(`manual-${candidate}`)) {
    candidate += 1;
  }
  return candidate;
}
