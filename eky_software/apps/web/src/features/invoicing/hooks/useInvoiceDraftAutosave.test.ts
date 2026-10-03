import { describe, expect, it } from 'vitest';

import {
  getInvoiceDraftAutosaveStatus,
  invoiceDraftAutosaveDelayMs,
} from './useInvoiceDraftAutosave.js';

const unsaved = {
  revision: 1,
  isCreateOutcomeUnknown: false,
  isSaving: false,
  isSaved: false,
  errorMessage: null,
};

describe('invoice draft autosave presentation', () => {
  it('does not mark newer valid input saved merely because the first create succeeded', () => {
    expect(getInvoiceDraftAutosaveStatus(unsaved, true)).toBe('saving');
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, isSaved: true }, true)).toBe('saved');
  });

  it('keeps invalid newer input unsaved', () => {
    expect(getInvoiceDraftAutosaveStatus(unsaved, false)).toBe('waitingForValidForm');
  });

  it('keeps a pending write visible while the newer form becomes invalid', () => {
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, isSaving: true }, false)).toBe('saving');
  });

  it('does not schedule an untouched new form', () => {
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, revision: 0 }, true)).toBe('disabled');
  });

  it('distinguishes an initially persisted edit form from a new form', () => {
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, revision: 0, isSaved: true }, true)).toBe('saved');
  });

  it('presents confirmed failure and uncertain create as errors, not ongoing saves', () => {
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, errorMessage: 'Safe rejection' }, true)).toBe('error');
    expect(getInvoiceDraftAutosaveStatus({ ...unsaved, isCreateOutcomeUnknown: true }, true)).toBe('error');
  });

  it('preserves the existing debounce interval', () => {
    expect(invoiceDraftAutosaveDelayMs).toBe(1800);
  });
});
