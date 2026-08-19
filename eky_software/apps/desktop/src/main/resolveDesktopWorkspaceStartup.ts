import {
  ActiveWorkspaceStartupRelaunchRequiredError,
  type ActiveWorkspaceStartupSelection,
} from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';

export type DesktopWorkspaceStartupResolution =
  | Readonly<{
      status: 'ready';
      activeWorkspace: Readonly<ActiveWorkspaceStartupSelection>;
      runtimeSessionSecret: string;
    }>
  | Readonly<{ status: 'relaunching' }>;

export interface ResolveDesktopWorkspaceStartupOptions {
  readonly createRuntimeSession: () => string;
  readonly relaunchApplication: () => void;
  readonly resolveActiveWorkspace: (
    userDataRoot: string,
  ) => Promise<Readonly<ActiveWorkspaceStartupSelection>>;
  readonly userDataRoot: string;
}

export async function resolveDesktopWorkspaceStartup(
  options: Readonly<ResolveDesktopWorkspaceStartupOptions>,
): Promise<DesktopWorkspaceStartupResolution> {
  try {
    const activeWorkspace = await options.resolveActiveWorkspace(
      options.userDataRoot,
    );
    return Object.freeze({
      status: 'ready',
      activeWorkspace,
      runtimeSessionSecret: options.createRuntimeSession(),
    });
  } catch (error) {
    if (error instanceof ActiveWorkspaceStartupRelaunchRequiredError) {
      options.relaunchApplication();
      return Object.freeze({ status: 'relaunching' });
    }
    throw error;
  }
}
