import type { DatabaseConnection } from './connection/createDatabaseConnection.js';
import {
  createLocalRuntimeIdentity,
  type LocalRuntimeIdentity,
} from '../infrastructure/identity/localRuntimeIdentity.js';

interface LocalRuntimeIdentityRow {
  actor_id: string;
  company_id: string;
  installation_id: string;
}

export function readLocalRuntimeIdentity(
  database: DatabaseConnection,
): LocalRuntimeIdentity {
  const row = database
    .prepare<[], LocalRuntimeIdentityRow>(
      `
        SELECT actor_id, company_id, installation_id
        FROM local_runtime_identity
        WHERE singleton_key = 'local-runtime'
      `,
    )
    .get();

  if (row === undefined) {
    throw new Error('Local runtime identity is not configured.');
  }

  return createLocalRuntimeIdentity({
    actorId: row.actor_id,
    companyId: row.company_id,
    installationId: row.installation_id,
  });
}
