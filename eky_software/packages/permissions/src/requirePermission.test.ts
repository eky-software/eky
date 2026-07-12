import { describe, expect, it } from 'vitest';

import { AuthorizationError } from './authorizationError.js';
import { requirePermission } from './requirePermission.js';

describe('requirePermission', () => {
  it('allows an explicitly granted permission', () => {
    expect(() =>
      requirePermission(
        { permissions: ['manageCompanyEmailSecret'] },
        'manageCompanyEmailSecret',
      ),
    ).not.toThrow();
  });

  it('denies a permission that was not explicitly granted', () => {
    expect(() =>
      requirePermission({ permissions: [] }, 'manageCompanyEmailSecret'),
    ).toThrow(AuthorizationError);
  });

  it('returns a safe authorization error without context details', () => {
    expect(() =>
      requirePermission({ permissions: [] }, 'sendInvoices'),
    ).toThrowError(
      expect.objectContaining({
        code: 'authorization_denied',
        message: 'Permission denied.',
      }),
    );
  });

  it('denies an unknown runtime permission value', () => {
    expect(() =>
      requirePermission(
        { permissions: ['sendInvoices'] },
        'unknownPermission' as 'sendInvoices',
      ),
    ).toThrow(AuthorizationError);
  });
});
