export const developmentBackendProxyPaths = [
  '/company-settings',
  '/customers',
  '/invoice-drafts',
  '/invoices',
  '/invoice-numbering-settings',
  '/invoice-payment-settings',
  '/invoice-vat-rates',
  '/sent-invoice-groups',
] as const;

interface DevelopmentBackendProxyTarget {
  changeOrigin: true;
  target: string;
}

export function createDevelopmentBackendProxy(
  target: string,
): Record<string, DevelopmentBackendProxyTarget> {
  return Object.fromEntries(
    developmentBackendProxyPaths.map((path) => [
      path,
      {
        changeOrigin: true,
        target,
      },
    ]),
  );
}
