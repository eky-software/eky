function fail(errorCode) {
  throw new Error(errorCode);
}

function assertNoDuplicateObjectKeys(source, errorCode) {
  let offset = 0;

  function skipWhitespace() {
    while (/\s/u.test(source[offset] ?? '')) {
      offset += 1;
    }
  }

  function readString() {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2;
        continue;
      }
      if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      }
      offset += 1;
    }
    fail(errorCode);
  }

  function readValue() {
    skipWhitespace();
    if (source[offset] === '{') {
      readObject();
      return;
    }
    if (source[offset] === '[') {
      readArray();
      return;
    }
    if (source[offset] === '"') {
      readString();
      return;
    }
    while (offset < source.length && !/[\s,\]}]/u.test(source[offset])) {
      offset += 1;
    }
  }

  function readObject() {
    const keys = new Set();
    offset += 1;
    skipWhitespace();
    if (source[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      skipWhitespace();
      if (source[offset] !== '"') {
        fail(errorCode);
      }
      const key = readString();
      if (keys.has(key)) {
        fail(errorCode);
      }
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') {
        fail(errorCode);
      }
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') {
        fail(errorCode);
      }
      offset += 1;
    }
    fail(errorCode);
  }

  function readArray() {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      readValue();
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') {
        fail(errorCode);
      }
      offset += 1;
    }
    fail(errorCode);
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) {
    fail(errorCode);
  }
}

export function parseStrictJsonObjectBytes(
  bytes,
  { errorCode, maximumBytes = 64 * 1024 },
) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > maximumBytes
  ) {
    fail(errorCode);
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(source);
    assertNoDuplicateObjectKeys(source, errorCode);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      fail(errorCode);
    }
    return value;
  } catch {
    fail(errorCode);
  }
}
