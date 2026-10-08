import { createActorContext } from '@eky/auth';
import { describe, expect, it } from 'vitest';

import {
  parseApprovedInvoiceEmailSmtpPrepareBody, parseApprovedInvoiceEmailSmtpSendBody,
  parseApprovedInvoiceEmailSmtpTestPrepareBody, parseApprovedInvoiceEmailSmtpTestSendBody,
  parseApprovedInvoiceEmailDryRunSendBody,
} from './approvedInvoiceEmailRequest.js';

const actorContext = createActorContext({ actorId: 'actor-1', companyId: 'company-1', authenticationMode: 'local', permissions: ['sendInvoices'] });
const context = { actorContext, invoiceId: 'invoice-1', preparedAt: '2026-10-06T12:00:00.000Z', sentAt: '2026-10-06T12:00:00.000Z' };
const message = { body: 'Synthetic body', cc: '', to: 'recipient@example.invalid', subject: 'Synthetic invoice' };
const authorization = { attemptId: 'attempt-1', authorizationToken: 'synthetic-token' };

describe.each([
  ['prepare', parseApprovedInvoiceEmailSmtpPrepareBody, {}],
  ['send', parseApprovedInvoiceEmailSmtpSendBody, authorization],
] as const)('customer SMTP %s target parser', (_operation, parse, extra) => {
  it.each(['revision', 'preservedLegacy'] as const)('requires an exact %s comparison target', kind => {
    const documentTarget = { kind, documentId: 'Ab9_-'.repeat(20) };
    expect(parse({ ...message, ...extra, documentTarget }, context)).toMatchObject({ actorContext, documentTarget });
  });

  it.each([
    undefined, null, [], {}, 'legacy', { kind: 'revision' }, { documentId: 'document-1' },
    { kind: 'unknown', documentId: 'document-1' },
    { kind: 'preservedLegacy', documentId: 'document-1', sourceDocumentId: 'source-1' },
    { kind: 'revision', documentId: 'document-1', revisionId: 'revision-1' },
    { kind: 'revision', documentId: 'document-1', companyId: 'company-1' },
    ...['', ' document-1', 'document-1 ', 'document 1', 'a'.repeat(101), '../document', 'a/b', 'a\\b', 'a.b', 'a\n', 'a\u0000', 'ä'].map(documentId => ({ kind: 'revision', documentId })),
    { kind: 'revision', documentId: 1 },
  ])('rejects malformed targets without normalization: %j', documentTarget => {
    expect(() => parse({ ...message, ...extra, documentTarget }, context)).toThrow();
  });

  it('rejects an absent target instead of falling back to the current document', () => {
    expect(() => parse({ ...message, ...extra }, context)).toThrow();
  });
});

describe('revision-only email request boundaries', () => {
  it.each([
    ['smtp-test prepare', parseApprovedInvoiceEmailSmtpTestPrepareBody, {}],
    ['smtp-test send', parseApprovedInvoiceEmailSmtpTestSendBody, authorization],
    ['dry-run send', parseApprovedInvoiceEmailDryRunSendBody, {}],
  ] as const)('does not extend %s with a customer target', (_label, parse, extra) => {
    expect(() => parse({ ...message, ...extra }, context)).not.toThrow();
    expect(() => parse({ ...message, ...extra, documentTarget: { kind: 'preservedLegacy', documentId: 'document-1' } }, context)).toThrow();
  });
});
