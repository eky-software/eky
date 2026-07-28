import type { CompanyEmailSecretReader } from '../../../../modules/companySettings/ports/companyEmailSecretReader.js';
import { normalizeEmailAddress } from '../../address/emailAddress.js';
import { buildInvoiceMimeMessage } from '../../mime/invoiceMimeMessageBuilder.js';
import { connectImplicitTlsSmtp } from '../../smtp/smtpConnection.js';
import { deliverSmtpMessage } from '../../smtp/smtpSession.js';
import type {
  SmtpMessageDeliveryInput,
  SmtpMessageDeliveryResult,
} from '../../smtp/smtpTypes.js';
import type { SmtpTransportSecuritySummary } from '../../smtp/smtpTransportSecurity.js';
import {
  dnaSmtpConnectionProfile,
  dnaSmtpSessionTimeouts,
} from './dnaSmtpConfiguration.js';
import {
  DnaSmtpProviderError,
  mapDnaSmtpProviderError,
} from './dnaSmtpErrorMapper.js';
import type {
  DnaSmtpEmailInput,
  DnaSmtpEmailResult,
  DnaSmtpTestEmailInput,
  DnaSmtpTestEmailResult,
} from './dnaSmtpTypes.js';
import {
  noOpDnaSmtpTransportDiagnostics,
  type DnaSmtpTransportDiagnostics,
} from './dnaSmtpTransportDiagnostics.js';

type DnaSmtpTransport = (
  input: SmtpMessageDeliveryInput,
  options?: {
    onConnectionSecured?(
      input: SmtpTransportSecuritySummary & { durationMs: number },
    ): void;
  },
) => Promise<SmtpMessageDeliveryResult>;

export class DnaSmtpEmailDeliveryProvider {
  constructor(
    private readonly dependencies: {
      companyEmailSecretReader: CompanyEmailSecretReader;
      transportDiagnostics?: DnaSmtpTransportDiagnostics;
      transport?: DnaSmtpTransport;
    },
  ) {}

  async sendTestEmail(
    input: DnaSmtpTestEmailInput,
  ): Promise<DnaSmtpTestEmailResult> {
    const { senderAddress, testRecipient, username } =
      normalizeDnaTestConfiguration(input);
    const result = await this.sendMessage({
      ...input,
      cc: '',
      senderAddress,
      to: testRecipient,
      username,
    });

    return {
      deliveredTo: result.deliveredTo,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      testMode: true,
    };
  }

  async sendEmail(input: DnaSmtpEmailInput): Promise<DnaSmtpEmailResult> {
    const { cc, senderAddress, to, username } =
      normalizeDnaConfiguration(input);
    const result = await this.sendMessage({
      ...input,
      cc,
      senderAddress,
      to,
      username,
    });

    return {
      deliveredCc: cc,
      deliveredTo: result.deliveredTo,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      testMode: false,
    };
  }

