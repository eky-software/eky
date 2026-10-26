import { promises as fileSystem } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';

import {
  assertProfileRestoreActivationJournalMatches as assertJournalMatches,
  captureProfileRestoreActivationJournal as captureJournal,
  captureProfileRestoreForwardProgress,
  profileRestoreForwardActivationPhases,
  type ProfileRestoreActivationJournal,
  type ProfileRestoreActivationPhase,
} from './profileRestoreActivationJournal.js';
import type {
  ProfileRestoreActivationJournalStore,
  ProfileRestoreJournalCreateAuthority,
  ProfileRestoreJournalWriteAuthority,
} from './profileRestoreActivationJournalStore.js';
import { renameProfilePathWithRetry } from './profileRestoreFileMove.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { readProfileRestoreForwardRecoverySlot } from './profileRestoreForwardRecoverySlot.js';
import {
  assertProfileRestoreCleanupEntry,
  assertProfileRestoreCleanupEntryIdentity,
  assertProfileRestoreCleanupRootAbsent,
  readProfileRestoreTerminalCleanupRoot,
  type ProfileRestoreTerminalCleanupCensus,
} from './profileRestoreTerminalCleanupCensus.js';
import {
  readProfileRestoreRollbackRecoverySlot,
  type ProfileRestoreOriginalRecoverySlot,
} from './profileRestoreRollbackRecoverySlot.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalCleanupReadBatchSize = 4;

interface ProfileRestoreActivationPaths {
  activeDatabasePath: string;
  activeDocumentsRoot: string;
  failedRoot: string;
  rollbackRoot: string;
  stagingRoot: string;
}

interface ProfileRestoreActivationTransactionDependencies {
  afterPhasePersisted?(
    phase: ProfileRestoreActivationPhase,
  ): Promise<void> | void;
  journalStore: Pick<
    ProfileRestoreActivationJournalStore,
    'clear' | 'peek' | 'read' | 'write'
  >;
  paths: ProfileRestoreActivationPaths;
}

export interface ProfileRestoreColdRollbackRoots {
  readonly anchorRoot: string;
  readonly anchorIdentity: string;
  readonly sources: readonly { readonly role: 'staging' | 'rollback'; readonly root: string; readonly identity: string }[];
}

