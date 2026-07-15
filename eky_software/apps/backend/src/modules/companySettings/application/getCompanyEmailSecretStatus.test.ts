import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import { CompanyEmailSecretOperationError } from './executeCompanyEmailSecretOperation.js';
import { getCompanyEmailSecretStatus } from './getCompanyEmailSecretStatus.js';

describe('getCompanyEmailSecretStatus', () => {
  it.each([true, false])(
    'returns configured=%s without reading the secret value',
    async (configured) => {
      const hasSecret = vi.fn(async () => configured);
      const status = await getCompanyEmailSecretStatus(
        { actorContext: createEmailSecretActorContext() },
        {
          companyEmailSecretStore: createSecretStore({ hasSecret }),
        },
      );

      expect(hasSecret).toHaveBeenCalledWith('example-company');
      expect(status).toEqual({ configured });
      expect(status).not.toHaveProperty('secret');
    },
  );

  it('denies access before checking the secret store', async () => {
    const hasSecret = vi.fn<CompanyEmailSecretStore['hasSecret']>();

    await expect(
      getCompanyEmailSecretStatus(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'example-company',
            permissions: [],
          }),
        },
        {
          companyEmailSecretStore: createSecretStore({ hasSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(hasSecret).not.toHaveBeenCalled();
  });

  it('maps secret store failures to a safe application error', async () => {
    const hasSecret = vi.fn(async () => {
      throw new Error('Synthetic storage details.');
    });

    await expect(
      getCompanyEmailSecretStatus(
        { actorContext: createEmailSecretActorContext() },
        { companyEmailSecretStore: createSecretStore({ hasSecret }) },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
        message: 'Email secret operation could not be completed safely.',
      } satisfies Partial<CompanyEmailSecretOperationError>),
    );
  });
});

function createEmailSecretActorContext() {
  return createActorContext({
    actorId: 'local-user',
    authenticationMode: 'local',
    companyId: 'example-company',
    permissions: ['manageCompanyEmailSecret'],
  });
}

function createSecretStore(
  overrides: Partial<CompanyEmailSecretStore> = {},
): CompanyEmailSecretStore {
  return {
    hasSecret: vi.fn(async () => false),
    removeSecret: vi.fn(async () => undefined),
    setSecret: vi.fn(async () => undefined),
    ...overrides,
  };
}
