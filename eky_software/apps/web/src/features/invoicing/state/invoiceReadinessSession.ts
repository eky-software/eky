import type { InvoiceIssuanceReadiness } from '@eky/api-client';

export interface InvoiceReadinessContext {
  draftId: string | null;
  formRevision: number;
  isSaved: boolean;
}

export interface InvoiceReadinessSnapshot {
  readiness: InvoiceIssuanceReadiness | null;
  errorMessage: string | null;
  isChecking: boolean;
}

interface ReadinessRequest {
  readonly draftId: string;
  readonly formRevision: number;
}

// One instance belongs to one keyed editor session, not to a backend authority.
export class InvoiceReadinessSession {
  private active = false;
  private context: InvoiceReadinessContext;
  private request: ReadinessRequest | null = null;
  private snapshot: InvoiceReadinessSnapshot = emptySnapshot();

  constructor(context: InvoiceReadinessContext) {
    this.context = { ...context };
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.clear();
    }
  }

  updateContext(context: InvoiceReadinessContext): void {
    if (
      context.draftId !== this.context.draftId ||
      context.formRevision !== this.context.formRevision ||
      context.isSaved !== this.context.isSaved
    ) {
      this.clear();
      this.context = { ...context };
    }
  }

  getSnapshot(): InvoiceReadinessSnapshot {
    return { ...this.snapshot };
  }

  clear(): void {
    this.request = null;
    this.snapshot = emptySnapshot();
  }

  begin(): ReadinessRequest | null {
    if (
      !this.active || !this.context.isSaved ||
      this.context.draftId === null || this.request !== null
    ) {
      return null;
    }
    this.request = {
      draftId: this.context.draftId,
      formRevision: this.context.formRevision,
    };
    this.snapshot = { ...emptySnapshot(), isChecking: true };
    return this.request;
  }

  succeed(request: ReadinessRequest, readiness: InvoiceIssuanceReadiness): boolean {
    if (!this.owns(request)) {
      return false;
    }
    this.request = null;
    this.snapshot = { readiness, errorMessage: null, isChecking: false };
    return true;
  }

  fail(request: ReadinessRequest, errorMessage: string): boolean {
    if (!this.owns(request)) {
      return false;
    }
    this.request = null;
    this.snapshot = { readiness: null, errorMessage, isChecking: false };
    return true;
  }

  canConfirm(): boolean {
    return this.active && this.context.isSaved &&
      this.context.draftId !== null && this.snapshot.readiness?.isReady === true;
  }

  private owns(request: ReadinessRequest): boolean {
    return this.active && this.request === request && this.context.isSaved &&
      this.context.draftId === request.draftId &&
      this.context.formRevision === request.formRevision;
  }
}

function emptySnapshot(): InvoiceReadinessSnapshot {
  return { readiness: null, errorMessage: null, isChecking: false };
}
