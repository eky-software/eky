import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { utilityProcess } from 'electron';

import { waitForProofUtilityProcessesReleased } from './workspaceManagementCompositionProofRuntime.js';

/** Test-only leaf: the existing Electron fixture still owns the entire tree. */
export async function interruptWorkspaceProofTransaction(input: {
  readonly assertMainOwned: () => Promise<void>;
  readonly databaseFilePath: string;
  readonly utilityProcessBaseline: ReadonlySet<number>;
}): Promise<string> {
  await input.assertMainOwned();
  const database = new DatabaseSync(input.databaseFilePath);
  try {
    const identity = database.prepare('SELECT company_id FROM local_runtime_identity').get();
    if (typeof identity?.company_id !== 'string') fail();
    const insert = database.prepare(
      'INSERT INTO customers (id, company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    database.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 200; index++) {
      insert.run(`synthetic-hot-${index}`, identity.company_id,
        'committed-' + 'x'.repeat(4096), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
    database.exec('COMMIT');
  } finally { database.close(); }
  const committedHash = await hashFile(input.databaseFilePath);
  await input.assertMainOwned();
  const writer = utilityProcess.fork(
    fileURLToPath(new URL('./workspaceHotJournalProofRunner.js', import.meta.url)),
    [input.databaseFilePath],
    { stdio: 'ignore', serviceName: 'eky-hot-journal-proof' },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { writer.kill(); } catch { /* The unproven exit retains the fixture. */ }
      reject(new Error('WORKSPACE_HOT_JOURNAL_PROOF_EXIT_UNPROVEN'));
    }, 5_000);
    writer.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('WORKSPACE_HOT_JOURNAL_PROOF_WRITER_FAILED'));
    });
  });
  if (!(await waitForProofUtilityProcessesReleased(input.utilityProcessBaseline))) fail();
  await input.assertMainOwned();
  const journal = await readFile(input.databaseFilePath + '-journal');
  if (journal.length <= 512 || await hashFile(input.databaseFilePath) === committedHash) fail();
  return committedHash;
}

export async function verifyWorkspaceProofTransactionRecovered(
  databaseFilePath: string,
  committedHash: string,
): Promise<void> {
  if (await hashFile(databaseFilePath) !== committedHash
    || (await readdir(dirname(databaseFilePath))).includes(basename(databaseFilePath) + '-journal')) fail();
  const database = new DatabaseSync(databaseFilePath, { readOnly: true });
  try {
    const row = database.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN name = 'uncommitted' THEN 1 ELSE 0 END) AS uncommitted FROM customers`).get();
    if (row?.total !== 200 || row.uncommitted !== 0) fail();
  } finally { database.close(); }
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function fail(): never { throw new Error('WORKSPACE_HOT_JOURNAL_PROOF_INVALID'); }
