import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const sqliteModule = createRequire(import.meta.url).resolve('better-sqlite3');

/** The owned leaf exits without closing SQLite, leaving a real rollback journal. */
export async function interruptSqliteTransaction(
  databaseFilePath: string,
  writeStatement: string,
): Promise<void> {
  const script = `
    const Database = require(process.argv[1]);
    const database = new Database(process.argv[2], { fileMustExist: true });
    database.pragma('journal_mode = DELETE');
    database.pragma('synchronous = FULL');
    database.pragma('cache_size = 10');
    database.exec('BEGIN IMMEDIATE');
    database.exec(process.argv[3]);
    process.stdout.write('transactionWritten', () => process.exit(0));
  `;
  const result = await executeFile(process.execPath, [
    '--eval', script, sqliteModule, databaseFilePath, writeStatement,
  ], { maxBuffer: 4096, timeout: 4000, windowsHide: true });
  if (result.stdout !== 'transactionWritten' || result.stderr !== '') {
    throw new Error('SYNTHETIC_TRANSACTION_INTERRUPTION_FAILED');
  }
}
