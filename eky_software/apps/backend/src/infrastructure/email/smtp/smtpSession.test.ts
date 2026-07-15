import { describe, expect, it } from 'vitest';

import type { SmtpConnection } from './smtpConnection.js';
import { SmtpTransportError } from './smtpErrors.js';
import { deliverSmtpMessage } from './smtpSession.js';
import type { SmtpReply } from './smtpTypes.js';

const defaultTimeouts = {
  authenticationMilliseconds: 1_000,
  commandMilliseconds: 1_000,
  dataMilliseconds: 1_000,
  greetingMilliseconds: 1_000,
  totalMilliseconds: 10_000,
};

describe('deliverSmtpMessage', () => {
  it('delivers with advertised AUTH PLAIN and never exposes credentials as commands', async () => {
    const connection = new FakeSmtpConnection('PLAIN');

    await expect(
      deliverSmtpMessage(createInput(), {
        connect: async () => connection,
        timeouts: defaultTimeouts,
      }),
    ).resolves.toEqual({ accepted: true, providerMessageId: null });

    expect(connection.commands).toEqual([
      'EHLO [127.0.0.1]',
      'AUTH PLAIN',
      'MAIL FROM:<billing@example.com>',
      'RCPT TO:<recipient@example.com>',
      'DATA',
      'QUIT',
    ]);
    expect(connection.sensitiveTokens).toEqual([
      Buffer.from('\0billing@example.com\0secret-value').toString('base64'),
    ]);
    expect(connection.data?.toString('ascii')).toBe(
      'MIME message\r\n.\r\n',
    );
    expect(connection.closed).toBe(true);
  });

  it('falls back only to advertised AUTH LOGIN', async () => {
    const connection = new FakeSmtpConnection('LOGIN');

    await deliverSmtpMessage(createInput(), {
      connect: async () => connection,
      timeouts: defaultTimeouts,
    });

    expect(connection.commands).toContain('AUTH LOGIN');
    expect(connection.sensitiveTokens).toEqual([
      Buffer.from('billing@example.com').toString('base64'),
      Buffer.from('secret-value').toString('base64'),
    ]);
  });

  it('fails closed when the server advertises no supported authentication', async () => {
    const connection = new FakeSmtpConnection('NONE');

    await expect(
      deliverSmtpMessage(createInput(), {
        connect: async () => connection,
        timeouts: defaultTimeouts,
      }),
    ).rejects.toMatchObject({ code: 'SMTP_AUTHENTICATION_UNAVAILABLE' });
    expect(connection.commands).not.toContain(
      'MAIL FROM:<billing@example.com>',
    );
  });

  it('reports an unknown outcome after DATA was written but final acceptance is lost', async () => {
    const connection = new FakeSmtpConnection('PLAIN');
    connection.finalDataError = new SmtpTransportError(
      'SMTP_OUTCOME_UNKNOWN',
      'finalAcceptance',
      'outcomeUnknown',
    );

    await expect(
      deliverSmtpMessage(createInput(), {
        connect: async () => connection,
        timeouts: defaultTimeouts,
      }),
    ).rejects.toMatchObject({
      code: 'SMTP_OUTCOME_UNKNOWN',
      outcome: 'outcomeUnknown',
    });
    expect(connection.commands.filter((command) => command === 'DATA')).toHaveLength(
      1,
    );
  });

  it('rejects an empty recipient list before opening a connection', async () => {
    let connectCalls = 0;

    await expect(
      deliverSmtpMessage(
        {
          ...createInput(),
          envelope: { from: 'billing@example.com', recipients: [] },
        },
        {
          connect: async () => {
            connectCalls += 1;
            return new FakeSmtpConnection('PLAIN');
          },
          timeouts: defaultTimeouts,
        },
      ),
    ).rejects.toMatchObject({ code: 'SMTP_ENVELOPE_REJECTED' });
    expect(connectCalls).toBe(0);
  });
});

function createInput() {
  return {
    credentials: {
      password: 'secret-value',
      username: 'billing@example.com',
    },
    envelope: {
      from: 'billing@example.com',
      recipients: ['recipient@example.com'],
    },
    message: Buffer.from('MIME message\r\n', 'ascii'),
  };
}

class FakeSmtpConnection implements SmtpConnection {
  closed = false;
  commands: string[] = [];
  data: Buffer | undefined;
  finalDataError: Error | undefined;
  sensitiveTokens: string[] = [];
  private authenticationStep = 0;

  constructor(private readonly authMode: 'LOGIN' | 'NONE' | 'PLAIN') {}

  close(): void {
    this.closed = true;
  }

  async readReply(): Promise<SmtpReply> {
    return reply(220, 'smtp.example.test ready');
  }

  async sendCommand(command: string): Promise<SmtpReply> {
    this.commands.push(command);

    if (command.startsWith('EHLO')) {
      const authLine =
        this.authMode === 'NONE' ? 'SIZE 1000000' : `AUTH ${this.authMode}`;
      return {
        code: 250,
        lines: [
          { code: 250, separator: '-', text: 'smtp.example.test' },
          { code: 250, separator: ' ', text: authLine },
        ],
      };
    }

    if (command === 'AUTH PLAIN' || command === 'AUTH LOGIN') {
      return reply(334, 'challenge');
    }

    if (command === 'DATA') {
      return reply(354, 'continue');
    }

    if (command === 'QUIT') {
      return reply(221, 'bye');
    }

    return reply(250, 'accepted');
  }

  async sendData(data: Buffer): Promise<SmtpReply> {
    this.data = Buffer.from(data);

    if (this.finalDataError !== undefined) {
      throw this.finalDataError;
    }

    return reply(250, 'queued');
  }

  async sendSensitiveLine(token: Buffer): Promise<SmtpReply> {
    this.sensitiveTokens.push(token.toString('ascii'));
    token.fill(0);
    this.authenticationStep += 1;

    if (this.authMode === 'LOGIN' && this.authenticationStep === 1) {
      return reply(334, 'password');
    }

    return reply(235, 'authenticated');
  }
}

function reply(code: number, text: string): SmtpReply {
  return {
    code,
    lines: [{ code, separator: ' ', text }],
  };
}
