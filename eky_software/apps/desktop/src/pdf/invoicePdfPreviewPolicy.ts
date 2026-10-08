import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron';

import { isValidResourceId } from '../main/protocolPolicy.js';
import type { InvoicePdfPreviewTarget } from './invoicePdfPreviewTypes.js';

const invoicePdfPreviewOrigin = 'eky://app';

export function createInvoicePdfPreviewUrl(
  invoiceId: unknown,
  target?: unknown,
): string {
  if (!isValidResourceId(invoiceId)) {
    throw new Error('INVOICE_PDF_PREVIEW_INVALID_ID');
  }

  if (target !== undefined) {
    if (!isValidInvoicePdfPreviewTarget(target)) {
      throw new Error('INVOICE_PDF_PREVIEW_INVALID_TARGET');
    }

    if (target.kind === 'deliveryEvent') {
      return `${invoicePdfPreviewOrigin}/invoices/${invoiceId}/delivery-events/${target.eventId}/pdf`;
    }

    return `${invoicePdfPreviewOrigin}/invoices/${invoiceId}/preserved-documents/${target.documentId}/pdf`;
  }

  return `${invoicePdfPreviewOrigin}/invoices/${invoiceId}/pdf`;
}

function isValidInvoicePdfPreviewTarget(
  value: unknown,
): value is InvoicePdfPreviewTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, 'kind') ||
    !('kind' in value)
  ) {
    return false;
  }

  if (value.kind === 'deliveryEvent') {
    return (
      Object.hasOwn(value, 'eventId') &&
      'eventId' in value &&
      isValidResourceId(value.eventId)
    );
  }

  return (
    value.kind === 'preservedLegacy' &&
    Object.hasOwn(value, 'documentId') &&
    'documentId' in value &&
    isValidResourceId(value.documentId)
  );
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
