import { Hono } from 'hono';
import { AuthorizationError } from '@eky/permissions';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';

import type {
  GetApprovedInvoiceInput,
} from '../application/getApprovedInvoice.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  CopyApprovedInvoiceToDraftInput,
} from '../application/copyApprovedInvoiceToDraft.js';
import type {
  GetApprovedInvoicePdfDocumentInput,
  ApprovedInvoicePdfDocumentFile,
} from '../application/getApprovedInvoicePdfDocument.js';
import type {
  GetApprovedInvoicePdfMetadataInput,
} from '../application/getApprovedInvoicePdfMetadata.js';
import type {
  ListApprovedInvoicesInput,
} from '../application/listApprovedInvoices.js';
import type {
  ReopenApprovedInvoiceForEditingInput,
} from '../application/reopenApprovedInvoiceForEditing.js';
import type {
  MarkApprovedInvoiceSentInput,
} from '../application/markApprovedInvoiceSent.js';
import type {
  PrepareApprovedInvoiceEmailDryRunInput,
} from '../application/prepareApprovedInvoiceEmailDryRun.js';
import type {
  SendApprovedInvoiceEmailDryRunInput,
  SendApprovedInvoiceEmailDryRunResult,
} from '../application/sendApprovedInvoiceEmailDryRun.js';
import type {
  ApprovedInvoiceEmailSmtpTestPreparation,
  PrepareApprovedInvoiceEmailSmtpTestInput,
} from '../application/prepareApprovedInvoiceEmailSmtpTest.js';
import type {
  SendApprovedInvoiceEmailSmtpTestInput,
  SendApprovedInvoiceEmailSmtpTestResult,
} from '../application/sendApprovedInvoiceEmailSmtpTest.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { ApprovedInvoiceEmailDeliveryError } from '../application/approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from '../application/approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { InvoiceSmtpTestAttemptError } from '../application/invoiceSmtpTestAttemptError.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApprovedInvoiceEmailPreview } from '../application/approvedInvoiceEmailPreview.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import {
  ApprovedInvoiceEmailRequestValidationError,
  parseApprovedInvoiceEmailDryRunSendBody,
  parseApprovedInvoiceEmailSmtpTestPrepareBody,
  parseApprovedInvoiceEmailSmtpTestSendBody,
} from './approvedInvoiceEmailRequest.js';

interface ApprovedInvoiceRouteDependencies {
  copyApprovedInvoiceToDraft(
    input: CopyApprovedInvoiceToDraftInput,
  ): Promise<InvoiceDraft>;
  generateApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoice(
    input: GetApprovedInvoiceInput,
  ): Promise<ApprovedInvoiceView>;
  getApprovedInvoicePdfDocument(
    input: GetApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoicePdfDocumentFile>;
  getApprovedInvoicePdfMetadata(
    input: GetApprovedInvoicePdfMetadataInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  listApprovedInvoices(
    input: ListApprovedInvoicesInput,
  ): Promise<ApprovedInvoiceSummary[]>;
  markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentInput,
  ): Promise<ApprovedInvoiceView>;
  prepareApprovedInvoiceEmailDryRun(
    input: PrepareApprovedInvoiceEmailDryRunInput,
  ): Promise<ApprovedInvoiceEmailPreview>;
  sendApprovedInvoiceEmailDryRun(
    input: SendApprovedInvoiceEmailDryRunInput,
  ): Promise<SendApprovedInvoiceEmailDryRunResult>;
  prepareApprovedInvoiceEmailSmtpTest(
    input: PrepareApprovedInvoiceEmailSmtpTestInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestPreparation>;
  sendApprovedInvoiceEmailSmtpTest(
    input: SendApprovedInvoiceEmailSmtpTestInput,
  ): Promise<SendApprovedInvoiceEmailSmtpTestResult>;
  reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoiceForEditingInput,
  ): Promise<{ draftId: string; invoiceId: string }>;
}

export function createApprovedInvoiceRoutes(
  dependencies: ApprovedInvoiceRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/invoices', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoices = await dependencies.listApprovedInvoices({
        companyId: actorContext.companyId,
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

  routes.post('/invoices/:id/pdf', async (context) => {
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
  });

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

  routes.post('/invoices/:id/mark-sent', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoice = await dependencies.markApprovedInvoiceSent({
        actorUserId: actorContext.actorId,
        companyId: actorContext.companyId,
        invoiceId: context.req.param('id'),
        markedSentAt: new Date().toISOString(),
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

  routes.post('/invoices/:id/email/dry-run', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const email = await dependencies.prepareApprovedInvoiceEmailDryRun({
        actorContext,
        invoiceId: context.req.param('id'),
        preparedAt: new Date().toISOString(),
      });

      return context.json({ email });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.post('/invoices/:id/email/dry-run/send', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const body = await context.req.json();
      const delivery = await dependencies.sendApprovedInvoiceEmailDryRun(
        parseApprovedInvoiceEmailDryRunSendBody(body, {
          actorContext,
          invoiceId: context.req.param('id'),
          sentAt: new Date().toISOString(),
        }),
      );

      return context.json({ delivery });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (
        error instanceof ApprovedInvoiceEmailRequestValidationError ||
        error instanceof InvoiceDraftValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      if (error instanceof ApprovedInvoiceEmailDeliveryError) {
        return context.json({ error: error.message }, 502);
      }

      throw error;
    }
  });

  routes.post('/invoices/:id/email/smtp-test/send', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const body = await context.req.json();
      const delivery = await dependencies.sendApprovedInvoiceEmailSmtpTest(
        parseApprovedInvoiceEmailSmtpTestSendBody(body, {
          actorContext,
          invoiceId: context.req.param('id'),
          sentAt: new Date().toISOString(),
        }),
      );

      return context.json({ delivery });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (
        error instanceof ApprovedInvoiceEmailRequestValidationError ||
        error instanceof InvoiceDraftValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      if (error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError) {
        return context.json({ error: error.message }, 502);
      }

      if (error instanceof InvoiceSmtpTestAttemptError) {
        return context.json(
          { error: error.message },
          error.code === 'cooldown' ? 429 : 409,
        );
      }

      if (error instanceof ApprovedInvoiceEmailDeliveryError) {
        return context.json({ error: error.message }, 502);
      }

      throw error;
    }
  });

  routes.post('/invoices/:id/email/smtp-test/prepare', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const body = await context.req.json();
      const preparation = await dependencies.prepareApprovedInvoiceEmailSmtpTest(
        parseApprovedInvoiceEmailSmtpTestPrepareBody(body, {
          actorContext,
          invoiceId: context.req.param('id'),
          preparedAt: new Date().toISOString(),
        }),
      );

      return context.json({ preparation });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (
        error instanceof ApprovedInvoiceEmailRequestValidationError ||
        error instanceof InvoiceDraftValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      if (error instanceof InvoiceSmtpTestAttemptError) {
        return context.json(
          { error: error.message },
          error.code === 'cooldown' ? 429 : 409,
        );
      }

      if (error instanceof ApprovedInvoiceEmailDeliveryError) {
        return context.json({ error: error.message }, 409);
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
