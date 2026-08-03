import {
  validateInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  type StoredInvoiceNumberingSettings,
} from './invoiceNumbering.js';
import { InvoiceNumberingError } from './invoiceNumberingError.js';

export const activateInvoiceNumberingSeriesConfirmation =
  'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';
export const maximumInvoiceNumberingSeriesReasonNoteLength = 500;

export const invoiceNumberingSeriesReasonCodes = Object.freeze([
  'legalRequirement',
  'accountingRequirement',
  'organizationalChange',
  'other',
] as const);

export type InvoiceNumberingSeriesReasonCode =
  (typeof invoiceNumberingSeriesReasonCodes)[number];

export interface InvoiceNumberingActiveSeries {
  companyId: string;
  activeSeriesKey: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface InvoiceNumberingSeriesEvent {
  id: string;
  companyId: string;
  actorUserId: string;
  previousSeriesKey: string;
  nextSeriesKey: string;
  reasonCode: InvoiceNumberingSeriesReasonCode;
  reasonNote: string | null;
  occurredAt: string;
}

export interface InvoiceNumberingSeriesHistoryEntry {
  event: InvoiceNumberingSeriesEvent;
  settings: StoredInvoiceNumberingSettings;
}

export interface InvoiceNumberingSeriesOverview {
  activeSeries: InvoiceNumberingActiveSeries;
  activeSettings: StoredInvoiceNumberingSettings;
  history: readonly InvoiceNumberingSeriesHistoryEntry[];
}

export function validateInvoiceNumberingActiveSeries(
  activeSeries: InvoiceNumberingActiveSeries,
): void {
  requireNonEmpty(activeSeries.companyId, 'Company id');
  requireNonEmpty(activeSeries.updatedAt, 'Updated timestamp');
  requireNonEmpty(activeSeries.updatedBy, 'Updated by');
  validateInvoiceNumberSeriesKey(activeSeries.activeSeriesKey);

  if (!Number.isSafeInteger(activeSeries.revision) || activeSeries.revision < 1) {
    throw new InvoiceNumberingError(
      'Invoice numbering series revision must be a positive safe integer.',
    );
  }
}

export function normalizeInvoiceNumberingSeriesReasonNote(
  reasonNote: string | null | undefined,
): string | null {
  if (reasonNote === undefined || reasonNote === null) {
    return null;
  }

  const normalized = reasonNote.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (
    normalized.length > maximumInvoiceNumberingSeriesReasonNoteLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
  ) {
    throw new InvoiceNumberingError(
      'Invoice numbering series reason note is invalid.',
    );
  }

  return normalized;
}

export function validateInvoiceNumberingSeriesEvent(
  event: InvoiceNumberingSeriesEvent,
): void {
  requireNonEmpty(event.id, 'Event id');
  requireNonEmpty(event.companyId, 'Company id');
  requireNonEmpty(event.actorUserId, 'Actor user id');
  requireNonEmpty(event.occurredAt, 'Occurred timestamp');
  validateInvoiceNumberSeriesKey(event.previousSeriesKey);
  validateInvoiceNumberSeriesKey(event.nextSeriesKey);

  if (event.previousSeriesKey === event.nextSeriesKey) {
    throw new InvoiceNumberingError(
      'Invoice numbering series transition must change the active series.',
    );
  }

  if (!invoiceNumberingSeriesReasonCodes.includes(event.reasonCode)) {
    throw new InvoiceNumberingError(
      'Invoice numbering series reason code is invalid.',
    );
  }

  if (
    normalizeInvoiceNumberingSeriesReasonNote(event.reasonNote) !==
    event.reasonNote
  ) {
    throw new InvoiceNumberingError(
      'Invoice numbering series reason note must be normalized.',
    );
  }
}

export function validateInvoiceNumberingSeriesOverview(
  overview: InvoiceNumberingSeriesOverview,
): void {
  validateInvoiceNumberingActiveSeries(overview.activeSeries);
  validateInvoiceNumberingSettings(overview.activeSettings);

  if (
    overview.activeSettings.companyId !== overview.activeSeries.companyId ||
    overview.activeSettings.seriesKey !== overview.activeSeries.activeSeriesKey
  ) {
    throw new InvoiceNumberingError(
      'Active invoice numbering series is inconsistent.',
    );
  }

  for (const entry of overview.history) {
    validateInvoiceNumberingSeriesEvent(entry.event);
    validateInvoiceNumberingSettings(entry.settings);

    if (
      entry.event.companyId !== overview.activeSeries.companyId ||
      entry.settings.companyId !== overview.activeSeries.companyId ||
      entry.settings.seriesKey !== entry.event.previousSeriesKey
    ) {
      throw new InvoiceNumberingError(
        'Invoice numbering series history is inconsistent.',
      );
    }
  }
}

function requireNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new InvoiceNumberingError(`${fieldName} is required.`);
  }
}
