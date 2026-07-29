import { Hono, type Context } from 'hono';
import { AuthorizationError } from '@eky/permissions';
import { bodyLimit } from 'hono/body-limit';

import { isRecord } from '../../../http/requestBody.js';
import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetCompanyEmailSecretStatusInput } from '../application/getCompanyEmailSecretStatus.js';
import type { RemoveCompanyEmailSecretInput } from '../application/removeCompanyEmailSecret.js';
import type { SetCompanyEmailSecretInput } from '../application/setCompanyEmailSecret.js';
import type { CompanyEmailSecretStatus } from '../application/companyEmailSecretStatus.js';
import { CompanyEmailSecretOperationError } from '../application/executeCompanyEmailSecretOperation.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

interface CompanyEmailSecretRouteDependencies {
  getCompanyEmailSecretStatus(
    input: GetCompanyEmailSecretStatusInput,
  ): Promise<CompanyEmailSecretStatus>;
  removeCompanyEmailSecret(
    input: RemoveCompanyEmailSecretInput,
  ): Promise<CompanyEmailSecretStatus>;
  setCompanyEmailSecret(
    input: SetCompanyEmailSecretInput,
  ): Promise<CompanyEmailSecretStatus>;
}

const maximumCompanyEmailSecretBodySizeBytes = 4 * 1024;
const maximumForbiddenBodySizeBytes = 1024;

export function createCompanyEmailSecretRoutes(
  dependencies: CompanyEmailSecretRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/company-settings/email-secret', async (context) => {
    try {
      const emailSecretStatus = await dependencies.getCompanyEmailSecretStatus({
        actorContext: context.get('actorContext'),
      });

      return context.json({ emailSecretStatus });
    } catch (error) {
      return mapCompanyEmailSecretError(context, error);
    }
  });

  routes.put(
    '/company-settings/email-secret',
    bodyLimit({
      maxSize: maximumCompanyEmailSecretBodySizeBytes,
      onError: (context) =>
        context.json({ error: 'Company email secret body is too large.' }, 413),
    }),
    async (context) => {
      const bodyResult = await readJsonRequestBody(context.req, 'required');

      if (!bodyResult.ok) {
        return context.json(
          { error: bodyResult.message },
          bodyResult.status,
        );
      }
      const body = bodyResult.body;

      if (!isEmailSecretRequestBody(body)) {
        return context.json(
          { error: 'Invalid company email secret body.' },
          400,
        );
      }

      try {
        const emailSecretStatus = await dependencies.setCompanyEmailSecret({
          actorContext: context.get('actorContext'),
          occurredAt: new Date().toISOString(),
          secret: body.secret,
        });

        return context.json({ emailSecretStatus });
      } catch (error) {
        return mapCompanyEmailSecretError(context, error);
      }
    },
  );

  routes.delete(
    '/company-settings/email-secret',
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
        const emailSecretStatus = await dependencies.removeCompanyEmailSecret({
          actorContext: context.get('actorContext'),
          occurredAt: new Date().toISOString(),
        });

        return context.json({ emailSecretStatus });
      } catch (error) {
        return mapCompanyEmailSecretError(context, error);
      }
    },
  );

  return routes;
}

function isEmailSecretRequestBody(
  value: unknown,
): value is { secret: unknown } {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, 'secret')
  );
}

function mapCompanyEmailSecretError(
  context: Context<BackendEnvironment>,
  error: unknown,
) {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.message }, 403);
  }

  if (error instanceof CompanySettingsValidationError) {
    return context.json({ error: error.message }, 400);
  }

  if (error instanceof CompanyEmailSecretOperationError) {
    return context.json(
      { error: 'Email secret storage is unavailable.' },
      503,
    );
  }

  throw error;
}
