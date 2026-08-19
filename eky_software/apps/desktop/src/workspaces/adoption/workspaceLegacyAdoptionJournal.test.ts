import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceLegacyAdoptionTransition,
  parseWorkspaceLegacyAdoptionJournalBytes,
  serializeWorkspaceLegacyAdoptionJournal,
  validateWorkspaceLegacyAdoptionJournal,
  WorkspaceLegacyAdoptionJournalStore,
} from './workspaceLegacyAdoptionJournal.js';
import {
  createAdoptionJournal,
  TEST_ADOPTION_OPERATION_ID,
} from './workspaceLegacyAdoptionTestSupport.js';

describe('workspace legacy adoption journal', () => {
  it('round-trips only canonical bytes', () => {
    const journal = createAdoptionJournal('prepared');
    const bytes = serializeWorkspaceLegacyAdoptionJournal(journal);

    expect(parseWorkspaceLegacyAdoptionJournalBytes(bytes)).toEqual(journal);
    expect(() =>
      parseWorkspaceLegacyAdoptionJournalBytes(
        new TextEncoder().encode(JSON.stringify(journal, null, 2)),
      ),
    ).toThrowError('WORKSPACE_ADOPTION_INVALID');
  });

  it('rejects duplicate decoded keys and unknown fields', () => {
    const duplicate =
      `{"formatVersion":1,"operationId":"${TEST_ADOPTION_OPERATION_ID}",` +
      `"operationId":"${TEST_ADOPTION_OPERATION_ID}",` +
      '"workspaceId":"11111111-1111-4111-8111-111111111111",' +
      '"sourceKind":"legacy","state":"prepared",' +
      '"createdAt":"2026-08-19T10:00:00.000Z"}\n';
    expect(() =>
      parseWorkspaceLegacyAdoptionJournalBytes(
        new TextEncoder().encode(duplicate),
      ),
    ).toThrowError('WORKSPACE_ADOPTION_INVALID');
    expect(() =>
      validateWorkspaceLegacyAdoptionJournal({
        ...createAdoptionJournal('prepared'),
        unknown: true,
      }),
    ).toThrowError('WORKSPACE_ADOPTION_INVALID');
  });

  it('allows only forward or recoveryRequired transitions', () => {
    const prepared = createAdoptionJournal('prepared');
    expect(() =>
      assertWorkspaceLegacyAdoptionTransition(undefined, prepared),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceLegacyAdoptionTransition(
        prepared,
        createAdoptionJournal('candidatePrepared'),
      ),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceLegacyAdoptionTransition(
        createAdoptionJournal('rootPublished'),
        createAdoptionJournal('prepared'),
      ),
    ).toThrowError('WORKSPACE_ADOPTION_INVALID');
  });

  it('rejects a relative journal root', () => {
    expect(() => new WorkspaceLegacyAdoptionJournalStore('relative'))
      .toThrowError('WORKSPACE_ADOPTION_STORAGE_FAILED');
  });
});
