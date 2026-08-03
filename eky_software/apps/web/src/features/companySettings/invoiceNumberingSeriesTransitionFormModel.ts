import type {
  ActivateInvoiceNumberingSeriesRequest,
  InvoiceNumberingSeriesActivationPreviewQuery,
  InvoiceNumberingSeriesOverviewView,
  InvoiceNumberingSeriesReasonCode,
} from '@eky/api-client';

import {
  invoiceNumberingModeOptions,
  type InvoiceNumberingSettingsForm,
} from './invoiceNumberingSettingsFormModel.js';

export const invoiceNumberingSeriesReasonCodeOptions: InvoiceNumberingSeriesReasonCode[] =
  [
    'legalRequirement',
    'accountingRequirement',
    'organizationalChange',
    'other',
  ];

export interface InvoiceNumberingSeriesTransitionForm
  extends InvoiceNumberingSettingsForm {
  confirmation: string;
  previewDate: string;
  reasonCode: InvoiceNumberingSeriesReasonCode;
  reasonNote: string;
}

export interface InvoiceNumberingSeriesTransitionValidationErrors {
  firstSequenceNumber?: string;
  fiscalYearStartMonth?: string;
  mode?: string;
  reasonNote?: string;
  sequencePadding?: string;
}

export function createInvoiceNumberingSeriesTransitionForm(
  overview: InvoiceNumberingSeriesOverviewView,
  previewDate: string,
): InvoiceNumberingSeriesTransitionForm {
  return {
    confirmation: '',
    firstSequenceNumber: String(overview.activeSeries.firstSequenceNumber),
    fiscalYearStartMonth: String(
      overview.activeSeries.fiscalYearStartMonth,
    ),
    mode: overview.activeSeries.mode,
    previewDate,
    reasonCode: 'accountingRequirement',
    reasonNote: '',
    sequencePadding: String(overview.activeSeries.sequencePadding),
  };
}

export function toInvoiceNumberingSeriesActivationPreviewQuery(
  form: InvoiceNumberingSeriesTransitionForm,
): InvoiceNumberingSeriesActivationPreviewQuery {
  return {
    fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
    mode: form.mode,
    previewDate: form.previewDate,
    sequencePadding: Number(form.sequencePadding),
  };
}

export function validateInvoiceNumberingSeriesTransitionForm(
  form: InvoiceNumberingSeriesTransitionForm,
  minimumFirstSequenceNumber: number | null,
  messages: {
    firstSequenceNumberInvalid: string;
    fiscalYearStartMonthInvalid: string;
    modeInvalid: string;
    reasonNoteInvalid: string;
    safeFirstSequenceNumberRequired: string;
    sequencePaddingInvalid: string;
  },
): InvoiceNumberingSeriesTransitionValidationErrors {
  const errors: InvoiceNumberingSeriesTransitionValidationErrors = {};
  const fiscalYearStartMonth = Number(form.fiscalYearStartMonth);
  const sequencePadding = Number(form.sequencePadding);
  const firstSequenceNumber = Number(form.firstSequenceNumber);

  if (!invoiceNumberingModeOptions.includes(form.mode)) {
    errors.mode = messages.modeInvalid;
  }

  if (
    !Number.isSafeInteger(fiscalYearStartMonth) ||
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12
  ) {
    errors.fiscalYearStartMonth = messages.fiscalYearStartMonthInvalid;
  }

  if (
    !Number.isSafeInteger(sequencePadding) ||
    sequencePadding < 0 ||
    sequencePadding > 12
  ) {
    errors.sequencePadding = messages.sequencePaddingInvalid;
  }

  if (
    !Number.isSafeInteger(firstSequenceNumber) ||
    firstSequenceNumber < 1
  ) {
    errors.firstSequenceNumber = messages.firstSequenceNumberInvalid;
  } else if (
    minimumFirstSequenceNumber === null ||
    firstSequenceNumber < minimumFirstSequenceNumber
  ) {
    errors.firstSequenceNumber = messages.safeFirstSequenceNumberRequired;
  }

  if (
    form.reasonNote.length > 500 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(form.reasonNote)
  ) {
    errors.reasonNote = messages.reasonNoteInvalid;
  }

  return errors;
}

export function hasInvoiceNumberingSeriesTransitionValidationErrors(
  errors: InvoiceNumberingSeriesTransitionValidationErrors,
): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

export function toActivateInvoiceNumberingSeriesRequest(
  form: InvoiceNumberingSeriesTransitionForm,
  currentRevision: number,
): ActivateInvoiceNumberingSeriesRequest {
  const reasonNote = form.reasonNote.trim();

  return {
    confirmation: form.confirmation,
    currentRevision,
    firstSequenceNumber: Number(form.firstSequenceNumber),
    fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
    mode: form.mode,
    reasonCode: form.reasonCode,
    reasonNote: reasonNote.length > 0 ? reasonNote : null,
    sequencePadding: Number(form.sequencePadding),
  };
}
