export const workspaceDeletionBackupProofScenarioIds = [
  'DESK-DELETE-BACKUP-001',
  'DESK-DELETE-BACKUP-CHANGED-001',
] as const;

export function isWorkspaceDeletionBackupProofScenario(scenarioId: string): boolean {
  return workspaceDeletionBackupProofScenarioIds.some(value => value === scenarioId);
}

export const workspaceDeletionProofScenarioIds = [
  'DESK-DELETE-CANCEL-001',
  'DESK-DELETE-NATIVE-DRAIN-001',
  'DESK-DELETE-PUBLISH-DRAIN-001',
  'DESK-DELETE-PREPARE-001',
  ...workspaceDeletionBackupProofScenarioIds,
] as const;

export const workspaceDeletionProofChannel = 'eky:e2e:workspace-deletion-preparation';

export function isWorkspaceDeletionProofScenario(scenarioId: string): boolean {
  return workspaceDeletionProofScenarioIds.some(value => value === scenarioId);
}

// Appended only to the isolated test's copied preload, never the desktop build.
export function workspaceDeletionProofPreload(scenarioId: string): string {
  if (!isWorkspaceDeletionProofScenario(scenarioId)) return '';
  return `\n;(() => {
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('ekyWorkspaceDeletionProof', Object.freeze({
      prepareDeletion: (...args) => ipcRenderer.invoke(${JSON.stringify(workspaceDeletionProofChannel)}, ...args),
    }));
  })();\n`;
}
