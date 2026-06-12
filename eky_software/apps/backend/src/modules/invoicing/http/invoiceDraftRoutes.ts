import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type {
  SaveInvoiceDraftInput,
} from '../application/saveInvoiceDraft.js';
import { InvoiceCalculationError } from '../domain/invoiceCalculationError.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  InvoiceDraftRequestValidationError,
  parseSaveInvoiceDraftRequest,
} from './invoiceDraftRequest.js';

const devCompanyId = 'dev-company';
const maximumInvoiceDraftBodySizeBytes = 256 * 1024;

interface InvoiceDraftRouteDependencies {
  saveInvoiceDraft(input: SaveInvoiceDraftInput): Promise<InvoiceDraft>;
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

  return routes;
}
