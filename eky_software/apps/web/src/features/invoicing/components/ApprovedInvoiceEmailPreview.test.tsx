import type {
  ApprovedInvoiceEmailPreview as EmailPreview,
  ApprovedInvoiceEmailSmtpPrepareInput,
} from '@eky/api-client';
import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailPreview } from './ApprovedInvoiceEmailPreview.js';
import { sendApprovedInvoiceEmailSmtpWithClient } from '../hooks/useSendApprovedInvoiceEmailSmtp.js';
import { uiText } from '../../../i18n/fi.js';

// Exercise the form's real action callbacks with its initial preview values.
// This is not a browser mounting or native-confirmation test.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));

describe('ApprovedInvoiceEmailPreview exact-target actions', () => {
  it.each(['revision', 'preservedLegacy'] as const)(
    'carries the visible %s target through fresh preparation and send', async (kind) => {
      const email = createPreview(kind);
      const client = {
        prepareApprovedInvoiceEmailSmtp: vi.fn(async () => ({
          attachment: { ...email.attachment },
          attemptId: 'attempt-1', authorizationToken: 'synthetic-authorization',
          body: email.body, cc: '', documentTarget: { ...email.documentTarget },
          expiresAt: '2026-10-06T12:01:00.000Z', invoiceId: email.invoiceId,
          invoiceNumber: email.invoiceNumber, recipient: email.to,
          resend: kind === 'preservedLegacy', sender: 'sender@example.invalid',
          subject: email.subject,
        })),
        sendApprovedInvoiceEmailSmtp: vi.fn(),
      };
      let command: Promise<unknown> | undefined;
      const onSendSmtp = vi.fn((input: ApprovedInvoiceEmailSmtpPrepareInput) => {
        command = sendApprovedInvoiceEmailSmtpWithClient(client, email.invoiceId, input);
      });
      const props = createProps(email, onSendSmtp);
      const tree = ApprovedInvoiceEmailPreview(props);
      const send = findButton(tree, kind === 'preservedLegacy'
        ? uiText.invoicing.invoiceEmailSmtpResend : uiText.invoicing.invoiceEmailSmtpSend);
      expect(send.disabled).toBe(false);
      send.onClick();
      expect(command).toBeDefined();
      await command;

      const expected = {
        body: email.body, subject: email.subject, to: email.to,
        documentTarget: email.documentTarget,
      };
      expect(onSendSmtp).toHaveBeenCalledExactlyOnceWith(expected);
      expect(client.prepareApprovedInvoiceEmailSmtp)
        .toHaveBeenCalledExactlyOnceWith(email.invoiceId, expected);
      expect(client.sendApprovedInvoiceEmailSmtp).toHaveBeenCalledExactlyOnceWith(email.invoiceId, {
        ...expected, attemptId: 'attempt-1', authorizationToken: 'synthetic-authorization',
      });
      expect(props.onSendDryRun).not.toHaveBeenCalled();
      expect(props.onSendSmtpTest).not.toHaveBeenCalled();
    },
  );

  it('keeps revision-only tools on their unchanged request contracts', () => {
    const email = createPreview('revision');
    const props = createProps(email);
    const tree = ApprovedInvoiceEmailPreview(props);
    const expected = { body: email.body, subject: email.subject, to: email.to };
    for (const label of [uiText.invoicing.invoiceEmailDryRunSend, uiText.invoicing.invoiceEmailSmtpTestSend]) {
      const button = findButton(tree, label);
      expect(button.disabled).toBe(false);
      button.onClick();
    }
    expect(props.onSendDryRun).toHaveBeenCalledExactlyOnceWith(expected);
    expect(props.onSendSmtpTest).toHaveBeenCalledExactlyOnceWith(expected);
    expect(props.onSendSmtp).not.toHaveBeenCalled();
  });

  it('does not submit a preserved attachment through either revision-only tool', () => {
    const props = createProps(createPreview('preservedLegacy'));
    const tree = ApprovedInvoiceEmailPreview(props);
    for (const label of [uiText.invoicing.invoiceEmailDryRunSend, uiText.invoicing.invoiceEmailSmtpTestSend]) {
      const button = findButton(tree, label);
      expect(button.disabled).toBe(true);
      button.onClick();
    }
    expect(props.onSendDryRun).not.toHaveBeenCalled();
    expect(props.onSendSmtpTest).not.toHaveBeenCalled();
    expect(props.onSendSmtp).not.toHaveBeenCalled();
  });
});

function createProps(email: EmailPreview, onSendSmtp = vi.fn<(input: ApprovedInvoiceEmailSmtpPrepareInput) => void>()) {
  return {
    email, errorMessage: null, isSending: false, isSendingSmtp: false,
    isSendingSmtpTest: false, isResend: email.documentTarget.kind === 'preservedLegacy',
    smtpErrorMessage: null, smtpSuccessMessage: null, smtpUnavailableMessage: null,
    smtpTestErrorMessage: null, smtpTestRecipient: 'test@example.invalid',
    smtpTestUnavailableMessage: null, smtpTestSuccessMessage: null, successMessage: null,
    onOpenPreservedPdf: vi.fn(async () => true), onSendDryRun: vi.fn(),
    onSendSmtp, onSendSmtpTest: vi.fn(),
  };
}

function createPreview(kind: EmailPreview['documentTarget']['kind']): EmailPreview {
  return {
    attachment: { documentId: 'preview-document', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 123 },
    documentTarget: { kind, documentId: 'preview-document' },
    body: 'Invoice attached.', invoiceId: 'invoice-1', invoiceNumber: '20260001',
    provider: 'dryRun', subject: 'Invoice', to: 'recipient@example.invalid',
  };
}

interface ButtonProps {
  children?: ReactNode;
  disabled?: boolean;
  onClick(): void;
}

function findButton(tree: ReactNode, label: string): ButtonProps {
  let found: ButtonProps | undefined;
  function visit(node: ReactNode): void {
    Children.forEach(node, (child) => {
      if (!isValidElement<ButtonProps>(child)) return;
      if (child.type === 'button' && child.props.children === label) found = child.props;
      else visit(child.props.children);
    });
  }
  visit(tree);
  if (found === undefined) throw new Error(`Missing action: ${label}`);
  return found;
}
