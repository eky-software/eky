import { EventEmitter } from 'node:events';
import type { ConnectionOptions, TLSSocket } from 'node:tls';

import { describe, expect, it, vi } from 'vitest';

import { connectImplicitTlsSmtp } from './smtpConnection.js';

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

class FakeTlsSocket extends EventEmitter {
  authorizationError: Error | null = null;
  authorized = true;
  destroyedByClient = false;
  protocol: string | null = 'TLSv1.3';
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

  setTimeout(timeoutMilliseconds: number): this {
    this.timeoutMilliseconds = timeoutMilliseconds;
    return this;
  }

  write(
    data: Uint8Array,
    callback?: (error?: Error | null) => void,
  ): boolean {
    this.writes.push(Buffer.from(data));
    callback?.();
    return true;
  }
}
