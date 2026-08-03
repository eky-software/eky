import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ApproveCreditInvoiceDraftInput } from '../application/approveCreditInvoiceDraft.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { CreateCreditInvoiceDraftInput } from '../application/createCreditInvoiceDraft.js';
import type { CreditInvoiceDraftView } from '../application/creditInvoiceDraftView.js';
import type { GetCreditInvoiceDraftInput } from '../application/getCreditInvoiceDraft.js';
import { InvoiceCreditConflictError } from '../application/invoiceCreditConflictError.js';
import { InvoiceDraftNotFoundError } from '../application/invoiceDraftNotFoundError.js';
import type { UpdateCreditInvoiceDraftInput } from '../application/updateCreditInvoiceDraft.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  CreditInvoiceDraftRequestValidationError,
  parseUpdateCreditInvoiceDraftRequest,
} from './creditInvoiceDraftRequest.js';
import type { ApprovedCreditInvoiceResult } from '../ports/invoiceCreditApprovalRepository.js';

const maximumCreditDraftBodySizeBytes = 256 * 1024;
const maximumForbiddenBodySizeBytes = 1024;

export interface CreditInvoiceDraftRouteDependencies {
  approveCreditInvoiceDraft(
    input: ApproveCreditInvoiceDraftInput,
  ): Promise<ApprovedCreditInvoiceResult>;
  createCreditInvoiceDraft(
    input: CreateCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraftView>;
  getCreditInvoiceDraft(
    input: GetCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraftView>;
  updateCreditInvoiceDraft(
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraftView>;
}

export function createCreditInvoiceDraftRoutes(
  dependencies: CreditInvoiceDraftRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post(
    '/invoices/:id/credit-draft',
    bodyLimit({
      maxSize: maximumForbiddenBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Credit invoice draft body is too large.' }, 413),
    }),
    async (context) => {
      try {
        const bodyResult = await readJsonRequestBody(context.req, 'forbidden');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const creditInvoiceDraft = await dependencies.createCreditInvoiceDraft({
          actorContext: context.get('actorContext'),
          createdAt: new Date().toISOString(),
          invoiceId: context.req.param('id'),
        });

        return context.json({ creditInvoiceDraft }, 201);
      } catch (error) {
        return mapCreditDraftError(context, error);
      }
    },
  );

  routes.get('/invoice-drafts/:id/credit', async (context) => {
    try {
      const creditInvoiceDraft = await dependencies.getCreditInvoiceDraft({
        actorContext: context.get('actorContext'),
        invoiceDraftId: context.req.param('id'),
      });

      return context.json({ creditInvoiceDraft });
    } catch (error) {
      return mapCreditDraftError(context, error);
    }
  });

  routes.post(
    '/invoice-drafts/:id/approve-credit',
    bodyLimit({
      maxSize: maximumForbiddenBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Credit invoice approval body is too large.' }, 413),
    }),
    async (context) => {
      try {
        const bodyResult = await readJsonRequestBody(context.req, 'forbidden');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const approvedInvoice =
          await dependencies.approveCreditInvoiceDraft({
            actorContext: context.get('actorContext'),
            approvedAt: new Date().toISOString(),
            draftId: context.req.param('id'),
          });

        return context.json({ approvedInvoice });
      } catch (error) {
        return mapCreditDraftError(context, error);
      }
    },
  );

  routes.put(
    '/invoice-drafts/:id/credit',
    bodyLimit({
      maxSize: maximumCreditDraftBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Credit invoice draft body is too large.' }, 413),
    }),
    async (context) => {
      try {
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;

        const creditInvoiceDraft = await dependencies.updateCreditInvoiceDraft(
          parseUpdateCreditInvoiceDraftRequest(body, {
            actorContext: context.get('actorContext'),
            invoiceDraftId: context.req.param('id'),
          }),
        );

        return context.json({ creditInvoiceDraft });
      } catch (error) {
        return mapCreditDraftError(context, error);
      }
    },
  );

  return routes;
}

function mapCreditDraftError(
  context: Context<BackendEnvironment>,
  error: unknown,
) {
  if (error instanceof AuthorizationError) {
    return context.json({ error: 'Access denied.' }, 403);
  }

  if (
    error instanceof ApprovedInvoiceNotFoundError ||
    error instanceof InvoiceDraftNotFoundError
  ) {
    return context.json({ error: error.message }, 404);
  }

  if (error instanceof InvoiceCreditConflictError) {
    return context.json({ error: error.message }, 409);
  }

  if (
    error instanceof CreditInvoiceDraftRequestValidationError ||
    error instanceof InvoiceCreditError ||
    error instanceof InvoiceDraftValidationError
  ) {
    return context.json({ error: error.message }, 400);
  }

  throw error;
}
