import type { InvoicePdfArchiveStatus } from './invoicePdfArchiveTypes.js';

export const getInvoicePdfArchiveStatusIpcChannel =
  'eky:invoice-pdf-archive:get-status';
export const chooseInvoicePdfArchiveDirectoryIpcChannel =
  'eky:invoice-pdf-archive:choose-directory';
export const openInvoicePdfArchiveDirectoryIpcChannel =
  'eky:invoice-pdf-archive:open-directory';
export const disableInvoicePdfArchiveIpcChannel =
  'eky:invoice-pdf-archive:disable';
export const retryPendingInvoicePdfArchiveTasksIpcChannel =
  'eky:invoice-pdf-archive:retry-pending';

export type InvoicePdfArchiveCapabilityStatus = InvoicePdfArchiveStatus;
