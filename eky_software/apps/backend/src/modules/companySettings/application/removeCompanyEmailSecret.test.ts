import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import { removeCompanyEmailSecret } from './removeCompanyEmailSecret.js';

describe('removeCompanyEmailSecret', () => {
  it('removes the secret from the actor company without returning it', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();
    const status = await removeCompanyEmailSecret(
      { actorContext: createEmailSecretActorContext() },
      {
        companyEmailSecretStore: createSecretStore({ removeSecret }),
      },
    );

    expect(removeSecret).toHaveBeenCalledWith('example-company');
    expect(status).toEqual({ configured: false });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();

    await expect(
      removeCompanyEmailSecret(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'example-company',
            permissions: [],
          }),
        },
        {
          companyEmailSecretStore: createSecretStore({ removeSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(removeSecret).not.toHaveBeenCalled();
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
