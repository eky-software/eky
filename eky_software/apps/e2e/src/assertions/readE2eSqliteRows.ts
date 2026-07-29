import { DatabaseSync } from 'node:sqlite';

export function readE2eSqliteRows(
  databaseFilePath: string,
  query: string,
  ...parameters: Array<number | string>
): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databaseFilePath, {
    open: true,
    readOnly: true,
  });

  try {
    return database.prepare(query).all(...parameters) as Array<
      Record<string, unknown>
    >;
  } finally {
    database.close();
  }
}
