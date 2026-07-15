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
  isExactDnaSmtpProfile,
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
    !isExactDnaSmtpProfile(input) ||
    input.companyId.length === 0 ||
    input.companyId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.companyId) ||
    input.emailUsername.length === 0 ||
    input.emailTestRecipientOverride.length === 0
  ) {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }

  try {
    return {
      senderAddress: normalizeEmailAddress(input.emailSenderAddress),
      testRecipient: normalizeEmailAddress(input.emailTestRecipientOverride),
      username: normalizeEmailAddress(input.emailUsername),
    };
  } catch {
    throw new DnaSmtpProviderError('DNA_SMTP_CONFIGURATION_INVALID');
  }
}

async function defaultTransport(
  input: SmtpMessageDeliveryInput,
): Promise<SmtpMessageDeliveryResult> {
  return deliverSmtpMessage(input, {
    connect: () => connectImplicitTlsSmtp(dnaSmtpConnectionProfile),
    timeouts: dnaSmtpSessionTimeouts,
  });
}
