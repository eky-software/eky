import { join, resolve } from 'node:path';

export interface DesktopProfilePaths {
  databaseFilePath: string;
  invoiceDocumentStorageRoot: string;
  runtimeRoot: string;
}

export function createDesktopProfilePaths(
  userDataPath: string,
): DesktopProfilePaths {
  const runtimeRoot = join(resolve(userDataPath), 'runtime');

  return Object.freeze({
    databaseFilePath: join(runtimeRoot, 'data', 'eky.sqlite'),
    invoiceDocumentStorageRoot: join(runtimeRoot, 'storage', 'invoices'),
    runtimeRoot,
  });
}
