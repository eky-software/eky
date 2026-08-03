import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { validateInvoiceNumberingSeriesOverview } from '../domain/invoiceNumberingSeries.js';
import type { InvoiceNumberingSeriesRepository } from '../ports/invoiceNumberingSeriesRepository.js';
import { InvoiceNumberingSeriesError } from './invoiceNumberingSeriesError.js';
import {
  toInvoiceNumberingSeriesOverviewView,
  type InvoiceNumberingSeriesOverviewView,
} from './invoiceNumberingSeriesView.js';

export interface GetInvoiceNumberingSeriesOverviewInput {
  actorContext: ActorContext;
}

export async function getInvoiceNumberingSeriesOverview(
  input: GetInvoiceNumberingSeriesOverviewInput,
  repository: InvoiceNumberingSeriesRepository,
): Promise<InvoiceNumberingSeriesOverviewView> {
  requirePermission(input.actorContext, 'manageInvoiceNumberingSeries');
  const overview = await repository.getOverview(input.actorContext.companyId);

  if (overview === undefined) {
    throw new InvoiceNumberingSeriesError(
      'notFound',
      'Invoice numbering series was not found.',
    );
  }

  validateInvoiceNumberingSeriesOverview(overview);

  return toInvoiceNumberingSeriesOverviewView(overview);
}
