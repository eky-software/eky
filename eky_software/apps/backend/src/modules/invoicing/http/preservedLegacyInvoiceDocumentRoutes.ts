import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type {
  PreservedLegacyInvoiceDeliveryDocument,
  ReadPreservedLegacyInvoiceDocumentInput,
} from '../application/readPreservedLegacyInvoiceDocument.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

export function createPreservedLegacyInvoiceDocumentRoutes(dependencies: {
  readPreservedLegacyInvoiceDocument(
    input: ReadPreservedLegacyInvoiceDocumentInput,
  ): Promise<PreservedLegacyInvoiceDeliveryDocument>;
}): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();
  routes.get('/invoices/:id/preserved-documents/:documentId/pdf', async (context) => {
    if (new URL(context.req.url).search !== '') {
      return context.json({ error: 'Query parameters are not allowed.' }, 400);
    }
    try {
      const { content } = await dependencies.readPreservedLegacyInvoiceDocument({
        actorContext: context.get('actorContext'),
        invoiceId: context.req.param('id'),
        documentId: context.req.param('documentId'),
      });
      try {
        // The response owns its copy; storage buffers never outlive this read.
        const body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(content.byteLength),
            'Content-Disposition': 'inline; filename="invoice.pdf"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } finally {
        content.fill(0);
      }
    } catch (error) {
      if (error instanceof AuthorizationError) return context.json({ error: 'Access denied.' }, 403);
      if (error instanceof InvoiceDraftValidationError) return context.json({ error: error.message }, 400);
      if (error instanceof InvoiceDeliveryConflictError) return context.json({ error: error.message }, 409);
      if (error instanceof InvoiceDocumentIntegrityError) return context.json({ error: error.message }, 500);
      // A response keeps raw exceptions away from the framework's stderr handler.
      // The existing HTTP middleware records this failure without exception data.
      return context.json({ error: 'Internal server error.' }, 500);
    }
  });
  return routes;
}
