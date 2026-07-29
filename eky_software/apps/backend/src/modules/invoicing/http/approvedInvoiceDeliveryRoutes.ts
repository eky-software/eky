import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceEmailDeliveryError } from '../application/approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from '../application/approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import type { ApprovedInvoiceEmailPreview } from '../application/approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from '../application/invoiceDeliveryConflictError.js';
import { InvoiceEmailSendAttemptError } from '../application/invoiceEmailSendAttemptError.js';
import type { ListInvoiceDeliveryEventsInput } from '../application/listInvoiceDeliveryEvents.js';
import type { MarkApprovedInvoiceSentInput } from '../application/markApprovedInvoiceSent.js';
import type { PrepareApprovedInvoiceEmailDryRunInput } from '../application/prepareApprovedInvoiceEmailDryRun.js';
import type {
  ApprovedInvoiceEmailSmtpPreparation,
  PrepareApprovedInvoiceEmailSmtpInput,
} from '../application/prepareApprovedInvoiceEmailSmtp.js';
import type {
  ApprovedInvoiceEmailSmtpTestPreparation,
  PrepareApprovedInvoiceEmailSmtpTestInput,
} from '../application/prepareApprovedInvoiceEmailSmtpTest.js';
import type {
  SendApprovedInvoiceEmailDryRunInput,
  SendApprovedInvoiceEmailDryRunResult,
} from '../application/sendApprovedInvoiceEmailDryRun.js';
import type {
  SendApprovedInvoiceEmailSmtpInput,
  SendApprovedInvoiceEmailSmtpResult,
} from '../application/sendApprovedInvoiceEmailSmtp.js';
import type {
  SendApprovedInvoiceEmailSmtpTestInput,
  SendApprovedInvoiceEmailSmtpTestResult,
} from '../application/sendApprovedInvoiceEmailSmtpTest.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  ApprovedInvoiceEmailRequestValidationError,
  parseApprovedInvoiceEmailDryRunSendBody,
  parseApprovedInvoiceEmailSmtpPrepareBody,
  parseApprovedInvoiceEmailSmtpSendBody,
  parseApprovedInvoiceEmailSmtpTestPrepareBody,
  parseApprovedInvoiceEmailSmtpTestSendBody,
} from './approvedInvoiceEmailRequest.js';
import {
  ApprovedInvoiceManualDeliveryRequestValidationError,
  parseApprovedInvoiceManualDeliveryBody,
} from './approvedInvoiceManualDeliveryRequest.js';

export interface ApprovedInvoiceDeliveryRouteDependencies {
  listInvoiceDeliveryEvents(
    input: ListInvoiceDeliveryEventsInput,
  ): Promise<InvoiceDeliveryEventSummary[]>;
  markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentInput,
  ): Promise<ApprovedInvoiceView>;
  prepareApprovedInvoiceEmailDryRun(
    input: PrepareApprovedInvoiceEmailDryRunInput,
  ): Promise<ApprovedInvoiceEmailPreview>;
  prepareApprovedInvoiceEmailSmtp(
    input: PrepareApprovedInvoiceEmailSmtpInput,
  ): Promise<ApprovedInvoiceEmailSmtpPreparation>;
  prepareApprovedInvoiceEmailSmtpTest(
    input: PrepareApprovedInvoiceEmailSmtpTestInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestPreparation>;
  sendApprovedInvoiceEmailDryRun(
    input: SendApprovedInvoiceEmailDryRunInput,
  ): Promise<SendApprovedInvoiceEmailDryRunResult>;
  sendApprovedInvoiceEmailSmtp(
    input: SendApprovedInvoiceEmailSmtpInput,
  ): Promise<SendApprovedInvoiceEmailSmtpResult>;
  sendApprovedInvoiceEmailSmtpTest(
    input: SendApprovedInvoiceEmailSmtpTestInput,
  ): Promise<SendApprovedInvoiceEmailSmtpTestResult>;
}

const maximumApprovedInvoiceEmailBodySizeBytes = 96 * 1024;
const maximumManualDeliveryBodySizeBytes = 2 * 1024;
const maximumForbiddenBodySizeBytes = 1024;

