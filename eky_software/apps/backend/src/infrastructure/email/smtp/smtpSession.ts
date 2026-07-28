import {
  createLoginAuthenticationToken,
  createPlainAuthenticationToken,
} from './smtpAuthentication.js';
import { parseSmtpCapabilities } from './smtpCapabilityParser.js';
import {
  createEhloCommand,
  createMailFromCommand,
  createRecipientCommand,
} from './smtpCommand.js';
import type { SmtpConnection } from './smtpConnection.js';
import { encodeSmtpData } from './smtpDataEncoder.js';
import { SmtpTransportError } from './smtpErrors.js';
import type { SmtpTransportSecuritySummary } from './smtpTransportSecurity.js';
import type {
  SmtpMessageDeliveryInput,
  SmtpMessageDeliveryResult,
  SmtpReply,
  SmtpSessionState,
} from './smtpTypes.js';
import { emailTransportLimits } from '../emailTransportLimits.js';

export interface SmtpSessionTimeouts {
  authenticationMilliseconds: number;
  commandMilliseconds: number;
  dataMilliseconds: number;
  greetingMilliseconds: number;
  totalMilliseconds: number;
}

export async function deliverSmtpMessage(
  input: SmtpMessageDeliveryInput,
  dependencies: {
    connect(): Promise<SmtpConnection>;
    onConnectionSecured?(
      input: SmtpTransportSecuritySummary & { durationMs: number },
    ): void;
    timeouts: SmtpSessionTimeouts;
  },
): Promise<SmtpMessageDeliveryResult> {
  const state = new SmtpStateMachine();
  const startedAt = Date.now();
  const encodedData = encodeSmtpData(input.message);
  const deadline = Date.now() + dependencies.timeouts.totalMilliseconds;
  let connection: SmtpConnection | undefined;

  try {
    assertEnvelope(input.envelope.recipients);
    connection = await dependencies.connect();
    if (connection.transportSecurity !== undefined) {
      notifyConnectionSecured(
        dependencies.onConnectionSecured,
        connection.transportSecurity,
        Date.now() - startedAt,
      );
    }
    state.transition('awaitingGreeting');
    expectReply(
      await connection.readReply(
        remainingTimeout(
          dependencies.timeouts.greetingMilliseconds,
          deadline,
          'greeting',
        ),
        'greeting',
      ),
      [220],
      'SMTP_GREETING_REJECTED',
      'greeting',
    );

    state.transition('awaitingEhlo');
    const ehloReply = await connection.sendCommand(
      createEhloCommand(),
      remainingTimeout(
        dependencies.timeouts.commandMilliseconds,
        deadline,
        'ehlo',
      ),
      'ehlo',
    );
    expectReply(ehloReply, [250], 'SMTP_PROTOCOL_ERROR', 'ehlo');
    const capabilities = parseSmtpCapabilities(ehloReply);

    state.transition('authenticating');
    await authenticate(
      connection,
      capabilities.authenticationMethods,
      input.credentials,
      remainingTimeout(
        dependencies.timeouts.authenticationMilliseconds,
        deadline,
        'authentication',
      ),
    );

    state.transition('awaitingMailFrom');
    expectReply(
      await connection.sendCommand(
        createMailFromCommand(input.envelope.from),
        remainingTimeout(
          dependencies.timeouts.commandMilliseconds,
          deadline,
          'mailFrom',
        ),
        'mailFrom',
      ),
      [250],
      'SMTP_ENVELOPE_REJECTED',
      'mailFrom',
    );

    state.transition('awaitingRecipient');
    for (const recipient of input.envelope.recipients) {
      expectReply(
        await connection.sendCommand(
          createRecipientCommand(recipient),
          remainingTimeout(
            dependencies.timeouts.commandMilliseconds,
            deadline,
            'recipient',
          ),
          'recipient',
        ),
        [250, 251],
        'SMTP_ENVELOPE_REJECTED',
        'recipient',
      );
    }

    state.transition('awaitingDataPermission');
    expectReply(
      await connection.sendCommand(
        'DATA',
        remainingTimeout(
          dependencies.timeouts.commandMilliseconds,
          deadline,
          'dataPermission',
        ),
        'dataPermission',
      ),
      [354],
      'SMTP_DATA_REJECTED',
      'dataPermission',
    );

    state.transition('sendingData');
    state.transition('awaitingFinalAcceptance');
    const finalReply = await connection.sendData(
      encodedData,
      remainingTimeout(
        dependencies.timeouts.dataMilliseconds,
        deadline,
        'finalAcceptance',
      ),
    );
    expectReply(
      finalReply,
      [250],
      'SMTP_DATA_REJECTED',
      'finalAcceptance',
    );

    state.transition('quitting');
    await connection
      .sendCommand(
        'QUIT',
        remainingTimeout(
          dependencies.timeouts.commandMilliseconds,
          deadline,
          'quit',
        ),
        'quit',
      )
      .catch(() => undefined);
    state.transition('completed');

    return {
      accepted: true,
      providerMessageId: null,
      ...(connection.transportSecurity === undefined
        ? {}
        : { transportSecurity: connection.transportSecurity }),
    };
  } catch (error) {
    state.fail(error);

    if (error instanceof SmtpTransportError) {
      throw error;
    }

    throw new SmtpTransportError('SMTP_CONNECTION_FAILED', state.current);
  } finally {
    encodedData.fill(0);
    connection?.close();
  }
}

