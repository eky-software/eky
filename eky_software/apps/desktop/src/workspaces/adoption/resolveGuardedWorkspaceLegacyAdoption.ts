import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceStartupProgress, ActiveWorkspaceStartupSelection } from '../runtime/resolveActiveWorkspaceStartup.js';
import { WorkspaceLegacyAdoptionBindingSelection } from './workspaceLegacyAdoptionBindingSelection.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { type WorkspaceLegacyAdoptionJournalStore, validateWorkspaceLegacyAdoptionJournal } from './workspaceLegacyAdoptionJournal.js';
import { WorkspaceLegacyAdoptionMetadataSelection } from './workspaceLegacyAdoptionMetadataSelection.js';
import type { WorkspaceLegacyAdoptionMutationAuthority } from './workspaceLegacyAdoptionMutationAuthority.js';
import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import type { WorkspaceLegacyAdoptionAcceptanceAuthority, WorkspaceLegacyAdoptionContext,
  WorkspaceLegacyAdoptionPreparationAuthority, WorkspaceLegacyAdoptionRecoveryAuthority } from './workspaceLegacyAdoptionPhaseAuthority.js';
import { recoverWorkspaceLegacyAdoption } from './workspaceLegacyAdoptionRecovery.js';
import { WorkspaceLegacyAdoptionRootSelection } from './workspaceLegacyAdoptionRootSelection.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { resolveWorkspaceLegacyAdoptionStartup } from './workspaceLegacyAdoptionStartup.js';

