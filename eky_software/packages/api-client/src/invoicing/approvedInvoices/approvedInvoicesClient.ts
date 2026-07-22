import { requestJson } from '../../http.js';
import { serializeApprovedInvoiceListQuery } from './approvedInvoiceListSerialization.js';
import { readInvoiceDraftResponse } from '../invoiceDrafts/invoiceDraftsResponse.js';
import {
  readApprovedInvoiceDocumentMetadataResponse,
  readApprovedInvoiceEmailDryRunSendResponse,
  readApprovedInvoiceEmailSmtpTestSendResponse,
  readApprovedInvoiceEmailSmtpTestPreparationResponse,
  readApprovedInvoiceEmailSmtpPreparationResponse,
  readApprovedInvoiceEmailSmtpSendResponse,
  readApprovedInvoiceEmailPreviewResponse,
  readInvoiceDeliveryEventListResponse,
  readApprovedInvoiceListResponse,
  readApprovedInvoiceResponse,
  readReopenedApprovedInvoiceResponse,
} from './approvedInvoicesResponse.js';
import type {
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailDryRunSendResult,
  ApprovedInvoiceEmailSmtpTestSendInput,
  ApprovedInvoiceEmailSmtpTestSendResult,
  ApprovedInvoiceEmailSmtpSendInput,
  ApprovedInvoiceEmailSmtpSendResult,
  ApprovedInvoicesApi,
  ApprovedInvoiceListPage,
  ApprovedInvoiceView,
  InvoiceDeliveryEventSummary,
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

    async listApprovedInvoices(query): Promise<ApprovedInvoiceListPage> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices?${serializeApprovedInvoiceListQuery(query)}`,
      );

      return readApprovedInvoiceListResponse(responseBody);
    },

    async listInvoiceDeliveryEvents(
      id,
    ): Promise<InvoiceDeliveryEventSummary[]> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/delivery-events`,
      );

      return readInvoiceDeliveryEventListResponse(responseBody);
    },

    async markApprovedInvoiceSent(
      id,
      deliveryMethod,
    ): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/mark-sent`,
        {
          body: JSON.stringify({ deliveryMethod }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
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
          body: JSON.stringify(createApprovedInvoiceEmailSendBody(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailDryRunSendResponse(responseBody);
    },

    async sendApprovedInvoiceEmailSmtpTest(
      id,
      input: ApprovedInvoiceEmailSmtpTestSendInput,
    ): Promise<ApprovedInvoiceEmailSmtpTestSendResult> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/smtp-test/send`,
        {
          body: JSON.stringify({
            ...createApprovedInvoiceEmailSendBody(input),
            attemptId: input.attemptId,
            authorizationToken: input.authorizationToken,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailSmtpTestSendResponse(responseBody);
    },

    async prepareApprovedInvoiceEmailSmtpTest(id, input) {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/smtp-test/prepare`,
        {
          body: JSON.stringify(createApprovedInvoiceEmailSendBody(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailSmtpTestPreparationResponse(responseBody);
    },

    async prepareApprovedInvoiceEmailSmtp(id, input) {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/smtp/prepare`,
        {
          body: JSON.stringify(createApprovedInvoiceEmailSendBody(input)),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailSmtpPreparationResponse(responseBody);
    },

    async sendApprovedInvoiceEmailSmtp(
      id,
      input: ApprovedInvoiceEmailSmtpSendInput,
    ): Promise<ApprovedInvoiceEmailSmtpSendResult> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/email/smtp/send`,
        {
          body: JSON.stringify({
            ...createApprovedInvoiceEmailSendBody(input),
            attemptId: input.attemptId,
            authorizationToken: input.authorizationToken,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      return readApprovedInvoiceEmailSmtpSendResponse(responseBody);
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

function createApprovedInvoiceEmailSendBody(
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
