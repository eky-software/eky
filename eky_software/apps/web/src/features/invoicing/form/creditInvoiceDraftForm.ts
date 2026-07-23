import type {
  CreditInvoiceDraft,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';

import { parseQuantityHundredths } from './invoiceDraftFormMapping.js';

const maximumSubjectLength = 500;
const maximumLongTextLength = 5_000;

export interface CreditInvoiceDraftLineForm {
  sourceInvoiceLineId: string;
  isIncluded: boolean;
  description: string;
  quantity: string;
  maximumQuantityHundredths: number;
}

export interface CreditInvoiceDraftForm {
  subject: string;
  note: string;
  lines: CreditInvoiceDraftLineForm[];
}

export type CreditInvoiceDraftFormError =
  | 'description'
  | 'lines'
  | 'note'
  | 'quantity'
  | 'subject';

export interface CreditInvoiceDraftFormValidation {
  errors: CreditInvoiceDraftFormError[];
  input: UpdateCreditInvoiceDraftInput | null;
}

export function hydrateCreditInvoiceDraftForm(
  draft: CreditInvoiceDraft,
): CreditInvoiceDraftForm {
  return {
    subject: draft.subject,
    note: draft.note,
    lines: draft.lines.map((line) => ({
      sourceInvoiceLineId: line.sourceInvoiceLineId,
      isIncluded: line.isIncluded,
      description: line.description,
      quantity: formatCreditQuantityInput(line.quantityHundredths),
      maximumQuantityHundredths: line.maximumQuantityHundredths,
    })),
  };
}

export function validateAndMapCreditInvoiceDraftForm(
  form: CreditInvoiceDraftForm,
): CreditInvoiceDraftFormValidation {
  const errors = new Set<CreditInvoiceDraftFormError>();
  const subject = form.subject.trim();
  const note = form.note.trim();
  const includedLines = form.lines.filter((line) => line.isIncluded);

  if (subject.length > maximumSubjectLength) {
    errors.add('subject');
  }

  if (note.length > maximumLongTextLength) {
    errors.add('note');
  }

  if (includedLines.length === 0) {
    errors.add('lines');
  }

  const lines = includedLines.flatMap((line) => {
    const description = line.description.trim();
    const quantityHundredths = parseQuantityHundredths(line.quantity);

    if (
      description.length === 0 ||
      description.length > maximumLongTextLength
    ) {
      errors.add('description');
    }

    if (
      quantityHundredths === null ||
      quantityHundredths <= 0 ||
      quantityHundredths > line.maximumQuantityHundredths
    ) {
      errors.add('quantity');
    }

    if (
      description.length === 0 ||
      description.length > maximumLongTextLength ||
      quantityHundredths === null ||
      quantityHundredths <= 0 ||
      quantityHundredths > line.maximumQuantityHundredths
    ) {
      return [];
    }

    return [
      {
        sourceInvoiceLineId: line.sourceInvoiceLineId,
        description,
        quantityHundredths,
      },
    ];
  });

  return errors.size === 0
    ? {
        errors: [],
        input: {
          subject,
          note,
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

