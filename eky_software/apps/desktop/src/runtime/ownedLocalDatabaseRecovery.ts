import { isAbsolute, relative, resolve, sep } from 'node:path';

import { createDesktopProfilePaths } from './desktopProfilePaths.js';
import { readWorkspaceProcessReservationIdentity } from './workspaceProcessReservation.js';
import { isWorkspaceProcessReservationIdentity } from './workspaceProcessReservationDescriptor.js';

/** Main creates this only from a verified, registered local workspace selection. */
export interface OwnedLocalDatabaseRecoverySelection {
  readonly workspaceIdentity: string;
  readonly workspaceRoot: string;
}

export interface OwnedLocalDatabaseRecovery {
  readonly signal: AbortSignal;
  assertOwnedDatabase(databaseFilePath: string): Promise<void>;
}

export async function captureOwnedLocalDatabaseRecoverySelection(
  workspaceRoot: string,
): Promise<Readonly<OwnedLocalDatabaseRecoverySelection>> {
  const root = resolve(workspaceRoot);
  const selection = parseOwnedLocalDatabaseRecoverySelection({
    workspaceIdentity: await readWorkspaceProcessReservationIdentity(root),
    workspaceRoot: root,
  });
  if (selection === undefined) fail();
  return selection;
}

export function parseOwnedLocalDatabaseRecoverySelection(
  value: unknown,
): Readonly<OwnedLocalDatabaseRecoverySelection> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, 'workspaceIdentity')
    || !Object.hasOwn(value, 'workspaceRoot')) return undefined;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (!Object.hasOwn(fields.workspaceIdentity!, 'value')
    || !Object.hasOwn(fields.workspaceRoot!, 'value')) return undefined;
  const identity: unknown = fields.workspaceIdentity!.value;
  const root: unknown = fields.workspaceRoot!.value;
  if (!isWorkspaceProcessReservationIdentity(identity)
    || typeof root !== 'string' || root.length === 0 || root.length > 4096
    || root.includes('\0') || !isAbsolute(root) || resolve(root) !== root) return undefined;
  return Object.freeze({ workspaceIdentity: identity, workspaceRoot: root });
}

/** A private DTO is not authority: the child also needs the current reservation. */
export function createOwnedLocalDatabaseRecovery(options: {
  readonly assertOwned: () => Promise<void>;
  readonly databaseFilePath: string;
  readonly reservationRoot: string;
  readonly selection: Readonly<OwnedLocalDatabaseRecoverySelection>;
  readonly signal: AbortSignal;
}): Readonly<OwnedLocalDatabaseRecovery> {
  const selection = parseOwnedLocalDatabaseRecoverySelection(options.selection);
  if (selection === undefined || !isAbsolute(options.databaseFilePath)
    || !isAbsolute(options.reservationRoot)) fail();
  const child = relative(resolve(options.reservationRoot), selection.workspaceRoot);
  if (child.length === 0 || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) fail();
  const databaseFilePath = createDesktopProfilePaths(selection.workspaceRoot).databaseFilePath;
  if (!pathsEqual(databaseFilePath, resolve(options.databaseFilePath))) fail();
  const assertCurrent = (path: string) => {
    if (options.signal.aborted || !isAbsolute(path)
      || !pathsEqual(databaseFilePath, resolve(path))) fail();
  };
  return Object.freeze({
    signal: options.signal,
    async assertOwnedDatabase(path: string) {
      assertCurrent(path);
      await options.assertOwned();
      assertCurrent(path);
      if (await readWorkspaceProcessReservationIdentity(selection.workspaceRoot)
        !== selection.workspaceIdentity) fail();
      assertCurrent(path);
      await options.assertOwned();
      assertCurrent(path);
    },
  });
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function fail(): never { throw new Error('LOCAL_DATABASE_RECOVERY_FAILED'); }
