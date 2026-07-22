import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetInvoiceVatRatesInput } from '../application/getInvoiceVatRates.js';
import type { InvoiceVatRatesView } from '../application/invoiceVatRatesView.js';
import type { UpdateInvoiceVatRatesInput } from '../application/updateInvoiceVatRates.js';
import { InvoiceVatRatesError } from '../domain/invoiceVatRatesError.js';
import {
  InvoiceVatRatesRequestValidationError,
  parseUpdateInvoiceVatRatesRequest,
} from './invoiceVatRatesRequest.js';

const maximumInvoiceVatRatesBodySizeBytes = 32 * 1024;

interface InvoiceVatRatesRouteDependencies {
  getInvoiceVatRates(input: GetInvoiceVatRatesInput): Promise<InvoiceVatRatesView>;
  updateInvoiceVatRates(
    input: UpdateInvoiceVatRatesInput,
  ): Promise<InvoiceVatRatesView>;
}

export function createInvoiceVatRatesRoutes(
  dependencies: InvoiceVatRatesRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/invoice-vat-rates', async (context) => {
    try {
      const invoiceVatRates = await dependencies.getInvoiceVatRates({
        actorContext: context.get('actorContext'),
      });

      return context.json({ invoiceVatRates });
    } catch (error) {
      return handleKnownError(context, error);
    }
  });

  routes.put(
    '/invoice-vat-rates',
    bodyLimit({
      maxSize: maximumInvoiceVatRatesBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Invoice VAT rates body is too large.' }, 413),
    }),
    async (context) => {
      let body: unknown;

      try {
        body = await context.req.json();
      } catch {
        return context.json({ error: 'Invalid JSON body.' }, 400);
      }

      try {
        const invoiceVatRates = await dependencies.updateInvoiceVatRates({
          actorContext: context.get('actorContext'),
          now: new Date().toISOString(),
          vatRates: parseUpdateInvoiceVatRatesRequest(body),
        });

        return context.json({ invoiceVatRates });
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
    return context.json({ error: 'Forbidden.' }, 403);
  }

  if (
    error instanceof InvoiceVatRatesRequestValidationError ||
    error instanceof InvoiceVatRatesError
  ) {
    return context.json({ error: error.message }, 400);
  }

  throw error;
}
