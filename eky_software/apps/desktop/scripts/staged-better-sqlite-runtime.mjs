import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const EXPECTED_BETTER_SQLITE_VERSION = '13.0.2';

const MINIMUM_NATIVE_FILE_SIZE_BYTES = 100_000;
const MAXIMUM_NATIVE_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function isPathInside(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

export function validateRegularFileMetadata({
  fileSize,
  isFile,
  isSymbolicLink,
  label,
  maximumSize = MAXIMUM_NATIVE_FILE_SIZE_BYTES,
  minimumSize = 1,
}) {
  if (isSymbolicLink) {
    throw new Error(`${label} must not be a symbolic link.`);
  }
  if (!isFile) {
    throw new Error(`${label} must be a regular file.`);
  }
  if (fileSize < minimumSize || fileSize > maximumSize) {
    throw new Error(`${label} size is outside the approved bounds.`);
  }
}

async function inspectContainedRegularFile({
  filePath,
  label,
  rootRealPath,
  maximumSize,
  minimumSize,
}) {
  const stats = await lstat(filePath);
  validateRegularFileMetadata({
    fileSize: stats.size,
    isFile: stats.isFile(),
    isSymbolicLink: stats.isSymbolicLink(),
    label,
    maximumSize,
    minimumSize,
  });

  const fileRealPath = await realpath(filePath);
  if (!isPathInside(rootRealPath, fileRealPath)) {
    throw new Error(`${label} escaped the staged package directory.`);
  }

  return fileRealPath;
}

function parsePackageMetadata(contents) {
  const metadata = JSON.parse(contents);
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Staged better-sqlite3 package metadata is invalid.');
  }
  return metadata;
}

export async function inspectStagedBetterSqliteRuntime({
  arch = 'x64',
  backendStage,
  expectedVersion = EXPECTED_BETTER_SQLITE_VERSION,
  platform = 'win32',
}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(
      `Unsupported staged better-sqlite3 target: ${platform}-${arch}.`,
    );
  }

  const stageRequire = createRequire(resolve(backendStage, 'package.json'));
  const packageJsonPath = stageRequire.resolve('better-sqlite3/package.json');
  const packageRoot = dirname(packageJsonPath);
  const stageRealPath = await realpath(backendStage);
  const packageRootRealPath = await realpath(packageRoot);

  if (!isPathInside(stageRealPath, packageRootRealPath)) {
    throw new Error(
      'Staged better-sqlite3 package escaped the backend stage directory.',
    );
  }

  const metadata = parsePackageMetadata(await readFile(packageJsonPath, 'utf8'));
  if (metadata.version !== expectedVersion) {
    throw new Error(
      `Expected staged better-sqlite3 ${expectedVersion}, found ${String(
        metadata.version,
      )}.`,
    );
  }

  const platformExport = metadata.exports?.['./win32-x64'];
  if (platformExport !== './lib/win32-x64.js') {
    throw new Error(
      'Staged better-sqlite3 package is missing the approved win32-x64 loader.',
    );
  }

  const loaderPath = resolve(packageRoot, 'lib/win32-x64.js');
  const nativePath = resolve(packageRoot, 'prebuilds/win32-x64.node');
  await inspectContainedRegularFile({
    filePath: loaderPath,
    label: 'Staged better-sqlite3 win32-x64 loader',
    rootRealPath: packageRootRealPath,
  });
  const nativeRealPath = await inspectContainedRegularFile({
    filePath: nativePath,
    label: 'Staged better-sqlite3 win32-x64 native file',
    maximumSize: MAXIMUM_NATIVE_FILE_SIZE_BYTES,
    minimumSize: MINIMUM_NATIVE_FILE_SIZE_BYTES,
    rootRealPath: packageRootRealPath,
  });

  const resolvedLoaderPath = await realpath(
    stageRequire.resolve('better-sqlite3/win32-x64'),
  );
  if (resolvedLoaderPath !== (await realpath(loaderPath))) {
    throw new Error(
      'Staged better-sqlite3 win32-x64 export resolved unexpectedly.',
    );
  }

  return {
    nativePath: nativeRealPath,
    packageRoot: packageRootRealPath,
    version: metadata.version,
  };
}

export function verifyBetterSqliteDatabase(Database) {
  const database = new Database(':memory:');
  try {
    database.exec(
      'CREATE TABLE compatibility_values (value INTEGER NOT NULL);',
    );
    const insert = database.prepare(
      'INSERT INTO compatibility_values (value) VALUES (?)',
    );
    database.transaction((values) => {
      for (const value of values) {
        insert.run(value);
      }
    })([40, 2]);

    const sum = database
      .prepare('SELECT SUM(value) AS value FROM compatibility_values')
      .get().value;
    if (sum !== 42) {
      throw new Error('Staged better-sqlite3 transaction verification failed.');
    }

    try {
      database.transaction(() => {
        insert.run(100);
        throw new Error('ROLLBACK_COMPATIBILITY_TEST');
      })();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'ROLLBACK_COMPATIBILITY_TEST'
      ) {
        throw error;
      }
    }

    const count = database
      .prepare('SELECT COUNT(*) AS value FROM compatibility_values')
      .get().value;
    if (count !== 2) {
      throw new Error('Staged better-sqlite3 rollback verification failed.');
    }

    return database.prepare('SELECT sqlite_version() AS version').get().version;
  } finally {
    database.close();
  }
}

export async function verifyStagedBetterSqliteDatabase({
  backendStage,
}) {
  const stageRequire = createRequire(resolve(backendStage, 'package.json'));
  const Database = stageRequire('better-sqlite3');
  return verifyBetterSqliteDatabase(Database);
}
