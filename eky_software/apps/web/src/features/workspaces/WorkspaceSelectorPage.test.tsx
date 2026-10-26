import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceManagementStatus,
  WorkspaceSelectorCapability,
} from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import {
  useWorkspaceManagement,
  type WorkspaceManagementController,
} from './useWorkspaceManagement.js';
import { WorkspaceSelectorPage } from './WorkspaceSelectorPage.js';
import {
  initialWorkspaceSelectorState,
  type WorkspaceSelectorState,
} from './workspaceSelectorState.js';

// Presentation and callback wiring only. Existing controller/operation units
// cover asynchronous results; Electron tests own the mounted native journey.
vi.mock('./useWorkspaceManagement.js', () => ({ useWorkspaceManagement: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const emptyStatus: WorkspaceManagementStatus = {
  activeWorkspaceId: null,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [],
};
const readyStatus: WorkspaceManagementStatus = {
  ...emptyStatus,
  workspaces: [{
    availability: 'ready', isActive: false, workspaceId, workspaceLabel: 'Company',
  }],
};
const capability: WorkspaceSelectorCapability = {
  createEmpty: async () => 'completed',
  getStatus: async () => emptyStatus,
  importBackupAsNew: async () => 'cancelled',
  rename: async () => 'completed',
  switchTo: async () => 'relaunching',
};

describe('WorkspaceSelectorPage', () => {
  it('starts as a loading first screen without a modal or close-to-business control', () => {
    const html = renderPage(initialWorkspaceSelectorState);
    expect(html).toContain('<main aria-labelledby="workspace-selector-title"');
    expect(html).toContain('<h1 id="workspace-selector-title"');
    expect(html).toContain(uiText.workspaces.loading);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain(uiText.workspaces.close);
    expect(html).not.toContain(uiText.workspaces.noWorkspaces);
    expect(html).not.toContain(uiText.workspaces.addWorkspace);
  });

  it('wires existing retry and form controls without any close callback', () => {
    const controller = createController(readyState());
    vi.mocked(useWorkspaceManagement).mockReturnValue(controller);
    const page = WorkspaceSelectorPage({ capability });

    expect(useWorkspaceManagement).toHaveBeenCalledWith(capability);
    expect(page.props.onRetry).toBe(controller.retryStatus);
    expect(page.props.onModeChange).toBe(controller.selectMode);
    expect(page.props.onSubmit).toBe(controller.submitOperation);
    expect(page.props.onLabelChange).toBe(controller.setLabelInput);
    expect(page.props).not.toHaveProperty('onClose');
    expect(page.props.canReplaceActiveWorkspace).toBe(false);
    expect(controller.openDialog).not.toHaveBeenCalled();
    expect(controller.closeDialog).not.toHaveBeenCalled();
  });

  it('shows a safe status error with an explicit retry, not an empty workspace list', () => {
    const html = renderPage({
      ...initialWorkspaceSelectorState,
      errorMessage: uiText.workspaces.safeError,
      loadState: 'error',
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain(uiText.workspaces.safeError);
    expect(html).toContain(uiText.workspaces.retry);
    expect(html).not.toContain(uiText.workspaces.noWorkspaces);
    expect(html).not.toContain(uiText.workspaces.close);
  });

  it('rejects a missing capability without a browser fallback or an endless spinner', () => {
    vi.mocked(useWorkspaceManagement).mockReturnValue(createController(initialWorkspaceSelectorState));
    const html = renderToStaticMarkup(<WorkspaceSelectorPage capability={undefined} />);
    expect(html).toContain(uiText.workspaces.safeError);
    expect(html).not.toContain(uiText.workspaces.loading);
    expect(html).not.toContain(uiText.workspaces.retry);
    expect(html).not.toContain(uiText.workspaces.browserSubtitle);
    expect(html).not.toContain(uiText.workspaces.close);
  });

  it('offers create and import for a truly empty status without selecting or creating anything', () => {
    const html = renderPage(readyState(emptyStatus));
    expect(html).toContain(uiText.workspaces.noWorkspaces);
    expect(html).toContain(uiText.workspaces.addWorkspace);
    expect(html).toContain(uiText.workspaces.importBackup);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain(uiText.workspaces.replaceActiveButton);
  });

  it('keeps null selection and duplicate names visible with explicit open and rename controls', () => {
    const html = renderPage(readyState({
      ...readyStatus,
      duplicateWorkspaceLabelIds: [workspaceId, otherWorkspaceId],
      workspaces: [readyStatus.workspaces[0]!, {
        ...readyStatus.workspaces[0]!, workspaceId: otherWorkspaceId,
      }],
    }));
    expect(html).toContain(uiText.workspaces.duplicateWorkspaceNames);
    expect(html).toContain(uiText.workspaces.workspaceIdentifier(workspaceId));
    expect(html).toContain(uiText.workspaces.workspaceIdentifier(otherWorkspaceId));
    expect(html).toContain(uiText.workspaces.openWorkspace);
    expect(html).toContain(uiText.workspaces.rename);
    expect(html).not.toContain(uiText.workspaces.active);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain(uiText.workspaces.replaceActiveButton);
  });

  it('distinguishes recovery-only entries from an empty installation', () => {
    const html = renderPage(readyState({
      ...readyStatus,
      workspaces: [{ ...readyStatus.workspaces[0]!, availability: 'recoveryRequired' }],
    }));
    expect(html).toContain('Company');
    expect(html).toContain(uiText.workspaces.requiresRecovery);
    expect(html).not.toContain(uiText.workspaces.noWorkspaces);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it.each(['busy', 'recoveryRequired'] as const)(
    'disables all mutations in the global %s state', (operationState) => {
      const html = renderPage(readyState({ ...readyStatus, operationState }));
      expect(html.match(/disabled=""/g)).toHaveLength(4);
      expect(html).not.toContain(uiText.workspaces.close);
      expect(html).not.toContain(uiText.workspaces.replaceActiveButton);
    },
  );

  it('keeps relaunching on the selector until main replaces the renderer', () => {
    const html = renderPage({
      ...readyState(),
      isSubmitting: true,
      isRelaunching: true,
      mode: 'confirmSwitch',
      selectedWorkspaceId: workspaceId,
    });
    expect(html).toContain(uiText.workspaces.relaunching);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain(uiText.workspaces.close);
  });
});

function readyState(status = readyStatus): WorkspaceSelectorState {
  return { ...initialWorkspaceSelectorState, loadState: 'ready', status };
}

function createController(state: WorkspaceSelectorState): WorkspaceManagementController {
  return {
    activeWorkspaceLabel: uiText.workspaces.fallbackName,
    brandState: 'idle',
    canReplaceActiveWorkspace: true,
    state,
    closeDialog: vi.fn(),
    openDialog: vi.fn(),
    retryStatus: vi.fn(),
    selectMode: vi.fn(),
    setLabelInput: vi.fn(),
    submitOperation: vi.fn(),
  };
}

function renderPage(state: WorkspaceSelectorState): string {
  vi.mocked(useWorkspaceManagement).mockReturnValue(createController(state));
  return renderToStaticMarkup(<WorkspaceSelectorPage capability={capability} />);
}
