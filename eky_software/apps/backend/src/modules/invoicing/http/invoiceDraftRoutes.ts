import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

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
import {
  InvoiceDraftRequestValidationError,
  parseSaveInvoiceDraftRequest,
  parseUpdateInvoiceDraftRequest,
} from './invoiceDraftRequest.js';

const devCompanyId = 'dev-company';
const maximumInvoiceDraftBodySizeBytes = 256 * 1024;

interface InvoiceDraftRouteDependencies {
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
): Hono {
  const routes = new Hono();

  routes.post(
    '/invoice-drafts',
    bodyLimit({
      maxSize: maximumInvoiceDraftBodySizeBytes,
      onError: (context) => {
        return context.json({ error: 'Invoice draft body is too large.' }, 413);
      },
    }),
    async (context) => {
      let body: unknown;

      try {
        body = await context.req.json();
      } catch {
        return context.json({ error: 'Invalid JSON body.' }, 400);
      }

      try {
        const input = parseSaveInvoiceDraftRequest(body, devCompanyId);
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
      const customerId = context.req.query('customerId');
      const input: ListInvoiceDraftsInput = {
        companyId: devCompanyId,
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

  routes.get('/invoice-drafts/:id', async (context) => {
    try {
      const invoiceDraft = await dependencies.getInvoiceDraft({
        companyId: devCompanyId,
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

  routes.delete('/invoice-drafts/:id', async (context) => {
    try {
      await dependencies.deleteInvoiceDraft({
        companyId: devCompanyId,
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
  });

  routes.put(
    '/invoice-drafts/:id',
    bodyLimit({
      maxSize: maximumInvoiceDraftBodySizeBytes,
      onError: (context) => {
        return context.json({ error: 'Invoice draft body is too large.' }, 413);
      },
    }),
    async (context) => {
      let body: unknown;

      try {
        body = await context.req.json();
      } catch {
        return context.json({ error: 'Invalid JSON body.' }, 400);
      }

      try {
        const input = parseUpdateInvoiceDraftRequest(
          body,
          devCompanyId,
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
