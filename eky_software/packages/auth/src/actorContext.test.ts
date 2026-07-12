import { describe, expect, it } from 'vitest';

import { createActorContext } from './actorContext.js';

describe('createActorContext', () => {
  it('creates a normalized local actor context', () => {
    expect(
      createActorContext({
        actorId: '  local-user  ',
        authenticationMode: 'local',
        companyId: '  example-company  ',
        permissions: ['manageCompanyEmailSettings'],
      }),
    ).toEqual({
      actorId: 'local-user',
      authenticationMode: 'local',
      companyId: 'example-company',
      permissions: ['manageCompanyEmailSettings'],
    });
  });

  it('creates a firebase actor context without Firebase dependencies', () => {
    expect(
      createActorContext({
        actorId: 'firebase-user',
        authenticationMode: 'firebase',
        companyId: 'example-company',
        permissions: ['sendInvoices'],
      }).authenticationMode,
    ).toBe('firebase');
  });

  it.each([
    { actorId: '', companyId: 'example-company' },
    { actorId: 'local-user', companyId: '' },
    { actorId: 'local\nuser', companyId: 'example-company' },
    { actorId: 'local-user', companyId: 'example\u0000company' },
    { actorId: 'a'.repeat(201), companyId: 'example-company' },
    { actorId: 'local-user', companyId: 'a'.repeat(201) },
  ])('rejects invalid actor and company identifiers', (identifiers) => {
    expect(() =>
      createActorContext({
        ...identifiers,
        authenticationMode: 'local',
        permissions: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_actor_context' }),
    );
  });

  it('rejects an unknown authentication mode', () => {
    expect(() =>
      createActorContext({
        actorId: 'local-user',
        authenticationMode: 'unknown',
        companyId: 'example-company',
        permissions: [],
      }),
    ).toThrow('Authentication mode is not supported.');
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      createActorContext({
        actorId: 'local-user',
        authenticationMode: 'local',
        companyId: 'example-company',
        permissions: ['unknownPermission'],
      }),
    ).toThrow('Permissions contain an unsupported value.');
  });

  it('copies and freezes the permission list', () => {
    const inputPermissions = ['sendInvoices'];
    const context = createActorContext({
      actorId: 'local-user',
      authenticationMode: 'local',
      companyId: 'example-company',
      permissions: inputPermissions,
    });

    inputPermissions.length = 0;

    expect(context.permissions).toEqual(['sendInvoices']);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.permissions)).toBe(true);
    expect(() => {
      (context.permissions as string[]).push('manageCompanyEmailSecret');
    }).toThrow(TypeError);
  });

  it('does not include rejected identifier values in error messages', () => {
    const rejectedActorId = `synthetic-sensitive-value\nother`;

    expect(() =>
      createActorContext({
        actorId: rejectedActorId,
        authenticationMode: 'local',
        companyId: 'example-company',
        permissions: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(rejectedActorId),
      }),
    );
  });
});
