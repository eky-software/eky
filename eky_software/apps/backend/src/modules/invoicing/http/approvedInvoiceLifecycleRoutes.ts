import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { CopyApprovedInvoiceToDraftInput } from '../application/copyApprovedInvoiceToDraft.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

export interface ApprovedInvoiceLifecycleRouteDependencies {
  copyApprovedInvoiceToDraft(
    input: CopyApprovedInvoiceToDraftInput,
  ): Promise<InvoiceDraft>;
  reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoiceForEditingInput,
  ): Promise<{ draftId: string; invoiceId: string }>;
}

export function createApprovedInvoiceLifecycleRoutes(
  dependencies: ApprovedInvoiceLifecycleRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post('/invoices/:id/reopen-for-edit', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const reopenedInvoice = await dependencies.reopenApprovedInvoiceForEditing({
        actorUserId: actorContext.actorId,
        companyId: actorContext.companyId,
        invoiceId: context.req.param('id'),
        reopenedAt: new Date().toISOString(),
      });

      return context.json({
        invoiceDraftId: reopenedInvoice.draftId,
        invoiceId: reopenedInvoice.invoiceId,
      });
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

  routes.post('/invoices/:id/copy-to-draft', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoiceDraft = await dependencies.copyApprovedInvoiceToDraft({
        companyId: actorContext.companyId,
        copiedAt: new Date().toISOString(),
        invoiceId: context.req.param('id'),
      });

      return context.json({ invoiceDraft }, 201);
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
