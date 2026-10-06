import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetInvoiceDraftDeliveryHistoryInput } from '../application/getInvoiceDraftDeliveryHistory.js';
import { InvoiceDraftDeliveryHistoryIntegrityError } from '../application/invoiceDraftDeliveryHistoryIntegrityError.js';
import { InvoiceDraftNotFoundError } from '../application/invoiceDraftNotFoundError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceDraftDeliveryHistory } from '../ports/invoiceDraftDeliveryHistoryReader.js';

export function createInvoiceDraftDeliveryHistoryRoutes(dependencies: {
  getInvoiceDraftDeliveryHistory(input: GetInvoiceDraftDeliveryHistoryInput): Promise<InvoiceDraftDeliveryHistory>;
  reportReadFailure(
    code: 'INVOICE_DRAFT_DELIVERY_HISTORY_INTEGRITY_FAILED' | 'INVOICE_DRAFT_DELIVERY_HISTORY_READ_FAILED',
    correlationId: string | undefined,
  ): void;
}): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();
  routes.get('/invoice-drafts/:id/delivery-history', async (context) => {
    context.header('Cache-Control', 'no-store');
    try {
      const invoiceDeliveryHistory = await dependencies.getInvoiceDraftDeliveryHistory({
        actorContext: context.get('actorContext'),
        invoiceDraftId: context.req.param('id'),
      });
      return context.json({ invoiceDeliveryHistory });
    } catch (error) {
      if (error instanceof AuthorizationError) return context.json({ error: 'Access denied.' }, 403);
      if (error instanceof InvoiceDraftNotFoundError) return context.json({ error: error.message }, 404);
      if (error instanceof InvoiceDraftValidationError) return context.json({ error: error.message }, 400);
      const integrityFailure = error instanceof InvoiceDraftDeliveryHistoryIntegrityError;
      try {
        dependencies.reportReadFailure(
          integrityFailure ? 'INVOICE_DRAFT_DELIVERY_HISTORY_INTEGRITY_FAILED' : 'INVOICE_DRAFT_DELIVERY_HISTORY_READ_FAILED',
          context.get('correlationId'),
        );
      } catch {
        // Diagnostic failure must not replace the safe read failure.
      }
      return context.json({ error: integrityFailure
        ? error.message : 'Invoice delivery history could not be read.' }, 500);
    }
  });
  return routes;
}
