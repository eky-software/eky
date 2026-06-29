import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type {
  GetInvoicePaymentSettingsInput,
} from '../application/getInvoicePaymentSettings.js';
import { InvoicePaymentSettingsApplicationError } from '../application/invoicePaymentSettingsError.js';
import type {
  InvoicePaymentSettingsView,
} from '../application/invoicePaymentSettingsView.js';
import type {
  UpdateInvoicePaymentSettingsInput,
} from '../application/updateInvoicePaymentSettings.js';
import { InvoicePaymentSettingsError } from '../domain/invoicePaymentSettingsError.js';
import {
  InvoicePaymentSettingsRequestValidationError,
  parseUpdateInvoicePaymentSettingsRequest,
} from './invoicePaymentSettingsRequest.js';

const devCompanyId = 'dev-company';
const maximumInvoicePaymentSettingsBodySizeBytes = 16 * 1024;

interface InvoicePaymentSettingsRouteDependencies {
  getInvoicePaymentSettings(
    input: GetInvoicePaymentSettingsInput,
  ): Promise<InvoicePaymentSettingsView>;
  updateInvoicePaymentSettings(
    input: UpdateInvoicePaymentSettingsInput,
  ): Promise<InvoicePaymentSettingsView>;
}

export function createInvoicePaymentSettingsRoutes(
  dependencies: InvoicePaymentSettingsRouteDependencies,
): Hono {
  const routes = new Hono();

  routes.get('/invoice-payment-settings', async (context) => {
    try {
      const invoicePaymentSettings =
        await dependencies.getInvoicePaymentSettings({
          companyId: devCompanyId,
        });

      return context.json({ invoicePaymentSettings });
    } catch (error) {
      if (
        error instanceof InvoicePaymentSettingsApplicationError ||
        error instanceof InvoicePaymentSettingsError
      ) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.put(
    '/invoice-payment-settings',
    bodyLimit({
      maxSize: maximumInvoicePaymentSettingsBodySizeBytes,
      onError: (context) => {
        return context.json(
          { error: 'Invoice payment settings body is too large.' },
          413,
        );
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
        const input = parseUpdateInvoicePaymentSettingsRequest(
          body,
          devCompanyId,
          new Date().toISOString(),
        );
        const invoicePaymentSettings =
          await dependencies.updateInvoicePaymentSettings(input);

        return context.json({ invoicePaymentSettings });
      } catch (error) {
        if (
          error instanceof InvoicePaymentSettingsRequestValidationError ||
          error instanceof InvoicePaymentSettingsApplicationError ||
          error instanceof InvoicePaymentSettingsError
        ) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  return routes;
}