export async function resolveGuardedWorkspaceLegacyAdoption(options: Readonly<{
  authority: WorkspaceLegacyAdoptionPreparationAuthority;
  journal: WorkspaceLegacyAdoptionJournalStore;
  registry: WorkspaceRegistryStore;
  registryValue: Readonly<LocalWorkspaceRegistry> | undefined;
  adoptionPending: boolean;
  userDataRoot: string;
  reportProgress(phase: ActiveWorkspaceStartupProgress['phase'], state: ActiveWorkspaceStartupProgress['state']): void;
}>): Promise<Readonly<{ status: 'adoption'; selection: Readonly<ActiveWorkspaceStartupSelection> }> | Readonly<{ status: 'relaunchRequired' }>> {
  const preparation = options.authority;
  const checkPreparation = preparation.assertMutationCurrent.bind(preparation);
  const checkPreparationOwned = preparation.assertCurrent.bind(preparation);
  const report = options.reportProgress.bind(options);
  const notify = preparation.onUncertain.bind(preparation);
  let failure: { reason: unknown } | undefined;
  let pending = false;
  const onUncertain = (reason: unknown) => {
    if (failure !== undefined) return;
    failure = { reason };
    try { notify(reason); } catch { /* The original failure remains authoritative. */ }
  };
  const assertPreparation = () => {
    if (failure !== undefined) throw required(failure.reason);
    checkPreparation();
  };
  assertPreparation();
  await checkPreparationOwned();
  assertPreparation();
  const metadata = await WorkspaceLegacyAdoptionMetadataSelection.observe({
    journal: options.journal, registry: options.registry, assertAuthority: assertPreparation, onUncertain,
  });
  const initialJournal = await metadata.readJournal();
  const initialRegistry = await metadata.readRegistry();
  if (!isDeepStrictEqual(initialRegistry, options.registryValue) || (initialJournal !== undefined) !== options.adoptionPending) throw required();
  const operationId = initialJournal?.operationId ?? randomUUID();
  const workspaceId = initialJournal?.workspaceId ?? generateWorkspaceId();
  const paths = deriveWorkspaceLegacyAdoptionPaths(options.userDataRoot, operationId, workspaceId);
  const roots = await WorkspaceLegacyAdoptionRootSelection.observe(paths, { assertMutationCurrent: assertPreparation, onUncertain });
  await checkPreparationOwned();
  assertPreparation();
  const sourceKind = initialJournal?.sourceKind ?? await new NodeWorkspaceLegacyAdoptionRootStore().detectSourceKind(paths);
  await checkPreparationOwned();
  assertPreparation();
  const journal = initialJournal ?? validateWorkspaceLegacyAdoptionJournal({
    formatVersion: 1, operationId, workspaceId, sourceKind, state: 'prepared', createdAt: new Date().toISOString(),
  });
  const binding = await WorkspaceLegacyAdoptionBindingSelection.observe({
    userDataRoot: options.userDataRoot, journal, assertAuthority: assertPreparation, onUncertain,
  });
  const initialBinding = binding.initialBinding;
  await metadata.assertObservedCurrent();
  await binding.assertObservedCurrent();
  await roots.assertObservedCurrent();
  await checkPreparationOwned();
  assertPreparation();
  const context: Readonly<WorkspaceLegacyAdoptionContext> = Object.freeze({
    preparationAuthority: preparation, operationId, workspaceId, sourceKind,
    createdAt: journal.createdAt, paths,
  });
  report('registryStateRead', 'completed');

  const withPhase = async <T>(authority: Omit<WorkspaceLegacyAdoptionMutationAuthority, 'onUncertain'>,
    use: (views: ReturnType<typeof createViews>) => Promise<T>): Promise<T> => {
    const checkOwner = authority.assertMutationCurrent.bind(authority);
    const checkOwned = authority.assertCurrent.bind(authority);
    // An expired idle caller cannot poison a later valid phase.
    checkOwner();
    if (failure !== undefined) throw required(failure.reason);
    if (pending) { const error = required(); onUncertain(error); throw error; }
    pending = true;
    let open = true;
    const assertCurrent = () => {
      if (!open) throw required();
      if (failure !== undefined) throw required(failure.reason);
      checkOwner();
    };
    const assertOwned = async () => { assertCurrent(); await checkOwned(); assertCurrent(); };
    try {
      const views = createViews(assertCurrent, assertOwned);
      // Joint readonly admission; each later writer keeps its full peer guards.
      await assertOwned();
      await views.metadata.assertObservedCurrent();
      await views.binding.assertObservedCurrent();
      await views.roots.assertObservedCurrent();
      await assertOwned();
      return await use(views);
    } finally { open = false; pending = false; }
  };
  function createViews(assertCurrent: () => void, assertOwned: () => Promise<void>) {
    const selectedMetadata = metadata.forPhase({ assertAuthority: assertCurrent, onUncertain,
      async assertExternalSelection() { await assertOwned(); await selectedBinding.assertObservedCurrent(); await selectedRoots.assertObservedCurrent(); await assertOwned(); } });
    const selectedBinding = binding.forPhase({ assertAuthority: assertCurrent, onUncertain,
      async assertExternalSelection() { await assertOwned(); await selectedMetadata.assertObservedCurrent(); await selectedRoots.assertObservedCurrent(); await assertOwned(); } });
    const selectedRoots = roots.forPhase({ assertMutationCurrent: assertCurrent, onUncertain,
      async assertCurrent() { await assertOwned(); await selectedMetadata.assertObservedCurrent(); await selectedBinding.assertObservedCurrent(); await assertOwned(); } });
    return { metadata: selectedMetadata, binding: selectedBinding, roots: selectedRoots,
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(selectedRoots) };
  }
  const preparationPhase = { assertMutationCurrent: assertPreparation, assertCurrent: checkPreparationOwned };
  const selected = await withPhase(preparationPhase, async views => {
    if (journal.state === 'recoveryRequired') {
      report('legacyAdoptionRecovery', 'started');
      await recoverWorkspaceLegacyAdoption({ journal: views.metadata.journal, registry: views.metadata.registry,
        rootStore: views.rootStore, userDataRoot: options.userDataRoot,
        ...(initialBinding === undefined ? {} : { boundRecovery: {
          async assertCurrent() { await views.metadata.assertRegistryAbsentCurrent(); await views.binding.assertPublished(initialBinding.lineageIdentity.profileId); },
          prepareRecoveredSelection: () => views.metadata.prepareRecoveredSelection({
            assertBindingCurrent: () => views.binding.assertObservedCurrent(),
            assertPayloadAbsent: () => views.roots.assertRecoveredPayloadAbsent(),
          }),
        } }),
      });
      report('legacyAdoptionRecovery', 'completed');
      return undefined;
    }
    report('legacyAdoption', 'started');
    const result = await resolveWorkspaceLegacyAdoptionStartup({
      journal: views.metadata.journal, registry: views.metadata.registry, rootStore: views.rootStore,
      userDataRoot: options.userDataRoot, generateOperationId: () => operationId,
      generateWorkspaceId: () => workspaceId, now: () => new Date(journal.createdAt), selectedSourceKind: sourceKind,
    });
    report('legacyAdoption', 'completed');
    return result;
  });
  if (selected === undefined) return Object.freeze({ status: 'relaunchRequired' });
  return Object.freeze({ status: 'adoption', selection: Object.freeze({
    mode: 'adoption', workspaceId, workspaceRoot: paths.finalRoot, adoptionContext: context,
    assertCanAccept: selected.assertCanAccept,
    async accept(profileId: string, authority?: WorkspaceLegacyAdoptionAcceptanceAuthority) {
      if (authority?.phase !== 'acceptance' || authority.context !== context || authority.profileId !== profileId) throw required();
      await withPhase(authority, views => selected.accept(profileId, {
        journal: views.metadata.journal, registry: views.metadata.registry,
        publishBinding: sourceKind === 'legacy' ? value => views.binding.publish(value) : () => views.binding.assertObservedCurrent(),
        cleanup: Object.freeze({ discardCandidate: (selectedPaths: typeof paths) => views.rootStore.discardCandidate(selectedPaths) }),
      }));
    },
    async recoverFromFailure(authority?: WorkspaceLegacyAdoptionRecoveryAuthority) {
      if (authority?.phase !== 'afterExit' || authority.context !== context) throw required();
      return withPhase(authority, views => selected.recoverFromFailure({ journal: views.metadata.journal }));
    },
  }) });
}

function required(cause?: unknown) {
  const error = new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  if (cause !== undefined) error.cause = cause;
  return error;
}
