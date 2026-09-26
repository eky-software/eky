import { validateIdentity, validateInitStatus } from './pidNamespaceContract.mjs';

// This is stricter than the old user-namespace experiment: no capability may
// survive in the initial user namespace, including the bounding set.
export function validateManagedInitStatus(text, expected) {
  validateIdentity({ uid: expected.uid, euid: expected.uid, gid: expected.gid, egid: expected.gid }, expected);
  validateInitStatus(text, expected);
  for (const [name, value] of [['Groups', ''], ['NoNewPrivs', '1'], ['CapBnd', '0000000000000000']]) {
    const matches = text.split('\n').filter(line => line.startsWith(`${name}:`));
    if (matches.length !== 1 || matches[0].slice(name.length + 1).trim() !== value) {
      throw new Error('Managed namespace credential drop unverified');
    }
  }
}
