import { EventEmitter } from 'node:events';
import type { ConnectionOptions, TLSSocket } from 'node:tls';

import { describe, expect, it, vi } from 'vitest';

import { connectImplicitTlsSmtp } from './smtpConnection.js';
import { deliverSmtpMessage } from './smtpSession.js';
import { emailTransportLimits } from '../emailTransportLimits.js';

describe('connectImplicitTlsSmtp', () => {
  it('requires certificate verification, hostname verification and TLS 1.2+', async () => {
    const socket = new FakeTlsSocket();
    let receivedOptions: ConnectionOptions | undefined;
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      (options) => {
        receivedOptions = options;
        return socket.asTlsSocket();
      },
    );

    expect(receivedOptions).toMatchObject({
      host: '127.0.0.1',
      minVersion: 'TLSv1.2',
      port: 2465,
      rejectUnauthorized: true,
      servername: 'smtp.example.test',
    });

    let resolved = false;
    void connectionPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    socket.emit('secureConnect');
    const connection = await connectionPromise;
    expect(socket.timeoutMilliseconds).toBe(5_000);
    connection.close();
  });

  it('accepts an authorized TLS socket when authorizationError is undefined', async () => {
    const socket = new FakeTlsSocket();
    socket.authorizationError = undefined;
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).resolves.toBeDefined();
  });

  it('captures bounded transport diagnostics only for an explicit DNA profile', async () => {
    const socket = new FakeTlsSocket();
    const connectionPromise = connectImplicitTlsSmtp(
      {
        ...createOptions(),
        diagnosticsProfile: {
          smtpProfile: 'dnaSmtp',
          targetPort: 465,
        },
        port: 465,
      },
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).resolves.toMatchObject({
      transportSecurity: {
        cipherName: 'TLS_AES_256_GCM_SHA384',
        peerCertificateFingerprint256: certificateFingerprint256,
        remoteAddress: '192.0.2.10',
        remoteFamily: 'IPv4',
        smtpProfile: 'dnaSmtp',
        targetPort: 465,
        tlsVersion: 'TLSv1.3',
      },
    });
  });

  it.each([
    {
      name: 'the certificate fingerprint is unavailable',
      configure(socket: FakeTlsSocket) {
        socket.certificateFingerprint256 = undefined;
      },
    },
    {
      name: 'the negotiated cipher is not in the diagnostic allowlist',
      configure(socket: FakeTlsSocket) {
        socket.cipherName = 'TLS_SYNTHETIC_SAFE_CIPHER';
      },
    },
  ])(
    'keeps an authorized TLS connection when $name',
    async ({ configure }) => {
      const socket = new FakeTlsSocket();
      configure(socket);
      const connectionPromise = connectImplicitTlsSmtp(
        {
          ...createOptions(),
          diagnosticsProfile: {
            smtpProfile: 'dnaSmtp',
            targetPort: 465,
          },
          port: 465,
        },
        () => socket.asTlsSocket(),
      );

      socket.emit('secureConnect');

      await expect(connectionPromise).resolves.toMatchObject({
        transportSecurity: undefined,
      });
    },
  );

  it('fails closed when a DNA diagnostics profile does not match the target port', async () => {
    const socket = new FakeTlsSocket();
    const connectionPromise = connectImplicitTlsSmtp(
      {
        ...createOptions(),
        diagnosticsProfile: {
          smtpProfile: 'dnaSmtp',
          targetPort: 465,
        },
      },
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).rejects.toMatchObject({
      code: 'SMTP_TLS_FAILED',
    });
  });

  it('fails closed when the certificate is not authorized', async () => {
    const socket = new FakeTlsSocket();
    socket.authorized = false;
    socket.authorizationError = new Error('synthetic certificate failure');
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).rejects.toMatchObject({
      code: 'SMTP_TLS_FAILED',
    });
    expect(socket.destroyedByClient).toBe(true);
  });

  it('fails closed when hostname validation fails', async () => {
    const socket = new FakeTlsSocket();
    socket.authorized = false;
    socket.authorizationError = new Error(
      'Host: smtp.example.test is not in the certificate alt names',
    );
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).rejects.toMatchObject({
      code: 'SMTP_TLS_FAILED',
    });
    expect(socket.destroyedByClient).toBe(true);
  });

  it('rejects a negotiated protocol older than TLS 1.2', async () => {
    const socket = new FakeTlsSocket();
    socket.protocol = 'TLSv1.1';
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );

    socket.emit('secureConnect');

    await expect(connectionPromise).rejects.toMatchObject({
      code: 'SMTP_TLS_FAILED',
    });
  });

  it('times out a stalled TLS connection without sending SMTP commands', async () => {
    vi.useFakeTimers();
    const socket = new FakeTlsSocket();

    try {
      const connectionPromise = connectImplicitTlsSmtp(
        { ...createOptions(), connectionTimeoutMilliseconds: 100 },
        () => socket.asTlsSocket(),
      );
      const rejection = expect(connectionPromise).rejects.toMatchObject({
        code: 'SMTP_TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(socket.writes).toEqual([]);
      expect(socket.destroyedByClient).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an unsolicited reply after the expected greeting', async () => {
    const socket = new FakeTlsSocket();
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );
    socket.emit('secureConnect');
    const connection = await connectionPromise;

    socket.emit('data', Buffer.from('220 smtp.example.test ready\r\n', 'ascii'));
    await expect(connection.readReply(1_000, 'greeting')).resolves.toMatchObject({
      code: 220,
    });

    socket.emit('data', Buffer.from('250 unsolicited\r\n', 'ascii'));

    await expect(connection.readReply(1_000, 'next')).rejects.toMatchObject({
      code: 'SMTP_PROTOCOL_ERROR',
    });
    expect(socket.destroyedByClient).toBe(true);
  });

  it.each(['combined', 'split'] as const)(
    'accepts a bounded multiline reply through the real connection parser: %s',
    async (partition) => {
      const socket = new FakeTlsSocket();
      const connecting = connectImplicitTlsSmtp(createOptions(), () => socket.asTlsSocket());
      socket.emit('secureConnect');
      const connection = await connecting;
      try {
        socket.emit('data', Buffer.from('220 ready\r\n'));
        await connection.readReply(1_000, 'greeting');
        const command = connection.sendCommand('EHLO localhost', 1_000, 'ehlo');
        const text = 'x'.repeat(emailTransportLimits.maximumReplyLineBytes - 4);
        const lines = [`250-${text}\r\n`, '250 AUTH PLAIN\r\n'];
        for (const chunk of partition === 'combined' ? [lines.join('')] : lines) {
          socket.emit('data', Buffer.from(chunk));
        }
        await expect(command).resolves.toEqual({
          code: 250,
          lines: [
            { code: 250, separator: '-', text },
            { code: 250, separator: ' ', text: 'AUTH PLAIN' },
          ],
        });
        expect(socket.destroyedByClient).toBe(false);
      } finally {
        connection.close();
      }
      expect(socket.destroyedByClient).toBe(true);
    },
  );

  it('preserves final acceptance when QUIT expires through the connection timer', async () => {
    vi.useFakeTimers();
    const socket = new FakeTlsSocket();
    const responses = [
      '250-server\r\n250 AUTH PLAIN\r\n',
      '334 challenge\r\n',
      '235 authenticated\r\n',
      '250 sender\r\n',
      '250 recipient\r\n',
      '354 send data\r\n',
      '250 accepted\r\n',
    ];
    const write = socket.write.bind(socket);
    const writeSpy = vi.spyOn(socket, 'write').mockImplementation((data, callback) => {
      const result = write(data, callback);
      const response = responses.shift();
      if (response !== undefined) socket.emit('data', Buffer.from(response));
      return result;
    });

    try {
      const connecting = connectImplicitTlsSmtp(createOptions(), () => socket.asTlsSocket());
      socket.emit('secureConnect');
      const connection = await connecting;
      socket.emit('data', Buffer.from('220 ready\r\n'));
      const delivery = deliverSmtpMessage({
        credentials: { username: 'billing@example.com', password: 'synthetic-password' },
        envelope: { from: 'billing@example.com', recipients: ['recipient@example.com'] },
        message: Buffer.from('Synthetic MIME message\r\n'),
      }, {
        connect: async () => connection,
        timeouts: {
          authenticationMilliseconds: 1_000,
          commandMilliseconds: 1_000,
          dataMilliseconds: 1_000,
          greetingMilliseconds: 1_000,
          totalMilliseconds: 10_000,
        },
      });
      let settled = false;
      const result = delivery.then((value) => { settled = true; return value; });
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.writes.at(-1)?.toString('ascii')).toBe('QUIT\r\n');
      expect(responses).toEqual([]);
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ accepted: true, providerMessageId: null });
      expect(socket.writes.filter((value) => value.toString('ascii') === 'DATA\r\n')).toHaveLength(1);
      expect(socket.destroyedByClient).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      writeSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rejects a second reply for one command instead of reusing it later', async () => {
    const socket = new FakeTlsSocket();
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );
    socket.emit('secureConnect');
    const connection = await connectionPromise;
    socket.emit('data', Buffer.from('220 smtp.example.test ready\r\n', 'ascii'));
    await connection.readReply(1_000, 'greeting');

    const command = connection.sendCommand('EHLO localhost', 1_000, 'ehlo');
    socket.emit(
      'data',
      Buffer.from('250 first\r\n250 unexpected-second\r\n', 'ascii'),
    );

    await expect(command).resolves.toMatchObject({ code: 250 });
    await expect(
      connection.sendCommand('QUIT', 1_000, 'quit'),
    ).rejects.toMatchObject({ code: 'SMTP_PROTOCOL_ERROR' });
    expect(socket.destroyedByClient).toBe(true);
  });

  it('treats a write failure during message data as an unknown outcome', async () => {
    const socket = new FakeTlsSocket();
    const connectionPromise = connectImplicitTlsSmtp(
      createOptions(),
      () => socket.asTlsSocket(),
    );
    socket.emit('secureConnect');
    const connection = await connectionPromise;
    socket.emit('data', Buffer.from('220 smtp.example.test ready\r\n', 'ascii'));
    await connection.readReply(1_000, 'greeting');
    socket.nextWriteError = new Error('synthetic interrupted write');

    await expect(
      connection.sendData(Buffer.from('message\r\n.\r\n'), 1_000),
    ).rejects.toMatchObject({
      code: 'SMTP_OUTCOME_UNKNOWN',
      outcome: 'outcomeUnknown',
    });
  });
});