  private async sendMessage(input: {
    attemptId: string;
    body: string;
    cc: string;
    companyId: string;
    emailSenderName: string;
    pdfContent: Uint8Array;
    pdfFileName: string;
    senderAddress: string;
    subject: string;
    to: string;
    username: string;
  }): Promise<Omit<DnaSmtpEmailResult, 'deliveredCc' | 'testMode'>> {
    let message: Buffer | undefined;
    const operationId = normalizeAttemptId(input.attemptId);
    const startedAt = Date.now();
    const transportDiagnostics =
      this.dependencies.transportDiagnostics ??
      noOpDnaSmtpTransportDiagnostics;

    try {
      message = buildInvoiceMimeMessage({
        body: input.body,
        cc: input.cc,
        fromAddress: input.senderAddress,
        fromName: input.emailSenderName,
        pdfContent: input.pdfContent,
        pdfFileName: input.pdfFileName,
        subject: input.subject,
        to: input.to,
      }, {
        messageId: `${operationId}@${input.senderAddress.slice(
          input.senderAddress.lastIndexOf('@') + 1,
        )}`,
      });
      const password = await this.dependencies.companyEmailSecretReader.getSecret(
        input.companyId,
      );

      if (password === null) {
        throw new DnaSmtpProviderError('DNA_SMTP_SECRET_NOT_CONFIGURED');
      }

      const result = await (this.dependencies.transport ?? defaultTransport)(
        {
          credentials: { password, username: input.username },
          envelope: {
            from: input.senderAddress,
            recipients: [input.to, ...(input.cc === '' ? [] : [input.cc])],
          },
          message,
        },
        {
          onConnectionSecured: (summary) =>
            recordTransportDiagnosticSafely(() =>
              transportDiagnostics.recordConnectionSecured({
                ...summary,
                operationId,
              }),
            ),
        },
      );
      const transportSecurity = result.transportSecurity;
      if (transportSecurity !== undefined) {
        recordTransportDiagnosticSafely(() =>
          transportDiagnostics.recordDeliveryCompleted({
            ...transportSecurity,
            durationMs: Date.now() - startedAt,
            operationId,
          }),
        );
      }

      return {
        deliveredTo: input.to,
        provider: 'smtp',
        providerMessageId: result.providerMessageId,
      };
    } catch (error) {
      throw mapDnaSmtpProviderError(error);
    } finally {
      message?.fill(0);
    }
  }
}

function normalizeDnaConfiguration(input: DnaSmtpEmailInput): {
  cc: string;
  senderAddress: string;
  to: string;
  username: string;
} {
  if (
    input.emailDeliveryProvider !== 'dnaSmtp' ||
    input.companyId.length === 0 ||
    input.companyId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.companyId) ||
    input.emailUsername.length === 0
  ) {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }

  try {
    const senderAddress = normalizeEmailAddress(input.emailSenderAddress);
    const username = normalizeEmailAddress(input.emailUsername);

    if (senderAddress.toLowerCase() !== username.toLowerCase()) {
      throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
    }

    return {
      cc: input.cc === '' ? '' : normalizeEmailAddress(input.cc),
      senderAddress,
      to: normalizeEmailAddress(input.to),
      username,
    };
  } catch {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }
}

function normalizeDnaTestConfiguration(input: DnaSmtpTestEmailInput): {
  senderAddress: string;
  testRecipient: string;
  username: string;
} {
  if (
    input.emailDeliveryProvider !== 'dnaSmtp' ||
    input.companyId.length === 0 ||
    input.companyId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.companyId) ||
    input.emailUsername.length === 0 ||
    input.emailTestRecipientOverride.length === 0
  ) {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }

  try {
    const senderAddress = normalizeEmailAddress(input.emailSenderAddress);
    const username = normalizeEmailAddress(input.emailUsername);

    if (senderAddress.toLowerCase() !== username.toLowerCase()) {
      throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
    }

    return {
      senderAddress,
      testRecipient: normalizeEmailAddress(input.emailTestRecipientOverride),
      username,
    };
  } catch {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }
}

function normalizeAttemptId(value: string): string {
  const normalizedValue = value.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(normalizedValue)) {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }

  return normalizedValue;
}

async function defaultTransport(
  input: SmtpMessageDeliveryInput,
  options?: {
    onConnectionSecured?(
      input: SmtpTransportSecuritySummary & { durationMs: number },
    ): void;
  },
): Promise<SmtpMessageDeliveryResult> {
  return deliverSmtpMessage(input, {
    connect: () => connectImplicitTlsSmtp(dnaSmtpConnectionProfile),
    ...(options?.onConnectionSecured === undefined
      ? {}
      : { onConnectionSecured: options.onConnectionSecured }),
    timeouts: dnaSmtpSessionTimeouts,
  });
}

function recordTransportDiagnosticSafely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Diagnostics must never change SMTP delivery outcomes.
  }
}
