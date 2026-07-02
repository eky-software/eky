import { Hono } from 'hono';

import type {
  GetApprovedInvoiceInput,
} from '../application/getApprovedInvoice.js';
import type {
  ListApprovedInvoicesInput,
} from '../application/listApprovedInvoices.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';

const devCompanyId = 'dev-company';

interface ApprovedInvoiceRouteDependencies {
  getApprovedInvoice(
    input: GetApprovedInvoiceInput,
  ): Promise<ApprovedInvoiceView>;
  listApprovedInvoices(
    input: ListApprovedInvoicesInput,
  ): Promise<ApprovedInvoiceSummary[]>;
}

export function createApprovedInvoiceRoutes(
  dependencies: ApprovedInvoiceRouteDependencies,
): Hono {
  const routes = new Hono();

  routes.get('/invoices', async (context) => {
    try {
      const invoices = await dependencies.listApprovedInvoices({
        companyId: devCompanyId,
      });

      return context.json({ invoices });
    } catch (error) {
      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.get('/invoices/:id', async (context) => {
    try {
      const invoice = await dependencies.getApprovedInvoice({
        companyId: devCompanyId,
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