function createOptions() {
  return {
    connectionTimeoutMilliseconds: 1_000,
    host: '127.0.0.1',
    idleTimeoutMilliseconds: 5_000,
    minVersion: 'TLSv1.2' as const,
    port: 2465,
    servername: 'smtp.example.test',
  };
}

const certificateFingerprint256 = Array.from(
  { length: 32 },
  (_, index) => index.toString(16).padStart(2, '0').toUpperCase(),
).join(':');

class FakeTlsSocket extends EventEmitter {
  authorizationError: Error | null | undefined = null;
  authorized = true;
  certificateFingerprint256: string | undefined =
    certificateFingerprint256;
  cipherName = 'TLS_AES_256_GCM_SHA384';
  destroyedByClient = false;
  nextWriteError: Error | undefined;
  protocol: string | null = 'TLSv1.3';
  remoteAddress = '192.0.2.10';
  remoteFamily = 'IPv4';
  timeoutMilliseconds: number | undefined;
  writes: Buffer[] = [];

  asTlsSocket(): TLSSocket {
    return this as unknown as TLSSocket;
  }

  destroy(): this {
    this.destroyedByClient = true;
    return this;
  }

  getProtocol(): string | null {
    return this.protocol;
  }

  getCipher() {
    return {
      name: this.cipherName,
      standardName: this.cipherName,
      version: 'TLSv1.3',
    };
  }

  getPeerCertificate() {
    return {
      fingerprint256: this.certificateFingerprint256,
    };
  }

  setTimeout(timeoutMilliseconds: number): this {
    this.timeoutMilliseconds = timeoutMilliseconds;
    return this;
  }

  write(
    data: Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.writes.push(Buffer.from(data));
    const error = this.nextWriteError;

    this.nextWriteError = undefined;
    callback?.(error);
    return true;
  }
}
