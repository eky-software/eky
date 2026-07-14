import { randomUUID } from 'node:crypto';

import { SecretBrokerError } from './secretBrokerErrors.js';
import {
  createSecretBrokerRequest,
  parseSecretBrokerResponse,
  readValidRequestId,
  type SecretBrokerOperation,
  type SecretBrokerSuccessResult,
} from './secretBrokerProtocol.js';
import type { SecretBrokerTransport } from './secretBrokerTransport.js';

const defaultRequestTimeoutMilliseconds = 10_000;

interface PendingRequest {
  reject(error: Error): void;
  resolve(result: SecretBrokerSuccessResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SetCompanyEmailSecretInput {
  companyId: string;
  secret: string;
}

export class CompanyEmailSecretBrokerClient {
  private closed = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly requestTimeoutMilliseconds: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: SecretBrokerTransport,
    options: { requestTimeoutMilliseconds?: number } = {},
  ) {
    this.requestTimeoutMilliseconds =
      options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds;

    if (
      !Number.isSafeInteger(this.requestTimeoutMilliseconds) ||
      this.requestTimeoutMilliseconds < 100 ||
      this.requestTimeoutMilliseconds > 30_000
    ) {
      throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    }

    this.unsubscribe = transport.subscribe((value) => this.receive(value));
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.unsubscribe();
    this.transport.close();

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE'));
    }

    this.pendingRequests.clear();
  }

  async getSecret(companyId: string): Promise<string | null> {
    try {
      const result = await this.request('readCompanyEmailSecret', companyId);

      if (!('secret' in result)) {
        throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
      }

      return result.secret;
    } catch (error) {
      if (
        error instanceof SecretBrokerError &&
        error.code === 'SECRET_NOT_CONFIGURED'
      ) {
        return null;
      }

      throw error;
    }
  }

  async hasSecret(companyId: string): Promise<boolean> {
    const result = await this.request('hasCompanyEmailSecret', companyId);

    if (!('configured' in result)) {
      throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    }

    return result.configured;
  }

  async removeSecret(companyId: string): Promise<void> {
    const result = await this.request('removeCompanyEmailSecret', companyId);

    if (!('configured' in result) || result.configured) {
      throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    }
  }

  async setSecret(input: SetCompanyEmailSecretInput): Promise<void> {
    const result = await this.request(
      'setCompanyEmailSecret',
      input.companyId,
      input.secret,
    );

    if (!('configured' in result) || !result.configured) {
      throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    }
  }

  private receive(value: unknown): void {
    const requestId = readValidRequestId(value);

    if (requestId === undefined) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);

    if (pending === undefined) {
      return;
    }

    const response = parseSecretBrokerResponse(value);
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);

    if (response === undefined) {
      pending.reject(new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID'));
      return;
    }

    if (!response.ok) {
      pending.reject(new SecretBrokerError(response.errorCode));
      return;
    }

    pending.resolve(response.result);
  }

  private request(
    operation: SecretBrokerOperation,
    companyId: string,
    secret?: string,
  ): Promise<SecretBrokerSuccessResult> {
    if (this.closed) {
      return Promise.reject(
        new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE'),
      );
    }

    const requestId = randomUUID();
    const request = createSecretBrokerRequest({
      companyId,
      operation,
      requestId,
      ...(secret === undefined ? {} : { secret }),
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE'));
      }, this.requestTimeoutMilliseconds);

      this.pendingRequests.set(requestId, {
        reject,
        resolve,
        timer,
      });

      try {
        this.transport.send(request);
      } catch {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE'));
      }
    });
  }
}
