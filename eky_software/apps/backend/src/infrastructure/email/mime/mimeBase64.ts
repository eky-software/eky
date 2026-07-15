export function encodeMimeBase64(content: Uint8Array): string {
  const encoded = Buffer.from(content).toString('base64');
  const lines: string[] = [];

  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }

  return lines.join('\r\n');
}
