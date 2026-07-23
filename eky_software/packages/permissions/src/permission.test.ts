import { describe, expect, it } from 'vitest';

import { isPermission, permissionValues } from './permission.js';

describe('permissionValues', () => {
  it('contains only the explicitly approved permission values', () => {
    expect(permissionValues).toEqual([
      'manageCompanySettings',
      'manageInvoiceSettings',
      'manageInvoiceCorrections',
      'manageCompanyEmailSettings',
      'manageCompanyEmailSecret',
      'sendInvoices',
    ]);
  });

  it('recognizes only known permission values', () => {
    expect(isPermission('sendInvoices')).toBe(true);
    expect(isPermission('manageInvoiceSettings')).toBe(true);
    expect(isPermission('manageInvoiceCorrections')).toBe(true);
    expect(isPermission('unknownPermission')).toBe(false);
    expect(isPermission(123)).toBe(false);
  });
});
