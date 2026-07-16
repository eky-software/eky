import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron';

import { isValidResourceId } from '../main/protocolPolicy.js';

const invoicePdfPreviewOrigin = 'eky://app';

export function createInvoicePdfPreviewUrl(invoiceId: unknown): string {
  if (!isValidResourceId(invoiceId)) {
    throw new Error('INVOICE_PDF_PREVIEW_INVALID_ID');
  }

  return `${invoicePdfPreviewOrigin}/invoices/${invoiceId}/pdf`;
}

export function isAllowedInvoicePdfPreviewNavigation(
  targetUrl: string,
  expectedUrl: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    const expected = new URL(expectedUrl);

    return (
      target.href === expected.href &&
      target.protocol === 'eky:' &&
      target.hostname === 'app' &&
      target.search === '' &&
      target.hash === ''
    );
  } catch {
    return false;
  }
}

export function createInvoicePdfPreviewWindowOptions(
  parent: BrowserWindow,
): BrowserWindowConstructorOptions {
  return {
    backgroundColor: '#eef4fb',
    height: 920,
    minHeight: 600,
    minWidth: 720,
    modal: false,
    parent,
    show: false,
    title: 'Eky - laskun PDF',
    width: 980,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      plugins: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  };
}
