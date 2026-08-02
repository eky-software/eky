import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import {
  formatInvoiceNumber,
  validateInvoiceNumberingSettings,
  type InvoiceNumberingMode,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSeriesRepository } from '../ports/invoiceNumberingSeriesRepository.js';
import { InvoiceNumberingSeriesError } from './invoiceNumberingSeriesError.js';

export interface PreviewInvoiceNumberingSeriesActivationInput {
  actorContext: ActorContext;
  fiscalYearStartMonth: number;
  mode: InvoiceNumberingMode;
  previewDate: string;
  sequencePadding: number;
}

export interface InvoiceNumberingSeriesActivationPreviewView {
  capacity: 'available' | 'exhausted';
  maximumSequenceNumber: number;
  minimumFirstSequenceNumber: number | null;
  previewDate: string;
  previewInvoiceNumber: string | null;
}

export async function previewInvoiceNumberingSeriesActivation(
  input: PreviewInvoiceNumberingSeriesActivationInput,
  repository: InvoiceNumberingSeriesRepository,
): Promise<InvoiceNumberingSeriesActivationPreviewView> {
  requirePermission(input.actorContext, 'manageInvoiceNumberingSeries');
  validateInvoiceNumberingSettings({
    firstSequenceNumber: 1,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    mode: input.mode,
    sequencePadding: input.sequencePadding,
  });

  const result = await repository.getActivationPreview({
    companyId: input.actorContext.companyId,
    target: {
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      mode: input.mode,
      sequencePadding: input.sequencePadding,
    },
  });

  if (result === undefined) {
    throw new InvoiceNumberingSeriesError(
      'notFound',
      'Invoice numbering series was not found.',
    );
  }

  const minimumFirstSequenceNumber = result.minimumSafeFirstSequenceNumber;

  return {
    capacity: result.capacity,
    maximumSequenceNumber: result.maximumSequenceNumber,
    minimumFirstSequenceNumber,
    previewDate: input.previewDate,
    previewInvoiceNumber:
      result.capacity === 'available' &&
      minimumFirstSequenceNumber !== null
        ? formatInvoiceNumber(
            {
              firstSequenceNumber: minimumFirstSequenceNumber,
              fiscalYearStartMonth: input.fiscalYearStartMonth,
              mode: input.mode,
              sequencePadding: input.sequencePadding,
            },
            input.previewDate,
            minimumFirstSequenceNumber,
          )
        : null,
  };
}
