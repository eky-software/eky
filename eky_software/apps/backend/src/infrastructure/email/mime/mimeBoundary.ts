import { randomBytes } from 'node:crypto';

export function createMimeBoundary(
  content: readonly string[],
  randomBytesImplementation: typeof randomBytes = randomBytes,
): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const boundary = `=_eky_${randomBytesImplementation(24).toString('hex')}`;

    if (content.every((value) => !value.includes(boundary))) {
      return boundary;
    }
  }

  throw new Error('Unable to create MIME boundary.');
}
