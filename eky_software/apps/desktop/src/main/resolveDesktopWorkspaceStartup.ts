import {
  ActiveWorkspaceStartupRelaunchRequiredError,
  type ActiveWorkspaceStartupOptions,
  type ActiveWorkspaceStartupSelection,
} from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import type { WorkspaceSelectorStartupSelection, WorkspaceSelectorSwitchStartupAuthority } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';

export type DesktopWorkspaceStartupResolution =
  | Readonly<{
      status: 'ready';
      activeWorkspace: Readonly<ActiveWorkspaceStartupSelection>;
      runtimeSessionSecret: string;
    }>
  | Readonly<{ status: 'selector'; selection: WorkspaceSelectorStartupSelection }>
  | Readonly<{ status: 'relaunching' }>;

export interface ResolveDesktopWorkspaceStartupOptions {
  readonly assertStartupCurrent: () => void;
  readonly createRuntimeSession: () => string;
  readonly relaunchApplication: () => void;
  readonly resolveActiveWorkspace: (
    userDataRoot: string,
    options?: Readonly<ActiveWorkspaceStartupOptions>,
  ) => Promise<Readonly<ActiveWorkspaceStartupSelection> | WorkspaceSelectorStartupSelection>;
  readonly selectorAuthority?: WorkspaceSelectorSwitchStartupAuthority;
  readonly userDataRoot: string;
}

export async function resolveDesktopWorkspaceStartup(
  options: Readonly<ResolveDesktopWorkspaceStartupOptions>,
): Promise<DesktopWorkspaceStartupResolution> {
  const assertStartupCurrent = options.assertStartupCurrent.bind(options);
  const createRuntimeSession = options.createRuntimeSession.bind(options);
  const relaunchApplication = options.relaunchApplication.bind(options);
  const resolveActiveWorkspace = options.resolveActiveWorkspace.bind(options);
  const selectorAuthority = options.selectorAuthority;
  assertStartupCurrent();
  let activeWorkspace: Readonly<ActiveWorkspaceStartupSelection> | WorkspaceSelectorStartupSelection;
  try {
    activeWorkspace = await (selectorAuthority === undefined
      ? resolveActiveWorkspace(options.userDataRoot)
      : resolveActiveWorkspace(options.userDataRoot, { selectorAuthority }));
  } catch (error) {
    if (error instanceof ActiveWorkspaceStartupRelaunchRequiredError) {
      assertStartupCurrent();
      relaunchApplication();
      return Object.freeze({ status: 'relaunching' });
    }
    throw error;
  }
  assertStartupCurrent();
  if (activeWorkspace.mode === 'selector') {
    await activeWorkspace.assertCurrent();
    assertStartupCurrent();
    return Object.freeze({ status: 'selector', selection: activeWorkspace });
  }
  return Object.freeze({
    status: 'ready',
    activeWorkspace,
    runtimeSessionSecret: createRuntimeSession(),
  });
}