export interface ProfileRestoreColdRollbackMutationAuthority {
  assertContent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
  beforeStagingMove(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
}

export interface ProfileRestoreTerminalMutationAuthority {
  readonly census: ProfileRestoreTerminalCleanupCensus;
  assertCurrent(journal: Readonly<ProfileRestoreActivationJournal>, removed: ReadonlySet<string>): Promise<void>;
}

export interface ProfileRestoreRollbackRootRemovalAuthority {
  readonly identity: string;
  assertCurrent(): void;
}

export function assertSynchronousRollbackRootAuthority(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

export class ProfileRestoreActivationTransaction {
  private readonly paths: ProfileRestoreActivationPaths;
  private readonly terminalCensuses = new WeakSet<ProfileRestoreTerminalCleanupCensus>();

  constructor(
    private readonly dependencies: ProfileRestoreActivationTransactionDependencies,
  ) {
    validatePaths(dependencies.paths);
    this.paths = {
      activeDatabasePath: resolve(
        dependencies.paths.activeDatabasePath,
      ),
      activeDocumentsRoot: resolve(
        dependencies.paths.activeDocumentsRoot,
      ),
      failedRoot: resolve(dependencies.paths.failedRoot),
      rollbackRoot: resolve(dependencies.paths.rollbackRoot),
      stagingRoot: resolve(dependencies.paths.stagingRoot),
    };
  }

  async prepare(
    operationId: string,
    assertAuthority?: () => Promise<void>,
    capturePreparation?: (journal: Readonly<ProfileRestoreActivationJournal>) => void,
  ): Promise<void> {
    validateOperationId(operationId);
    const assertAbsent = async () => {
      await assertAuthority?.();
      if ((await this.dependencies.journalStore.peek()) !== undefined) {
        throw new Error('PROFILE_RESTORE_ACTIVATION_BUSY');
      }
      await assertAuthority?.();
    };
    await assertAbsent();

    const paths = this.operationPaths(operationId);
    await Promise.all([
      assertRegularFile(paths.stagedDatabasePath),
      assertDirectory(paths.stagedDocumentsRoot),
      assertPathMissing(paths.rollbackOperationRoot),
      assertPathMissing(paths.failedOperationRoot),
    ]);
    const hadActiveDatabase = await inspectOptionalRegularFile(
      this.paths.activeDatabasePath,
    );
    const hadActiveDocuments = await inspectOptionalDirectory(
      this.paths.activeDocumentsRoot,
    );

    await assertAbsent();
    await createPrivateDirectory(paths.rollbackOperationRoot);
    await assertAbsent();
    const prepared = captureJournal({
      formatVersion: 1,
      hadActiveDatabase,
      hadActiveDocuments,
      operationId,
      phase: 'prepared',
      revision: 0,
    });
    capturePreparation?.(prepared);
    await this.writeJournal(prepared, {
      previous: undefined,
      assertAbsent: async () => { await assertAuthority?.(); },
      assertCurrent: journal => this.assertJournalMutation(journal, assertAuthority),
    });
  }

  async readPreparation(
    operationId: string,
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority?: () => Promise<void>,
  ): Promise<'notPrepared' | 'prepared'> {
    validateOperationId(operationId);
    const captured = expected === undefined ? undefined : captureJournal(expected);
    if (captured !== undefined && (captured.operationId !== operationId ||
        captured.phase !== 'prepared' || captured.revision !== 0)) {
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    await assertAuthority?.();
    // Reconciliation must not repair or adopt a journal from another preparation.
    const journal = captured !== undefined || assertAuthority !== undefined
      ? await this.dependencies.journalStore.peek()
      : await this.dependencies.journalStore.read();
    await assertAuthority?.();
    if (journal === undefined) {
      const paths = this.operationPaths(operationId);
      try {
        await assertPathMissing(paths.rollbackOperationRoot);
        await assertPathMissing(paths.failedOperationRoot);
        await assertAuthority?.();
        if ((captured !== undefined || assertAuthority !== undefined) &&
            (await this.dependencies.journalStore.peek()) !== undefined) {
          throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
        }
        await assertAuthority?.();
      } catch (error) {
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
      }
      return 'notPrepared';
    }
    if (journal.operationId !== operationId || journal.phase !== 'prepared' || journal.revision !== 0 ||
        (assertAuthority !== undefined && captured === undefined)) {
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    if (captured !== undefined) {
      assertJournalMatches(captured, journal);
      await this.assertJournalMutation(captured, assertAuthority);
    }
    return 'prepared';
  }

  async advanceToValidation(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    assertContent?: (journal: Readonly<ProfileRestoreActivationJournal>) => Promise<void>,
  ): Promise<ProfileRestoreActivationJournal> {
    if ((assertRecoveryAuthority !== undefined && expected === undefined) ||
        (assertContent !== undefined && (expected === undefined || assertRecoveryAuthority === undefined))) {
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    const captured = expected === undefined ? undefined : captureJournal(expected);
    let journal: ProfileRestoreActivationJournal;
    const assertCurrent = async () => {
      try { await assertRecoveryAuthority?.(); }
      catch (error) { throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error }); }
    };
    const assertMutation = async () => {
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
      await assertContent?.(captureJournal(journal));
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
    };
    // Directory preparation checks selection and layout; payload mutation still checks content.
    const assertPreparation = assertContent === undefined ? assertMutation : async () => {
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
      await this.readForwardRecoverySources(journal);
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
    };
    const writeAuthority = (): ProfileRestoreJournalWriteAuthority => assertContent === undefined ? ({
      previous: captureJournal(journal),
      assertCurrent: async (expectedJournal: Readonly<ProfileRestoreActivationJournal>) => {
        await this.assertJournalMutation(expectedJournal, assertRecoveryAuthority);
        await this.assertJournalMutation(expectedJournal, assertRecoveryAuthority);
      },
    }) : ({
      kind: 'separateContent',
      previous: captureJournal(journal),
      assertCurrent: current => this.assertJournalMutation(current, assertRecoveryAuthority),
      assertContent,
    });
    try {
      await assertCurrent();
      journal = await this.requireJournal(captured, assertRecoveryAuthority === undefined ? undefined : async () => {
        await assertCurrent();
        if (captured !== undefined) await assertContent?.(captured);
      });
      await assertCurrent();
      if (captured !== undefined) assertJournalMatches(captured, journal);
    } catch (error) {
      if (captured === undefined) throw error;
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }

    if (
      journal.phase === 'accepted' ||
      journal.phase === 'rolledBack' ||
      journal.phase === 'failedSafe'
    ) {
      return journal;
    }
    if (journal.phase === 'rollbackStarting') {
      throw new Error('PROFILE_RESTORE_ROLLBACK_REQUIRED');
    }

    const steps: readonly ActivationStep[] = [
      {
        completedPhase: 'currentDatabaseMoved',
        intentPhase: 'movingCurrentDatabase',
        move: () => this.moveCurrentDatabase(journal, assertMutation, assertPreparation),
      },
      {
        completedPhase: 'currentDocumentsMoved',
        intentPhase: 'movingCurrentDocuments',
        move: () => this.moveCurrentDocuments(journal, assertMutation, assertPreparation),
      },
      {
        completedPhase: 'stagedDatabaseActivated',
        intentPhase: 'activatingStagedDatabase',
        move: () => this.activateStagedDatabase(journal, assertMutation, assertPreparation),
      },
      {
        completedPhase: 'stagedDocumentsActivated',
        intentPhase: 'activatingStagedDocuments',
        move: () => this.activateStagedDocuments(journal, assertMutation, assertPreparation),
      },
    ];

    for (const step of steps) {
      if (isAtOrAfter(journal.phase, step.completedPhase)) {
        continue;
      }
      await assertCurrent();
      if (journal.phase !== step.intentPhase) {
        journal = await this.advanceJournal(
          journal,
          step.intentPhase,
          writeAuthority(),
        );
      }
      await assertCurrent();
      await step.move();
      await assertCurrent();
      journal = await this.advanceJournal(
        journal,
        step.completedPhase,
        writeAuthority(),
      );
      await assertCurrent();
    }

    if (journal.phase !== 'validationStarting') {
      await assertCurrent();
      journal = await this.advanceJournal(
        journal,
        'validationStarting',
        writeAuthority(),
      );
    }
    await assertCurrent();
    return journal;
  }

  async assertForwardRecoveryState(expected: Readonly<ProfileRestoreActivationJournal>): Promise<void> {
    await this.readForwardRecoverySources(expected);
  }

  async readOwnForwardProgress(
    prepared: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority: () => Promise<void>,
  ): Promise<Readonly<ProfileRestoreActivationJournal>> {
    const captured = captureJournal(prepared);
    if (captured.phase !== 'prepared' || captured.revision !== 0) {
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    await assertAuthority();
    const advanced = captureProfileRestoreForwardProgress(captured, await this.dependencies.journalStore.peek());
    await assertAuthority();
    await this.assertForwardRecoveryState(advanced);
    await this.assertJournalMutation(advanced, assertAuthority);
    return advanced;
  }

  async readForwardRecoverySources(expected: Readonly<ProfileRestoreActivationJournal>): Promise<Readonly<{
    databaseSlot: 'active' | 'staged';
    documentsSlot: 'active' | 'staged';
  }>> {
    const captured = captureJournal(expected);
    const assertJournalCurrent = async () => {
      assertJournalMatches(captured, await this.dependencies.journalStore.peek());
    };
    await assertJournalCurrent();
    const paths = this.operationPaths(captured.operationId);
    await Promise.all([
      assertDirectory(paths.stagingOperationRoot),
      assertDirectory(paths.rollbackOperationRoot),
      inspectRecoverySlot(paths.failedOperationRoot, 'directory').then(present => {
        if (present) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      }),
    ]);
    const database = await Promise.all([
      inspectRecoverySlot(this.paths.activeDatabasePath, 'file'),
      inspectRecoverySlot(paths.rollbackDatabasePath, 'file'),
      inspectRecoverySlot(paths.stagedDatabasePath, 'file'),
    ]);
    const documents = await Promise.all([
      inspectRecoverySlot(this.paths.activeDocumentsRoot, 'directory'),
      inspectRecoverySlot(paths.rollbackDocumentsRoot, 'directory'),
      inspectRecoverySlot(paths.stagedDocumentsRoot, 'directory'),
    ]);
    const databaseSlot = readProfileRestoreForwardRecoverySlot({
      phase: captured.phase, kind: 'database', hadActive: captured.hadActiveDatabase,
      slots: { activePresent: database[0]!, rollbackPresent: database[1]!, stagedPresent: database[2]! },
    });
    const documentsSlot = readProfileRestoreForwardRecoverySlot({
      phase: captured.phase, kind: 'documents', hadActive: captured.hadActiveDocuments,
      slots: { activePresent: documents[0]!, rollbackPresent: documents[1]!, stagedPresent: documents[2]! },
    });
    await assertJournalCurrent();
    return Object.freeze({ databaseSlot, documentsSlot });
  }

  async accept(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
  ): Promise<void> {
    const journal = await this.commitAcceptance(expected, assertRecoveryAuthority);
    await this.clearAccepted(journal, assertRecoveryAuthority);
  }

  async commitAcceptance(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    terminalAuthority?: ProfileRestoreTerminalMutationAuthority,
  ): Promise<Readonly<ProfileRestoreActivationJournal>> {
    const assertTerminal = terminalAuthority === undefined ? assertRecoveryAuthority : async () => {
      await this.assertTerminalMutation(expected!, new Set(), assertRecoveryAuthority, terminalAuthority);
      await this.assertTerminalCleanupCensus(terminalAuthority.census, new Set(), expected!);
      await this.assertTerminalMutation(expected!, new Set(), assertRecoveryAuthority, terminalAuthority);
    };
    if (terminalAuthority !== undefined && expected === undefined) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    const journal = await this.requireTerminalJournal(expected, assertTerminal);
    if (journal.phase === 'accepted') {
      return captureJournal(journal);
    }
    if (journal.phase !== 'validationStarting') {
      throw new Error('PROFILE_RESTORE_ACCEPT_INVALID');
    }

    await this.assertJournalMutation(journal, assertRecoveryAuthority);
    await this.assertForwardRecoveryState(journal);
    const census = terminalAuthority?.census ?? await this.readTerminalCleanupCensus(journal);
    const assertPublication = async (current: Readonly<ProfileRestoreActivationJournal>) => {
      await this.assertTerminalMutation(current, new Set(), assertRecoveryAuthority, terminalAuthority);
      await this.assertTerminalCleanupCensus(census, new Set(), current);
      await this.assertTerminalMutation(current, new Set(), assertRecoveryAuthority, terminalAuthority);
    };
    await assertPublication(journal);
    return captureJournal(await this.advanceJournal(
      journal, 'accepted', { previous: captureJournal(journal), assertCurrent: assertPublication },
    ));
  }

  async clearAccepted(
    expected: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    terminalAuthority?: ProfileRestoreTerminalMutationAuthority,
  ): Promise<void> {
    const assertTerminal = terminalAuthority === undefined ? assertRecoveryAuthority : async () => {
      await this.assertTerminalMutation(expected, new Set(), assertRecoveryAuthority, terminalAuthority);
      await this.assertTerminalCleanupCensus(terminalAuthority.census, new Set(), expected);
      await this.assertTerminalMutation(expected, new Set(), assertRecoveryAuthority, terminalAuthority);
    };
    const journal = await this.requireTerminalJournal(expected, assertTerminal);
    if (journal.phase !== 'accepted') throw new Error('PROFILE_RESTORE_ACCEPT_INVALID');
    await this.cleanupAccepted(journal, assertRecoveryAuthority, terminalAuthority);
  }

  async readTerminalCleanupCensus(
    expected: Readonly<ProfileRestoreActivationJournal>,
  ): Promise<ProfileRestoreTerminalCleanupCensus> {
    const journal = captureJournal(expected);
    if (journal.phase !== 'validationStarting' && journal.phase !== 'accepted') {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    await this.assertJournalMutation(journal);
    if (journal.phase === 'validationStarting') await this.assertForwardRecoveryState(journal);
    const paths = this.operationPaths(journal.operationId);
    await assertPathMissing(paths.failedOperationRoot);
    const roots = [];
    for (const [role, root] of [['rollback', paths.rollbackOperationRoot], ['staging', paths.stagingOperationRoot]] as const) {
      roots.push(await readProfileRestoreTerminalCleanupRoot({ journal, role, root }));
    }
    await this.assertJournalMutation(journal);
    const census = Object.freeze({ journal, roots: Object.freeze(roots) });
    this.terminalCensuses.add(census);
    await this.assertTerminalCleanupCensus(census);
    return census;
  }

  async assertTerminalCleanupCensus(
    census: ProfileRestoreTerminalCleanupCensus,
    removed: ReadonlySet<string> = new Set(),
    current: Readonly<ProfileRestoreActivationJournal> = census.journal,
  ): Promise<void> {
    if (!this.terminalCensuses.has(census)) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    const expected = census.journal.phase === 'validationStarting' && current.phase === 'accepted'
      ? { ...census.journal, phase: 'accepted' as const, revision: census.journal.revision + 1 } : census.journal;
    assertJournalMatches(expected, current);
    await this.assertJournalMutation(current);
    await assertPathMissing(this.operationPaths(census.journal.operationId).failedOperationRoot);
    for (const root of census.roots) {
      if (root.identity === undefined || removed.has(root.root)) {
        await assertProfileRestoreCleanupRootAbsent(root);
        continue;
      }
      if (await readWorkspaceProcessReservationIdentity(root.anchorRoot) !== root.anchorIdentity ||
          await readWorkspaceProcessReservationIdentity(root.root) !== root.identity) {
        throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      }
      let batch: (typeof root.entries)[number][] = [];
      const finishBatch = async () => {
        const entries = batch;
        batch = [];
        // Settle every started check before returning the first census-order failure.
        const results = await Promise.allSettled(entries.map(entry =>
          Promise.resolve().then(() => assertProfileRestoreCleanupEntry(entry, removed))));
        for (const result of results) {
          if (result.status === 'rejected') throw result.reason;
        }
      };
      for (const entry of root.entries) {
        if (removed.has(entry.path)) {
          await finishBatch();
          await assertPathMissing(entry.path);
        } else {
          batch.push(entry);
          if (batch.length === terminalCleanupReadBatchSize) await finishBatch();
        }
      }
      await finishBatch();
    }
    await this.assertJournalMutation(current);
  }

  async rollback(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    coldAuthority?: ProfileRestoreColdRollbackMutationAuthority,
  ): Promise<ProfileRestoreActivationJournal> {
    if (coldAuthority !== undefined && (expected === undefined || assertRecoveryAuthority === undefined ||
        (expected.phase !== 'validationStarting' && expected.phase !== 'rollbackStarting' && expected.phase !== 'rolledBack'))) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    let journal = await this.requireTerminalJournal(expected, coldAuthority === undefined ? assertRecoveryAuthority : async () => {
      await assertRecoveryAuthority!();
      await coldAuthority.assertContent(expected!);
    });
    if (journal.phase === 'rolledBack') {
      await this.assertRollbackMutation(journal, assertRecoveryAuthority, coldAuthority);
      return journal;
    }
    if (
      journal.phase === 'accepted' ||
      journal.phase === 'failedSafe'
    ) {
      throw new Error('PROFILE_RESTORE_ROLLBACK_INVALID');
    }

    if (journal.phase !== 'rollbackStarting') {
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
      if (coldAuthority === undefined) await this.assertForwardRecoveryState(journal);
      else await this.assertRollbackMutation(journal, assertRecoveryAuthority, coldAuthority);
      journal = await this.advanceJournal(
        journal,
        'rollbackStarting',
        coldAuthority === undefined ? this.journalMutationAuthority(journal, assertRecoveryAuthority)
          : this.coldRollbackJournalAuthority(journal, assertRecoveryAuthority!, coldAuthority),
      );
    }

    await this.assertRollbackMutation(journal, assertRecoveryAuthority, coldAuthority);
    try {
      await this.restorePreviousProfile(journal, () => this.assertRollbackMutation(journal, assertRecoveryAuthority, coldAuthority),
        coldAuthority === undefined ? undefined : () => coldAuthority.beforeStagingMove(journal));
      journal = await this.advanceJournal(journal, 'rolledBack', coldAuthority === undefined ? {
        previous: captureJournal(journal),
        assertCurrent: current => this.assertRollbackMutation(current, assertRecoveryAuthority, coldAuthority),
      } : this.coldRollbackJournalAuthority(journal, assertRecoveryAuthority!, coldAuthority));
      return journal;
    } catch (error) {
      if (coldAuthority === undefined) {
        try {
          journal = await this.advanceJournal(journal, 'failedSafe', this.journalMutationAuthority(journal, assertRecoveryAuthority));
        } catch {
          // The caller must stop all further writes even if journal persistence fails.
        }
      }
      throw new Error('PROFILE_RESTORE_ROLLBACK_FAILED', { cause: error });
    }
  }

  async clearRolledBack(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    beforeRollbackRootRemoval?: (journal: Readonly<ProfileRestoreActivationJournal>) => Promise<ProfileRestoreRollbackRootRemovalAuthority>,
  ): Promise<void> {
    const journal = await this.requireTerminalJournal(expected, assertRecoveryAuthority);
    if (journal.phase !== 'rolledBack') {
      throw new Error('PROFILE_RESTORE_ROLLBACK_INVALID');
    }
    await this.assertRollbackMutation(journal, assertRecoveryAuthority);
    const root = this.operationPaths(journal.operationId).rollbackOperationRoot;
    await assertEmptyRollbackOperationStructure(root);
    for (const path of [join(root, 'data'), join(root, 'storage'), root]) {
      await this.assertRollbackMutation(journal, assertRecoveryAuthority);
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
      await assertEmptyRollbackOperationStructure(root);
      if (!(await inspectRecoverySlot(path, 'directory'))) continue;
      if (path === root && beforeRollbackRootRemoval !== undefined) {
        const proof = await beforeRollbackRootRemoval(journal);
        const identity = proof.identity;
        const assertRootOwner = proof.assertCurrent.bind(proof);
        await this.assertRollbackMutation(journal, assertRecoveryAuthority);
        await this.assertJournalMutation(journal, assertRecoveryAuthority);
        await assertEmptyRollbackOperationStructure(root);
        if (await readWorkspaceProcessReservationIdentity(root) !== identity) {
          throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
        }
        assertSynchronousRollbackRootAuthority(assertRootOwner);
      }
      try {
        // A late entry must stop cleanup, never be recursively removed.
        await fileSystem.rmdir(path);
      } catch (error) {
        throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID', { cause: error });
      }
    }
    await this.dependencies.journalStore.clear(journal, async () => {
      await this.assertRollbackMutation(journal, assertRecoveryAuthority);
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
      await assertPathMissing(root);
    });
  }

  async readRollbackRecoverySources(expected: Readonly<ProfileRestoreActivationJournal>): Promise<Readonly<{
    databaseSlot: ProfileRestoreOriginalRecoverySlot;
    documentsSlot: ProfileRestoreOriginalRecoverySlot;
  }>> {
    const captured = captureJournal(expected);
    if (captured.phase !== 'validationStarting' && captured.phase !== 'rollbackStarting' && captured.phase !== 'rolledBack') {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    await this.assertJournalMutation(captured);
    const paths = this.operationPaths(captured.operationId);
    const [stagingPresent, rollbackPresent, failedPresent, failedStagingPresent] = await Promise.all([
      inspectRecoverySlot(paths.stagingOperationRoot, 'directory'),
      inspectRecoverySlot(paths.rollbackOperationRoot, 'directory'),
      inspectRecoverySlot(paths.failedOperationRoot, 'directory'),
      inspectRecoverySlot(paths.failedStagingRoot, 'directory'),
    ]);
    if (stagingPresent === failedStagingPresent || (failedStagingPresent && !failedPresent) ||
      ((captured.phase === 'validationStarting' || captured.phase === 'rollbackStarting') && !rollbackPresent) ||
      (captured.phase === 'rolledBack' && (stagingPresent || !failedStagingPresent))) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    if (failedPresent) await assertFailedOperationStructure(paths.failedOperationRoot);
    // Before rollback intent the stationary anchor is empty; no move may have started.
    if (captured.phase === 'validationStarting' && (failedStagingPresent ||
        (failedPresent && (await readdir(paths.failedOperationRoot)).length !== 0))) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    const readSlot = async (kind: 'file' | 'directory', hadActive: boolean, activePath: string, rollbackPath: string,
      stagedPath: string, failedPath: string, failedStagedPath: string) => {
      const [active, rollback, staged, failed, failedStaged] = await Promise.all([
        inspectRecoverySlot(activePath, kind),
        inspectRecoverySlot(rollbackPath, kind),
        inspectRecoverySlot(stagedPath, kind),
        inspectRecoverySlot(failedPath, kind),
        inspectRecoverySlot(failedStagedPath, kind),
      ]);
      if (staged && failedStaged) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      if (captured.phase === 'validationStarting' &&
          (!active || rollback !== hadActive || staged || failed || failedStaged)) {
        throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      }
      return readProfileRestoreRollbackRecoverySlot({
        phase: failedStagingPresent ? 'rolledBack' : captured.phase === 'validationStarting' ? 'rollbackStarting' : captured.phase, hadActive,
        slots: { activePresent: active!, rollbackPresent: rollback!, stagedPresent: staged! || failedStaged!, failedPresent: failed! },
      });
    };
    const databaseSlot = await readSlot('file', captured.hadActiveDatabase, this.paths.activeDatabasePath,
      paths.rollbackDatabasePath, paths.stagedDatabasePath, paths.failedActiveDatabasePath, paths.failedStagedDatabasePath);
    const documentsSlot = await readSlot('directory', captured.hadActiveDocuments, this.paths.activeDocumentsRoot,
      paths.rollbackDocumentsRoot, paths.stagedDocumentsRoot, paths.failedActiveDocumentsRoot, paths.failedStagedDocumentsRoot);
    if (failedStagingPresent && (databaseSlot === 'rollback' || documentsSlot === 'rollback')) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    await this.assertJournalMutation(captured);
    return Object.freeze({ databaseSlot, documentsSlot });
  }

  /** Prepares only the selected rollback's stationary anchor, never adopting unknown evidence. */
  async prepareColdRollbackAnchor(
    expected: Readonly<ProfileRestoreActivationJournal>,
    claimSources: (sources: ProfileRestoreColdRollbackRoots['sources']) => Promise<void>,
    assertRecoveryAuthority: () => Promise<void>,
  ): Promise<ProfileRestoreColdRollbackRoots> {
    const journal = captureJournal(expected);
    const paths = this.operationPaths(journal.operationId);
    const assertCurrent = async () => {
      await this.assertRollbackMutation(journal, assertRecoveryAuthority);
      await this.assertJournalMutation(journal, assertRecoveryAuthority);
    };
    await assertCurrent();
    const anchorPresent = await inspectRecoverySlot(paths.failedOperationRoot, 'directory');
    const previousAnchorIdentity = anchorPresent ? await readWorkspaceProcessReservationIdentity(paths.failedOperationRoot) : undefined;
    const sources: ProfileRestoreColdRollbackRoots['sources'][number][] = [];
    for (const [role, root] of [['staging', paths.stagingOperationRoot], ['rollback', paths.rollbackOperationRoot]] as const) {
      if (await inspectRecoverySlot(root, 'directory')) sources.push({ role, root, identity: await readWorkspaceProcessReservationIdentity(root) });
    }
    const selectedSources = Object.freeze(sources.map(source => Object.freeze(source)));
    await claimSources(selectedSources);
    await assertCurrent();
    if (anchorPresent !== await inspectRecoverySlot(paths.failedOperationRoot, 'directory')) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    if (previousAnchorIdentity !== undefined && previousAnchorIdentity !== await readWorkspaceProcessReservationIdentity(paths.failedOperationRoot)) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    if (!anchorPresent) {
      await createPrivateDirectory(this.paths.failedRoot, assertCurrent);
      await assertCurrent();
      // Exclusive leaf creation rejects a root that appeared after the last census.
      await mkdir(paths.failedOperationRoot, { mode: 0o700 });
    }
    await assertCurrent();
    const anchorIdentity = await readWorkspaceProcessReservationIdentity(paths.failedOperationRoot);
    await assertCurrent();
    return Object.freeze({ anchorRoot: paths.failedOperationRoot, anchorIdentity, sources: selectedSources });
  }

  private async moveCurrentDatabase(
    journal: ProfileRestoreActivationJournal,
    assertAuthority?: () => Promise<void>,
    assertPreparation?: () => Promise<void>,
  ): Promise<void> {
    const rollbackPath = this.operationPaths(
      journal.operationId,
    ).rollbackDatabasePath;
    await moveOptionalSlot({
      destinationPath: rollbackPath,
      expectedSource: journal.hadActiveDatabase,
      kind: 'file',
      sourcePath: this.paths.activeDatabasePath,
      ...(assertAuthority === undefined ? {} : { assertAuthority }),
      ...(assertPreparation === undefined ? {} : { assertPreparation }),
    });
  }

  private async moveCurrentDocuments(
    journal: ProfileRestoreActivationJournal,
    assertAuthority?: () => Promise<void>,
    assertPreparation?: () => Promise<void>,
  ): Promise<void> {
    const rollbackPath = this.operationPaths(
      journal.operationId,
    ).rollbackDocumentsRoot;
    await moveOptionalSlot({
      destinationPath: rollbackPath,
      expectedSource: journal.hadActiveDocuments,
      kind: 'directory',
      sourcePath: this.paths.activeDocumentsRoot,
      ...(assertAuthority === undefined ? {} : { assertAuthority }),
      ...(assertPreparation === undefined ? {} : { assertPreparation }),
    });
  }

  private async activateStagedDatabase(
    journal: ProfileRestoreActivationJournal,
    assertAuthority?: () => Promise<void>,
    assertPreparation?: () => Promise<void>,
  ): Promise<void> {
    await moveRequiredSlot({
      destinationPath: this.paths.activeDatabasePath,
      kind: 'file',
      sourcePath: this.operationPaths(journal.operationId)
        .stagedDatabasePath,
      ...(assertAuthority === undefined ? {} : { assertAuthority }),
      ...(assertPreparation === undefined ? {} : { assertPreparation }),
    });
    await assertAuthority?.();
    await chmod(this.paths.activeDatabasePath, 0o600);
  }

  private async activateStagedDocuments(
    journal: ProfileRestoreActivationJournal,
    assertAuthority?: () => Promise<void>,
    assertPreparation?: () => Promise<void>,
  ): Promise<void> {
    await moveRequiredSlot({
      destinationPath: this.paths.activeDocumentsRoot,
      kind: 'directory',
      sourcePath: this.operationPaths(journal.operationId)
        .stagedDocumentsRoot,
      ...(assertAuthority === undefined ? {} : { assertAuthority }),
      ...(assertPreparation === undefined ? {} : { assertPreparation }),
    });
    await assertAuthority?.();
    await chmod(this.paths.activeDocumentsRoot, 0o700);
  }

  private async restorePreviousProfile(
    journal: ProfileRestoreActivationJournal,
    assertAuthority: () => Promise<void>,
    beforeStagingMove?: () => Promise<void>,
  ): Promise<void> {
    const paths = this.operationPaths(journal.operationId);
    await createPrivateDirectory(paths.failedOperationRoot, assertAuthority);

    await rollbackSlot({
      activePath: this.paths.activeDocumentsRoot,
      failedPath: paths.failedActiveDocumentsRoot,
      hadOriginal: journal.hadActiveDocuments,
      kind: 'directory',
      rollbackPath: paths.rollbackDocumentsRoot,
      assertAuthority,
    });
    await rollbackSlot({
      activePath: this.paths.activeDatabasePath,
      failedPath: paths.failedActiveDatabasePath,
      hadOriginal: journal.hadActiveDatabase,
      kind: 'file',
      rollbackPath: paths.rollbackDatabasePath,
      assertAuthority,
    });

    if (await pathExists(paths.stagingOperationRoot)) {
      const stagingIdentity = beforeStagingMove === undefined ? undefined
        : await readWorkspaceProcessReservationIdentity(paths.stagingOperationRoot);
      await beforeStagingMove?.();
      const assertStagingAuthority = async () => {
        await assertAuthority();
        if (stagingIdentity !== undefined) {
          const source = await inspectRecoverySlot(paths.stagingOperationRoot, 'directory');
          const destination = await inspectRecoverySlot(paths.failedStagingRoot, 'directory');
          if (source === destination || stagingIdentity !== await readWorkspaceProcessReservationIdentity(
            source ? paths.stagingOperationRoot : paths.failedStagingRoot)) {
            throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
          }
        }
        await assertAuthority();
      };
      await moveRequiredSlot({
        destinationPath: paths.failedStagingRoot,
        kind: 'directory',
        sourcePath: paths.stagingOperationRoot,
        assertAuthority: assertStagingAuthority,
      });
      await assertStagingAuthority();
    }
  }

  private async cleanupAccepted(
    journal: ProfileRestoreActivationJournal,
    assertRecoveryAuthority?: () => Promise<void>,
    terminalAuthority?: ProfileRestoreTerminalMutationAuthority,
  ): Promise<void> {
    await this.assertJournalMutation(journal, assertRecoveryAuthority);
    const census = terminalAuthority?.census ?? await this.readTerminalCleanupCensus(journal);
    const removed = new Set<string>();
    // Only captured leaves are unlinked; a late directory entry makes rmdir fail, never recurse.
    for (const root of census.roots) {
      await this.assertTerminalMutation(journal, removed, assertRecoveryAuthority, terminalAuthority);
      await this.assertTerminalCleanupCensus(census, removed, journal);
      for (const entry of [...root.entries].reverse()) {
        await this.assertTerminalMutation(journal, removed, assertRecoveryAuthority, terminalAuthority);
        if (await readWorkspaceProcessReservationIdentity(root.anchorRoot) !== root.anchorIdentity) {
          throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
        }
        for (let ancestor = entry.parent; ancestor !== undefined; ancestor = ancestor.parent) {
          await assertProfileRestoreCleanupEntryIdentity(ancestor);
        }
        await assertProfileRestoreCleanupEntry(entry, removed);
        // The asynchronous identity reads must not outlive the deletion grant.
        await this.assertTerminalMutation(journal, removed, assertRecoveryAuthority, terminalAuthority);
        try {
          if (entry.kind === 'file') await fileSystem.unlink(entry.path);
          else await fileSystem.rmdir(entry.path);
        } catch (error) {
          throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID', { cause: error });
        }
        removed.add(entry.path);
        await assertPathMissing(entry.path);
      }
      await assertProfileRestoreCleanupRootAbsent(root);
    }
    await this.dependencies.journalStore.clear(journal, async () => {
      await this.assertTerminalMutation(journal, removed, assertRecoveryAuthority, terminalAuthority);
      await this.assertTerminalCleanupCensus(census, removed, journal);
      await this.assertTerminalMutation(journal, removed, assertRecoveryAuthority, terminalAuthority);
    });
  }

  private async assertTerminalMutation(
    journal: Readonly<ProfileRestoreActivationJournal>,
    removed: ReadonlySet<string>,
    assertRecoveryAuthority?: () => Promise<void>,
    terminalAuthority?: ProfileRestoreTerminalMutationAuthority,
  ): Promise<void> {
    await this.assertJournalMutation(journal);
    await assertRecoveryAuthority?.();
    await terminalAuthority?.assertCurrent(journal, removed);
  }

  private async requireTerminalJournal(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
  ): Promise<ProfileRestoreActivationJournal> {
    if (expected === undefined && assertRecoveryAuthority !== undefined) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    const captured = expected === undefined
      ? await this.dependencies.journalStore.peek()
      : captureJournal(expected);
    if (captured === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_REQUIRED');
    return this.requireJournal(captured, () => this.assertJournalMutation(captured, assertRecoveryAuthority));
  }

  private async assertJournalMutation(
    journal: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
  ): Promise<void> {
    await assertRecoveryAuthority?.();
    assertJournalMatches(journal, await this.dependencies.journalStore.peek());
    await assertRecoveryAuthority?.();
  }

  private journalMutationAuthority(
    journal: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
  ): ProfileRestoreJournalWriteAuthority {
    return {
      previous: captureJournal(journal),
      assertCurrent: current => this.assertJournalMutation(current, assertRecoveryAuthority),
    };
  }

  private async assertRollbackMutation(
    journal: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority?: () => Promise<void>,
    coldAuthority?: Pick<ProfileRestoreColdRollbackMutationAuthority, 'assertContent'>,
  ): Promise<void> {
    await this.assertJournalMutation(journal, assertRecoveryAuthority);
    await this.readRollbackRecoverySources(journal);
    await coldAuthority?.assertContent(journal);
    await this.assertJournalMutation(journal, assertRecoveryAuthority);
  }

  private coldRollbackJournalAuthority(
    journal: Readonly<ProfileRestoreActivationJournal>,
    assertRecoveryAuthority: () => Promise<void>,
    coldAuthority: ProfileRestoreColdRollbackMutationAuthority,
  ): ProfileRestoreJournalWriteAuthority {
    return {
      kind: 'separateContent',
      previous: captureJournal(journal),
      assertCurrent: current => this.assertRollbackMutation(current, assertRecoveryAuthority),
      assertContent: current => coldAuthority.assertContent(current),
    };
  }

  private async requireJournal(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority?: () => Promise<void>,
  ): Promise<ProfileRestoreActivationJournal> {
    const journal = expected === undefined
      ? await this.dependencies.journalStore.read()
      : await this.dependencies.journalStore.read(expected, assertAuthority);
    if (journal === undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_REQUIRED');
    }
    return journal;
  }

  private async advanceJournal(
    journal: ProfileRestoreActivationJournal,
    phase: ProfileRestoreActivationPhase,
    authority?: ProfileRestoreJournalWriteAuthority,
  ): Promise<ProfileRestoreActivationJournal> {
    const next: ProfileRestoreActivationJournal = {
      ...journal,
      phase,
      revision: journal.revision + 1,
    };
    await this.writeJournal(next, authority);
    return next;
  }

  private async writeJournal(
    journal: ProfileRestoreActivationJournal,
    authority?: ProfileRestoreJournalWriteAuthority | ProfileRestoreJournalCreateAuthority,
  ): Promise<void> {
    await this.dependencies.journalStore.write(journal, authority);
    await this.dependencies.afterPhasePersisted?.(journal.phase);
  }

  private operationPaths(operationId: string) {
    validateOperationId(operationId);
    const stagingOperationRoot = join(
      this.paths.stagingRoot,
      operationId,
    );
    const rollbackOperationRoot = join(
      this.paths.rollbackRoot,
      operationId,
    );
    const failedOperationRoot = join(
      this.paths.failedRoot,
      operationId,
    );
    return {
      failedActiveDatabasePath: join(
        failedOperationRoot,
        'active',
        'data',
        'eky.sqlite',
      ),
      failedActiveDocumentsRoot: join(
        failedOperationRoot,
        'active',
        'storage',
        'invoices',
      ),
      failedOperationRoot,
      failedStagingRoot: join(failedOperationRoot, 'staging'),
      failedStagedDatabasePath: join(failedOperationRoot, 'staging', 'profile.sqlite'),
      failedStagedDocumentsRoot: join(failedOperationRoot, 'staging', 'activation', 'storage', 'invoices'),
      rollbackDatabasePath: join(
        rollbackOperationRoot,
        'data',
        'eky.sqlite',
      ),
      rollbackDocumentsRoot: join(
        rollbackOperationRoot,
        'storage',
        'invoices',
      ),
      rollbackOperationRoot,
      stagedDatabasePath: join(
        stagingOperationRoot,
        'profile.sqlite',
      ),
      stagedDocumentsRoot: join(
        stagingOperationRoot,
        'activation',
        'storage',
        'invoices',
      ),
      stagingOperationRoot,
    };
  }
}

interface ActivationStep {
  completedPhase: ProfileRestoreActivationPhase;
  intentPhase: ProfileRestoreActivationPhase;
  move(): Promise<void>;
}

async function assertEmptyRollbackOperationStructure(root: string): Promise<void> {
  const levels = [
    [root, ['data', 'storage']],
    [join(root, 'data'), []],
    [join(root, 'storage'), []],
  ] as const;
  for (const [path, allowed] of levels) {
    if (!(await inspectRecoverySlot(path, 'directory'))) continue;
    if ((await readdir(path)).some(name => !(allowed as readonly string[]).includes(name))) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
  }
}

async function assertFailedOperationStructure(root: string): Promise<void> {
  const levels = [
    [root, ['active', 'staging']],
    [join(root, 'active'), ['data', 'storage']],
    [join(root, 'active', 'data'), ['eky.sqlite']],
    [join(root, 'active', 'storage'), ['invoices']],
  ] as const;
  for (const [path, allowed] of levels) {
    if (!(await inspectRecoverySlot(path, 'directory'))) continue;
    if ((await readdir(path)).some(name => !(allowed as readonly string[]).includes(name))) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
  }
}

async function inspectRecoverySlot(path: string, kind: 'directory' | 'file'): Promise<boolean> {
  const present = await inspectOptionalPath(path, kind);
  if (!present) {
    let parent = dirname(path);
    while (!(await inspectOptionalDirectory(parent))) {
      const next = dirname(parent);
      if (next === parent) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      parent = next;
    }
  }
  return present;
}

function isAtOrAfter(
  current: ProfileRestoreActivationPhase,
  expected: ProfileRestoreActivationPhase,
): boolean {
  const phases: readonly ProfileRestoreActivationPhase[] = profileRestoreForwardActivationPhases;
  const currentIndex = phases.indexOf(current);
  const expectedIndex = phases.indexOf(expected);
  return (
    currentIndex >= 0 &&
    expectedIndex >= 0 &&
    currentIndex >= expectedIndex
  );
}

async function moveOptionalSlot(input: {
  assertAuthority?: () => Promise<void>;
  assertPreparation?: () => Promise<void>;
  destinationPath: string;
  expectedSource: boolean;
  kind: 'directory' | 'file';
  sourcePath: string;
}): Promise<void> {
  const sourceExists = await inspectOptionalPath(
    input.sourcePath,
    input.kind,
  );
  const destinationExists = await inspectOptionalPath(
    input.destinationPath,
    input.kind,
  );

  if (!input.expectedSource) {
    if (sourceExists || destinationExists) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    return;
  }
  if (!sourceExists && destinationExists) {
    return;
  }
  if (!sourceExists || destinationExists) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }

  await createPrivateDirectory(dirname(input.destinationPath), input.assertPreparation ?? input.assertAuthority);
  await renameProfilePathWithRetry(input);
  await syncDirectories([
    dirname(input.sourcePath),
    dirname(input.destinationPath),
  ]);
}

async function moveRequiredSlot(input: {
  assertAuthority?: () => Promise<void>;
  assertPreparation?: () => Promise<void>;
  destinationPath: string;
  kind: 'directory' | 'file';
  sourcePath: string;
}): Promise<void> {
  const sourceExists = await inspectOptionalPath(
    input.sourcePath,
    input.kind,
  );
  const destinationExists = await inspectOptionalPath(
    input.destinationPath,
    input.kind,
  );

  if (!sourceExists && destinationExists) {
    return;
  }
  if (!sourceExists || destinationExists) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }

  await createPrivateDirectory(dirname(input.destinationPath), input.assertPreparation ?? input.assertAuthority);
  await renameProfilePathWithRetry(input);
  await syncDirectories([
    dirname(input.sourcePath),
    dirname(input.destinationPath),
  ]);
}

async function rollbackSlot(input: {
  assertAuthority: () => Promise<void>;
  activePath: string;
  failedPath: string;
  hadOriginal: boolean;
  kind: 'directory' | 'file';
  rollbackPath: string;
}): Promise<void> {
  const activeExists = await inspectOptionalPath(
    input.activePath,
    input.kind,
  );
  const rollbackExists = await inspectOptionalPath(
    input.rollbackPath,
    input.kind,
  );

  if (!rollbackExists) {
    if (input.hadOriginal) {
      if (!activeExists) {
        throw new Error('PROFILE_RESTORE_ROLLBACK_STATE_INVALID');
      }
      return;
    }
    if (activeExists) {
      await moveRequiredSlot({
        destinationPath: input.failedPath,
        kind: input.kind,
        sourcePath: input.activePath,
        assertAuthority: input.assertAuthority,
      });
    }
    return;
  }

  if (!input.hadOriginal) {
    throw new Error('PROFILE_RESTORE_ROLLBACK_STATE_INVALID');
  }
  if (activeExists) {
    if (await inspectOptionalPath(input.failedPath, input.kind)) {
      throw new Error('PROFILE_RESTORE_ROLLBACK_STATE_INVALID');
    }
    await moveRequiredSlot({
      destinationPath: input.failedPath,
      kind: input.kind,
      sourcePath: input.activePath,
      assertAuthority: input.assertAuthority,
    });
  }

  await createPrivateDirectory(dirname(input.activePath), input.assertAuthority);
  await renameProfilePathWithRetry({
    destinationPath: input.activePath,
    sourcePath: input.rollbackPath,
    assertAuthority: input.assertAuthority,
  });
  await syncDirectories([
    dirname(input.rollbackPath),
    dirname(input.activePath),
  ]);
}

async function inspectOptionalRegularFile(path: string): Promise<boolean> {
  return inspectOptionalPath(path, 'file');
}

async function inspectOptionalDirectory(path: string): Promise<boolean> {
  return inspectOptionalPath(path, 'directory');
}

async function inspectOptionalPath(
  path: string,
  kind: 'directory' | 'file',
): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    const valid =
      !metadata.isSymbolicLink() &&
      (kind === 'file'
        ? metadata.isFile() && metadata.nlink === 1
        : metadata.isDirectory());
    if (!valid || !pathsAreEqual(await realpath(path), path)) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function assertRegularFile(path: string): Promise<void> {
  if (!(await inspectOptionalRegularFile(path))) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

async function assertDirectory(path: string): Promise<void> {
  if (!(await inspectOptionalDirectory(path))) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

async function assertPathMissing(path: string): Promise<void> {
  if (await pathExists(path)) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function createPrivateDirectory(path: string, assertAuthority?: () => Promise<void>): Promise<void> {
  await assertAuthority?.();
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertAuthority?.();
  await chmod(path, 0o700);
  await assertAuthority?.();
  if (!(await inspectOptionalDirectory(path))) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

async function syncDirectories(paths: readonly string[]): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  for (const path of new Set(paths)) {
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function validatePaths(paths: ProfileRestoreActivationPaths): void {
  const values = Object.values(paths);
  if (
    values.some(
      (path) =>
        !isAbsolute(path) ||
        path.includes('\0') ||
        path.length > 4_096,
    ) ||
    new Set(values.map((path) => normalizedPath(path))).size !==
      values.length
  ) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_PATHS_INVALID');
  }
}

function validateOperationId(operationId: string): void {
  if (!operationIdPattern.test(operationId)) {
    throw new Error('PROFILE_RESTORE_OPERATION_INVALID');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  return normalizedPath(first) === normalizedPath(second);
}

function normalizedPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
