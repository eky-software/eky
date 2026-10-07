import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { STARTUP_EXCEPTION_CONTROL, STARTUP_EXCEPTION_SUFFIX, STARTUP_EXCEPTION_LIMITS,
  validateStartupExceptionEvidence } from '../../src/main/startupExceptionEvidence.ts';
import { deriveLegacySourceUserDataRoot } from './legacyUpgradeProfileEvidence.mjs';
import { ordinaryPath } from './workspaceEncryptedEvidence.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { writeJsonAtomicExclusive } from './legacyUpgradeContracts.mjs';

export async function prepareLegacyStartupExceptionControl(runRoot, runNonce, identity) {
  const directory = resolve(dirname(deriveLegacySourceUserDataRoot(runRoot, runNonce)), 'result');
  const control = { schemaVersion: 1, scenarioRunNonce: runNonce, ...identity };
  const path = resolve(directory, STARTUP_EXCEPTION_CONTROL);
  const existing = await ordinaryPath(runRoot, path).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing === null) { await writeJsonAtomicExclusive(path, control); return; }
  if (existing.size > 4096) throw new Error('legacyStartupEvidenceInvalid');
  const saved = parseStrictJsonObjectBytes(await readFile(path), { errorCode: 'legacyStartupEvidenceInvalid', maximumBytes: 4096 });
  if (Object.keys(saved).length !== Object.keys(control).length ||
    Object.entries(control).some(([key, value]) => saved[key] !== value)) throw new Error('legacyStartupEvidenceInvalid');
}

export function validateLegacyOriginalExceptionEvidence(value, startup) {
  const invalid = () => { throw new Error('legacyStartupEvidenceInvalid'); };
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== 2 ||
    !['notEnabled', 'notObserved', 'recorded', 'missing', 'unverified'].includes(value.status) ||
    !Array.isArray(value.exceptions) || value.exceptions.length > 2 ||
    (value.status === 'recorded' && value.exceptions.length === 0) ||
    (['notEnabled', 'notObserved', 'missing'].includes(value.status) && value.exceptions.length > 0)) invalid();
  const runtimes = new Set();
  for (const record of value.exceptions) {
    try { validateStartupExceptionEvidence(record); } catch { invalid(); }
    if (record.scenarioRunNonce !== startup.scenarioRunNonce || record.appVersion !== startup.targetIdentity.appVersion ||
      !startup.targetIdentity.buildRevision.startsWith(record.buildRevision) || runtimes.has(record.runtimeInstanceId)) invalid();
    runtimes.add(record.runtimeInstanceId);
  }
  if (value.status === 'recorded' && startup.events.some(event => !runtimes.has(event.runtimeInstanceId))) invalid();
  return value;
}

export async function readLegacyOriginalExceptionEvidence({ runRoot, artifact, supervisorResult }, startup) {
  const result = { status: 'unverified', exceptions: [] };
  if (supervisorResult.processTreeAbsent !== true) return result;
  const directory = resolve(dirname(deriveLegacySourceUserDataRoot(runRoot, supervisorResult.runNonce)), 'result');
  try {
    const controlPath = resolve(directory, STARTUP_EXCEPTION_CONTROL);
    let info;
    try { info = await ordinaryPath(runRoot, controlPath); }
    catch (error) { if (error?.code === 'ENOENT') return { status: 'notEnabled', exceptions: [] }; throw error; }
    if (info.size > 4096) return result;
    const control = parseStrictJsonObjectBytes(await readFile(controlPath), { errorCode: 'legacyStartupEvidenceInvalid', maximumBytes: 4096 });
    if (Object.keys(control).length !== 4 || control.schemaVersion !== 1 ||
      control.scenarioRunNonce !== supervisorResult.runNonce || control.appVersion !== artifact.target.appVersion ||
      control.buildRevision !== artifact.target.buildRevision) return result;
    const files = (await readdir(directory)).filter(name => name.endsWith(STARTUP_EXCEPTION_SUFFIX));
    let partial = files.length > 2;
    for (const name of files.sort().slice(0, 2)) {
      try {
        const path = resolve(directory, name);
        const before = await ordinaryPath(runRoot, path);
        if (before.size > STARTUP_EXCEPTION_LIMITS.fileBytes) throw new Error('legacyStartupEvidenceInvalid');
        const bytes = await readFile(path);
        const after = await ordinaryPath(runRoot, path);
        if (bytes.length !== before.size || ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) {
          throw new Error('legacyStartupEvidenceInvalid');
        }
        const record = validateStartupExceptionEvidence(parseStrictJsonObjectBytes(bytes,
          { errorCode: 'legacyStartupEvidenceInvalid', maximumBytes: STARTUP_EXCEPTION_LIMITS.fileBytes }));
        if (name !== `${record.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`) throw new Error('legacyStartupEvidenceInvalid');
        validateLegacyOriginalExceptionEvidence({ status: 'unverified', exceptions: [record] }, startup);
        result.exceptions.push(record);
      } catch { partial = true; }
    }
    partial ||= startup.events.some(event => !result.exceptions.some(record => record.runtimeInstanceId === event.runtimeInstanceId));
    result.status = partial ? 'unverified' : files.length > 0 ? 'recorded' :
      startup.status === 'notObserved' && supervisorResult.status === 'completed' ? 'notObserved' : 'missing';
    return validateLegacyOriginalExceptionEvidence(result, startup);
  } catch { return { status: 'unverified', exceptions: [] }; }
}

export function originalExceptionEvidenceAllowsRemoval(value) {
  return ['notEnabled', 'notObserved'].includes(value.status) ||
    (value.status === 'recorded' && value.exceptions.every(record => !record.incomplete));
}
