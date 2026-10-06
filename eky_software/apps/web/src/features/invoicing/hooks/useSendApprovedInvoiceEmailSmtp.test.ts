import {
  EkyApiError,
  type ApprovedInvoiceEmailSmtpPreparation,
  type ApprovedInvoiceEmailSmtpPrepareInput,
  type ApprovedInvoiceEmailSmtpSendResult,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getSendApprovedInvoiceEmailSmtpErrorMessage,
  sendApprovedInvoiceEmailSmtpWithClient,
} from './useSendApprovedInvoiceEmailSmtp.js';
import { uiText } from '../../../i18n/fi.js';

describe('sendApprovedInvoiceEmailSmtpWithClient', () => {
  it.each(['revision', 'preservedLegacy'] as const)('uses preparation authorization with the unchanged %s preview target', async (kind) => {
    const input: ApprovedInvoiceEmailSmtpPrepareInput = {
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      documentTarget: { kind, documentId: 'document-1' },
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const result = {
      deliveredCc: 'copy@example.fi',
      deliveredTo: 'customer@example.fi',
      deliveryEventId: 'delivery-event-1',
      invoice: { id: 'invoice-1', status: 'sent' },
      provider: 'smtp',
      providerMessageId: '<message@example.fi>',
      resend: false,
      testMode: false,
    } as ApprovedInvoiceEmailSmtpSendResult;
    const apiClient = {
      prepareApprovedInvoiceEmailSmtp: vi.fn(async () => ({
        attachment: { documentId: 'document-1', fileName: 'invoice.pdf', sizeBytes: 2048 },
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        body: input.body,
        cc: 'copy@example.fi',
        documentTarget: { ...input.documentTarget },
        expiresAt: '2026-07-17T22:01:00.000Z',
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        recipient: 'customer@example.fi',
        resend: false,
        sender: 'Example Oy <billing@example.fi>',
        subject: input.subject,
      })),
      sendApprovedInvoiceEmailSmtp: vi.fn(async () => result),
    };

    await expect(
      sendApprovedInvoiceEmailSmtpWithClient(apiClient, 'invoice-1', input),
    ).resolves.toBe(result);
    expect(apiClient.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledWith(
      'invoice-1',
      input,
    );
    expect(apiClient.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledWith(
      'invoice-1',
      {
        ...input,
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
      },
    );
    expect(apiClient.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledTimes(1);
    expect(apiClient.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledTimes(1);
  });

  describe.each(['revision', 'preservedLegacy'] as const)('%s preview', (kind) => {
    it.each(['invoice', 'kind', 'document', 'attachment'] as const)(
      'does not send when the preparation changes the %s identity', async (mismatch) => {
        const input = createInput(kind);
        const preparation = createPreparation(input);
        if (mismatch === 'invoice') preparation.invoiceId = 'other-invoice';
        if (mismatch === 'kind') {
          preparation.documentTarget.kind = kind === 'revision' ? 'preservedLegacy' : 'revision';
        }
        if (mismatch === 'document') {
          preparation.documentTarget.documentId = 'replacement-document';
          preparation.attachment.documentId = 'replacement-document';
        }
        if (mismatch === 'attachment') preparation.attachment.documentId = 'other-document';
        const client = {
          prepareApprovedInvoiceEmailSmtp: vi.fn(async () => preparation),
          sendApprovedInvoiceEmailSmtp: vi.fn(),
        };

        const error = await sendApprovedInvoiceEmailSmtpWithClient(client, 'invoice-1', input)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(EkyApiError);
        expect(error).toMatchObject({ status: 409, responseBody: undefined });
        expect(getSendApprovedInvoiceEmailSmtpErrorMessage(error))
          .toBe(uiText.invoicing.invoiceEmailSmtpConflict);
        expect(client.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledExactlyOnceWith('invoice-1', input);
        expect(client.sendApprovedInvoiceEmailSmtp).not.toHaveBeenCalled();
      },
    );
  });

  it('retains the submitted preview identity while preparation is pending', async () => {
    const input = createInput('preservedLegacy');
    const preparation = createPreparation(input);
    let resolve!: (value: ApprovedInvoiceEmailSmtpPreparation) => void;
    const pending = new Promise<ApprovedInvoiceEmailSmtpPreparation>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const client = {
      prepareApprovedInvoiceEmailSmtp: vi.fn(() => pending),
      sendApprovedInvoiceEmailSmtp: vi.fn(),
    };
    const command = sendApprovedInvoiceEmailSmtpWithClient(client, 'invoice-1', input);
    input.documentTarget.documentId = 'new-preview';
    input.body = 'New message';
    resolve(preparation);
    await command;

    expect(client.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledExactlyOnceWith('invoice-1', {
      ...createInput('preservedLegacy'),
      attemptId: preparation.attemptId,
      authorizationToken: preparation.authorizationToken,
    });
  });

  it('does not send or retry when fresh preparation rejects the preview', async () => {
    const error = new EkyApiError('Invoice delivery conflict.', { status: 409 });
    const client = {
      prepareApprovedInvoiceEmailSmtp: vi.fn().mockRejectedValue(error),
      sendApprovedInvoiceEmailSmtp: vi.fn(),
    };
    await expect(sendApprovedInvoiceEmailSmtpWithClient(client, 'invoice-1', createInput()))
      .rejects.toBe(error);
    expect(client.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledTimes(1);
    expect(client.sendApprovedInvoiceEmailSmtp).not.toHaveBeenCalled();
  });

  it('propagates a committed read failure without preparing or sending again', async () => {
    const input = createInput();
    const error = new EkyApiError('Safe read failure.', {
      status: 409,
      responseBody: { code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED' },
    });
    const client = {
      prepareApprovedInvoiceEmailSmtp: vi.fn(async () => createPreparation(input)),
      sendApprovedInvoiceEmailSmtp: vi.fn().mockRejectedValue(error),
    };
    await expect(sendApprovedInvoiceEmailSmtpWithClient(client, 'invoice-1', input))
      .rejects.toBe(error);
    expect(client.prepareApprovedInvoiceEmailSmtp).toHaveBeenCalledTimes(1);
    expect(client.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledTimes(1);
  });
});

function createInput(
  kind: ApprovedInvoiceEmailSmtpPrepareInput['documentTarget']['kind'] = 'revision',
): ApprovedInvoiceEmailSmtpPrepareInput {
  return {
    body: 'Invoice attached.',
    documentTarget: { kind, documentId: 'document-1' },
    subject: 'Invoice',
    to: 'recipient@example.invalid',
  };
}

function createPreparation(input: ApprovedInvoiceEmailSmtpPrepareInput): ApprovedInvoiceEmailSmtpPreparation {
  return {
    attachment: { documentId: input.documentTarget.documentId, fileName: 'invoice.pdf', sizeBytes: 2048 },
    attemptId: 'attempt-1',
    authorizationToken: 'synthetic-one-time-authorization',
    body: input.body,
    cc: input.cc ?? '',
    documentTarget: { ...input.documentTarget },
    expiresAt: '2026-07-17T22:01:00.000Z',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    recipient: input.to,
    resend: input.documentTarget.kind === 'preservedLegacy',
    sender: 'Example Oy <billing@example.invalid>',
    subject: input.subject,
  };
}

describe('getSendApprovedInvoiceEmailSmtpErrorMessage', () => {
  it('distinguishes durable delivery from a failed read without exposing raw details', () => {
    const error = new EkyApiError('synthetic-private-read-failure', {
      status: 409,
      responseBody: { code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED', stack: 'must-not-leak' },
    });
    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);
    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpCommittedReadFailed);
    expect(message).not.toContain('must-not-leak');
    expect(message).not.toContain('synthetic-private-read-failure');
  });

  it.each([
    null, 'INVOICE_DELIVERY_COMMITTED_READ_FAILED',
    ['INVOICE_DELIVERY_COMMITTED_READ_FAILED'],
    { code: ['INVOICE_DELIVERY_COMMITTED_READ_FAILED'] },
    { code: 'unknown' }, { error: { code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED' } },
  ])('does not infer committed success from a malformed body %#', (responseBody) => {
    const error = new EkyApiError('Invoice was sent.', { status: 409, responseBody });
    expect(getSendApprovedInvoiceEmailSmtpErrorMessage(error))
      .toBe(uiText.invoicing.invoiceEmailSmtpConflict);
  });

  it.each([200, 500, 502])('does not infer committed success from an unexpected status %s', (status) => {
    const error = new EkyApiError('Invoice was sent.', {
      status, responseBody: { code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED' },
    });
    expect(getSendApprovedInvoiceEmailSmtpErrorMessage(error))
      .toBe(uiText.invoicing.invoiceEmailSmtpError);
  });

  it('shows a calm message when the native confirmation is cancelled', () => {
    const error = new EkyApiError('Sähköpostilähetys peruutettiin.', {
      responseBody: { technicalDetail: 'must-not-leak' },
      status: 409,
    });

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpCancelled);
    expect(message).not.toContain('technicalDetail');
  });

  it('warns against an automatic retry when the outcome is unknown', () => {
    const error = new EkyApiError(
      'Invoice email delivery outcome is unknown.',
      {
        responseBody: { stack: 'must-not-leak' },
        status: 502,
      },
    );

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpOutcomeUnknown);
    expect(message).not.toContain('stack');
  });

  it('directs an unresolved persisted attempt to delivery history', () => {
    const error = new EkyApiError(
      'Invoice has an unresolved delivery attempt.',
      {
        responseBody: { technicalDetail: 'must-not-leak' },
        status: 409,
      },
    );

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(
      uiText.invoicing.invoiceEmailSmtpPersistentConflict,
    );
    expect(message).not.toContain('technicalDetail');
  });

  it('uses a safe Finnish message for provider failures', () => {
    const error = new EkyApiError('Internal SMTP details', {
      responseBody: { password: 'must-not-leak' },
      status: 502,
    });

    const message = getSendApprovedInvoiceEmailSmtpErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceEmailSmtpError);
    expect(message).not.toContain('password');
    expect(message).not.toContain('SMTP details');
  });
});
