import {
  ActiveWorkspaceStartupRelaunchRequiredError,
  resolveActiveWorkspaceStartup,
  type ActiveWorkspaceStartupOptions,
  type ActiveWorkspaceStartupPhase,
} from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { readSafeElectronE2eWorkspaceStartupFailureCode } from './electronE2eWorkspaceStartupFailure.js';

// Keep the production owner's authority intact while observing test phases.
export async function resolveElectronE2eWorkspaceStartup(
  userDataRoot: string,
  options: Readonly<ActiveWorkspaceStartupOptions> = {},
) {
  let phase: ActiveWorkspaceStartupPhase | undefined;
  const reportProgress: NonNullable<ActiveWorkspaceStartupOptions['reportProgress']> = progress => {
    phase = progress.state === 'started' ? progress.phase : undefined;
    options.reportProgress?.(progress);
  };
  try {
    return await (options.selectorAuthority === undefined
      ? resolveActiveWorkspaceStartup(userDataRoot, { reportProgress })
      : resolveActiveWorkspaceStartup(userDataRoot, {
          ...options, selectorAuthority: options.selectorAuthority, reportProgress,
        }));
  } catch (error) {
    // This is the production owner's completed recovery handoff, not a startup
    // failure. Its identity must reach resolveDesktopWorkspaceStartup intact.
    if (error instanceof ActiveWorkspaceStartupRelaunchRequiredError) throw error;
    throw new Error(readSafeElectronE2eWorkspaceStartupFailureCode(error, phase));
  }
}
