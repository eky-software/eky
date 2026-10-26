import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction, ProfileRestoreRollbackRootRemovalAuthority, ProfileRestoreTerminalMutationAuthority } from './profileRestoreActivationTransaction.js';
import { assertSynchronousRollbackRootAuthority } from './profileRestoreActivationTransaction.js';
import {
  assertProfileRestoreActivationJournalMatches,
  captureProfileRestoreActivationJournal,
  captureProfileRestoreForwardProgress,
  profileRestoreForwardActivationPhases,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';

export interface ProfileRestoreColdForwardAdmission {
  readonly journal: Readonly<ProfileRestoreActivationJournal>;
  assertCurrent(): Promise<void>;
  assertContent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
}

export interface ProfileRestoreColdRollbackAdmission extends ProfileRestoreColdForwardAdmission {
  readonly kind: 'rollback';
  beforeStagingMove(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
  beforeRollbackRootRemoval?(journal: Readonly<ProfileRestoreActivationJournal>): Promise<ProfileRestoreRollbackRootRemovalAuthority>;
}

export type ProfileRestoreStartupMode =
  | 'normal'
  | 'validateAcceptedProfile'
  | 'validateRestoredProfile'
  | 'validateRolledBackProfile';

export type ProfileRestoreStartupValidationResult =
  | 'ready'
  | 'restoredProfileReady'
  | 'relaunchRequired';

export type ProfileRestoreTerminalAcceptance = (
  journal: Readonly<ProfileRestoreActivationJournal>,
  use: (authority: ProfileRestoreTerminalMutationAuthority) => Promise<void>,
) => Promise<void>;

export type ProfileRestoreRollbackAcceptance = (
  journal: Readonly<ProfileRestoreActivationJournal>,
  use: (admission: ProfileRestoreColdRollbackAdmission) => Promise<void>,
) => Promise<void>;

interface ProfileRestoreStartupRecoveryDependencies {
  journalStore: Pick<ProfileRestoreActivationJournalStore, 'peek' | 'read'>;
  observer?: ProfileRecoveryOperationalObserver;
  withTerminalAuthority?: ProfileRestoreTerminalAcceptance;
  withRollbackAuthority?: ProfileRestoreRollbackAcceptance;
  transaction: Pick<
    ProfileRestoreActivationTransaction,
    | 'commitAcceptance'
    | 'clearAccepted'
    | 'advanceToValidation'
    | 'assertForwardRecoveryState'
    | 'clearRolledBack'
    | 'rollback'
  >;
}

export class ProfileRestoreStartupRecovery {
  private activeCorrelationId: string | undefined;
  private selectedJournal: Readonly<ProfileRestoreActivationJournal> | undefined;
  private restoredProfileAwaitingDecision = false;
  private acceptanceState: 'notStarted' | 'unverified' | 'committed' = 'notStarted';
  private selectorReturnState: 'unused' | 'active' | 'complete' | 'failed' = 'unused';
  private activeStartupOperations = 0;

  constructor(
    private readonly dependencies: ProfileRestoreStartupRecoveryDependencies,
  ) {}

  async prepareBeforeBackend(
    admission?: ProfileRestoreColdForwardAdmission | ProfileRestoreColdRollbackAdmission,
    selected?: Readonly<ProfileRestoreActivationJournal>,
  ): Promise<ProfileRestoreStartupMode> {
    return this.runStartupOperation(() => this.prepareStartup(admission, selected));
  }

  private async prepareStartup(
    admission?: ProfileRestoreColdForwardAdmission | ProfileRestoreColdRollbackAdmission,
    selected?: Readonly<ProfileRestoreActivationJournal>,
  ): Promise<ProfileRestoreStartupMode> {
    this.restoredProfileAwaitingDecision = false;
    this.activeCorrelationId = undefined;
    this.selectedJournal = undefined;
    this.acceptanceState = 'notStarted';
    const expected = admission === undefined
      ? selected === undefined ? undefined : captureProfileRestoreActivationJournal(selected)
      : captureProfileRestoreActivationJournal(admission.journal);
    this.activeCorrelationId = expected?.operationId;
    const rollbackAdmission = admission !== undefined && 'kind' in admission && admission.kind === 'rollback'
      ? admission : undefined;
    const assertCurrent = async () => {
      try { await admission?.assertCurrent(); }
      catch (error) { throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error }); }
    };
    let stored: ProfileRestoreActivationJournal | undefined;
    try {
      if (admission !== undefined && expected !== undefined && (rollbackAdmission === undefined
          ? !(profileRestoreForwardActivationPhases as readonly string[]).includes(expected.phase)
          : expected.phase !== 'rollbackStarting' && expected.phase !== 'rolledBack')) {
        throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      }
      await assertCurrent();
      const deferTerminalRepair = admission === undefined &&
        (expected?.phase === 'accepted' || this.dependencies.withTerminalAuthority !== undefined);
      if (deferTerminalRepair) {
        stored = await this.dependencies.journalStore.peek();
        if (expected !== undefined) assertProfileRestoreActivationJournalMatches(expected, stored);
      }
      // Accepted cold state has no deletion grant until fresh live validation.
      if (!deferTerminalRepair || stored?.phase !== 'accepted') stored = expected === undefined
        ? await this.dependencies.journalStore.read()
        : admission === undefined ? await this.dependencies.journalStore.read(expected)
          : await this.dependencies.journalStore.read(expected, () => admission.assertContent(expected));
      await assertCurrent();
      if (expected !== undefined) assertProfileRestoreActivationJournalMatches(expected, stored);
    } catch (error) {
      if (admission === undefined) throw error;
      this.observeRecoveryRequired('startupRollback');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }
    if (stored === undefined) {
      this.activeCorrelationId = undefined;
      return 'normal';
    }
    const journal = Object.freeze({ ...stored });
    this.selectedJournal = journal;
    this.activeCorrelationId = journal.operationId;
    if (journal.phase === 'failedSafe') {
      this.observeRecoveryRequired('failedSafeJournal');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    if (journal.phase === 'accepted') {
      this.acceptanceState = 'committed';
      return 'validateAcceptedProfile';
    }
    if (journal.phase === 'rolledBack') {
      this.assertOriginalDatabasePresent();
      return 'validateRolledBackProfile';
    }
    if (journal.phase === 'rollbackStarting') {
      this.assertOriginalDatabasePresent();
      await this.rollbackOrFail('startupRollback', rollbackAdmission);
      return 'validateRolledBackProfile';
    }

    // An ambiguous slot is not permission to overwrite or roll back its evidence.
    try {
      await assertCurrent();
      await this.dependencies.transaction.assertForwardRecoveryState(journal);
      await assertCurrent();
    } catch (error) {
      this.observeRecoveryRequired('startupRollback');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }

    try {
      if (admission === undefined) {
        this.selectedJournal = captureProfileRestoreActivationJournal(
          await this.dependencies.transaction.advanceToValidation(journal),
        );
      } else {
        this.selectedJournal = captureProfileRestoreActivationJournal(
          await this.dependencies.transaction.advanceToValidation(journal, assertCurrent, admission.assertContent),
        );
      }
      await assertCurrent();
      return 'validateRestoredProfile';
    } catch (error) {
      if (admission !== undefined) {
        // Forward ownership is not a grant to move the operation into rollback.
        this.observeRecoveryRequired('startupRollback');
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
      }
      if (error instanceof Error && error.message === 'PROFILE_RESTORE_RECOVERY_REQUIRED') {
        this.observeRecoveryRequired('startupRollback');
        throw error;
      }
      await this.rollbackInterruptedForward(journal, error);
      this.assertOriginalDatabasePresent(error);
      return 'validateRolledBackProfile';
    }
  }

  async validateAfterBackend(input: {
    deferRestoredProfileAcceptance?: boolean;
    mode: ProfileRestoreStartupMode;
    stopBackend(): Promise<void>;
    validateActiveProfile(): Promise<void>;
  }): Promise<ProfileRestoreStartupValidationResult> {
    return this.runStartupOperation(() => this.validateStartup(input));
  }

  private async validateStartup(
    input: Parameters<ProfileRestoreStartupRecovery['validateAfterBackend']>[0],
  ): Promise<ProfileRestoreStartupValidationResult> {
    if (input.mode === 'normal') {
      this.activeCorrelationId = undefined;
      return 'ready';
    }

    const startedAt = Date.now();
    try {
      await input.validateActiveProfile();
    } catch (error) {
      this.observeValidation({
        durationMs: Date.now() - startedAt,
        errorCode: readProfileInspectionFailureCause(error) ??
          readSafeStartupRecoveryErrorCode(error),
        eventName: 'restore.validationFailed',
        retryable: false,
        sideEffectState: 'unknown',
        stage: input.mode === 'validateRolledBackProfile' ? 'rolledBackProfile' : 'restoredProfile',
      });
      try {
        await input.stopBackend();
      } catch (stopError) {
        this.observeRecoveryRequired('startupRollback');
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', {
          cause: new AggregateError([error, stopError], 'PROFILE_RESTORE_RECOVERY_REQUIRED'),
        });
      }
      if (input.mode === 'validateRolledBackProfile' || input.mode === 'validateAcceptedProfile') {
        this.observeRecoveryRequired(input.mode === 'validateRolledBackProfile' ? 'rolledBackProfile' : 'startupRollback');
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
      }
      try { await this.rollbackAfterStoppedBackend(); }
      catch (rollbackError) {
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', {
          cause: new AggregateError([error, rollbackError], 'PROFILE_RESTORE_RECOVERY_REQUIRED'),
        });
      }
      this.assertOriginalDatabasePresent(error);
      return 'relaunchRequired';
    }
    this.observeValidation({
      durationMs: Date.now() - startedAt,
      eventName: 'restore.validationCompleted',
      stage: input.mode === 'validateRolledBackProfile' ? 'rolledBackProfile' : 'restoredProfile',
    });
    if (input.mode !== 'validateRolledBackProfile' && input.deferRestoredProfileAcceptance === true) {
      this.restoredProfileAwaitingDecision = true;
      return 'restoredProfileReady';
    }
    try {
      if (input.mode === 'validateRolledBackProfile') {
        await this.dependencies.transaction.clearRolledBack(this.requireSelectedJournal());
        this.selectedJournal = undefined;
      } else {
        await this.finishAcceptance();
      }
      this.activeCorrelationId = undefined;
      return 'ready';
    } catch (error) {
      this.observeRecoveryRequired('startupRollback');
      try { await input.stopBackend(); }
      catch (stopError) {
        throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', {
          cause: new AggregateError([error, stopError], 'PROFILE_RESTORE_RECOVERY_REQUIRED'),
        });
      }
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }
  }

  async acceptValidatedRestoredProfile(input: {
    assertTargetCanAccept(): void;
  }): Promise<void> {
    return this.runStartupOperation(async () => {
      this.assertRestoredProfileAwaitingDecision();
      input.assertTargetCanAccept();
      await this.finishAcceptance();
      this.restoredProfileAwaitingDecision = false;
      this.activeCorrelationId = undefined;
    });
  }

  async rollbackValidatedRestoredProfile(): Promise<void> {
    return this.runStartupOperation(async () => {
      this.assertRestoredProfileAwaitingDecision();
      if (this.acceptanceState !== 'notStarted') throw new Error('PROFILE_RESTORE_DECISION_INVALID');
      await this.rollbackAfterStoppedBackend();
      this.restoredProfileAwaitingDecision = false;
      this.assertOriginalDatabasePresent();
    });
  }

  readAcceptanceState(): 'notStarted' | 'unverified' | 'committed' {
    return this.acceptanceState;
  }

  /** Cold original-content validation grants selector return, not business readiness. */
  async completeRolledBackBeforeSelectorReturn(admission: ProfileRestoreColdRollbackAdmission): Promise<void> {
    this.assertStartupContinuation();
    if (this.activeStartupOperations !== 0) throw new Error('PROFILE_RESTORE_DECISION_INVALID');
    this.selectorReturnState = 'active';
    try {
      const selected = this.requireSelectedJournal();
      if (selected.phase !== 'rolledBack' || !selected.hadActiveDatabase || admission.kind !== 'rollback' ||
          admission.beforeRollbackRootRemoval === undefined) {
        throw new Error('PROFILE_RESTORE_DECISION_INVALID');
      }
      assertProfileRestoreActivationJournalMatches(selected, admission.journal);
      const assertCurrent = admission.assertCurrent.bind(admission);
      const assertContent = admission.assertContent.bind(admission);
      const releaseRollbackRoot = admission.beforeRollbackRootRemoval.bind(admission);
      const assertSelected = () => {
        if (this.selectorReturnState !== 'active' || this.selectedJournal !== selected ||
            this.acceptanceState !== 'notStarted' || this.restoredProfileAwaitingDecision) {
          throw new Error('PROFILE_RESTORE_DECISION_INVALID');
        }
      };
      const assertAuthority = async () => {
        assertSelected();
        await assertCurrent();
        assertSelected();
      };
      const assertOriginal = async () => {
        await assertAuthority();
        await assertContent(selected);
        await assertAuthority();
      };
      await assertOriginal();
      await this.dependencies.transaction.clearRolledBack(selected, assertOriginal, async journal => {
        assertProfileRestoreActivationJournalMatches(selected, journal);
        await assertOriginal();
        const proof = await releaseRollbackRoot(selected);
        const identity = proof.identity;
        const assertRootOwner = proof.assertCurrent.bind(proof);
        await assertAuthority();
        return Object.freeze({ identity, assertCurrent() {
          assertSelected(); assertSynchronousRollbackRootAuthority(assertRootOwner);
        } });
      });
      await assertAuthority();
      const remaining = await this.dependencies.journalStore.peek();
      await assertAuthority();
      if (remaining !== undefined) throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
      this.selectedJournal = undefined;
      this.activeCorrelationId = undefined;
      this.selectorReturnState = 'complete';
    } catch (error) {
      this.selectorReturnState = 'failed';
      this.observeRecoveryRequired('rolledBackProfile');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }
  }

  private assertStartupContinuation(): void {
    if (this.selectorReturnState !== 'unused') {
      this.selectorReturnState = 'failed';
      throw new Error('PROFILE_RESTORE_DECISION_INVALID');
    }
  }

  private async runStartupOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertStartupContinuation();
    this.activeStartupOperations++;
    try { return await operation(); }
    finally { this.activeStartupOperations--; }
  }

  private async finishAcceptance(): Promise<void> {
    const selected = this.requireSelectedJournal();
    const startedAt = Date.now();
    let stage: 'acceptancePreparation' | 'acceptanceCommit' | 'acceptedCleanup' = 'acceptancePreparation';
    const finish = async (authority?: ProfileRestoreTerminalMutationAuthority) => {
      if (this.acceptanceState === 'notStarted') {
        stage = 'acceptanceCommit';
        // Publication can succeed before a readback fails; uncertainty is not rollback authority.
        this.acceptanceState = 'unverified';
        const accepted = captureProfileRestoreActivationJournal(
          await (authority === undefined
            ? this.dependencies.transaction.commitAcceptance(selected)
            : this.dependencies.transaction.commitAcceptance(selected, undefined, authority)),
        );
        assertProfileRestoreActivationJournalMatches({
          ...selected, phase: 'accepted', revision: selected.revision + 1,
        }, accepted);
        this.selectedJournal = accepted;
        this.acceptanceState = 'committed';
      }
      if (this.acceptanceState !== 'committed') throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
      stage = 'acceptedCleanup';
      if (authority === undefined) await this.dependencies.transaction.clearAccepted(this.requireSelectedJournal());
      else await this.dependencies.transaction.clearAccepted(this.requireSelectedJournal(), undefined, authority);
      this.selectedJournal = undefined;
    };
    try {
      if (this.dependencies.withTerminalAuthority === undefined) await finish();
      else await this.dependencies.withTerminalAuthority(selected, finish);
    } catch (error) {
      observeProfileRecoverySafely(this.dependencies.observer ?? noOpProfileRecoveryOperationalObserver, {
        eventName: 'restore.acceptanceFailed', correlationId: selected.operationId,
        durationMs: Date.now() - startedAt, stage,
        errorCode: readProfileInspectionFailureCause(error) ?? 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        retryable: false, sideEffectState: 'unknown',
      });
      throw error;
    }
  }

  private assertOriginalDatabasePresent(firstFailure?: unknown): void {
    if (!this.requireSelectedJournal().hadActiveDatabase) {
      this.observeRecoveryRequired('rolledBackProfile');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: firstFailure });
    }
  }

  private assertRestoredProfileAwaitingDecision(): void {
    if (!this.restoredProfileAwaitingDecision) {
      throw new Error('PROFILE_RESTORE_DECISION_INVALID');
    }
  }

  private requireSelectedJournal(): Readonly<ProfileRestoreActivationJournal> {
    if (this.selectedJournal === undefined) {
      throw new Error('PROFILE_RESTORE_DECISION_INVALID');
    }
    return this.selectedJournal;
  }

  private async rollbackInterruptedForward(
    previous: Readonly<ProfileRestoreActivationJournal>,
    firstFailure: unknown,
  ): Promise<void> {
    let rollbackStarted = false;
    try {
      const advanced = captureProfileRestoreForwardProgress(previous, await this.dependencies.journalStore.peek());
      await this.dependencies.transaction.assertForwardRecoveryState(advanced);
      this.selectedJournal = advanced;
      rollbackStarted = true;
      await this.rollbackOrFail('startupRollback');
    } catch (recoveryError) {
      if (!rollbackStarted) this.observeRecoveryRequired('startupRollback');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', {
        cause: new AggregateError([firstFailure, recoveryError], 'PROFILE_RESTORE_RECOVERY_REQUIRED'),
      });
    }
  }

  private async rollbackOrFail(
    stage: 'startupRollback',
    admission?: ProfileRestoreColdRollbackAdmission,
  ): Promise<void> {
    const correlationId = this.activeCorrelationId;
    const startedAt = Date.now();
    if (correlationId !== undefined) {
      this.observe({
        correlationId,
        eventName: 'restore.rollbackStarted',
        stage,
      });
    }
    try {
      const selected = this.requireSelectedJournal();
      this.selectedJournal = captureProfileRestoreActivationJournal(admission === undefined
        ? await this.dependencies.transaction.rollback(selected)
        : await this.dependencies.transaction.rollback(selected, admission.assertCurrent, {
            assertContent: admission.assertContent, beforeStagingMove: admission.beforeStagingMove,
          }));
      if (correlationId !== undefined) {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          eventName: 'restore.rollbackCompleted',
          stage,
        });
      }
    } catch (error) {
      if (correlationId !== undefined) {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.rollbackFailed',
          retryable: false,
          sideEffectState: 'unknown',
          stage,
        });
        this.observeRecoveryRequired(stage);
      }
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED', { cause: error });
    }
  }

  private async rollbackAfterStoppedBackend(): Promise<void> {
    const selected = this.requireSelectedJournal();
    if (this.acceptanceState !== 'notStarted') throw new Error('PROFILE_RESTORE_DECISION_INVALID');
    if (this.dependencies.withRollbackAuthority === undefined) {
      this.observeRecoveryRequired('startupRollback');
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    await this.dependencies.withRollbackAuthority(selected, async admission => {
      if (this.acceptanceState !== 'notStarted') throw new Error('PROFILE_RESTORE_DECISION_INVALID');
      assertProfileRestoreActivationJournalMatches(selected, this.requireSelectedJournal());
      assertProfileRestoreActivationJournalMatches(selected, admission.journal);
      await this.rollbackOrFail('startupRollback', admission);
      assertProfileRestoreActivationJournalMatches({ ...selected, phase: 'rolledBack', revision: selected.revision + 2 },
        this.requireSelectedJournal());
    });
  }

  private observe(
    event: Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
  ): void {
    observeProfileRecoverySafely(
      this.dependencies.observer ??
        noOpProfileRecoveryOperationalObserver,
      event,
    );
  }

  private observeValidation(
    event:
      | Omit<
          Extract<
            Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
            { eventName: 'restore.validationCompleted' }
          >,
          'correlationId'
        >
      | Omit<
          Extract<
            Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
            { eventName: 'restore.validationFailed' }
          >,
          'correlationId'
        >,
  ): void {
    if (this.activeCorrelationId !== undefined) {
      this.observe({
        ...event,
        correlationId: this.activeCorrelationId,
      } as Parameters<ProfileRecoveryOperationalObserver['observe']>[0]);
    }
  }

  private observeRecoveryRequired(
    stage:
      | 'failedSafeJournal'
      | 'rolledBackProfile'
      | 'startupRollback',
  ): void {
    if (this.activeCorrelationId !== undefined) {
      this.observe({
        correlationId: this.activeCorrelationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage,
      });
    }
  }
}

function readSafeStartupRecoveryErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'PROFILE_RESTORE_VALIDATION_FAILED';
}
