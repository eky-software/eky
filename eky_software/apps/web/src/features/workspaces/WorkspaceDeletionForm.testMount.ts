import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type { WorkspaceDeletionRequest } from '../../app/desktopWorkspaceManagement.js';
import { WorkspaceDeletionForm } from './WorkspaceDeletionForm.js';

// Loaded only by the isolated browser-component fixture, never by the app entry.
export async function mountWorkspaceDeletionFormProbe() {
  if (import.meta.env.MODE !== 'eky-e2e') throw new Error('Deletion form probe requires the E2E runtime.');
  const { act } = await import('react');
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  async function flush(callback: () => void) {
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try { await act(callback); }
    finally {
      if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
      else environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  }
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  let label = 'Synthetic company', typedLabel = '', busy = false, backupAvailable = true, showIdentifier = false;
  let backupChoice: WorkspaceDeletionRequest['backupChoice'] | null = null;
  const requests: Readonly<WorkspaceDeletionRequest>[] = [];
  let backs = 0;
  const container = document.createElement('section');
  container.setAttribute('aria-label', 'Workspace deletion form probe');
  container.style.cssText = 'max-width:680px;margin:20px auto;padding:16px;';
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(createElement(WorkspaceDeletionForm, {
    target: { workspaceId, workspaceLabel: label }, showWorkspaceIdentifier: showIdentifier,
    typedLabel, backupChoice, backupAvailable, isBusy: busy, errorMessage: null,
    onTypedLabelChange(value: string) { typedLabel = value; render(); },
    onBackupChoiceChange(value: WorkspaceDeletionRequest['backupChoice']) { backupChoice = value; render(); },
    onBack() { backs++; },
    onSubmit(request: Readonly<WorkspaceDeletionRequest>) { requests.push(request); busy = true; render(); },
  }));
  async function close() {
    try { await flush(() => root.unmount()); }
    finally { container.remove(); }
  }
  try { await flush(render); }
  catch (error) {
    try { await close(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Deletion form initialization and cleanup failed.', { cause: error });
    }
    throw error;
  }
  return {
    read: () => ({ requests: [...requests], backs }),
    async configure(input: { busy?: boolean; backupAvailable?: boolean; label?: string; showIdentifier?: boolean }) {
      if (input.busy !== undefined) busy = input.busy;
      if (input.backupAvailable !== undefined) backupAvailable = input.backupAvailable;
      if (input.showIdentifier !== undefined) showIdentifier = input.showIdentifier;
      if (input.label !== undefined) { label = input.label; typedLabel = ''; backupChoice = null; }
      await flush(render);
    },
    close,
  };
}
