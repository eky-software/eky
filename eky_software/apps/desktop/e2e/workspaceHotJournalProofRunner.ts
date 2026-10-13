import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2];
if (path === undefined || !isAbsolute(path) || process.argv.length !== 3) {
  throw new Error('WORKSPACE_HOT_JOURNAL_PROOF_INPUT_INVALID');
}
const database = new DatabaseSync(path);
database.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA synchronous = FULL;
  PRAGMA cache_size = 10;
  BEGIN IMMEDIATE;
  UPDATE customers SET name = 'uncommitted';
`);
// Deliberately bypass close/rollback: the next real candidate must recover it.
process.exit(0);
