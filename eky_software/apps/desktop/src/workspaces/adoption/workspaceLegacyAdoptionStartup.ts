import { randomUUID } from 'node:crypto';

import {
  appendReadyWorkspaceEntry,
  createReadyWorkspaceEntry,
  findWorkspaceEntry,
  readWorkspaceRegistry,
} from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import {
  assertWorkspaceLegacyAdoptionTransition,
  type WorkspaceLegacyAdoptionJournalPort,
  type WorkspaceLegacyAdoptionJournalV1,
} from './workspaceLegacyAdoptionJournal.js';
import {
  deriveWorkspaceLegacyAdoptionPaths,
  type WorkspaceLegacyAdoptionPaths,
} from './workspaceLegacyAdoptionPaths.js';
import type { WorkspaceLegacyAdoptionRootPort } from './workspaceLegacyAdoptionRootStore.js';

const defaultWorkspaceLabel = 'Oma yritys';

export interface WorkspaceLegacyAdoptionAcceptancePorts {
  readonly journal: WorkspaceLegacyAdoptionJournalPort;
  readonly registry: WorkspaceRegistryPort;
  publishBinding(profileId: string): Promise<void>;
  readonly cleanup: Pick<WorkspaceLegacyAdoptionRootPort, 'discardCandidate'>;
}

export interface WorkspaceLegacyAdoptionStartupSelection {
  readonly mode: 'adoption';
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
  assertCanAccept(profileId: string): void;
  accept(profileId: string, ports: WorkspaceLegacyAdoptionAcceptancePorts): Promise<void>;
  recoverFromFailure(ports: {
    readonly journal: WorkspaceLegacyAdoptionJournalPort;
  }): Promise<'notRecovered'>;
}

export interface ResolveWorkspaceLegacyAdoptionStartupOptions {
  readonly generateOperationId?: () => string;
  readonly generateWorkspaceId?: () => WorkspaceId;
  readonly journal: WorkspaceLegacyAdoptionJournalPort;
  readonly now?: () => Date;
  readonly registry: WorkspaceRegistryPort;
  readonly rootStore: WorkspaceLegacyAdoptionRootPort;
  readonly selectedSourceKind?: WorkspaceLegacyAdoptionJournalV1['sourceKind'];
  readonly userDataRoot: string;
}

export async function resolveWorkspaceLegacyAdoptionStartup(
  options: Readonly<ResolveWorkspaceLegacyAdoptionStartupOptions>,
): Promise<Readonly<WorkspaceLegacyAdoptionStartupSelection>> {
  const generateOperationId = options.generateOperationId ?? randomUUID;
  const createWorkspaceId = options.generateWorkspaceId ?? generateWorkspaceId;
  const now = options.now ?? (() => new Date());
  let journal = await options.journal.read();
  let registry = await options.registry.read();

  if (journal === undefined) {
    if (registry !== undefined) {
      throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
    }
    const workspaceId = createWorkspaceId();
    const operationId = generateOperationId();
    const paths = deriveWorkspaceLegacyAdoptionPaths(
      options.userDataRoot,
      operationId,
      workspaceId,
    );
    await options.rootStore.assertNoUntrackedWorkspaceRoots(paths);
    const sourceKind = await options.rootStore.detectSourceKind(paths);
    if (options.selectedSourceKind !== undefined && sourceKind !== options.selectedSourceKind) {
      throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    }
    journal = Object.freeze({
      formatVersion: 1,
      operationId,
      workspaceId,
      sourceKind,
      state: 'prepared',
      createdAt: validateWorkspaceTimestamp(now().toISOString()),
    });
    await options.journal.write(journal);
  }

  if (options.selectedSourceKind !== undefined && journal.sourceKind !== options.selectedSourceKind) {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  }

  if (journal.state === 'recoveryRequired') {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }

  const paths = deriveWorkspaceLegacyAdoptionPaths(
    options.userDataRoot,
    journal.operationId,
    journal.workspaceId,
  );
  journal = await preparePublishedRoot(options, paths, journal);
  registry = await options.registry.read();
  if (journal.state === 'registryPublished') {
    requirePublishedRegistry(registry, journal.workspaceId);
  } else if (registry !== undefined) {
    const published = findWorkspaceEntry(registry, journal.workspaceId);
    if (
      registry.activeWorkspaceId !== journal.workspaceId ||
      published === undefined ||
      published.lifecycleState !== 'ready'
    ) {
      return recoveryRequired(options.journal, journal);
    }
    journal = Object.freeze({ ...journal, state: 'registryPublished' });
    await options.journal.write(journal);
  }

  const activeJournal = journal;
  return Object.freeze({
    mode: 'adoption' as const,
    workspaceId: activeJournal.workspaceId,
    workspaceRoot: paths.finalRoot,
    assertCanAccept(profileId: string) {
      validateWorkspaceLineage({ formatVersion: 1, profileId });
    },
    async accept(profileId: string, ports: WorkspaceLegacyAdoptionAcceptancePorts) {
      const lineageIdentity = validateWorkspaceLineage({
        formatVersion: 1,
        profileId,
      });
      const selectedJournal = await readMatchingJournal(ports.journal, activeJournal);
      if (
        selectedJournal.state !== 'rootPublished' &&
        selectedJournal.state !== 'registryPublished'
      ) {
        throw new WorkspaceLegacyAdoptionError(
          'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
        );
      }
      let currentRegistry = await ports.registry.read();
      if (currentRegistry !== undefined) {
        const existing = requirePublishedRegistry(
          currentRegistry,
          activeJournal.workspaceId,
        );
        if (existing.lineageIdentity.profileId !== lineageIdentity.profileId) {
          await markRecoveryRequired(ports.journal, activeJournal);
          throw new WorkspaceLegacyAdoptionError(
            'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
          );
        }
      }
      await ports.publishBinding(profileId);
      if (currentRegistry === undefined) {
        currentRegistry = appendReadyWorkspaceEntry(
          readWorkspaceRegistry(undefined),
          createReadyWorkspaceEntry({
            workspaceId: activeJournal.workspaceId,
            workspaceLabel: defaultWorkspaceLabel,
            lineageIdentity,
            createdAt: activeJournal.createdAt,
          }),
        );
        await ports.registry.write(currentRegistry);
      }
      const currentJournal = await readMatchingJournal(ports.journal, activeJournal);
      if (currentJournal.state !== 'registryPublished') {
        await ports.journal.write({
          ...currentJournal,
          state: 'registryPublished',
        });
      }
      await ports.cleanup.discardCandidate(paths);
      await ports.journal.clear(activeJournal.operationId);
    },
    async recoverFromFailure(ports: { readonly journal: WorkspaceLegacyAdoptionJournalPort }) {
      await markRecoveryRequired(ports.journal, activeJournal);
      return 'notRecovered' as const;
    },
  });
}

