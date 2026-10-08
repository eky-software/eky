import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNativeError } from 'node:util/types';

export const STARTUP_EXCEPTION_SWITCH = 'startup-exception-evidence';
export const STARTUP_EXCEPTION_TOKEN_ENV = 'EKY_STARTUP_EXCEPTION_TOKEN';
export const STARTUP_EXCEPTION_CONTROL = 'startup-exception-control.json';
export const STARTUP_EXCEPTION_SUFFIX = '.startup-exception.private.json';
export const STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS = 500;
export const STARTUP_EXCEPTION_LIMITS = Object.freeze({
  depth: 4, message: 2048, stack: 8192, name: 128, fileBytes: 192 * 1024,
});
const tokenPattern = /^[a-f0-9]{64}$/;
const runtimePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const stages = ['earlyStartup', 'compositionStartup', 'runtimeStartup'] as const;
export type StartupExceptionStage = typeof stages[number];
export interface StartupExceptionBinding {
  scenarioRunNonce: string;
  appVersion: string;
  buildRevision: string;
  runtimeInstanceId: string;
}
interface ExceptionPart {
  name: string | null;
  message: string | null;
  stack: string | null;
  truncated: boolean;
}
export interface StartupExceptionEvidence extends StartupExceptionBinding {
  schemaVersion: 1;
  stage: StartupExceptionStage;
  chain: ExceptionPart[];
  incomplete: boolean;
}
export type StartupExceptionDelivery = 'recorded' | 'failed' | 'timedOut' | 'notObserved';
export interface StartupExceptionCapture {
  (error: unknown, stage: StartupExceptionStage, secrets?: readonly string[]): void;
  waitForDelivery(): Promise<StartupExceptionDelivery>;
}
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function invalid(): never { throw new Error('startupExceptionEvidenceInvalid'); }
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;
const initialStackFormatter = Error.prepareStackTrace;

export function validateStartupExceptionEvidence(value: unknown): StartupExceptionEvidence {
  if (!exact(value, ['schemaVersion', 'scenarioRunNonce', 'appVersion', 'buildRevision',
    'runtimeInstanceId', 'stage', 'chain', 'incomplete']) || value.schemaVersion !== 1 ||
    typeof value.scenarioRunNonce !== 'string' || !tokenPattern.test(value.scenarioRunNonce) ||
    typeof value.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.appVersion) ||
    typeof value.buildRevision !== 'string' || !/^[a-f0-9]{7,40}$/.test(value.buildRevision) ||
    typeof value.runtimeInstanceId !== 'string' || !runtimePattern.test(value.runtimeInstanceId) ||
    !stages.includes(value.stage as StartupExceptionStage) || typeof value.incomplete !== 'boolean' ||
    !Array.isArray(value.chain) || value.chain.length < 1 || value.chain.length > STARTUP_EXCEPTION_LIMITS.depth) invalid();
  for (const part of value.chain) {
    if (!exact(part, ['name', 'message', 'stack', 'truncated']) || typeof part.truncated !== 'boolean') invalid();
    for (const key of ['name', 'message', 'stack'] as const) {
      if (part[key] !== null && (typeof part[key] !== 'string' ||
        (part[key] as string).length > STARTUP_EXCEPTION_LIMITS[key])) invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > STARTUP_EXCEPTION_LIMITS.fileBytes) invalid();
  return value as unknown as StartupExceptionEvidence;
}

// Read data properties only: exceptions must not execute getters or toJSON.
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) return descriptor.value;
    if (key === 'stack' && isNativeError(value) && descriptor?.get === nativeStackGetter &&
      nativeStackGetter !== undefined && Error.prepareStackTrace === initialStackFormatter &&
      typeof Object.getOwnPropertyDescriptor(value, 'message')?.value === 'string') {
      // Node 24 exposes V8's original lazy stack via a shared native accessor.
      // Never invoke an accessor supplied by the thrown object.
      const ownName = Object.getOwnPropertyDescriptor(value, 'name');
      if (ownName !== undefined && !Object.hasOwn(ownName, 'value')) return undefined;
      let prototype = Object.getPrototypeOf(value);
      for (let depth = 0; prototype !== null && depth < 8; depth++) {
        const name = Object.getOwnPropertyDescriptor(prototype, 'name');
        if (name !== undefined && !Object.hasOwn(name, 'value')) return undefined;
        prototype = Object.getPrototypeOf(prototype);
      }
      return nativeStackGetter.call(value);
    }
    return undefined;
  } catch { return undefined; }
}

