import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { EmptyWorkspaceCreationError } from './emptyWorkspaceCreationError.js';
import type { EmptyWorkspaceBootstrapResult } from './emptyWorkspaceCreationPorts.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const freshCompanyIdPattern = /^local-company-[0-9a-f]{32}$/;

export function validateEmptyWorkspaceBootstrapResult(
  value: Readonly<EmptyWorkspaceBootstrapResult>,
): Readonly<EmptyWorkspaceBootstrapResult> {
  try {
    if (
      value.actorId !== 'local-owner' ||
      value.artifactRootHealth !== 'ready' ||
      !freshCompanyIdPattern.test(value.companyId) ||
      value.databaseHealth !== 'healthy' ||
      value.foreignKeyHealth !== 'healthy' ||
      value.handlesClosed !== true ||
      !sha256Pattern.test(value.migrationChainIdentity) ||
      value.migrationState !== 'current'
    ) {
      throw new Error('invalid');
    }
    return Object.freeze({
      ...value,
      lineageIdentity: validateWorkspaceLineage(value.lineageIdentity),
    });
  } catch {
    throw new EmptyWorkspaceCreationError(
      'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
      'bootstrap',
    );
  }
}