async function preparePublishedRoot(
  options: Readonly<ResolveWorkspaceLegacyAdoptionStartupOptions>,
  paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  initialJournal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1>> {
  let journal = initialJournal;
  let presence = await options.rootStore.readPresence(paths);
  if (journal.state === 'prepared') {
    if (presence.finalExists && !presence.candidateExists) {
      await options.rootStore.inspectPublished(paths, journal.sourceKind);
      journal = Object.freeze({ ...journal, state: 'rootPublished' });
      await options.journal.write(journal);
    } else {
      if (presence.candidateExists || presence.finalExists) {
        return recoveryRequired(options.journal, journal);
      }
      await options.rootStore.prepareCandidate(paths, journal.sourceKind);
      journal = Object.freeze({ ...journal, state: 'candidatePrepared' });
      await options.journal.write(journal);
    }
  }
  if (journal.state === 'candidatePrepared') {
    presence = await options.rootStore.readPresence(paths);
    if (presence.candidateExists && !presence.finalExists) {
      await options.rootStore.inspectCandidate(paths, journal.sourceKind);
      await options.rootStore.publishCandidate(paths);
    } else if (!presence.candidateExists && presence.finalExists) {
      await options.rootStore.inspectPublished(paths, journal.sourceKind);
    } else {
      return recoveryRequired(options.journal, journal);
    }
    journal = Object.freeze({ ...journal, state: 'rootPublished' });
    await options.journal.write(journal);
  }
  if (
    journal.state !== 'rootPublished' &&
    journal.state !== 'registryPublished'
  ) {
    return recoveryRequired(options.journal, journal);
  }
  await options.rootStore.inspectPublished(paths, journal.sourceKind);
  return journal;
}

function requirePublishedRegistry(
  registry: Awaited<ReturnType<WorkspaceRegistryPort['read']>>,
  workspaceId: WorkspaceId,
) {
  const workspace =
    registry === undefined ? undefined : findWorkspaceEntry(registry, workspaceId);
  if (
    registry?.activeWorkspaceId !== workspaceId ||
    workspace === undefined ||
    workspace.lifecycleState !== 'ready'
  ) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
  return workspace;
}

async function markRecoveryRequired(
  journalPort: WorkspaceLegacyAdoptionJournalPort,
  journal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): Promise<void> {
  const current = await readMatchingJournal(journalPort, journal);
  if (current.state !== 'recoveryRequired') {
    await journalPort.write({ ...current, state: 'recoveryRequired' });
  }
}

async function readMatchingJournal(
  journalPort: WorkspaceLegacyAdoptionJournalPort,
  journal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1>> {
  const current = await journalPort.read();
  if (current === undefined) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
  try {
    assertWorkspaceLegacyAdoptionTransition(journal, current);
  } catch {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
  return current;
}

async function recoveryRequired(
  journalPort: WorkspaceLegacyAdoptionJournalPort,
  journal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): Promise<never> {
  await markRecoveryRequired(journalPort, journal);
  throw new WorkspaceLegacyAdoptionError(
    'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
  );
}
