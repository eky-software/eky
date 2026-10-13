import { describe, expect, it } from 'vitest';

import {
  readWorkspaceCandidateCleanupCause,
  readWorkspaceCandidateFailureCause,
} from './workspaceCandidateFailure.js';
import { workspaceCandidateFailureCauses } from './workspaceCandidateMessages.js';

describe('workspace candidate safe failure projection', () => {
  it.each(workspaceCandidateFailureCauses)('retains the closed cause %s', cause => {
    expect(readWorkspaceCandidateFailureCause(
      new Error('generic operation failure', { cause: new Error(cause) }),
    )).toBe(cause);
  });

  it('never replaces an unknown primary with a known cleanup failure', () => {
    const error = new Error('generic wrapper', { cause: new AggregateError([
      new Error('synthetic private message/path/password'),
      new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
    ], 'PROFILE_SCHEMA_UNSUPPORTED') });
    expect(readWorkspaceCandidateFailureCause(error)).toBe('unknown');
    expect(readWorkspaceCandidateCleanupCause(error))
      .toBe('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
  });

  it('keeps the first recovery before a later lease failure', () => {
    const error = new AggregateError([
      new AggregateError([
        new Error('PROFILE_SCHEMA_UNSUPPORTED'),
        new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
      ]),
      new Error('PROFILE_INSPECTION_TIMEOUT'),
    ]);
    expect(readWorkspaceCandidateFailureCause(error)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    expect(readWorkspaceCandidateCleanupCause(error))
      .toBe('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
  });

  it('does not invent a cleanup failure for a single failure', () => {
    expect(readWorkspaceCandidateCleanupCause(new Error('PROFILE_SCHEMA_UNSUPPORTED')))
      .toBeUndefined();
  });

  it('retains the deepest closed cause within the primary branch', () => {
    const error = new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID', {
      cause: new Error('PROFILE_SCHEMA_UNSUPPORTED'),
    });
    expect(readWorkspaceCandidateFailureCause(error)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
  });

  it('does not replace an earlier unknown cleanup with a later known cleanup', () => {
    const error = new AggregateError([
      new AggregateError([
        new Error('PROFILE_SCHEMA_UNSUPPORTED'),
        new Error('synthetic private cleanup message'),
      ]),
      new Error('PROFILE_INSPECTION_TIMEOUT'),
    ]);
    expect(readWorkspaceCandidateFailureCause(error)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    expect(readWorkspaceCandidateCleanupCause(error)).toBe('unknown');
  });

  it('bounds cycles, long chains and throwing getters without inventing cleanup', () => {
    const cyclic = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    cyclic.cause = cyclic;
    let deep = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    for (let i = 0; i < 10; i++) deep = new Error('wrapper', { cause: deep });
    const getter = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    Object.defineProperty(getter, 'cause', { get() { throw new Error('private'); } });
    for (const error of [cyclic, deep, getter]) {
      expect(readWorkspaceCandidateFailureCause(error)).toBe('unknown');
      expect(readWorkspaceCandidateCleanupCause(error)).toBeUndefined();
    }
  });
});
