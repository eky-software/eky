import { createEkyApiClient, type EkyApiClient } from '@eky/api-client';

import {
  getDesktopWorkspaceManagement,
  type WorkspaceSelectorCapability,
} from './desktopWorkspaceManagement.js';

export type WebAppComposition =
  | { readonly mode: 'business'; readonly apiClient: EkyApiClient }
  | {
      readonly mode: 'workspaceSelector';
      readonly workspaceManagementCapability: WorkspaceSelectorCapability | undefined;
    };

const workspaceSelectorUrl = 'eky://app/index.html#workspace-selector';

export function createWebAppComposition(
  target: Pick<Window, 'ekyDesktop' | 'location'> = window,
): WebAppComposition {
  // Presentation only. Main owns protocol admission and all capability authority.
  if (target.location.href === workspaceSelectorUrl) {
    const capability = getDesktopWorkspaceManagement(target);
    return {
      mode: 'workspaceSelector',
      workspaceManagementCapability: capability === undefined
        ? undefined
        : Object.freeze({
            createEmpty: capability.createEmpty,
            getStatus: capability.getStatus,
            importBackupAsNew: capability.importBackupAsNew,
            rename: capability.rename,
            switchTo: capability.switchTo,
          }),
    };
  }

  return {
    mode: 'business',
    apiClient: createEkyApiClient({
      baseUrl: import.meta.env.VITE_EKY_API_BASE_URL ?? '',
    }),
  };
}
