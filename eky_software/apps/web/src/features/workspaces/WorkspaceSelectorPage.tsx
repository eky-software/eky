import type { CreateSupportBundle } from '../../app/desktopBridge.js';
import type { WorkspaceSelectorCapability } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { useWorkspaceManagement } from './useWorkspaceManagement.js';
import { useWorkspaceSupportBundle } from './useWorkspaceSupportBundle.js';
import { WorkspaceManagementDialog } from './WorkspaceManagementDialog.js';
import { WorkspaceSupportBundleControl } from './WorkspaceSupportBundleControl.js';
import { isWorkspaceSelectorBusy, type WorkspaceSelectorState } from './workspaceSelectorState.js';

interface WorkspaceSelectorPageProps {
  readonly capability: WorkspaceSelectorCapability | undefined;
  readonly createSupportBundle?: CreateSupportBundle;
}

export function WorkspaceSelectorPage({
  capability,
  createSupportBundle,
}: WorkspaceSelectorPageProps): React.JSX.Element {
  const controller = useWorkspaceManagement(capability);
  const state: WorkspaceSelectorState = capability === undefined
    ? {
        ...controller.state,
        errorMessage: uiText.workspaces.safeError,
        loadState: 'error',
        status: null,
      }
    : controller.state;
  const support = useWorkspaceSupportBundle(capability === undefined ? undefined : createSupportBundle,
    state.loadState === 'loading' || isWorkspaceSelectorBusy(state) || state.isRelaunching);

  return (
    <WorkspaceManagementDialog
      canDeleteWorkspace={controller.canDeleteWorkspace}
      backupAvailableForSelectedWorkspace={false}
      onBackupChoiceChange={controller.setBackupChoice}
      canReplaceActiveWorkspace={false}
      onLabelChange={controller.setLabelInput}
      onModeChange={controller.selectMode}
      {...(capability === undefined ? {} : { onRetry: controller.retryStatus })}
      onSubmit={controller.submitOperation}
      state={state}
      {...(capability === undefined || createSupportBundle === undefined ? {} : {
        supportBundleControl: <WorkspaceSupportBundleControl
          controller={support}
        />,
      })}
    />
  );
}
