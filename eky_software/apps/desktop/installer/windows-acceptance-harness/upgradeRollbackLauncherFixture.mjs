import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELEASE_MESSAGE = 'release\n';
const MAX_INPUT_LENGTH = RELEASE_MESSAGE.length;

export async function runUpgradeRollbackLauncherFixture(arguments_) {
  if (arguments_.length !== 0) {
    return 64;
  }
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > MAX_INPUT_LENGTH) {
      return 65;
    }
  }
  return input === RELEASE_MESSAGE ? 0 : 65;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runUpgradeRollbackLauncherFixture(
    process.argv.slice(2),
  );
}
