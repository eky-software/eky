import type { MessageBoxOptions } from 'electron';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import type { DesktopWorkspaceRecoveryOffer } from './desktopWorkspaceRecoverySelection.js';
import type { DesktopWorkspaceRecoveryReadAuthority } from './desktopWorkspaceRecoverySources.js';

const recoveryChoices = ['recover', 'manage', 'close'] as const;
export type DesktopWorkspaceRecoveryChoice = typeof recoveryChoices[number];

interface DesktopWorkspaceRecoveryChoiceOptions {
  readonly selection: Pick<DesktopWorkspaceRecoveryOffer, 'assertCurrent' | 'readSelected'> & {
    readonly target: Pick<DesktopWorkspaceRecoveryOffer['target'], 'workspaceLabel'>;
  };
  readonly ownership: Readonly<DesktopWorkspaceRecoveryReadAuthority>;
  readonly signal: AbortSignal;
  showMessageBox(options: MessageBoxOptions): Promise<unknown>;
}

/** A fresh read choice only; it neither stops writers nor authorizes deletion. */
export async function selectDesktopWorkspaceRecoveryChoice(
  input: Readonly<DesktopWorkspaceRecoveryChoiceOptions>,
): Promise<DesktopWorkspaceRecoveryChoice> {
  const label = input.selection.target.workspaceLabel;
  const selectedCurrent = input.selection.assertCurrent.bind(input.selection);
  const readSelected = input.selection.readSelected.bind(input.selection);
  const ownership = Object.freeze({ assertCurrent: input.ownership.assertCurrent.bind(input.ownership),
    assertOwned: input.ownership.assertOwned.bind(input.ownership) });
  const signal = input.signal, showMessageBox = input.showMessageBox.bind(input);
  const assertCurrent = () => {
    signal.throwIfAborted();
    assertUpdateJournalAuthority(selectedCurrent);
    assertUpdateJournalAuthority(ownership.assertCurrent);
    assertUpdateJournalAuthority(selectedCurrent);
    signal.throwIfAborted();
  };
  const assertSelected = async () => {
    assertCurrent();
    const result: unknown = await readSelected(ownership);
    assertCurrent();
    if (result !== undefined) throw unavailable();
  };
  await assertSelected();
  assertCurrent();
  // Keep the original native promise owned until it settles, including after abort.
  const result = await showMessageBox({ type: 'warning', title: 'Keskeytynyt palautus',
    message: 'Yrityksen palautuminen on kesken.',
    detail: `${label}\n\nVoit jatkaa palautumista, avata rajatun hallinnan tai sulkea Ekyn. Hallinnan avaaminen ei vahvista poistoa.`,
    buttons: ['Jatka palautumista', 'Rajattu hallinta', 'Sulje'],
    defaultId: 0, cancelId: 2, noLink: true, signal });
  assertCurrent();
  if (typeof result !== 'object' || result === null || !('response' in result) ||
      typeof result.response !== 'number' || !Number.isInteger(result.response)) throw unavailable();
  const choice = recoveryChoices[result.response];
  if (choice === undefined) throw unavailable();
  await assertSelected();
  assertCurrent();
  return choice;
}

function unavailable() { return new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status'); }
