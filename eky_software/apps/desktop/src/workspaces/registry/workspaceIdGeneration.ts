import { randomUUID } from 'node:crypto';

import type { WorkspaceId } from './workspaceRegistryTypes.js';
import { validateWorkspaceId } from './workspaceIdValidation.js';

export function generateWorkspaceId(): WorkspaceId {
  return validateWorkspaceId(randomUUID());
}
