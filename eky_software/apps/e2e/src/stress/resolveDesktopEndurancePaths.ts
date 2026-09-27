import { join } from 'node:path';

import { readElectronE2eActiveWorkspace } from '../environment/readElectronE2eActiveWorkspace.js';

export function resolveDesktopEndurancePaths(userDataPath: string): {
  databaseFilePath: string;
  documentsRoot: string;
  emailSecretFilePath: string;
  logsRoot: string;
} {
  const workspace = readElectronE2eActiveWorkspace(userDataPath);
  return {
    databaseFilePath: workspace.databaseFilePath,
    documentsRoot: workspace.documentsRoot,
    emailSecretFilePath: workspace.emailSecretFilePath,
    // Operational logs belong to the installation, not the active workspace.
    logsRoot: join(userDataPath, 'runtime', 'logs'),
  };
}
