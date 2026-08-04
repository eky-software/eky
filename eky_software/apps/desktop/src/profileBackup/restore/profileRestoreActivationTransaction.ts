import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';

import type {
  ProfileRestoreActivationJournal,
  ProfileRestoreActivationPhase,
} from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import { renameProfilePathWithRetry } from './profileRestoreFileMove.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    'clear' | 'read' | 'write'
  >;
  paths: ProfileRestoreActivationPaths;
}

export class ProfileRestoreActivationTransaction {
  private readonly paths: ProfileRestoreActivationPaths;

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

  async prepare(operationId: string): Promise<void> {
    validateOperationId(operationId);
    if ((await this.dependencies.journalStore.read()) !== undefined) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_BUSY');
    }

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

    await createPrivateDirectory(paths.rollbackOperationRoot);
    await this.writeJournal({
      formatVersion: 1,
      hadActiveDatabase,
      hadActiveDocuments,
      operationId,
      phase: 'prepared',
      revision: 0,
    });
  }

  async advanceToValidation(): Promise<ProfileRestoreActivationJournal> {
    let journal = await this.requireJournal();

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
        move: () => this.moveCurrentDatabase(journal),
      },
      {
        completedPhase: 'currentDocumentsMoved',
        intentPhase: 'movingCurrentDocuments',
        move: () => this.moveCurrentDocuments(journal),
      },
      {
        completedPhase: 'stagedDatabaseActivated',
        intentPhase: 'activatingStagedDatabase',
        move: () => this.activateStagedDatabase(journal),
      },
      {
        completedPhase: 'stagedDocumentsActivated',
        intentPhase: 'activatingStagedDocuments',
        move: () => this.activateStagedDocuments(journal),
      },
    ];

    for (const step of steps) {
      if (isAtOrAfter(journal.phase, step.completedPhase)) {
        continue;
      }
      if (journal.phase !== step.intentPhase) {
        journal = await this.advanceJournal(
          journal,
          step.intentPhase,
        );
      }
      await step.move();
      journal = await this.advanceJournal(
        journal,
        step.completedPhase,
      );
    }

    if (journal.phase !== 'validationStarting') {
      journal = await this.advanceJournal(
        journal,
        'validationStarting',
      );
    }
    return journal;
  }

  async accept(): Promise<void> {
    let journal = await this.requireJournal();
    if (journal.phase === 'accepted') {
      await this.cleanupAccepted(journal.operationId);
      return;
    }
    if (journal.phase !== 'validationStarting') {
      throw new Error('PROFILE_RESTORE_ACCEPT_INVALID');
    }

    journal = await this.advanceJournal(journal, 'accepted');
    await this.cleanupAccepted(journal.operationId);
  }

  async rollback(): Promise<ProfileRestoreActivationJournal> {
    let journal = await this.requireJournal();
    if (journal.phase === 'rolledBack') {
      return journal;
    }
    if (
      journal.phase === 'accepted' ||
      journal.phase === 'failedSafe'
    ) {
      throw new Error('PROFILE_RESTORE_ROLLBACK_INVALID');
    }

    if (journal.phase !== 'rollbackStarting') {
      journal = await this.advanceJournal(
        journal,
        'rollbackStarting',
      );
    }

    try {
      await this.restorePreviousProfile(journal);
      journal = await this.advanceJournal(journal, 'rolledBack');
      return journal;
    } catch {
      try {
        journal = await this.advanceJournal(journal, 'failedSafe');
      } catch {
        // The caller must stop all further writes even if journal persistence fails.
      }
      throw new Error('PROFILE_RESTORE_ROLLBACK_FAILED');
    }
  }

  async clearRolledBack(): Promise<void> {
    const journal = await this.requireJournal();
    if (journal.phase !== 'rolledBack') {
      throw new Error('PROFILE_RESTORE_ROLLBACK_INVALID');
    }
    await rm(this.operationPaths(journal.operationId).rollbackOperationRoot, {
      force: true,
      recursive: true,
    });
    await this.dependencies.journalStore.clear();
  }

  private async moveCurrentDatabase(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    const rollbackPath = this.operationPaths(
      journal.operationId,
    ).rollbackDatabasePath;
    await moveOptionalSlot({
      destinationPath: rollbackPath,
      expectedSource: journal.hadActiveDatabase,
      kind: 'file',
      sourcePath: this.paths.activeDatabasePath,
    });
  }

  private async moveCurrentDocuments(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    const rollbackPath = this.operationPaths(
      journal.operationId,
    ).rollbackDocumentsRoot;
    await moveOptionalSlot({
      destinationPath: rollbackPath,
      expectedSource: journal.hadActiveDocuments,
      kind: 'directory',
      sourcePath: this.paths.activeDocumentsRoot,
    });
  }

  private async activateStagedDatabase(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    await moveRequiredSlot({
      destinationPath: this.paths.activeDatabasePath,
      kind: 'file',
      sourcePath: this.operationPaths(journal.operationId)
        .stagedDatabasePath,
    });
    await chmod(this.paths.activeDatabasePath, 0o600);
  }

  private async activateStagedDocuments(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    await moveRequiredSlot({
      destinationPath: this.paths.activeDocumentsRoot,
      kind: 'directory',
      sourcePath: this.operationPaths(journal.operationId)
        .stagedDocumentsRoot,
    });
    await chmod(this.paths.activeDocumentsRoot, 0o700);
  }

  private async restorePreviousProfile(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    const paths = this.operationPaths(journal.operationId);
    await createPrivateDirectory(paths.failedOperationRoot);

    await rollbackSlot({
      activePath: this.paths.activeDocumentsRoot,
      failedPath: paths.failedActiveDocumentsRoot,
      hadOriginal: journal.hadActiveDocuments,
      kind: 'directory',
      rollbackPath: paths.rollbackDocumentsRoot,
    });
    await rollbackSlot({
      activePath: this.paths.activeDatabasePath,
      failedPath: paths.failedActiveDatabasePath,
      hadOriginal: journal.hadActiveDatabase,
      kind: 'file',
      rollbackPath: paths.rollbackDatabasePath,
    });

    if (await pathExists(paths.stagingOperationRoot)) {
      await moveRequiredSlot({
        destinationPath: paths.failedStagingRoot,
        kind: 'directory',
        sourcePath: paths.stagingOperationRoot,
      });
    }
  }

  private async cleanupAccepted(operationId: string): Promise<void> {
    const paths = this.operationPaths(operationId);
    await Promise.all([
      rm(paths.rollbackOperationRoot, {
        force: true,
        recursive: true,
      }),
      rm(paths.stagingOperationRoot, {
        force: true,
        recursive: true,
      }),
    ]);
    await this.dependencies.journalStore.clear();
  }

  private async requireJournal(): Promise<ProfileRestoreActivationJournal> {
    const journal = await this.dependencies.journalStore.read();
    if (journal === undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_REQUIRED');
    }
    return journal;
  }

  private async advanceJournal(
    journal: ProfileRestoreActivationJournal,
    phase: ProfileRestoreActivationPhase,
  ): Promise<ProfileRestoreActivationJournal> {
    const next: ProfileRestoreActivationJournal = {
      ...journal,
      phase,
      revision: journal.revision + 1,
    };
    await this.writeJournal(next);
    return next;
  }

  private async writeJournal(
    journal: ProfileRestoreActivationJournal,
  ): Promise<void> {
    await this.dependencies.journalStore.write(journal);
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

const orderedActivationPhases: readonly ProfileRestoreActivationPhase[] = [
  'prepared',
  'movingCurrentDatabase',
  'currentDatabaseMoved',
  'movingCurrentDocuments',
  'currentDocumentsMoved',
  'activatingStagedDatabase',
  'stagedDatabaseActivated',
  'activatingStagedDocuments',
  'stagedDocumentsActivated',
  'validationStarting',
];

function isAtOrAfter(
  current: ProfileRestoreActivationPhase,
  expected: ProfileRestoreActivationPhase,
): boolean {
  const currentIndex = orderedActivationPhases.indexOf(current);
  const expectedIndex = orderedActivationPhases.indexOf(expected);
  return (
    currentIndex >= 0 &&
    expectedIndex >= 0 &&
    currentIndex >= expectedIndex
  );
}

async function moveOptionalSlot(input: {
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

  await createPrivateDirectory(dirname(input.destinationPath));
  await renameProfilePathWithRetry(input);
  await syncDirectories([
    dirname(input.sourcePath),
    dirname(input.destinationPath),
  ]);
}

async function moveRequiredSlot(input: {
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

  await createPrivateDirectory(dirname(input.destinationPath));
  await renameProfilePathWithRetry(input);
  await syncDirectories([
    dirname(input.sourcePath),
    dirname(input.destinationPath),
  ]);
}

async function rollbackSlot(input: {
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
    });
  }

  await createPrivateDirectory(dirname(input.activePath));
  await renameProfilePathWithRetry({
    destinationPath: input.activePath,
    sourcePath: input.rollbackPath,
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

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await chmod(path, 0o700);
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
