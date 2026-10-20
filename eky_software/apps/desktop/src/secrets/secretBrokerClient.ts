import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { SecretBrokerError } from './secretBrokerErrors.js';
import {
  createSecretBrokerRequest,
  isSecretBrokerGenerationId,
  matchesSecretBrokerBinding,
  parseSecretBrokerResponse,
  secretBrokerRequestTimeoutMilliseconds,
  type SecretBrokerOperation,
  type SecretBrokerRequest,
  type SecretBrokerSuccessResult,
} from './secretBrokerProtocol.js';
import type { SecretBrokerTransport } from './secretBrokerTransport.js';

interface PendingRequest {
  deadline: number;
  request: SecretBrokerRequest;
  reject(error: SecretBrokerError): void;
  resolve(result: SecretBrokerSuccessResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SetCompanyEmailSecretInput {
  companyId: string;
  operationId?: string;
  secret: string;
}

export class CompanyEmailSecretBrokerClient {
  private closed = false;
  private admissionSealed = false;
  private uncertain: SecretBrokerError | undefined;
  private cleanupFailure: SecretBrokerError | undefined;
  private disposed = false;
  private initializing = true;
  private dispatching = false;
  private active: PendingRequest | undefined;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly now: () => number;
  private readonly generationId: string;
  private unsubscribe: () => void = () => undefined;
  private unsubscribeTerminal: () => void = () => undefined;

  constructor(
    private readonly transport: SecretBrokerTransport,
    options: { generationId: string; now?: () => number },
  ) {
    if (!isSecretBrokerGenerationId(options?.generationId)) {
      throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID', 'noEffect');
    }
    this.generationId = options.generationId;
    this.now = options.now ?? (() => performance.now());
    try {
      this.unsubscribe = transport.subscribe(value => this.receive(value));
      this.unsubscribeTerminal = transport.subscribeTerminal(() => {
        this.fence(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
      });
    } catch {
      this.fence(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
    } finally {
      this.initializing = false;
      if (this.closed) this.dispose();
    }
  }

  assertSettled(): void {
    if (this.uncertain !== undefined) throw this.uncertain;
    if (this.pendingRequests.size !== 0) {
      throw new SecretBrokerError('SECRET_BROKER_UNSETTLED');
    }
  }

  sealAdmission(): void {
    if (this.admissionSealed) return;
    this.admissionSealed = true;
    // Preserve the active receipt and deadline; only unsent work is no-effect.
    this.rejectQueued();
  }

  close(): void {
    if (!this.closed) {
      if (this.active !== undefined) {
        this.fence(new SecretBrokerError('SECRET_BROKER_UNSETTLED'));
      } else {
        this.closed = true;
        this.rejectQueued();
      }
    }
    this.dispose();
    if (this.cleanupFailure !== undefined) throw this.cleanupFailure;
  }

  async getSecret(companyId: string): Promise<string | null> {
    const result = await this.request('readCompanyEmailSecret', companyId);
    if (!('secret' in result)) throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    return result.secret;
  }

  async hasSecret(companyId: string): Promise<boolean> {
    const result = await this.request('hasCompanyEmailSecret', companyId);
    if (!('configured' in result)) throw new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID');
    return result.configured;
  }

  async removeSecret(companyId: string, operationId?: string): Promise<void> {
    await this.request('removeCompanyEmailSecret', companyId, undefined, operationId);
  }

  async setSecret(input: SetCompanyEmailSecretInput): Promise<void> {
    await this.request('setCompanyEmailSecret', input.companyId, input.secret, input.operationId);
  }

  private request(
    operation: SecretBrokerOperation,
    companyId: string,
    secret?: string,
    operationId?: string,
  ): Promise<SecretBrokerSuccessResult> {
    if (this.closed || this.admissionSealed) {
      return Promise.reject(new SecretBrokerError('SECRET_BROKER_GENERATION_CLOSED', 'noEffect'));
    }
    const deadline = this.now() + secretBrokerRequestTimeoutMilliseconds;
    const request = createSecretBrokerRequest({
      companyId,
      generationId: this.generationId,
      operation,
      requestId: operationId === undefined ? randomUUID() : operationId,
      ...(secret === undefined ? {} : { secret }),
    });
    if (this.pendingRequests.has(request.requestId)) {
      return Promise.reject(new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID', 'noEffect'));
    }
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        deadline, request, resolve, reject,
        timer: setTimeout(() => this.expire(pending), Math.max(0, deadline - this.now())),
      };
      this.pendingRequests.set(request.requestId, pending);
      this.dispatch();
    });
  }

  private expire(pending: PendingRequest): void {
    if (!this.pendingRequests.has(pending.request.requestId)) return;
    const remaining = pending.deadline - this.now();
    if (remaining > 0) {
      pending.timer = setTimeout(() => this.expire(pending), remaining);
      return;
    }
    if (pending === this.active) {
      this.fence(new SecretBrokerError('SECRET_BROKER_TIMEOUT'));
    } else {
      this.removePending(pending);
      pending.reject(new SecretBrokerError('SECRET_BROKER_TIMEOUT', 'noEffect'));
      this.dispatch();
    }
  }

  private dispatch(): void {
    if (this.dispatching || this.active !== undefined || this.closed || this.admissionSealed) return;
    this.dispatching = true;
    try {
      while (!this.closed && !this.admissionSealed && this.active === undefined) {
        const pending = this.pendingRequests.values().next().value;
        if (pending === undefined) return;
        if (this.now() >= pending.deadline) {
          this.removePending(pending);
          pending.reject(new SecretBrokerError('SECRET_BROKER_TIMEOUT', 'noEffect'));
          continue;
        }
        this.active = pending;
        try {
          this.transport.send(pending.request);
        } catch {
          this.fence(new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'));
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  private receive(value: unknown): void {
    if (this.closed) return;
    const pending = this.active;
    const response = parseSecretBrokerResponse(value);
    if (pending === undefined || response === undefined ||
        !matchesSecretBrokerBinding(pending.request, response)) {
      this.fence(new SecretBrokerError('SECRET_BROKER_REQUEST_INVALID'));
      return;
    }
    if (this.now() >= pending.deadline) {
      this.fence(new SecretBrokerError('SECRET_BROKER_TIMEOUT'));
      return;
    }
    if (!response.ok && response.effect === 'unknown') {
      this.fence(new SecretBrokerError(response.errorCode));
      return;
    }
    this.removePending(pending);
    this.active = undefined;
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new SecretBrokerError(response.errorCode, 'noEffect'));
    this.dispatch();
  }

  private removePending(pending: PendingRequest): void {
    clearTimeout(pending.timer);
    this.pendingRequests.delete(pending.request.requestId);
  }

  private rejectQueued(): void {
    const queued = [...this.pendingRequests.values()];
    for (const pending of queued) {
      if (pending === this.active) continue;
      this.removePending(pending);
      pending.reject(new SecretBrokerError('SECRET_BROKER_GENERATION_CLOSED', 'noEffect'));
    }
  }

  private fence(error: SecretBrokerError): void {
    if (this.closed) return;
    this.uncertain = error;
    this.closed = true;
    const active = this.active;
    this.active = undefined;
    if (active !== undefined) this.removePending(active);
    this.rejectQueued();
    this.dispose();
    active?.reject(error);
  }

  private dispose(): void {
    if (this.disposed || this.initializing) return;
    this.disposed = true;
    for (const teardown of [this.unsubscribe, this.unsubscribeTerminal, () => this.transport.close()]) {
      try { teardown(); }
      catch {
        this.cleanupFailure ??= new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED');
        this.uncertain ??= this.cleanupFailure;
      }
    }
  }
}
