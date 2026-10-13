import { isSqliteMemoryError } from '../../database/connection/isSqliteMemoryError.js';

export function profileInspectionSqliteError(error: unknown): unknown {
  return isSqliteMemoryError(error)
    ? new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED', { cause: error })
    : error;
}
