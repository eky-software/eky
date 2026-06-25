import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type {
  GetInvoiceNumberingSettingsInput,
} from '../application/getInvoiceNumberingSettings.js';
import { InvoiceNumberingSettingsError } from '../application/invoiceNumberingSettingsError.js';
import type { InvoiceNumberingSettingsView } from '../application/invoiceNumberingSettingsView.js';
import type {
  UpdateInvoiceNumberingSettingsInput,
} from '../application/updateInvoiceNumberingSettings.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import {
  InvoiceNumberingSettingsRequestValidationError,
  parseUpdateInvoiceNumberingSettingsRequest,
} from './invoiceNumberingSettingsRequest.js';

const devCompanyId = 'dev-company';
const maximumInvoiceNumberingSettingsBodySizeBytes = 16 * 1024;

interface InvoiceNumberingSettingsRouteDependencies {
  getInvoiceNumberingSettings(
    input: GetInvoiceNumberingSettingsInput,
  ): Promise<InvoiceNumberingSettingsView>;
  updateInvoiceNumberingSettings(
    input: UpdateInvoiceNumberingSettingsInput,
  ): Promise<InvoiceNumberingSettingsView>;
}

export function createInvoiceNumberingSettingsRoutes(
  dependencies: InvoiceNumberingSettingsRouteDependencies,
): Hono {
  const routes = new Hono();

  routes.get('/invoice-numbering-settings', async (context) => {
    try {
      const invoiceNumberingSettings =
        await dependencies.getInvoiceNumberingSettings({
          companyId: devCompanyId,
        });

      return context.json({ invoiceNumberingSettings });
    } catch (error) {
      if (
        error instanceof InvoiceNumberingSettingsError ||
        error instanceof InvoiceNumberingError
      ) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.put(
    '/invoice-numbering-settings',
    bodyLimit({
      maxSize: maximumInvoiceNumberingSettingsBodySizeBytes,
      onError: (context) => {
        return context.json(
          { error: 'Invoice numbering settings body is too large.' },
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
        const input = parseUpdateInvoiceNumberingSettingsRequest(
          body,
          devCompanyId,
          new Date().toISOString(),
        );
        const invoiceNumberingSettings =
          await dependencies.updateInvoiceNumberingSettings(input);

        return context.json({ invoiceNumberingSettings });
      } catch (error) {
        if (
          error instanceof InvoiceNumberingSettingsRequestValidationError ||
          error instanceof InvoiceNumberingSettingsError ||
          error instanceof InvoiceNumberingError
        ) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  return routes;
}
