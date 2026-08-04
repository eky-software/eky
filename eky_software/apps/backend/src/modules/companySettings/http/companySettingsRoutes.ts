import { Hono } from 'hono';
import { AuthorizationError } from '@eky/permissions';
import { bodyLimit } from 'hono/body-limit';

import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetCompanySettingsInput } from '../application/getCompanySettings.js';
import type { UpdateCompanySettingsInput } from '../application/updateCompanySettings.js';
import type { CompanySettings } from '../domain/companySettings.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import { parseCompanySettingsRequest } from './companySettingsRequest.js';

interface CompanySettingsRouteDependencies {
  getCompanySettings(input: GetCompanySettingsInput): Promise<CompanySettings>;
  updateCompanySettings(input: UpdateCompanySettingsInput): Promise<CompanySettings>;
}

const maximumCompanySettingsBodySizeBytes = 16 * 1024;
const companySettingsBodyLimit = bodyLimit({
  maxSize: maximumCompanySettingsBodySizeBytes,
  onError: (context) =>
    context.json({ error: 'Company settings body is too large.' }, 413),
});

export function createCompanySettingsRoutes(
  dependencies: CompanySettingsRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/company-settings', async (context) => {
    const actorContext = context.get('actorContext');
    const companySettings = await dependencies.getCompanySettings({
      companyId: actorContext.companyId,
    });

    return context.json({ companySettings });
  });

  routes.put('/company-settings', companySettingsBodyLimit, async (context) => {
    const actorContext = context.get('actorContext');
    const bodyResult = await readJsonRequestBody(context.req, 'required');

    if (!bodyResult.ok) {
      return context.json(
        { error: bodyResult.message },
        bodyResult.status,
      );
    }
    const parsedBody = parseCompanySettingsRequest(bodyResult.body);

    if (!parsedBody.ok) {
      return context.json(
        {
          error:
            parsedBody.reason === 'fixedSmtpSettings'
              ? 'SMTP connection settings are fixed.'
              : 'Invalid company settings body.',
        },
        400,
      );
    }

    try {
      const companySettings = await dependencies.updateCompanySettings({
        actorContext,
        ...parsedBody.input,
      });

      return context.json({ companySettings });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: error.message }, 403);
      }

      if (error instanceof CompanySettingsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  return routes;
}
