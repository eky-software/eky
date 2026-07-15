import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetCompanyEmailSecretStatusInput } from '../application/getCompanyEmailSecretStatus.js';
import type { RemoveCompanyEmailSecretInput } from '../application/removeCompanyEmailSecret.js';
import type { SetCompanyEmailSecretInput } from '../application/setCompanyEmailSecret.js';
import { CompanyEmailSecretOperationError } from '../application/executeCompanyEmailSecretOperation.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import { createCompanyEmailSecretRoutes } from './companyEmailSecretRoutes.js';

describe('companyEmailSecretRoutes', () => {
  it('returns only the configured status for the authenticated actor company', async () => {
    let receivedInput: GetCompanyEmailSecretStatusInput | undefined;
    const app = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async getCompanyEmailSecretStatus(input) {
            receivedInput = input;

            return { configured: true };
          },
        }),
      ),
    );

    const response = await app.request('/company-settings/email-secret');

    expect(response.status).toBe(200);
    expect(receivedInput?.actorContext).toEqual(
      expect.objectContaining({ companyId: 'actor-company' }),
    );
    await expect(response.json()).resolves.toEqual({
      emailSecretStatus: { configured: true },
    });
  });

  it('sets the unchanged secret without accepting a request company id', async () => {
    let receivedInput: SetCompanyEmailSecretInput | undefined;
    const app = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async setCompanyEmailSecret(input) {
            receivedInput = input;

            return { configured: true };
          },
        }),
      ),
    );

    const response = await app.request('/company-settings/email-secret', {
      body: JSON.stringify({ secret: '  synthetic password  ' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(200);
    expect(receivedInput).toEqual({
      actorContext: expect.objectContaining({ companyId: 'actor-company' }),
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      secret: '  synthetic password  ',
    });
    expect(receivedInput).not.toHaveProperty('companyId');
    await expect(response.json()).resolves.toEqual({
      emailSecretStatus: { configured: true },
    });
  });

  it('removes the secret only from the authenticated actor company', async () => {
    let receivedInput: RemoveCompanyEmailSecretInput | undefined;
    const app = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async removeCompanyEmailSecret(input) {
            receivedInput = input;

            return { configured: false };
          },
        }),
      ),
    );

    const response = await app.request('/company-settings/email-secret', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(receivedInput).toEqual({
      actorContext: expect.objectContaining({ companyId: 'actor-company' }),
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    await expect(response.json()).resolves.toEqual({
      emailSecretStatus: { configured: false },
    });
  });

  it.each([
    { companyId: 'other-company', secret: 'synthetic-password' },
    { secret: 'synthetic-password', status: 'configured' },
    {},
  ])('rejects bodies containing anything except one secret field', async (body) => {
    const setCompanyEmailSecret = vi.fn();
    const app = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({ setCompanyEmailSecret }),
      ),
    );

    const response = await app.request('/company-settings/email-secret', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(400);
    expect(setCompanyEmailSecret).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid company email secret body.',
    });
  });

  it('maps validation and permission errors without exposing the secret', async () => {
    const invalidSecret = 'synthetic-private-value';
    const validationApp = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async setCompanyEmailSecret() {
            throw new CompanySettingsValidationError(
              'Email secret is required.',
            );
          },
        }),
      ),
    );
    const deniedApp = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async setCompanyEmailSecret() {
            throw new AuthorizationError();
          },
        }),
      ),
    );

    const validationResponse = await putSecret(validationApp, invalidSecret);
    const deniedResponse = await putSecret(deniedApp, invalidSecret);
    const validationBody = JSON.stringify(await validationResponse.json());
    const deniedBody = JSON.stringify(await deniedResponse.json());

    expect(validationResponse.status).toBe(400);
    expect(deniedResponse.status).toBe(403);
    expect(validationBody).not.toContain(invalidSecret);
    expect(deniedBody).not.toContain(invalidSecret);
    expect(deniedBody).not.toContain('stack');
  });

  it('maps storage failures to a safe unavailable response', async () => {
    const app = createAuthenticatedTestApp(
      createCompanyEmailSecretRoutes(
        createDependencies({
          async setCompanyEmailSecret() {
            throw new CompanyEmailSecretOperationError(
              'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
            );
          },
        }),
      ),
    );

    const response = await putSecret(app, 'synthetic-private-value');
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).toBe(
      JSON.stringify({ error: 'Email secret storage is unavailable.' }),
    );
    expect(responseText).not.toContain('synthetic-private-value');
    expect(responseText).not.toContain('safeStorage');
  });
});

function createDependencies(overrides: {
  getCompanyEmailSecretStatus?: (
    input: GetCompanyEmailSecretStatusInput,
  ) => Promise<{ configured: boolean }>;
  removeCompanyEmailSecret?: (
    input: RemoveCompanyEmailSecretInput,
  ) => Promise<{ configured: boolean }>;
  setCompanyEmailSecret?: (
    input: SetCompanyEmailSecretInput,
  ) => Promise<{ configured: boolean }>;
} = {}) {
  return {
    getCompanyEmailSecretStatus:
      overrides.getCompanyEmailSecretStatus ??
      vi.fn(async () => ({ configured: false })),
    removeCompanyEmailSecret:
      overrides.removeCompanyEmailSecret ??
      vi.fn(async () => ({ configured: false })),
    setCompanyEmailSecret:
      overrides.setCompanyEmailSecret ??
      vi.fn(async () => ({ configured: true })),
  };
}

function createAuthenticatedTestApp(
  routes: Hono<BackendEnvironment>,
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'actor-company',
        permissions: ['manageCompanyEmailSecret'],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return app;
}

async function putSecret(
  app: Hono<BackendEnvironment>,
  secret: string,
): Promise<Response> {
  return await app.request('/company-settings/email-secret', {
    body: JSON.stringify({ secret }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  });
}
