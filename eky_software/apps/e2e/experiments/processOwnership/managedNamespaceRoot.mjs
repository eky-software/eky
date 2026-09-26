import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { parseActorArguments, requireCondition } from './pidNamespaceContract.mjs';

export function managedControlPath(root) {
  requireCondition(typeof root === 'string' && /^\/[A-Za-z0-9_./-]+$/u.test(root) &&
    !/[^A-Za-z0-9_./-]/u.test(root) && !root.endsWith('/') && posix.normalize(root) === root &&
    /^eky-managed-ns-[a-zA-Z0-9]{6}$/u.test(posix.basename(root)), 'rootFailed');
  const socketPath = posix.join(root, 'control.sock');
  requireCondition(Buffer.byteLength(socketPath) < 104, 'rootFailed');
  return socketPath;
}

export function parseManagedInitArguments(argv) {
  requireCondition(Array.isArray(argv) && argv.length === 5 && typeof argv[4] === 'string' &&
    argv[4].startsWith('--root='), 'invalidArguments');
  const config = parseActorArguments(argv.slice(0, 4));
  const root = argv[4].slice(7);
  managedControlPath(root);
  return Object.freeze({ ...config, root });
}

// These checks intentionally do not promise isolation from a hostile same-UID
// peer. No path is removed here, even when a previous receipt no longer matches.
export function inspectManagedRoot(root, identity, { fs = filesystem, tempDirectory = tmpdir, previous } = {}) {
  managedControlPath(root);
  const metadata = fs.lstatSync(root);
  requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() &&
    metadata.uid === identity.uid && metadata.gid === identity.gid &&
    (metadata.mode & 0o7777) === 0o700 &&
    posix.dirname(root) === fs.realpathSync(tempDirectory()) && fs.realpathSync(root) === root &&
    Number.isSafeInteger(metadata.dev) && metadata.dev >= 0 &&
    Number.isSafeInteger(metadata.ino) && metadata.ino > 0, 'rootFailed');
  const receipt = Object.freeze({ dev: metadata.dev, ino: metadata.ino });
  requireCondition(!previous || (previous.dev === receipt.dev && previous.ino === receipt.ino), 'rootFailed');
  return receipt;
}

export function inspectManagedSocket(root, identity, { fs = filesystem, previous } = {}) {
  const metadata = fs.lstatSync(managedControlPath(root));
  requireCondition(metadata.isSocket() && !metadata.isSymbolicLink() &&
    metadata.uid === identity.uid && metadata.gid === identity.gid &&
    (metadata.mode & 0o7777) === 0o600 &&
    Number.isSafeInteger(metadata.dev) && metadata.dev >= 0 &&
    Number.isSafeInteger(metadata.ino) && metadata.ino > 0, 'rootFailed');
  const receipt = Object.freeze({ dev: metadata.dev, ino: metadata.ino });
  requireCondition(!previous || (previous.dev === receipt.dev && previous.ino === receipt.ino), 'rootFailed');
  return receipt;
}
