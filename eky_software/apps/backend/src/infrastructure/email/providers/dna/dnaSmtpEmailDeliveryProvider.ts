import type { CompanyEmailSecretReader } from '../../../../modules/companySettings/ports/companyEmailSecretReader.js';
import { normalizeEmailAddress } from '../../address/emailAddress.js';
import { buildInvoiceMimeMessage } from '../../mime/invoiceMimeMessageBuilder.js';
import { connectImplicitTlsSmtp } from '../../smtp/smtpConnection.js';
import { deliverSmtpMessage } from '../../smtp/smtpSession.js';
import type {
  SmtpMessageDeliveryInput,
  SmtpMessageDeliveryResult,
} from '../../smtp/smtpTypes.js';
import {
  dnaSmtpConnectionProfile,
  dnaSmtpSessionTimeouts,
} from './dnaSmtpConfiguration.js';
import {
  DnaSmtpProviderError,
  mapDnaSmtpProviderError,
} from './dnaSmtpErrorMapper.js';
import type {
  DnaSmtpTestEmailInput,
  DnaSmtpTestEmailResult,
} from './dnaSmtpTypes.js';

type DnaSmtpTransport = (
  input: SmtpMessageDeliveryInput,
) => Promise<SmtpMessageDeliveryResult>;

export class DnaSmtpEmailDeliveryProvider {
  constructor(
    private readonly dependencies: {
      companyEmailSecretReader: CompanyEmailSecretReader;
      transport?: DnaSmtpTransport;
    },
  ) {}

  async sendTestEmail(
    input: DnaSmtpTestEmailInput,
  ): Promise<DnaSmtpTestEmailResult> {
    let message: Buffer | undefined;

    try {
      const { senderAddress, testRecipient, username } =
        normalizeDnaTestConfiguration(input);
      message = buildInvoiceMimeMessage({
        body: input.body,
        fromAddress: senderAddress,
        fromName: input.emailSenderName,
        pdfContent: input.pdfContent,
        pdfFileName: input.pdfFileName,
        subject: input.subject,
        to: testRecipient,
      }, {
        messageId: `${normalizeAttemptId(input.attemptId)}@${senderAddress.slice(
          senderAddress.lastIndexOf('@') + 1,
        )}`,
      });
      const password = await this.dependencies.companyEmailSecretReader.getSecret(
        input.companyId,
      );

      if (password === null) {
        throw new DnaSmtpProviderError('DNA_SMTP_SECRET_NOT_CONFIGURED');
      }

      const result = await (this.dependencies.transport ?? defaultTransport)({
        credentials: { password, username },
        envelope: {
          from: senderAddress,
          recipients: [testRecipient],
        },
        message,
      });

      return {
        deliveredTo: testRecipient,
        provider: 'smtp',
        providerMessageId: result.providerMessageId,
        testMode: true,
      };
    } catch (error) {
      throw mapDnaSmtpProviderError(error);
    } finally {
      message?.fill(0);
    }
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
): Promise<SmtpMessageDeliveryResult> {
  return deliverSmtpMessage(input, {
    connect: () => connectImplicitTlsSmtp(dnaSmtpConnectionProfile),
    timeouts: dnaSmtpSessionTimeouts,
  });
}
