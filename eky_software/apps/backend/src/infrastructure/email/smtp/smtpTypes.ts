export interface SmtpReplyLine {
  code: number;
  separator: '-' | ' ';
  text: string;
}

export interface SmtpReply {
  code: number;
  lines: SmtpReplyLine[];
}

export type SmtpSessionState =
  | 'connecting'
  | 'awaitingGreeting'
  | 'awaitingEhlo'
  | 'authenticating'
  | 'awaitingMailFrom'
  | 'awaitingRecipient'
  | 'awaitingDataPermission'
  | 'sendingData'
  | 'awaitingFinalAcceptance'
  | 'quitting'
  | 'completed'
  | 'failed'
  | 'outcomeUnknown';

export interface SmtpCredentials {
  password: string;
  username: string;
}

export interface SmtpEnvelope {
  from: string;
  recipients: string[];
}

export interface SmtpMessageDeliveryInput {
  credentials: SmtpCredentials;
  envelope: SmtpEnvelope;
  message: Uint8Array;
}

export interface SmtpMessageDeliveryResult {
  accepted: true;
  providerMessageId: string | null;
  transportSecurity?: SmtpTransportSecuritySummary;
}
import type { SmtpTransportSecuritySummary } from './smtpTransportSecurity.js';
