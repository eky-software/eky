import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceManagementStatus,
  WorkspaceRecoveryManagementStatus,
  WorkspaceSelectorCapability,
} from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import {
  useWorkspaceManagement,
  type WorkspaceManagementController,
} from './useWorkspaceManagement.js';
import { WorkspaceSelectorPage } from './WorkspaceSelectorPage.js';
import { WorkspaceSupportBundleControl } from './WorkspaceSupportBundleControl.js';
import { useWorkspaceSupportBundle } from './useWorkspaceSupportBundle.js';
import {
  initialWorkspaceSelectorState,
  type WorkspaceSelectorState,
} from './workspaceSelectorState.js';

// Presentation and callback wiring only. Existing controller/operation units
// cover asynchronous results; Electron tests own the mounted native journey.
vi.mock('./useWorkspaceManagement.js', () => ({ useWorkspaceManagement: vi.fn() }));
vi.mock('./useWorkspaceSupportBundle.js', () => ({ useWorkspaceSupportBundle: vi.fn() }));
beforeEach(() => vi.mocked(useWorkspaceSupportBundle).mockImplementation((creator, disabled) => ({
  create: vi.fn(), state: 'idle', disabled: creator === undefined || disabled,
})));
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
  const recovery: WorkspaceRecoveryManagementStatus = {
    formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
    operationState: 'idle', maintenanceState: 'idle', persistedActiveWorkspaceId: otherWorkspaceId,
    target: { workspaceId, workspaceLabel: 'Synthetic recovery target' },
  };

  it('renders only the exact recovery target and deletion, without fabricating an active business list', () => {
    const html = renderPage({ ...initialWorkspaceSelectorState, loadState: 'ready', status: recovery }, true);
    expect(html).toContain(uiText.workspaces.recoveryManagementHeading);
    expect(html).toContain('Synthetic recovery target');
    expect(html).toContain(uiText.workspaces.deleteWorkspace);
    for (const excluded of [otherWorkspaceId, uiText.workspaces.active, uiText.workspaces.ready,
      uiText.workspaces.addWorkspace, uiText.workspaces.importBackup, uiText.workspaces.openWorkspace,
      uiText.workspaces.rename, uiText.workspaces.replaceActiveButton, uiText.workspaces.noWorkspaces]) {
      expect(html).not.toContain(excluded);
    }
  });

  it.each(['busy', 'recoveryRequired'] as const)('keeps target-free recovery %s read-only with an explicit refresh', operationState => {
    const html = renderPage({ ...initialWorkspaceSelectorState, loadState: 'ready', status: {
      formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent', maintenanceState: 'idle', operationState,
    } }, true);
    expect(html).toContain(uiText.workspaces.retry);
    for (const excluded of ['Synthetic recovery target', workspaceId, otherWorkspaceId,
      uiText.workspaces.deleteWorkspace, uiText.workspaces.addWorkspace, uiText.workspaces.importBackup,
      uiText.workspaces.openWorkspace, uiText.workspaces.rename]) expect(html).not.toContain(excluded);
  });

  it('shows only a manual-close completion while leaving the separate support control available', () => {
    const state = { ...initialWorkspaceSelectorState, loadState: 'ready' as const, status: recovery,
      deletionCompleted: true, progressMessage: uiText.workspaces.deleteCompletedClose };
    vi.mocked(useWorkspaceManagement).mockReturnValue({ ...createController(state), canDeleteWorkspace: true });
    const createSupportBundle = vi.fn(async () => 'created' as const);
    const page = WorkspaceSelectorPage({ capability, createSupportBundle });
    const html = renderToStaticMarkup(page);
    expect(html).toContain(uiText.workspaces.deleteCompletedClose);
    expect(html).toContain(uiText.diagnostics.createSupportBundle);
    expect(html).not.toContain('Synthetic recovery target');
    expect(html).not.toContain(uiText.workspaces.deleteWorkspace);
    expect(html).not.toContain(uiText.workspaces.deleteCompletedSelector);
    expect(html).not.toContain(uiText.workspaces.retry);
    expect(useWorkspaceSupportBundle).toHaveBeenLastCalledWith(createSupportBundle, false);
    expect(createSupportBundle).not.toHaveBeenCalled();
  });

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
    const controller = { ...createController(readyState()), canDeleteWorkspace: true,
      backupAvailableForSelectedWorkspace: true };
    vi.mocked(useWorkspaceManagement).mockReturnValue(controller);
    const page = WorkspaceSelectorPage({ capability });

    expect(useWorkspaceManagement).toHaveBeenCalledWith(capability);
    expect(page.props.onRetry).toBe(controller.retryStatus);
    expect(page.props.onModeChange).toBe(controller.selectMode);
    expect(page.props.onSubmit).toBe(controller.submitOperation);
    expect(page.props.onLabelChange).toBe(controller.setLabelInput);
    expect(page.props).not.toHaveProperty('onClose');
    expect(page.props.canReplaceActiveWorkspace).toBe(false);
    expect(page.props.canDeleteWorkspace).toBe(true);
    expect(page.props.backupAvailableForSelectedWorkspace).toBe(false);
    expect(page.props.onBackupChoiceChange).toBe(controller.setBackupChoice);
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

  it.each([
    ['ready', readyState(), false],
    ['loading', initialWorkspaceSelectorState, true],
    ['status error', { ...readyState(), loadState: 'error', status: null }, false],
    ['submitting', { ...readyState(), isSubmitting: true }, true],
    ['busy', readyState({ ...readyStatus, operationState: 'busy' }), true],
    ['relaunching', { ...readyState(), isRelaunching: true }, true],
    ['recovery required', readyState({ ...readyStatus, operationState: 'recoveryRequired' }), false],
    ['restart required', { ...readyState(), requiresRestart: true }, false],
  ] as const)('keeps support availability separate from mutations: %s', (_name, state, disabled) => {
    const controller = createController(state);
    vi.mocked(useWorkspaceManagement).mockReturnValue(controller);
    const createSupportBundle = vi.fn(async () => 'created' as const);
    const page = WorkspaceSelectorPage({ capability, createSupportBundle });
    expect(page.props.supportBundleControl.type).toBe(WorkspaceSupportBundleControl);
    expect(useWorkspaceSupportBundle).toHaveBeenLastCalledWith(createSupportBundle, disabled);
    expect(page.props.supportBundleControl.props.controller.disabled).toBe(disabled);
    const html = renderToStaticMarkup(page);
    expect(html).toContain(uiText.diagnostics.createSupportBundle);
    expect(createSupportBundle).not.toHaveBeenCalled();
    expect(page.props.onSubmit).toBe(controller.submitOperation);
    expect(page.props.state).toBe(state);
  });

  it('does not offer support with a missing capability or missing support callback', () => {
    vi.mocked(useWorkspaceManagement).mockReturnValue(createController(readyState()));
    const createSupportBundle = vi.fn(async () => 'created' as const);
    for (const props of [{ capability }, { capability: undefined, createSupportBundle }]) {
      const page = WorkspaceSelectorPage(props);
      expect(page.props).not.toHaveProperty('supportBundleControl');
      expect(useWorkspaceSupportBundle).toHaveBeenLastCalledWith(undefined, false);
      expect(renderToStaticMarkup(page)).not.toContain(uiText.diagnostics.createSupportBundle);
    }
    expect(createSupportBundle).not.toHaveBeenCalled();
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
    canDeleteWorkspace: false,
    backupAvailableForSelectedWorkspace: false,
    state,
    closeDialog: vi.fn(),
    openDialog: vi.fn(),
    retryStatus: vi.fn(),
    selectMode: vi.fn(),
    setLabelInput: vi.fn(),
    setBackupChoice: vi.fn(),
    submitOperation: vi.fn(),
  };
}

function renderPage(state: WorkspaceSelectorState, canDeleteWorkspace = false): string {
  vi.mocked(useWorkspaceManagement).mockReturnValue({ ...createController(state), canDeleteWorkspace });
  return renderToStaticMarkup(<WorkspaceSelectorPage capability={capability} />);
}
