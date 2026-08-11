const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function compareSemanticVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifier(
      leftVersion.core[index]!,
      rightVersion.core[index]!,
    );
    if (comparison !== 0) {
      return comparison;
    }
  }
  return comparePreRelease(leftVersion.preRelease, rightVersion.preRelease);
}

function parseSemanticVersion(value: string): {
  core: readonly [string, string, string];
  preRelease: readonly string[] | undefined;
} {
  const match = semanticVersionPattern.exec(value);
  if (match === null) {
    throw new Error('SEMANTIC_VERSION_INVALID');
  }
  return {
    core: [match[1]!, match[2]!, match[3]!],
    preRelease: match[4]?.split('.'),
  };
}

function comparePreRelease(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): number {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier
        ? 0
        : leftIdentifier === undefined
          ? -1
          : 1;
    }
    const comparison = compareIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return compareNumericIdentifier(left, right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
