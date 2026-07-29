import { startE2eBackend } from './startE2eBackend.js';

const configPath = readConfigPath(process.argv.slice(2));

try {
  const { server } = await startE2eBackend(configPath);
  console.log(
    `E2E backend listening on http://${server.hostname}:${String(server.port)}`,
  );

  let closing = false;
  const close = async () => {
    if (closing) {
      return;
    }
    closing = true;
    await server.close().catch(() => undefined);
    process.exitCode = 0;
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('E2E backend could not be started.');
  process.exitCode = 1;
}

function readConfigPath(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--config' || args[1] === undefined) {
    throw new Error('E2E backend requires one config path.');
  }
  return args[1];
}
