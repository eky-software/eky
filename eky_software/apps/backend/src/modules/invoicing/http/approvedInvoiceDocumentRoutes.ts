import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from '../application/getApprovedInvoicePdfDocument.js';
import type { GetApprovedInvoicePdfMetadataInput } from '../application/getApprovedInvoicePdfMetadata.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

export interface ApprovedInvoiceDocumentRouteDependencies {
  generateApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoicePdfDocument(
    input: GetApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoicePdfDocumentFile>;
  getApprovedInvoicePdfMetadata(
    input: GetApprovedInvoicePdfMetadataInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
}

const maximumForbiddenBodySizeBytes = 1024;

export function createApprovedInvoiceDocumentRoutes(
  dependencies: ApprovedInvoiceDocumentRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post(
    '/invoices/:id/pdf',
    bodyLimit({
      maxSize: maximumForbiddenBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Request body is too large.' }, 413),
    }),
    async (context) => {
      const bodyResult = await readJsonRequestBody(context.req, 'forbidden');

      if (!bodyResult.ok) {
        return context.json(
          { error: bodyResult.message },
          bodyResult.status,
        );
      }

      try {
        const actorContext = context.get('actorContext');
        const document = await dependencies.generateApprovedInvoicePdfDocument({
          companyId: actorContext.companyId,
          createdAt: new Date().toISOString(),
          invoiceId: context.req.param('id'),
        });

        return context.json({ document });
      } catch (error) {
        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (error instanceof InvoiceDraftValidationError) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  routes.get('/invoices/:id/pdf', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const pdfDocument = await dependencies.getApprovedInvoicePdfDocument({
        companyId: actorContext.companyId,
        invoiceId: context.req.param('id'),
      });
      const responseBody = pdfDocument.content.buffer.slice(
        pdfDocument.content.byteOffset,
        pdfDocument.content.byteOffset + pdfDocument.content.byteLength,
      ) as ArrayBuffer;

      return new Response(responseBody, {
        headers: {
          'Content-Disposition': `inline; filename="${pdfDocument.metadata.fileName}"`,
          'Content-Length': `${pdfDocument.metadata.sizeBytes}`,
          'Content-Type': pdfDocument.metadata.mimeType,
        },
        status: 200,
      });
    } catch (error) {
      if (
        error instanceof ApprovedInvoiceDocumentNotFoundError ||
        error instanceof ApprovedInvoiceNotFoundError
      ) {
        return context.json({ error: error.message }, 404);
      }

      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.get('/invoices/:id/pdf/metadata', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const document = await dependencies.getApprovedInvoicePdfMetadata({
        companyId: actorContext.companyId,
        invoiceId: context.req.param('id'),
      });

      return context.json({ document });
    } catch (error) {
      if (
        error instanceof ApprovedInvoiceDocumentNotFoundError ||
        error instanceof ApprovedInvoiceNotFoundError
      ) {
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