function redact(text: string, secrets: readonly string[]): string {
  if (secrets.length > 128) return '[redacted: secret bounds exceeded]';
  let result = text;
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret.length > 1024) {
      if (result.includes(secret.slice(0, 1024))) return '[redacted: long known secret]';
    } else if (secret.length > 0) result = result.split(secret).join('[redacted]');
  }
  return result
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(/((?:password|passwd|token|secret|api[_-]?key|authorization)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[redacted]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}

export function projectStartupException(error: unknown, binding: StartupExceptionBinding,
  stage: StartupExceptionStage, secrets: readonly string[] = []): StartupExceptionEvidence {
  const chain: ExceptionPart[] = [];
  const seen = new Set<unknown>();
  let current = error;
  let incomplete = false;
  while (chain.length < STARTUP_EXCEPTION_LIMITS.depth) {
    if (seen.has(current)) { incomplete = true; break; }
    seen.add(current);
    const part: ExceptionPart = { name: null, message: null, stack: null, truncated: false };
    for (const key of ['name', 'message', 'stack'] as const) {
      const raw = ownValue(current, key);
      if (typeof raw !== 'string') { if (key !== 'name') incomplete = true; continue; }
      // Bound the input as well as the redacted output. Never traverse an arbitrary object.
      const limit = STARTUP_EXCEPTION_LIMITS[key];
      part.truncated ||= raw.length > limit;
      part[key] = redact(raw.slice(0, limit + 1024), secrets).slice(0, limit);
    }
    chain.push(part);
    const cause = ownValue(current, 'cause');
    if (cause === undefined) break;
    current = cause;
    if (chain.length === STARTUP_EXCEPTION_LIMITS.depth) incomplete = true;
  }
  return validateStartupExceptionEvidence({ schemaVersion: 1, ...binding, stage, chain, incomplete });
}

export function startupExceptionDirectory(tempPath: string, token: string): string {
  if (!tokenPattern.test(token)) invalid();
  return join(resolve(tempPath), 'eky-desktop-smoke', token.slice(0, 32));
}

export function createStartupExceptionCapture(input: {
  enabled: boolean; tempPath: string; userDataPath: string; token: string | undefined;
  runtimeInstanceId: string; appVersion: string; buildRevision: string;
}): StartupExceptionCapture | undefined {
  if (!input.enabled) return undefined;
  try {
    if (input.token === undefined) return undefined;
    const temp = realpathSync.native(input.tempPath);
    const root = startupExceptionDirectory(temp, input.token);
    for (const path of [join(temp, 'eky-desktop-smoke'), root, join(root, 'user-data'), join(root, 'result')]) {
      if (lstatSync(path).isSymbolicLink() || realpathSync.native(path) !== path) return undefined;
    }
    if (resolve(input.userDataPath) !== join(root, 'user-data')) return undefined;
    const controlPath = join(root, 'result', STARTUP_EXCEPTION_CONTROL);
    const info = lstatSync(controlPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) return undefined;
    const control: unknown = JSON.parse(readFileSync(controlPath, 'utf8'));
    if (!exact(control, ['schemaVersion', 'scenarioRunNonce', 'appVersion', 'buildRevision']) ||
      control.schemaVersion !== 1 || control.scenarioRunNonce !== input.token ||
      control.appVersion !== input.appVersion || typeof control.buildRevision !== 'string' ||
      !/^[a-f0-9]{7,40}$/.test(input.buildRevision) || !control.buildRevision.startsWith(input.buildRevision)) return undefined;
    const binding: StartupExceptionBinding = { scenarioRunNonce: input.token,
      appVersion: input.appVersion, buildRevision: input.buildRevision, runtimeInstanceId: input.runtimeInstanceId };
    const output = join(root, 'result', `${input.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`);
    const environmentSecrets = Object.entries(process.env)
      .filter(([key, value]) => /(?:TOKEN|PASSWORD|SECRET|API_KEY|AUTHORIZATION)/i.test(key) &&
        value !== undefined && value.length > 0)
      .map(([, value]) => value as string);
    let observed = false;
    let delivery: Promise<StartupExceptionDelivery> | undefined;
    let deliveryWait: Promise<StartupExceptionDelivery> | undefined;
    const capture = (error: unknown, stage: StartupExceptionStage, secrets: readonly string[] = []) => {
      if (observed) return;
      observed = true;
      try {
        const record = projectStartupException(error, binding, stage, [...environmentSecrets, ...secrets]);
        delivery = writeFile(output, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 })
          .then(() => 'recorded' as const, () => 'failed' as const);
      } catch { delivery = Promise.resolve('failed'); }
    };
    return Object.assign(capture, {
      waitForDelivery(): Promise<StartupExceptionDelivery> {
        if (delivery === undefined) return Promise.resolve('notObserved');
        if (deliveryWait !== undefined) return deliveryWait;
        // Only the opt-in synthetic failure path may wait; never a fixed sleep.
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<StartupExceptionDelivery>(resolve => {
          timer = setTimeout(() => resolve('timedOut'), STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS);
        });
        deliveryWait = Promise.race([delivery, deadline]).finally(() => clearTimeout(timer));
        return deliveryWait;
      },
    });
  } catch { return undefined; }
}
