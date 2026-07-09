import { requestJson } from '../../http.js';
import { readInvoiceDraftResponse } from '../invoiceDrafts/invoiceDraftsResponse.js';
import {
  readApprovedInvoiceDocumentMetadataResponse,
  readApprovedInvoiceEmailDryRunSendResponse,
  readApprovedInvoiceEmailPreviewResponse,
  readApprovedInvoiceListResponse,
  readApprovedInvoiceResponse,
  readReopenedApprovedInvoiceResponse,
} from './approvedInvoicesResponse.js';
import type {
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailDryRunSendResult,
  ApprovedInvoicesApi,
  ApprovedInvoiceSummary,
  ApprovedInvoiceView,
  ReopenedApprovedInvoice,
} from './approvedInvoicesTypes.js';
import type { InvoiceDraft } from '../invoiceDrafts/index.js';

export function createApprovedInvoicesApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): ApprovedInvoicesApi {
  return {
    async copyApprovedInvoiceToDraft(id): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/copy-to-draft`,
        { method: 'POST' },
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async createApprovedInvoicePdf(
      id,
    ): Promise<ApprovedInvoiceDocumentMetadata> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/pdf`,
        { method: 'POST' },
      );

      return readApprovedInvoiceDocumentMetadataResponse(responseBody);
    },

    async getApprovedInvoicePdfMetadata(
      id,
    ): Promise<ApprovedInvoiceDocumentMetadata> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/pdf/metadata`,
      );

      return readApprovedInvoiceDocumentMetadataResponse(responseBody);
    },

    async getApprovedInvoice(id): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}`,
      );

      return readApprovedInvoiceResponse(responseBody);
    },

    getApprovedInvoicePdfUrl(id): string {
      return `${baseUrl}/invoices/${encodeURIComponent(id)}/pdf`;
    },

    async listApprovedInvoices(): Promise<ApprovedInvoiceSummary[]> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoices',
      );

      return readApprovedInvoiceListResponse(responseBody);
    },

    async markApprovedInvoiceSent(id): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/mark-sent`,
        { method: 'POST' },
      );

      return readApprovedInvoiceResponse(responseBody);
    },

    async prepareApprovedInvoiceEmailDryRun(id) {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/dry-run`,
        { method: 'POST' },
      );

      return readApprovedInvoiceEmailPreviewResponse(responseBody);
    },

    async sendApprovedInvoiceEmailDryRun(
      id,
      input: ApprovedInvoiceEmailDryRunSendInput,
    ): Promise<ApprovedInvoiceEmailDryRunSendResult> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/dry-run/send`,
        {
          body: JSON.stringify(createApprovedInvoiceEmailDryRunSendBody(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailDryRunSendResponse(responseBody);
    },

    async reopenApprovedInvoiceForEditing(
      id,
    ): Promise<ReopenedApprovedInvoice> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/reopen-for-edit`,
        { method: 'POST' },
      );

      return readReopenedApprovedInvoiceResponse(responseBody);
    },
  };
}

function createApprovedInvoiceEmailDryRunSendBody(
  input: ApprovedInvoiceEmailDryRunSendInput,
): ApprovedInvoiceEmailDryRunSendInput {
  const body: ApprovedInvoiceEmailDryRunSendInput = {
    body: input.body,
    subject: input.subject,
    to: input.to,
  };

  if (input.cc !== undefined) {
    body.cc = input.cc;
  }

  return body;
}
