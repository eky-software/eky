import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { profileInspectionSqliteError } from './profileInspectionSqliteError.js';

describe('native profile inspection allocation failure', () => {
  it('preserves the original native error behind the existing resource code', () => {
    const cause = new Database.SqliteError('synthetic native detail', 'SQLITE_NOMEM');
    const result = profileInspectionSqliteError(cause);
    expect(result).toBeInstanceOf(Error);
    expect(result).toMatchObject({ message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause });
    expect((result as Error).cause).toBe(cause);
  });

  it.each([
    new Error('SQLITE_NOMEM'),
    new Error('out of memory'),
    new Database.SqliteError('SQLITE_NOMEM', 'SQLITE_CORRUPT'),
    new Error('PROFILE_SCHEMA_UNSUPPORTED'),
    { code: 'SQLITE_NOMEM' },
    'SQLITE_NOMEM',
    undefined,
  ])('does not infer a resource code from messages or non-native values %#', failure => {
    expect(profileInspectionSqliteError(failure)).toBe(failure);
  });

  it('does not replace an earlier failure with a secondary memory error', () => {
    const failure = new AggregateError([
      new Error('PROFILE_SCHEMA_UNSUPPORTED'),
      new Database.SqliteError('synthetic close detail', 'SQLITE_NOMEM'),
    ]);
    expect(profileInspectionSqliteError(failure)).toBe(failure);
  });
});