export function createApprovedInvoiceDeliveryRoutes(
  dependencies: ApprovedInvoiceDeliveryRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post(
    '/invoices/:id/mark-sent',
    bodyLimit({
      maxSize: maximumManualDeliveryBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Manual delivery body is too large.' }, 413),
    }),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const manualDelivery = parseApprovedInvoiceManualDeliveryBody(body);
        const invoice = await dependencies.markApprovedInvoiceSent({
          actorContext,
          deliveryMethod: manualDelivery.deliveryMethod,
          invoiceId: context.req.param('id'),
          markedSentAt: new Date().toISOString(),
        });

        return context.json({ invoice });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceManualDeliveryRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof InvoiceDeliveryConflictError) {
          return context.json({ error: error.message }, 409);
        }

        throw error;
      }
    },
  );

  routes.get('/invoices/:id/delivery-events', async (context) => {
    try {
      const actorContext = context.get('actorContext');
      const events = await dependencies.listInvoiceDeliveryEvents({
        actorContext,
        invoiceId: context.req.param('id'),
      });

      return context.json({ events });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Access denied.' }, 403);
      }

      if (error instanceof ApprovedInvoiceNotFoundError) {
        return context.json({ error: error.message }, 404);
      }

      if (error instanceof InvoiceDraftValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.post(
    '/invoices/:id/email/dry-run',
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
        const email = await dependencies.prepareApprovedInvoiceEmailDryRun({
          actorContext,
          invoiceId: context.req.param('id'),
          preparedAt: new Date().toISOString(),
        });

        return context.json({ email });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (error instanceof InvoiceDraftValidationError) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    },
  );

  routes.post(
    '/invoices/:id/email/dry-run/send',
    approvedInvoiceEmailBodyLimit(),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const delivery = await dependencies.sendApprovedInvoiceEmailDryRun(
          parseApprovedInvoiceEmailDryRunSendBody(body, {
            actorContext,
            invoiceId: context.req.param('id'),
            sentAt: new Date().toISOString(),
          }),
        );

        return context.json({ delivery });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceEmailRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryError) {
          return context.json({ error: error.message }, 502);
        }

        throw error;
      }
    },
  );

  routes.post(
    '/invoices/:id/email/smtp-test/send',
    approvedInvoiceEmailBodyLimit(),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const delivery = await dependencies.sendApprovedInvoiceEmailSmtpTest(
          parseApprovedInvoiceEmailSmtpTestSendBody(body, {
            actorContext,
            invoiceId: context.req.param('id'),
            sentAt: new Date().toISOString(),
          }),
        );

        return context.json({ delivery });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceEmailRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError) {
          return context.json({ error: error.message }, 502);
        }

        if (error instanceof InvoiceEmailSendAttemptError) {
          return context.json(
            { error: error.message },
            error.code === 'cooldown' ? 429 : 409,
          );
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryError) {
          return context.json({ error: error.message }, 502);
        }

        throw error;
      }
    },
  );

  routes.post(
    '/invoices/:id/email/smtp-test/prepare',
    approvedInvoiceEmailBodyLimit(),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const preparation =
          await dependencies.prepareApprovedInvoiceEmailSmtpTest(
            parseApprovedInvoiceEmailSmtpTestPrepareBody(body, {
              actorContext,
              invoiceId: context.req.param('id'),
              preparedAt: new Date().toISOString(),
            }),
          );

        return context.json({ preparation });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceEmailRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof InvoiceEmailSendAttemptError) {
          return context.json(
            { error: error.message },
            error.code === 'cooldown' ? 429 : 409,
          );
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryError) {
          return context.json({ error: error.message }, 409);
        }

        throw error;
      }
    },
  );

  routes.post(
    '/invoices/:id/email/smtp/send',
    approvedInvoiceEmailBodyLimit(),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const delivery = await dependencies.sendApprovedInvoiceEmailSmtp(
          parseApprovedInvoiceEmailSmtpSendBody(body, {
            actorContext,
            invoiceId: context.req.param('id'),
            sentAt: new Date().toISOString(),
          }),
        );

        return context.json({ delivery });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceEmailRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError) {
          return context.json({ error: error.message }, 502);
        }

        if (error instanceof InvoiceEmailSendAttemptError) {
          return context.json(
            { error: error.message },
            error.code === 'cooldown' ? 429 : 409,
          );
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryError) {
          return context.json({ error: error.message }, 502);
        }

        throw error;
      }
    },
  );

  routes.post(
    '/invoices/:id/email/smtp/prepare',
    approvedInvoiceEmailBodyLimit(),
    async (context) => {
      try {
        const actorContext = context.get('actorContext');
        const bodyResult = await readJsonRequestBody(context.req, 'required');

        if (!bodyResult.ok) {
          return context.json(
            { error: bodyResult.message },
            bodyResult.status,
          );
        }
        const body = bodyResult.body;
        const preparation = await dependencies.prepareApprovedInvoiceEmailSmtp(
          parseApprovedInvoiceEmailSmtpPrepareBody(body, {
            actorContext,
            invoiceId: context.req.param('id'),
            preparedAt: new Date().toISOString(),
          }),
        );

        return context.json({ preparation });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return context.json({ error: 'Access denied.' }, 403);
        }

        if (error instanceof ApprovedInvoiceNotFoundError) {
          return context.json({ error: error.message }, 404);
        }

        if (
          error instanceof ApprovedInvoiceEmailRequestValidationError ||
          error instanceof InvoiceDraftValidationError
        ) {
          return context.json({ error: error.message }, 400);
        }

        if (error instanceof InvoiceEmailSendAttemptError) {
          return context.json(
            { error: error.message },
            error.code === 'cooldown' ? 429 : 409,
          );
        }

        if (error instanceof InvoiceDeliveryConflictError) {
          return context.json({ error: error.message }, 409);
        }

        if (error instanceof ApprovedInvoiceEmailDeliveryError) {
          return context.json({ error: error.message }, 409);
        }

        throw error;
      }
    },
  );

  return routes;
}

function approvedInvoiceEmailBodyLimit() {
  return bodyLimit({
    maxSize: maximumApprovedInvoiceEmailBodySizeBytes,
    onError: (context) =>
      context.json({ error: 'Invoice email body is too large.' }, 413),
  });
}
