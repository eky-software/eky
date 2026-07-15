const forbiddenHeaderCharacterPattern = /[\u0000-\u001f\u007f]/;
const maximumChunkBytes = 30;

export class MimeHeaderValidationError extends Error {
  constructor() {
    super('MIME header value is invalid.');
    this.name = 'MimeHeaderValidationError';
  }
}

export function encodeMimeHeaderValue(value: string): string {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    forbiddenHeaderCharacterPattern.test(normalizedValue)
  ) {
    throw new MimeHeaderValidationError();
  }

  const chunks: string[] = [];
  let currentChunk = '';
  let currentBytes = 0;

  for (const character of normalizedValue) {
    const characterBytes = Buffer.byteLength(character, 'utf8');

    if (currentBytes + characterBytes > maximumChunkBytes) {
      chunks.push(currentChunk);
      currentChunk = '';
      currentBytes = 0;
    }

    currentChunk += character;
    currentBytes += characterBytes;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks
    .map(
      (chunk) =>
        `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`,
    )
    .join('\r\n ');
}
