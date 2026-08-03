const sourceDatabaseFilePath =
  process.env.EKY_SQLITE_UPGRADE_SOURCE_PATH?.trim();

if (sourceDatabaseFilePath === undefined || sourceDatabaseFilePath === '') {
  throw new Error(
    'Set EKY_SQLITE_UPGRADE_SOURCE_PATH to the exact closed SQLite database file.',
  );
}

const { verifySqliteUpgradeCopy } = await import(
  '../dist/database/compatibility/verifySqliteUpgradeCopy.js'
);
const result = await verifySqliteUpgradeCopy(sourceDatabaseFilePath);

process.stdout.write(`${JSON.stringify(result)}\n`);
