import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';

import { assertSafeSmtpCommand } from './smtpCommand.js';
import { SmtpTransportError } from './smtpErrors.js';
import { SmtpReplyParser } from './smtpReplyParser.js';
import type { SmtpReply } from './smtpTypes.js';

export interface ImplicitTlsSmtpConnectionOptions {
  ca?: Buffer | string;
  connectionTimeoutMilliseconds: number;
  host: string;
  idleTimeoutMilliseconds: number;
  minVersion: 'TLSv1.2';
  port: number;
  servername: string;
}

export interface SmtpConnection {
  close(): void;
  readReply(timeoutMilliseconds: number, phase: string): Promise<SmtpReply>;
  sendCommand(
    command: string,
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply>;
  sendData(
    data: Buffer,
    timeoutMilliseconds: number,
  ): Promise<SmtpReply>;
  sendSensitiveLine(
    token: Buffer,
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply>;
}

type TlsConnectImplementation = (
  options: ConnectionOptions,
) => TLSSocket;

export async function connectImplicitTlsSmtp(
  options: ImplicitTlsSmtpConnectionOptions,
  connectImplementation: TlsConnectImplementation = (socketOptions) =>
    connect(socketOptions),
): Promise<SmtpConnection> {
  const socketOptions: ConnectionOptions = {
    host: options.host,
    minVersion: options.minVersion,
    port: options.port,
    rejectUnauthorized: true,
    servername: options.servername,
    ...(options.ca === undefined ? {} : { ca: options.ca }),
  };

  return new Promise((resolve, reject) => {
    const socket = connectImplementation(socketOptions);
    let settled = false;
    const timer = setTimeout(() => {
      fail(new SmtpTransportError('SMTP_TIMEOUT', 'connect'));
    }, options.connectionTimeoutMilliseconds);

    const fail = (error: SmtpTransportError): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };

    socket.once('error', (error) => {
      fail(
        new SmtpTransportError(
          isTlsValidationError(error)
            ? 'SMTP_TLS_FAILED'
            : 'SMTP_CONNECTION_FAILED',
          'connect',
        ),
      );
    });
    socket.once('secureConnect', () => {
      if (settled) {
        return;
      }

      const protocol = socket.getProtocol();

      if (
        !socket.authorized ||
        socket.authorizationError != null ||
        (protocol !== 'TLSv1.2' && protocol !== 'TLSv1.3')
      ) {
        fail(new SmtpTransportError('SMTP_TLS_FAILED', 'connect'));
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.setTimeout(options.idleTimeoutMilliseconds);
      resolve(new TlsSmtpConnection(socket));
    });
  });
}

class TlsSmtpConnection implements SmtpConnection {
  private closed = false;
  private initialGreeting: SmtpReply | undefined;
  private initialGreetingWindowOpen = true;
  private pendingRead:
    | {
        reject(error: Error): void;
        resolve(reply: SmtpReply): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private readonly replyParser = new SmtpReplyParser();
  private terminalError: SmtpTransportError | undefined;

  constructor(private readonly socket: TLSSocket) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.once('error', () => this.failPending(connectionClosedError()));
    socket.once('close', () => this.failPending(connectionClosedError()));
    socket.once('timeout', () => {
      this.failPending(new SmtpTransportError('SMTP_TIMEOUT', 'idle'));
      socket.destroy();
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socket.destroy();
    this.failPending(connectionClosedError());
  }

  async readReply(
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply> {
    const initialGreeting = this.initialGreeting;

    if (initialGreeting !== undefined) {
      this.initialGreeting = undefined;
      this.initialGreetingWindowOpen = false;
      return initialGreeting;
    }

    this.initialGreetingWindowOpen = false;
    return this.beginRead(timeoutMilliseconds, phase);
  }

  async sendCommand(
    command: string,
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply> {
    assertSafeSmtpCommand(command);
    const reply = this.beginRead(timeoutMilliseconds, phase);

    try {
      await this.write(Buffer.from(`${command}\r\n`, 'ascii'), phase);
    } catch (error) {
      this.failPending(asTransportError(error, phase));
    }

    return reply;
  }

  async sendSensitiveLine(
    token: Buffer,
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply> {
    const line = Buffer.concat([token, Buffer.from('\r\n', 'ascii')]);
    const reply = this.beginRead(timeoutMilliseconds, phase);

    try {
      await this.write(line, phase);
    } catch (error) {
      this.failPending(asTransportError(error, phase));
    } finally {
      token.fill(0);
      line.fill(0);
    }

    return reply;
  }

  async sendData(
    data: Buffer,
    timeoutMilliseconds: number,
  ): Promise<SmtpReply> {
    const reply = this.beginRead(
      timeoutMilliseconds,
      'finalAcceptance',
    );

    try {
      await this.write(data, 'data');
    } catch {
      this.failPending(
        new SmtpTransportError(
          'SMTP_OUTCOME_UNKNOWN',
          'data',
          'outcomeUnknown',
        ),
      );
      return reply;
    }

    try {
      return await reply;
    } catch {
      throw new SmtpTransportError(
        'SMTP_OUTCOME_UNKNOWN',
        'finalAcceptance',
        'outcomeUnknown',
      );
    }
  }

  private beginRead(
    timeoutMilliseconds: number,
    phase: string,
  ): Promise<SmtpReply> {
    if (this.terminalError !== undefined || this.closed) {
      return Promise.reject(
        this.terminalError ?? connectionClosedError(phase),
      );
    }

    if (this.pendingRead !== undefined) {
      return Promise.reject(
        new SmtpTransportError('SMTP_PROTOCOL_ERROR', phase),
      );
    }

    const reply = new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRead = undefined;
        reject(new SmtpTransportError('SMTP_TIMEOUT', phase));
      }, timeoutMilliseconds);

      this.pendingRead = { reject, resolve, timer };
    });

    void reply.catch(() => undefined);
    return reply;
  }

  private failPending(error: SmtpTransportError): void {
    this.terminalError ??= error;

    if (this.pendingRead !== undefined) {
      clearTimeout(this.pendingRead.timer);
      this.pendingRead.reject(this.terminalError);
      this.pendingRead = undefined;
    }
  }

  private receive(chunk: Buffer): void {
    if (this.closed || this.terminalError !== undefined) {
      return;
    }

    let replies: SmtpReply[];

    try {
      replies = this.replyParser.push(chunk);
    } catch {
      const error = new SmtpTransportError(
        'SMTP_PROTOCOL_ERROR',
        'reply',
      );
      this.terminalError = error;
      this.failPending(error);
      this.socket.destroy();
      return;
    }

    for (const reply of replies) {
      if (this.pendingRead !== undefined) {
        const pendingRead = this.pendingRead;
        this.pendingRead = undefined;
        clearTimeout(pendingRead.timer);
        pendingRead.resolve(reply);
      } else if (
        this.initialGreetingWindowOpen &&
        this.initialGreeting === undefined &&
        replies.length === 1
      ) {
        this.initialGreeting = reply;
      } else {
        const error = new SmtpTransportError(
          'SMTP_PROTOCOL_ERROR',
          'reply',
        );
        this.terminalError = error;
        this.failPending(error);
        this.socket.destroy();
        return;
      }
    }
  }

  private write(data: Buffer, phase: string): Promise<void> {
    if (this.closed || this.terminalError !== undefined) {
      return Promise.reject(
        new SmtpTransportError('SMTP_CONNECTION_CLOSED', phase),
      );
    }

    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => {
        if (error != null) {
          reject(new SmtpTransportError('SMTP_CONNECTION_CLOSED', phase));
          return;
        }

        resolve();
      });
    });
  }
}

function connectionClosedError(phase = 'connection'): SmtpTransportError {
  return new SmtpTransportError('SMTP_CONNECTION_CLOSED', phase);
}

function asTransportError(error: unknown, phase: string): SmtpTransportError {
  return error instanceof SmtpTransportError
    ? error
    : new SmtpTransportError('SMTP_CONNECTION_CLOSED', phase);
}

function isTlsValidationError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? '';

  return (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_CERT_') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  );
}
