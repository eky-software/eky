import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';

export const profileInspectionSqliteHeapBytes = 256 * 1024 * 1024;
export const profileInspectionSqliteCacheKiB = 2_000;

// Process-global and irreversible through PRAGMA: call only in the isolated
// inspection utility, before opening any imported database, never in the host.
export function initializeProfileInspectionSqliteBudget(
  openReference: () => DatabaseConnection,
): void {
  const control = openReference();
  try {
    // A positive PRAGMA readback is not enforcement when this driver's memory
    // accounting is disabled. Do not admit an imported DB on that runtime.
    const options = control.pragma('compile_options') as { compile_options: string }[];
    // SQLite omits the default value 1; the native factory verifies source/byte provenance.
    if (options.some(option => option.compile_options === 'DEFAULT_MEMSTATUS=0')) {
      throw new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED');
    }
    control.pragma(`hard_heap_limit = ${profileInspectionSqliteHeapBytes}`);
    if (control.pragma('hard_heap_limit', { simple: true }) !== profileInspectionSqliteHeapBytes) {
      throw new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED');
    }
  } finally {
    control.close();
  }
}

export function configureProfileInspectionConnection(database: DatabaseConnection): void {
  database.pragma('trusted_schema = OFF');
  database.pragma('query_only = ON');
  database.pragma('mmap_size = 0');
  database.pragma(`cache_size = -${profileInspectionSqliteCacheKiB}`);
  database.pragma('temp_store = MEMORY');
  if (
    database.pragma('trusted_schema', { simple: true }) !== 0 ||
    database.pragma('query_only', { simple: true }) !== 1 ||
    database.pragma('mmap_size', { simple: true }) !== 0 ||
    database.pragma('cache_size', { simple: true }) !== -profileInspectionSqliteCacheKiB ||
    database.pragma('temp_store', { simple: true }) !== 2
  ) {
    throw new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED');
  }
}
