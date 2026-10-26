import type { WorkspaceSelectorCapability } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { useWorkspaceManagement } from './useWorkspaceManagement.js';
import { WorkspaceManagementDialog } from './WorkspaceManagementDialog.js';
import type { WorkspaceSelectorState } from './workspaceSelectorState.js';

interface WorkspaceSelectorPageProps {
  readonly capability: WorkspaceSelectorCapability | undefined;
}

export function WorkspaceSelectorPage({
  capability,
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

  return (
    <WorkspaceManagementDialog
      canReplaceActiveWorkspace={false}
      onLabelChange={controller.setLabelInput}
      onModeChange={controller.selectMode}
      {...(capability === undefined ? {} : { onRetry: controller.retryStatus })}
      onSubmit={controller.submitOperation}
      state={state}
    />
  );
}
