import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { createEmailDocument } from './loadInvoiceEmailDeliveryDocument.fixture.js';
import { prepareApprovedInvoiceEmailSmtp } from './prepareApprovedInvoiceEmailSmtp.js';
import { prepareApprovedInvoiceEmailSmtpTest } from './prepareApprovedInvoiceEmailSmtpTest.js';

function fixture() {
  const document = createEmailDocument();
  const input = {
    actorContext: createActorContext({ actorId: 'actor-1', companyId: 'company-1', authenticationMode: 'local', permissions: ['sendInvoices'] }),
    invoiceId: 'invoice-1', preparedAt: '2026-10-05T12:00:00.000Z',
    documentTarget: { kind: 'revision' as const, documentId: document.metadata.id },
    to: 'customer@example.invalid', cc: 'copy@example.invalid', body: 'Synthetic body', subject: 'Synthetic subject',
  };
  const settings = {
    emailDeliveryProvider: 'dnaSmtp' as const, emailSenderAddress: 'sender@example.invalid', emailSenderName: 'Synthetic',
    emailTestRecipientOverride: 'owner@example.invalid', emailUsername: 'synthetic',
  };
  const dependencies = {
    approvedInvoiceReader: { getApprovedInvoiceById: vi.fn(async () => ({ id: 'invoice-1', status: 'approved', invoiceNumber: '20260001' } as ApprovedInvoiceView)), listApprovedInvoiceSummaries: vi.fn() },
    loadInvoiceEmailDeliveryDocument: vi.fn(async () => document),
    loadCustomerInvoiceEmailDocument: vi.fn(async () => document),
    invoiceDeliveryEventReader: {
      requiresLegacyDeliveryReview: vi.fn(async () => false),
      hasUnresolvedDeliveryEvent: vi.fn(async () => false),
    },
    invoiceEmailSettingsReader: { getEmailSettings: vi.fn(async () => settings) },
    invoiceEmailSendAttemptStore: { acquire: vi.fn(), complete: vi.fn(), prepare: vi.fn(() => ({ attemptId: 'attempt-1', authorizationToken: 'synthetic-authorization', expiresAt: '2026-10-05T12:01:00.000Z' })) },
  };
  return { document, input, settings, dependencies };
}

describe.each([
  ['customer', prepareApprovedInvoiceEmailSmtp], ['smtpTest', prepareApprovedInvoiceEmailSmtpTest],
] as const)('%s preparation exact document contract', (mode, prepare) => {
  it('binds the verified revision and clears its temporary buffer after authorization', async () => {
    const f = fixture();
    const result = await prepare(f.input, f.dependencies);
    expect(f.dependencies.invoiceEmailSendAttemptStore.prepare).toHaveBeenCalledExactlyOnceWith({
      actorId: 'actor-1', companyId: 'company-1', invoiceId: 'invoice-1', mode, provider: 'dnaSmtp',
      recipient: mode === 'customer' ? f.input.to : f.settings.emailTestRecipientOverride,
      requestFingerprint: createInvoiceEmailSendRequestFingerprint({
        ...f.input, document: f.document.metadata,
        recipient: mode === 'customer' ? f.input.to : f.settings.emailTestRecipientOverride,
        sender: { name: f.settings.emailSenderName, address: f.settings.emailSenderAddress },
      }),
    });
    expect(f.document.content.every(value => value === 0)).toBe(true);
    for (const internal of ['revisionId', 'binding', 'sha256', 'storagePath', 'companyId']) expect(JSON.stringify(result)).not.toContain(internal);
  });

  it('clears verified bytes if authorization preparation throws', async () => {
    const f = fixture();
    const error = new Error('synthetic-authorization-failure');
    f.dependencies.invoiceEmailSendAttemptStore.prepare.mockImplementation(() => { throw error; });
    await expect(prepare(f.input, f.dependencies)).rejects.toBe(error);
    expect(f.document.content.every(value => value === 0)).toBe(true);
  });

  it('refuses unresolved persistence before settings, PDF and authorization', async () => {
    const f = fixture();
    f.dependencies.invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent.mockResolvedValue(true);
    await expect(prepare(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(f.dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(f.dependencies.loadCustomerInvoiceEmailDocument).not.toHaveBeenCalled();
    expect(f.dependencies.invoiceEmailSendAttemptStore.prepare).not.toHaveBeenCalled();
  });

  it('requires backend permission before touching any document or invoice', async () => {
    const f = fixture();
    const actorContext = createActorContext({ actorId: 'actor-1', companyId: 'company-1', authenticationMode: 'local', permissions: [] });
    await expect(prepare({ ...f.input, actorContext }, f.dependencies)).rejects.toBeInstanceOf(AuthorizationError);
    expect(f.dependencies.approvedInvoiceReader.getApprovedInvoiceById).not.toHaveBeenCalled();
    expect(f.dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(f.dependencies.loadCustomerInvoiceEmailDocument).not.toHaveBeenCalled();
  });
});
