import { describe, expect, it } from 'vitest';

import {
  profileInspectionFailureCauses,
  readProfileInspectionFailureCause,
} from './profileInspectionFailure.js';

describe('profile inspection safe failure projection', () => {
  it.each(profileInspectionFailureCauses)('keeps the closed primary cause %s', cause => {
    expect(readProfileInspectionFailureCause(new Error('wrapper', {
      cause: new Error(cause),
    }))).toBe(cause);
  });

  it('retains the deepest allowed cause only within the primary branch', () => {
    const failure = new AggregateError([
      new Error('PROFILE_INSPECTION_PROTOCOL_INVALID', {
        cause: new Error('PROFILE_SCHEMA_UNSUPPORTED'),
      }),
      new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
    ]);
    expect(readProfileInspectionFailureCause(failure)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it('never promotes a cleanup or aggregate message to an unknown primary', () => {
    const failure = new Error('PROFILE_SCHEMA_UNSUPPORTED', {
      cause: new AggregateError([
        new Error('synthetic private primary detail'),
        new Error('PROFILE_INSPECTION_TIMEOUT'),
      ], 'PROFILE_INSPECTION_PROTOCOL_INVALID'),
    });
    expect(readProfileInspectionFailureCause(failure)).toBeUndefined();
  });

  it('does not accept other operation codes, suffixed messages or non-Errors', () => {
    for (const error of [
      new Error('MIGRATION_HISTORY_INVALID'),
      new Error('PROFILE_SCHEMA_UNSUPPORTED: synthetic private detail'),
      { message: 'PROFILE_SCHEMA_UNSUPPORTED' },
      null,
      'PROFILE_SCHEMA_UNSUPPORTED',
    ]) {
      expect(readProfileInspectionFailureCause(error)).toBeUndefined();
    }
  });

  it('allows exactly eight errors but rejects an unfinished ninth error', () => {
    let failure = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    for (let index = 0; index < 7; index++) {
      failure = new Error('wrapper', { cause: failure });
    }
    expect(readProfileInspectionFailureCause(failure)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    expect(readProfileInspectionFailureCause(new Error('wrapper', {
      cause: failure,
    }))).toBeUndefined();
  });

  it('rejects cycles and throwing cause, message or aggregate getters', () => {
    const cyclic = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    cyclic.cause = cyclic;
    const failures: Error[] = [cyclic];
    for (const key of ['cause', 'message']) {
      const error = new Error('PROFILE_SCHEMA_UNSUPPORTED');
      Object.defineProperty(error, key, {
        get() { throw new Error('synthetic private getter'); },
      });
      failures.push(error);
    }
    const aggregate = new AggregateError([new Error('PROFILE_SCHEMA_UNSUPPORTED')]);
    Object.defineProperty(aggregate, 'errors', {
      get() { throw new Error('synthetic private getter'); },
    });
    failures.push(aggregate);
    for (const error of failures) {
      expect(readProfileInspectionFailureCause(error)).toBeUndefined();
    }
  });
});
