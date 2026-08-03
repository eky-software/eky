import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';

import type { ApproveInvoiceDraftInput } from '../application/approveInvoiceDraft.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type { DeleteInvoiceDraftInput } from '../application/deleteInvoiceDraft.js';
import type { GetInvoiceDraftInput } from '../application/getInvoiceDraft.js';
import { InvoiceDraftNotFoundError } from '../application/invoiceDraftNotFoundError.js';
import type { ListInvoiceDraftsInput } from '../application/listInvoiceDrafts.js';
import type {
  SaveInvoiceDraftInput,
} from '../application/saveInvoiceDraft.js';
import type { UpdateInvoiceDraftInput } from '../application/updateInvoiceDraft.js';
import { InvoiceCalculationError } from '../domain/invoiceCalculationError.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import type { ApprovedInvoiceResult } from '../ports/invoiceApprovalRepository.js';
import {
  InvoiceDraftRequestValidationError,
  parseSaveInvoiceDraftRequest,
  parseUpdateInvoiceDraftRequest,
} from './invoiceDraftRequest.js';

const maximumInvoiceDraftBodySizeBytes = 256 * 1024;
const maximumInvoiceApprovalBodySizeBytes = 4 * 1024;
const maximumForbiddenBodySizeBytes = 1024;

interface InvoiceDraftRouteDependencies {
  approveInvoiceDraft(
    input: ApproveInvoiceDraftInput,
  ): Promise<ApprovedInvoiceResult>;
  deleteInvoiceDraft(input: DeleteInvoiceDraftInput): Promise<void>;
  getInvoiceDraft(input: GetInvoiceDraftInput): Promise<InvoiceDraft>;
  listInvoiceDrafts(
    input: ListInvoiceDraftsInput,
  ): Promise<InvoiceDraftSummary[]>;
  saveInvoiceDraft(input: SaveInvoiceDraftInput): Promise<InvoiceDraft>;
  updateInvoiceDraft(input: UpdateInvoiceDraftInput): Promise<InvoiceDraft>;
}

export function createInvoiceDraftRoutes(
  dependencies: InvoiceDraftRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post(
    '/invoice-drafts',
    bodyLimit({
      maxSize: maximumInvoiceDraftBodySizeBytes,
      onError: (context) => {
        return context.json({ error: 'Invoice draft body is too large.' }, 413);
      },
    }),
    async (context) => {
      const actorContext = context.get('actorContext');
      const bodyResult = await readJsonRequestBody(context.req, 'required');

      if (!bodyResult.ok) {
        return context.json(
          { error: bodyResult.message },
          bodyResult.status,
        );
      }
      const body = bodyResult.body;

      try {
        const input = parseSaveInvoiceDraftRequest(
          body,
          actorContext.companyId,
        );
        const invoiceDraft = await dependencies.saveInvoiceDraft(input);

        return context.json({ invoiceDraft }, 201);
      } catch (error) {
        if (
          error instanceof InvoiceDraftRequestValidationError ||
          error instanceof InvoiceDraftValidationError ||
          error instanceof InvoiceCalculationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  routes.get('/invoice-drafts', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const customerId = context.req.query('customerId');
      const input: ListInvoiceDraftsInput = {
        companyId: actorContext.companyId,
      };

      if (customerId !== undefined) {
        input.customerId = customerId;
      }

      const invoiceDrafts = await dependencies.listInvoiceDrafts(input);

      return context.json({ invoiceDrafts });
    } catch (error) {
      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.post(
    '/invoice-drafts/:id/approve',
    bodyLimit({
      maxSize: maximumInvoiceApprovalBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Invoice approval body is too large.' }, 413),
    }),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'optional');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        let reverseChargeEligibilityConfirmed = false;

        if (bodyResult.body !== undefined) {
          const requestBody = bodyResult.body;
          if (
            typeof requestBody !== 'object' ||
            requestBody === null ||
            Array.isArray(requestBody) ||
            Object.keys(requestBody).some(
              (field) => field !== 'reverseChargeEligibilityConfirmed',
            ) ||
            ('reverseChargeEligibilityConfirmed' in requestBody &&
              typeof requestBody.reverseChargeEligibilityConfirmed !==
                'boolean')
          ) {
            return context.json({ error: 'Invalid approval body.' }, 400);
          }

          reverseChargeEligibilityConfirmed =
            'reverseChargeEligibilityConfirmed' in requestBody &&
            requestBody.reverseChargeEligibilityConfirmed === true;
        }
        const approvedInvoice = await dependencies.approveInvoiceDraft({
          actorUserId: actorContext.actorId,
          approvedAt: new Date().toISOString(),
          companyId: actorContext.companyId,
          draftId: context.req.param('id'),
          reverseChargeEligibilityConfirmed,
        });

        return context.json({ approvedInvoice });
      } catch (error) {
        if (error instanceof InvoiceDraftNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApproveInvoiceDraftError ||
          error instanceof InvoiceDraftValidationError ||
          error instanceof InvoiceNumberingError
        ) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  routes.get('/invoice-drafts/:id', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const invoiceDraft = await dependencies.getInvoiceDraft({
        companyId: actorContext.companyId,
        invoiceDraftId: context.req.param('id'),
      });

      return context.json({ invoiceDraft });
    } catch (error) {
      if (error instanceof InvoiceDraftNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.delete(
    '/invoice-drafts/:id',
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
        await dependencies.deleteInvoiceDraft({
          companyId: actorContext.companyId,
          invoiceDraftId: context.req.param('id'),
        });

        return context.json({ deleted: true });
      } catch (error) {
        if (error instanceof InvoiceDraftNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (error instanceof InvoiceDraftValidationError) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  routes.put(
    '/invoice-drafts/:id',
    bodyLimit({
      maxSize: maximumInvoiceDraftBodySizeBytes,
      onError: (context) => {
        return context.json({ error: 'Invoice draft body is too large.' }, 413);
      },
    }),
    async (context) => {
      const actorContext = context.get('actorContext');
      const bodyResult = await readJsonRequestBody(context.req, 'required');

      if (!bodyResult.ok) {
        return context.json(
          { error: bodyResult.message },
          bodyResult.status,
        );
      }
      const body = bodyResult.body;

      try {
        const input = parseUpdateInvoiceDraftRequest(
          body,
          actorContext.companyId,
          context.req.param('id'),
        );
        const invoiceDraft = await dependencies.updateInvoiceDraft(input);

        return context.json({ invoiceDraft });
      } catch (error) {
        if (error instanceof InvoiceDraftNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof InvoiceDraftRequestValidationError ||
          error instanceof InvoiceDraftValidationError ||
          error instanceof InvoiceCalculationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  return routes;
}