function notifyConnectionSecured(
  listener:
    | ((
        input: SmtpTransportSecuritySummary & { durationMs: number },
      ) => void)
    | undefined,
  summary: SmtpTransportSecuritySummary,
  durationMs: number,
): void {
  try {
    listener?.({ ...summary, durationMs });
  } catch {
    // Diagnostics must never change SMTP delivery outcomes.
  }
}

function assertEnvelope(recipients: readonly string[]): void {
  if (
    recipients.length === 0 ||
    recipients.length > emailTransportLimits.maximumRecipients
  ) {
    throw new SmtpTransportError('SMTP_ENVELOPE_REJECTED', 'recipient');
  }
}

function remainingTimeout(
  phaseTimeoutMilliseconds: number,
  deadline: number,
  phase: string,
): number {
  const remainingMilliseconds = deadline - Date.now();

  if (
    !Number.isSafeInteger(phaseTimeoutMilliseconds) ||
    phaseTimeoutMilliseconds <= 0 ||
    remainingMilliseconds <= 0
  ) {
    throw new SmtpTransportError('SMTP_TIMEOUT', phase);
  }

  return Math.min(phaseTimeoutMilliseconds, remainingMilliseconds);
}

async function authenticate(
  connection: SmtpConnection,
  methods: ReadonlySet<'LOGIN' | 'PLAIN'>,
  credentials: { password: string; username: string },
  timeoutMilliseconds: number,
): Promise<void> {
  if (methods.has('PLAIN')) {
    const challenge = await connection.sendCommand(
      'AUTH PLAIN',
      timeoutMilliseconds,
      'authentication',
    );

    if (challenge.code === 235) {
      return;
    }

    expectReply(
      challenge,
      [334],
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
    expectReply(
      await connection.sendSensitiveLine(
        createPlainAuthenticationToken(
          credentials.username,
          credentials.password,
        ),
        timeoutMilliseconds,
        'authentication',
      ),
      [235],
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
    return;
  }

  if (methods.has('LOGIN')) {
    expectReply(
      await connection.sendCommand(
        'AUTH LOGIN',
        timeoutMilliseconds,
        'authentication',
      ),
      [334],
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
    expectReply(
      await connection.sendSensitiveLine(
        createLoginAuthenticationToken(credentials.username),
        timeoutMilliseconds,
        'authentication',
      ),
      [334],
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
    expectReply(
      await connection.sendSensitiveLine(
        createLoginAuthenticationToken(credentials.password),
        timeoutMilliseconds,
        'authentication',
      ),
      [235],
      'SMTP_AUTHENTICATION_FAILED',
      'authentication',
    );
    return;
  }

  throw new SmtpTransportError(
    'SMTP_AUTHENTICATION_UNAVAILABLE',
    'authentication',
  );
}

function expectReply(
  reply: SmtpReply,
  allowedCodes: readonly number[],
  errorCode: ConstructorParameters<typeof SmtpTransportError>[0],
  phase: string,
): void {
  if (!allowedCodes.includes(reply.code)) {
    throw new SmtpTransportError(errorCode, phase);
  }
}

class SmtpStateMachine {
  current: SmtpSessionState = 'connecting';

  transition(next: SmtpSessionState): void {
    const allowedNextStates: Record<SmtpSessionState, readonly SmtpSessionState[]> = {
      connecting: ['awaitingGreeting'],
      awaitingGreeting: ['awaitingEhlo'],
      awaitingEhlo: ['authenticating'],
      authenticating: ['awaitingMailFrom'],
      awaitingMailFrom: ['awaitingRecipient'],
      awaitingRecipient: ['awaitingDataPermission'],
      awaitingDataPermission: ['sendingData'],
      sendingData: ['awaitingFinalAcceptance'],
      awaitingFinalAcceptance: ['quitting'],
      quitting: ['completed'],
      completed: [],
      failed: [],
      outcomeUnknown: [],
    };

    if (!allowedNextStates[this.current].includes(next)) {
      throw new SmtpTransportError('SMTP_PROTOCOL_ERROR', this.current);
    }

    this.current = next;
  }

  fail(error: unknown): void {
    this.current =
      error instanceof SmtpTransportError && error.outcome === 'outcomeUnknown'
        ? 'outcomeUnknown'
        : 'failed';
  }
}
