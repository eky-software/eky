import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { GetApprovedInvoiceInput } from '../application/getApprovedInvoice.js';
import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ApprovedInvoiceListPage } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { parseApprovedInvoiceListRequest } from './approvedInvoiceListRequest.js';

export interface ApprovedInvoiceQueryRouteDependencies {
  getApprovedInvoice(input: GetApprovedInvoiceInput): Promise<ApprovedInvoiceView>;
  listApprovedInvoices(
    input: ListApprovedInvoicesInput,
  ): Promise<ApprovedInvoiceListPage>;
}

export function createApprovedInvoiceQueryRoutes(
  dependencies: ApprovedInvoiceQueryRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/invoices', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoicePage = await dependencies.listApprovedInvoices(
        parseApprovedInvoiceListRequest(
          actorContext.companyId,
          context.req.query(),
        ),
      );

      return context.json({ invoicePage });
    } catch (error) {
      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.get('/invoices/:id', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoice = await dependencies.getApprovedInvoice({
        companyId: actorContext.companyId,
        invoiceId: context.req.param('id'),
      });

      return context.json({ invoice });
    } catch (error) {
      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  return routes;
}
