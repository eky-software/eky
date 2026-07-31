import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import { InvoicePaymentConflictError } from '../application/invoicePaymentConflictError.js';
import { InvoicePaymentDateError } from '../application/invoicePaymentDateError.js';
import type { MarkInvoicePaidInput } from '../application/markInvoicePaid.js';
import type { RevertInvoicePaidMarkInput } from '../application/revertInvoicePaidMark.js';
import type { InvoicePaymentSummary } from '../domain/invoicePayment.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  InvoicePaymentRequestValidationError,
  parseMarkInvoicePaidRequest,
} from './invoicePaymentRequest.js';

const maximumInvoicePaymentBodySizeBytes = 2 * 1024;
const maximumForbiddenBodySizeBytes = 1024;

export interface ApprovedInvoicePaymentRouteDependencies {
  markInvoicePaid(input: MarkInvoicePaidInput): Promise<InvoicePaymentSummary>;
  revertInvoicePaidMark(
    input: RevertInvoicePaidMarkInput,
  ): Promise<InvoicePaymentSummary>;
}

export function createApprovedInvoicePaymentRoutes(
  dependencies: ApprovedInvoicePaymentRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.put(
    '/invoices/:id/payment',
    bodyLimit({
      maxSize: maximumInvoicePaymentBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Invoice payment body is too large.' }, 413),
    }),
    async (context) => {
      const bodyResult = await readJsonRequestBody(context.req, 'required');

      if (!bodyResult.ok) {
        return context.json(
          { error: bodyResult.message },
          bodyResult.status,
        );
      }

      try {
        const payment = await dependencies.markInvoicePaid({
          actorContext: context.get('actorContext'),
          invoiceId: context.req.param('id'),
          ...parseMarkInvoicePaidRequest(bodyResult.body),
        });

        return context.json({ payment });
      } catch (error) {
        return handleKnownError(context, error);
      }
    },
  );

  routes.delete(
    '/invoices/:id/payment',
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
        const payment = await dependencies.revertInvoicePaidMark({
          actorContext: context.get('actorContext'),
          invoiceId: context.req.param('id'),
        });

        return context.json({ payment });
      } catch (error) {
        return handleKnownError(context, error);
      }
    },
  );

  return routes;
}

function handleKnownError(
  context: Context<BackendEnvironment>,
  error: unknown,
) {
  if (error instanceof AuthorizationError) {
    return context.json({ error: 'Access denied.' }, 403);
  }

  if (error instanceof ApprovedInvoiceNotFoundError) {
    return context.json({ error: error.message }, 404);
  }

  if (
    error instanceof InvoicePaymentRequestValidationError ||
    error instanceof InvoicePaymentDateError ||
    error instanceof InvoiceDraftValidationError
  ) {
    return context.json({ error: error.message }, 400);
  }

  if (error instanceof InvoicePaymentConflictError) {
    return context.json({ error: error.message }, 409);
  }

  throw error;
}
