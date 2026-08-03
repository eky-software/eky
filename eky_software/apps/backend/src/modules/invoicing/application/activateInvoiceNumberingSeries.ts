import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import {
  activateInvoiceNumberingSeriesConfirmation,
  normalizeInvoiceNumberingSeriesReasonNote,
  validateInvoiceNumberingActiveSeries,
  validateInvoiceNumberingSeriesEvent,
  type InvoiceNumberingSeriesReasonCode,
} from '../domain/invoiceNumberingSeries.js';
import {
  validateInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  type InvoiceNumberingMode,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSeriesRepository } from '../ports/invoiceNumberingSeriesRepository.js';
import { InvoiceNumberingSeriesError } from './invoiceNumberingSeriesError.js';
import {
  toInvoiceNumberingSeriesOverviewView,
  type InvoiceNumberingSeriesOverviewView,
} from './invoiceNumberingSeriesView.js';

export interface ActivateInvoiceNumberingSeriesInput {
  actorContext: ActorContext;
  confirmation: string;
  currentRevision: number;
  firstSequenceNumber: number;
  fiscalYearStartMonth: number;
  mode: InvoiceNumberingMode;
  now: string;
  reasonCode: InvoiceNumberingSeriesReasonCode;
  reasonNote?: string | null;
  sequencePadding: number;
}

export interface ActivateInvoiceNumberingSeriesDependencies {
  createEventId(): string;
  createSeriesKey(): string;
  repository: InvoiceNumberingSeriesRepository;
}

export async function activateInvoiceNumberingSeries(
  input: ActivateInvoiceNumberingSeriesInput,
  dependencies: ActivateInvoiceNumberingSeriesDependencies,
): Promise<InvoiceNumberingSeriesOverviewView> {
  requirePermission(input.actorContext, 'manageInvoiceNumberingSeries');

  if (input.confirmation !== activateInvoiceNumberingSeriesConfirmation) {
    throw new InvoiceNumberingSeriesError(
      'confirmationInvalid',
      'Invoice numbering series confirmation is invalid.',
    );
  }

  if (!Number.isSafeInteger(input.currentRevision) || input.currentRevision < 1) {
    throw new InvoiceNumberingSeriesError(
      'conflict',
      'Invoice numbering series revision is invalid.',
    );
  }

  const companyId = requireNonEmpty(input.actorContext.companyId);
  const actorUserId = requireNonEmpty(input.actorContext.actorId);
  const now = requireNonEmpty(input.now);
  const currentOverview = await dependencies.repository.getOverview(companyId);

  if (currentOverview === undefined) {
    throw new InvoiceNumberingSeriesError(
      'notFound',
      'Invoice numbering series was not found.',
    );
  }

  if (currentOverview.activeSeries.revision !== input.currentRevision) {
    throw new InvoiceNumberingSeriesError(
      'conflict',
      'Invoice numbering series changed before activation.',
    );
  }

  validateInvoiceNumberingActiveSeries(currentOverview.activeSeries);
  const currentActiveSeriesKey = currentOverview.activeSeries.activeSeriesKey;
  const nextSeriesKey = dependencies.createSeriesKey();
  const eventId = dependencies.createEventId();
  const reasonNote = normalizeInvoiceNumberingSeriesReasonNote(input.reasonNote);

  validateInvoiceNumberSeriesKey(currentActiveSeriesKey);
  validateInvoiceNumberSeriesKey(nextSeriesKey);
  validateInvoiceNumberingSettings({
    mode: input.mode,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    sequencePadding: input.sequencePadding,
    firstSequenceNumber: input.firstSequenceNumber,
  });

  const activeSeries = {
    companyId,
    activeSeriesKey: nextSeriesKey,
    revision: input.currentRevision + 1,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const event = {
    id: eventId,
    companyId,
    actorUserId,
    previousSeriesKey: currentActiveSeriesKey,
    nextSeriesKey,
    reasonCode: input.reasonCode,
    reasonNote,
    occurredAt: now,
  };
  const nextSettings = {
    companyId,
    seriesKey: nextSeriesKey,
    mode: input.mode,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    sequencePadding: input.sequencePadding,
    firstSequenceNumber: input.firstSequenceNumber,
    createdAt: now,
    updatedAt: now,
  };

  validateInvoiceNumberingActiveSeries(activeSeries);
  validateInvoiceNumberingSeriesEvent(event);

  const result = await dependencies.repository.activate({
    activeSeries,
    event,
    expectedActiveSeriesKey: currentActiveSeriesKey,
    expectedRevision: input.currentRevision,
    nextSettings,
  });

  if (result.outcome !== 'activated') {
    throw toApplicationError(result.outcome);
  }

  return toInvoiceNumberingSeriesOverviewView(result.overview);
}

function requireNonEmpty(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new InvoiceNumberingSeriesError(
      'conflict',
      'Invoice numbering series input is invalid.',
    );
  }

  return normalized;
}

function toApplicationError(
  outcome: 'conflict' | 'notFound' | 'unsafeFirstSequenceNumber',
): InvoiceNumberingSeriesError {
  if (outcome === 'notFound') {
    return new InvoiceNumberingSeriesError(
      'notFound',
      'Invoice numbering series was not found.',
    );
  }

  if (outcome === 'unsafeFirstSequenceNumber') {
    return new InvoiceNumberingSeriesError(
      'unsafeFirstSequenceNumber',
      'First sequence number is not safe.',
    );
  }

  return new InvoiceNumberingSeriesError(
    'conflict',
    'Invoice numbering series changed before activation.',
  );
}
