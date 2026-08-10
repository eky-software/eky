import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createProductionProfileAudit } from './production-profile-audit.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');

async function assertEkyIsClosed() {
  if (process.platform !== 'win32') {
    throw new Error('PROFILE_AUDIT_WINDOWS_REQUIRED');
  }
  const { stdout } = await execFileAsync(
    'tasklist.exe',
    ['/FI', 'IMAGENAME eq Eky.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (/"Eky\.exe"/i.test(stdout)) {
    throw new Error('PROFILE_AUDIT_APPLICATION_RUNNING');
  }
}

async function main() {
  await assertEkyIsClosed();
  const appData = process.env.APPDATA?.trim();
  if (appData === undefined || appData === '') {
    throw new Error('PROFILE_AUDIT_APPDATA_UNAVAILABLE');
  }
  const report = await createProductionProfileAudit({
    migrationsDirectory: resolve(
      repositoryRoot,
      'backend/src/database/migrations',
    ),
    profileRoot: resolve(appData, 'Eky'),
  });
  await assertEkyIsClosed();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const safeCode =
    error instanceof Error && /^PROFILE_AUDIT_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'PROFILE_AUDIT_FAILED';
  process.stderr.write(`${safeCode}\n`);
  process.exitCode = 1;
}
