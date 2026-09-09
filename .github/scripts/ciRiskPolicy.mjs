import { WORKSPACE_FAULT_PLANS } from '../../eky_software/apps/desktop/installer/windows-acceptance-harness/workspaceFaultContracts.mjs';

export const CI_GATES = Object.freeze([
  'verify', 'systemSecurity', 'webCritical', 'electronCritical',
  'windowsContracts', 'packageSmoke', 'cleanLifecycle', 'upgradeRollback',
  'legacyUpgrade', 'workspaceSuccess', 'workspaceFault',
]);
export const CI_FAULT_SCENARIOS = Object.freeze(Object.keys(WORKSPACE_FAULT_PLANS));
const FAST_GATES = ['verify', 'systemSecurity', 'webCritical'];
const WINDOWS_GATES = ['electronCritical', 'windowsContracts', 'packageSmoke',
  'cleanLifecycle', 'upgradeRollback', 'workspaceSuccess'];
const ROOT = 'eky_software/';
const POLICY_FILES = new Set([
  `${ROOT}docs/ai/testing-rules.md`, `${ROOT}docs/architecture/windows-installer-acceptance-harness-v2.md`,
]);

export function isCiRecord(value, keys) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property?.enumerable === true && Object.hasOwn(property, 'value');
    });
}

function fail() { throw new Error('CI_RISK_INPUT_INVALID'); }

function pathRisk(path) {
  const name = path.split('/').at(-1);
  if (path.startsWith('.github/') || POLICY_FILES.has(path) || name === 'AGENTS.md' ||
    /^(?:package(?:-lock)?\.json|pnpm-(?:lock|workspace)\.yaml|global\.json|NuGet\.Config|packages\.lock\.json|\.node-version|\.npmrc)$/.test(name) ||
    name.startsWith('tsconfig') || /\.(?:sql|csproj|wixproj|wxs)$/.test(name)) return 'full';
  if (path.startsWith(`${ROOT}apps/desktop/`)) {
    // Shared lifecycle boundaries conservatively select all five fault contracts.
    return /\/(?:installer|scripts|e2e|update|workspaces|backup|main)\//.test(path) ? 'compatibility' : 'installer';
  }
  if (path.startsWith(`${ROOT}apps/e2e/`) || path.startsWith(`${ROOT}apps/web/src/desktop/`)) return 'compatibility';
  if (path.startsWith(`${ROOT}apps/backend/src/`)) {
    return path.startsWith(`${ROOT}apps/backend/src/modules/`) &&
      !/\/(?:infrastructure|ports|composition)\//.test(path) ? 'fast' : 'compatibility';
  }
  if ((path.startsWith(`${ROOT}docs/`) && path.endsWith('.md')) ||
    /^(?:eky_software\/)?(?:README\.md|LICENSE|\.gitignore)$/.test(path) ||
    path.startsWith(`${ROOT}apps/web/src/`) ||
    /^eky_software\/packages\/(?:domain|validation|api-client|ui)\/src\//.test(path)) return 'fast';
  return 'unknown';
}

export function validateCiChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length > 100_000) fail();
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0 || path.length > 4096 ||
      /[\x00-\x1f\x7f\\:]/.test(path) || path.split('/').some((part) => ['', '.', '..'].includes(part))) fail();
  }
  return paths;
}

export function classifyCiRisk(input) {
  if (!isCiRecord(input, ['eventName', 'ref', 'changedPaths', 'comparisonComplete']) ||
    !['pull_request', 'push', 'schedule', 'workflow_dispatch'].includes(input.eventName) ||
    typeof input.ref !== 'string' ||
    !/^refs\/(?:heads\/[^\x00-\x20\x7f]+|pull\/[1-9][0-9]*\/merge)$/.test(input.ref) ||
    typeof input.comparisonComplete !== 'boolean') fail();
  const paths = validateCiChangedPaths(input.changedPaths);
  const fullEvent = input.eventName !== 'pull_request';
  let risk = 'fast';
  let reason = 'classified';
  let compatibility = false;
  if (fullEvent || !input.comparisonComplete || paths.length === 0) {
    risk = 'full';
    reason = fullEvent ? 'releaseEvent' : !input.comparisonComplete ? 'comparisonUnavailable' : 'emptyChange';
  } else {
    for (const path of paths) {
      const value = pathRisk(path);
      if (value === 'full' || value === 'unknown') {
        risk = 'full';
        if (reason !== 'unknownPath') reason = value === 'unknown' ? 'unknownPath' : 'sharedPolicy';
      }
      if (risk !== 'full' && value !== 'fast') risk = 'installer';
      compatibility ||= value === 'compatibility';
    }
  }
  const selected = new Set(FAST_GATES);
  if (risk !== 'fast') for (const gate of WINDOWS_GATES) selected.add(gate);
  if (risk === 'full' || compatibility) {
    selected.add('legacyUpgrade');
    selected.add('workspaceFault');
  }
  return Object.freeze({ schemaVersion: 1, risk, reason,
    gates: Object.freeze(Object.fromEntries(CI_GATES.map((gate) => [gate, selected.has(gate)]))),
    faultScenarios: selected.has('workspaceFault') ? CI_FAULT_SCENARIOS : Object.freeze([]),
    repetitions: risk === 'full' ? 2 : 1,
  });
}

export function validateCiRiskPlan(plan) {
  if (!isCiRecord(plan, ['schemaVersion', 'risk', 'reason', 'gates', 'faultScenarios', 'repetitions']) ||
    plan.schemaVersion !== 1 || !['fast', 'installer', 'full'].includes(plan.risk) ||
    !['classified', 'releaseEvent', 'comparisonUnavailable', 'emptyChange', 'unknownPath', 'sharedPolicy'].includes(plan.reason) ||
    (plan.risk !== 'full' && plan.reason !== 'classified') ||
    !isCiRecord(plan.gates, CI_GATES) || CI_GATES.some((key) => typeof plan.gates[key] !== 'boolean') ||
    FAST_GATES.some((key) => !plan.gates[key]) || plan.repetitions !== (plan.risk === 'full' ? 2 : 1) ||
    (plan.risk === 'full' && CI_GATES.some((key) => !plan.gates[key])) ||
    (plan.risk === 'fast' && CI_GATES.some((key) => plan.gates[key] !== FAST_GATES.includes(key))) ||
    (plan.risk === 'installer' && WINDOWS_GATES.some((key) => !plan.gates[key])) ||
    plan.gates.legacyUpgrade !== plan.gates.workspaceFault ||
    !Array.isArray(plan.faultScenarios) ||
    JSON.stringify(plan.faultScenarios) !== JSON.stringify(plan.gates.workspaceFault ? CI_FAULT_SCENARIOS : [])) fail();
  return plan;
}
