import type { InvoiceDraft } from '@eky/api-client';

export type InvoiceDraftSaveMode =
  | { type: 'create' }
  | { draftId: string; type: 'edit' };

export type InvoiceDraftSaveSource = 'auto' | 'manual';

export interface InvoiceDraftSaveRequest {
  readonly mode: InvoiceDraftSaveMode;
  readonly revision: number;
  readonly source: InvoiceDraftSaveSource;
}

export interface InvoiceDraftSaveSnapshot {
  revision: number;
  savedRevision: number;
  lastAttemptedRevision: number;
  isSaving: boolean;
  isCreateOutcomeUnknown: boolean;
  errorMessage: string | null;
  savedDraft: InvoiceDraft | null;
  savedBy: InvoiceDraftSaveSource | null;
}

// One instance belongs to one keyed editor session, including create -> edit.
export class InvoiceDraftSaveSession {
  private active = false;
  private target: InvoiceDraftSaveMode;
  private request: InvoiceDraftSaveRequest | null = null;
  private snapshot: InvoiceDraftSaveSnapshot;

  constructor(mode: InvoiceDraftSaveMode) {
    this.target = mode;
    this.snapshot = {
      revision: 0,
      savedRevision: mode.type === 'edit' ? 0 : -1,
      lastAttemptedRevision: -1,
      isSaving: false,
      isCreateOutcomeUnknown: false,
      errorMessage: null,
      savedDraft: null,
      savedBy: null,
    };
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  getSnapshot(): InvoiceDraftSaveSnapshot {
    return this.snapshot;
  }

  isSaved(): boolean {
    return (
      this.active &&
      !this.snapshot.isSaving &&
      !this.snapshot.isCreateOutcomeUnknown &&
      this.snapshot.savedRevision === this.snapshot.revision
    );
  }

  markEdited(): void {
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
    };
    this.clearError();
  }

  clearError(): void {
    if (!this.snapshot.isCreateOutcomeUnknown) {
      this.snapshot = { ...this.snapshot, errorMessage: null };
    }
  }

  begin(
    revision: number,
    source: InvoiceDraftSaveSource,
  ): InvoiceDraftSaveRequest | null {
    if (
      !this.active || this.request !== null ||
      this.snapshot.isCreateOutcomeUnknown ||
      revision !== this.snapshot.revision || this.isSaved() ||
      (source === 'auto' && revision === this.snapshot.lastAttemptedRevision)
    ) {
      return null;
    }

    const request = { mode: this.target, revision, source };
    this.request = request;
    this.snapshot = {
      ...this.snapshot,
      isSaving: true,
      lastAttemptedRevision: revision,
      errorMessage: null,
    };
    return request;
  }

  succeed(
    request: InvoiceDraftSaveRequest,
    draft: InvoiceDraft,
  ): { isCurrentRevision: boolean } | null {
    if (!this.active || request !== this.request) {
      return null;
    }

    // Retain the created ID before allowing another write, even with newer edits.
    this.target = { type: 'edit', draftId: draft.id };
    this.request = null;
    this.snapshot = {
      ...this.snapshot,
      isSaving: false,
      savedRevision: request.revision,
      savedDraft: draft,
      savedBy: request.source,
    };
    return { isCurrentRevision: request.revision === this.snapshot.revision };
  }

  fail(
    request: InvoiceDraftSaveRequest,
    errorMessage: string,
    isDefiniteRejection: boolean,
  ): boolean {
    if (!this.active || request !== this.request) {
      return false;
    }

    const isCreateOutcomeUnknown =
      request.mode.type === 'create' && !isDefiniteRejection;
    this.request = null;
    this.snapshot = {
      ...this.snapshot,
      isSaving: false,
      isCreateOutcomeUnknown,
      errorMessage: isCreateOutcomeUnknown || request.revision === this.snapshot.revision
        ? errorMessage
        : null,
    };
    return true;
  }
}
