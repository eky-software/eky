export const permissionValues = Object.freeze([
  'manageCompanySettings',
  'manageInvoiceSettings',
  'manageInvoiceCorrections',
  'manageCompanyEmailSettings',
  'manageCompanyEmailSecret',
  'sendInvoices',
  'viewActivity',
  'viewDiagnostics',
  'createSupportBundle',
] as const);

export type Permission = (typeof permissionValues)[number];

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === 'string' &&
    permissionValues.includes(value as Permission)
  );
}
