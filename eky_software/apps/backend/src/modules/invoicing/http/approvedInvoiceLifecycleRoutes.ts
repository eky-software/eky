import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { CancelApprovedInvoiceInput } from '../application/cancelApprovedInvoice.js';
import type { CopyApprovedInvoiceToDraftInput } from '../application/copyApprovedInvoiceToDraft.js';
import { InvoiceCancellationConfirmationError } from '../application/invoiceCancellationConfirmationError.js';
import { InvoiceCancellationConflictError } from '../application/invoiceCancellationConflictError.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { CancelledApprovedInvoiceResult } from '../ports/invoiceCorrectionRepository.js';
import {
  InvoiceCancellationRequestValidationError,
  parseInvoiceCancellationRequest,
} from './invoiceCancellationRequest.js';

export interface ApprovedInvoiceLifecycleRouteDependencies {
  cancelApprovedInvoice(
    input: CancelApprovedInvoiceInput,
  ): Promise<CancelledApprovedInvoiceResult>;
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

  routes.post('/invoices/:id/cancel', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      let body: unknown;

      try {
        body = await context.req.json();
      } catch {
        throw new InvoiceCancellationRequestValidationError();
      }

      const cancellation = await dependencies.cancelApprovedInvoice(
        parseInvoiceCancellationRequest(body, {
          actorContext,
          cancelledAt: new Date().toISOString(),
          invoiceId: context.req.param('id'),
        }),
      );

      return context.json({ cancellation });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (
        error instanceof InvoiceCancellationConfirmationError ||
        error instanceof InvoiceCancellationRequestValidationError ||
        error instanceof InvoiceDraftValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      if (error instanceof InvoiceCancellationConflictError) {
        return context.json({ error: error.message }, 409);
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
