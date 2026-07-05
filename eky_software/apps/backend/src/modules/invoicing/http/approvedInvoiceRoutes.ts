import { Hono } from 'hono';

import type {
  GetApprovedInvoiceInput,
} from '../application/getApprovedInvoice.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  GetApprovedInvoicePdfDocumentInput,
  ApprovedInvoicePdfDocumentFile,
} from '../application/getApprovedInvoicePdfDocument.js';
import type {
  ListApprovedInvoicesInput,
} from '../application/listApprovedInvoices.js';
import type {
  ReopenApprovedInvoiceForEditingInput,
} from '../application/reopenApprovedInvoiceForEditing.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';

const devCompanyId = 'dev-company';
const devActorUserId = 'dev-user';

interface ApprovedInvoiceRouteDependencies {
  generateApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoice(
    input: GetApprovedInvoiceInput,
  ): Promise<ApprovedInvoiceView>;
  getApprovedInvoicePdfDocument(
    input: GetApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoicePdfDocumentFile>;
  listApprovedInvoices(
    input: ListApprovedInvoicesInput,
  ): Promise<ApprovedInvoiceSummary[]>;
  reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoiceForEditingInput,
  ): Promise<{ draftId: string; invoiceId: string }>;
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

  routes.post('/invoices/:id/pdf', async (context) => {
    try {
      const document = await dependencies.generateApprovedInvoicePdfDocument({
        companyId: devCompanyId,
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
  });

  routes.get('/invoices/:id/pdf', async (context) => {
    try {
      const pdfDocument = await dependencies.getApprovedInvoicePdfDocument({
        companyId: devCompanyId,
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

  routes.post('/invoices/:id/reopen-for-edit', async (context) => {
    try {
      const reopenedInvoice = await dependencies.reopenApprovedInvoiceForEditing({
        actorUserId: devActorUserId,
        companyId: devCompanyId,
        invoiceId: context.req.param('id'),
        reopenedAt: new Date().toISOString(),
      });

      return context.json({
        invoiceId: reopenedInvoice.invoiceId,
        invoiceDraftId: reopenedInvoice.draftId,
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

  return routes;
}
