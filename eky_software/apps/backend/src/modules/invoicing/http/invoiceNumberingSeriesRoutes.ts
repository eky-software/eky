import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type {
  ActivateInvoiceNumberingSeriesInput,
} from '../application/activateInvoiceNumberingSeries.js';
import type {
  GetInvoiceNumberingSeriesOverviewInput,
} from '../application/getInvoiceNumberingSeriesOverview.js';
import type {
  InvoiceNumberingSeriesOverviewView,
} from '../application/invoiceNumberingSeriesView.js';
import { InvoiceNumberingSeriesError } from '../application/invoiceNumberingSeriesError.js';
import type {
  InvoiceNumberingSeriesActivationPreviewView,
  PreviewInvoiceNumberingSeriesActivationInput,
} from '../application/previewInvoiceNumberingSeriesActivation.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import {
  InvoiceNumberingSeriesRequestValidationError,
  parseActivateInvoiceNumberingSeriesRequest,
  parseInvoiceNumberingSeriesActivationPreviewQuery,
} from './invoiceNumberingSeriesRequest.js';

const maximumInvoiceNumberingSeriesBodySizeBytes = 16 * 1024;

interface InvoiceNumberingSeriesRouteDependencies {
  activateInvoiceNumberingSeries(
    input: ActivateInvoiceNumberingSeriesInput,
  ): Promise<InvoiceNumberingSeriesOverviewView>;
  getInvoiceNumberingSeriesOverview(
    input: GetInvoiceNumberingSeriesOverviewInput,
  ): Promise<InvoiceNumberingSeriesOverviewView>;
  previewInvoiceNumberingSeriesActivation(
    input: PreviewInvoiceNumberingSeriesActivationInput,
  ): Promise<InvoiceNumberingSeriesActivationPreviewView>;
}

export function createInvoiceNumberingSeriesRoutes(
  dependencies: InvoiceNumberingSeriesRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/invoice-numbering-series', async (context) => {
    if (new URL(context.req.url).search.length > 0) {
      return context.json(
        { error: 'Unsupported invoice numbering series query.' },
        400,
      );
    }

    try {
      const invoiceNumberingSeriesOverview =
        await dependencies.getInvoiceNumberingSeriesOverview({
          actorContext: context.get('actorContext'),
        });

      return context.json({ invoiceNumberingSeriesOverview });
    } catch (error) {
      return mapInvoiceNumberingSeriesError(context, error);
    }
  });

  routes.get(
    '/invoice-numbering-series/activation-preview',
    async (context) => {
      try {
        const query = parseInvoiceNumberingSeriesActivationPreviewQuery(
          new URL(context.req.url).searchParams,
        );
        const invoiceNumberingSeriesActivationPreview =
          await dependencies.previewInvoiceNumberingSeriesActivation({
            ...query,
            actorContext: context.get('actorContext'),
          });

        return context.json({ invoiceNumberingSeriesActivationPreview });
      } catch (error) {
        return mapInvoiceNumberingSeriesError(context, error);
      }
    },
  );

  routes.post(
    '/invoice-numbering-series/activate',
    bodyLimit({
      maxSize: maximumInvoiceNumberingSeriesBodySizeBytes,
      onError: (context) =>
        context.json(
          { error: 'Invoice numbering series body is too large.' },
          413,
        ),
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
        const request = parseActivateInvoiceNumberingSeriesRequest(
          bodyResult.body,
        );
        const invoiceNumberingSeriesOverview =
          await dependencies.activateInvoiceNumberingSeries({
            ...request,
            actorContext: context.get('actorContext'),
            now: new Date().toISOString(),
          });

        return context.json({ invoiceNumberingSeriesOverview }, 201);
      } catch (error) {
        return mapInvoiceNumberingSeriesError(context, error);
      }
    },
  );

  return routes;
}

function mapInvoiceNumberingSeriesError(
  context: Context<BackendEnvironment>,
  error: unknown,
) {
  if (error instanceof AuthorizationError) {
    return context.json({ error: 'Forbidden.' }, 403);
  }

  if (error instanceof InvoiceNumberingSeriesRequestValidationError) {
    return context.json({ error: error.message }, 400);
  }

  if (error instanceof InvoiceNumberingSeriesError) {
    if (error.code === 'notFound') {
      return context.json({ error: 'Invoice numbering series was not found.' }, 404);
    }

    if (
      error.code === 'conflict' ||
      error.code === 'unsafeFirstSequenceNumber'
    ) {
      return context.json(
        { error: 'Invoice numbering series activation conflicted.' },
        409,
      );
    }

    return context.json({ error: 'Invoice numbering series confirmation is invalid.' }, 400);
  }

  if (error instanceof InvoiceNumberingError) {
    return context.json({ error: 'Invoice numbering series input is invalid.' }, 400);
  }

  throw error;
}
