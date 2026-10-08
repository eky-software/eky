import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import type { GetInvoiceDeliveryEventPdfInput, InvoiceDeliveryEventPdfResult } from '../application/getInvoiceDeliveryEventPdf.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

export function createInvoiceDeliveryHistoryRoutes(dependencies: {
  getInvoiceDeliveryEventPdf(input: GetInvoiceDeliveryEventPdfInput): Promise<InvoiceDeliveryEventPdfResult>;
}): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();
  for (const suffix of ['', '/metadata'] as const) {
    routes.get(`/invoices/:id/delivery-events/:eventId/pdf${suffix}`, async (context) => {
      try {
        const result = await dependencies.getInvoiceDeliveryEventPdf({
          actorContext: context.get('actorContext'),
          invoiceId: context.req.param('id'),
          eventId: context.req.param('eventId'),
        });
        if (result.kind === 'legacyMissingDocument') {
          return context.json({ error: 'The legacy delivery event has no preserved PDF.' }, 409);
        }
        const { content, metadata } = result.file;
        if (suffix === '/metadata') {
          try {
            return context.json({ document: {
              id: metadata.id,
              invoiceId: metadata.invoiceId,
              mimeType: metadata.mimeType,
              sha256: metadata.sha256,
              sizeBytes: metadata.sizeBytes,
            } }, 200, { 'Cache-Control': 'no-store' });
          } finally {
            content.fill(0);
          }
        }
        const body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': metadata.mimeType,
            'Content-Length': String(content.byteLength),
            'Content-Disposition': 'inline; filename="invoice.pdf"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (error) {
        if (error instanceof AuthorizationError) return context.json({ error: 'Access denied.' }, 403);
        if (error instanceof ApprovedInvoiceDocumentNotFoundError) return context.json({ error: error.message }, 404);
        if (error instanceof InvoiceDraftValidationError) return context.json({ error: error.message }, 400);
        if (error instanceof InvoiceDocumentIntegrityError) return context.json({ error: error.message }, 500);
        return context.json({ error: 'Internal server error.' }, 500);
      }
    });
  }
  return routes;
}
