import type { MessagePortMain } from 'electron';

import {
  matchesSecretBrokerBinding,
  parseSecretBrokerResponse,
  readSecretBrokerBinding,
  type SecretBrokerBinding,
  type SecretBrokerResponse,
} from '../src/secrets/secretBrokerProtocol.js';

type Mutation = 'setCompanyEmailSecret' | 'removeCompanyEmailSecret';

// Test-only relay: hold one mutation acknowledgment, never its secret payload.
export function createElectronSecretReplyHold(
  mainPort: MessagePortMain,
  backendPort: MessagePortMain,
  generationId: string,
) {
  let operation: Mutation | undefined;
  let expected: SecretBrokerBinding | undefined;
  let held: SecretBrokerResponse | undefined;
  let used = false;
  let released = false;
  let disposed = false;
  let failure: unknown;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    held = undefined;
    for (const port of [mainPort, backendPort]) {
      port.removeListener('message', port === mainPort ? receiveReply : receiveRequest);
      port.removeListener('close', dispose);
      try { port.close(); } catch (error) { failure ??= error; }
    }
  };
  const forward = (port: MessagePortMain, value: unknown) => {
    try { port.postMessage(value); }
    catch (error) { failure ??= error; dispose(); }
  };
  const receiveRequest = ({ data }: { data: unknown }) => {
    if (disposed) return;
    const binding = readSecretBrokerBinding(data);
    if (!released && operation !== undefined && expected === undefined &&
        binding?.operation === operation && binding.generationId === generationId) {
      expected = binding;
    }
    forward(mainPort, data);
  };
  const receiveReply = ({ data }: { data: unknown }) => {
    if (disposed) return;
    const response = parseSecretBrokerResponse(data);
    if (!released && expected !== undefined &&
        response?.ok === true && 'configured' in response.result &&
        matchesSecretBrokerBinding(expected, response)) {
      if (held !== undefined) {
        failure = new Error('ELECTRON_SECRET_REPLY_DUPLICATE');
        dispose();
        return;
      }
      held = response;
      return;
    }
    forward(backendPort, data);
  };
  mainPort.on('message', receiveReply);
  backendPort.on('message', receiveRequest);
  mainPort.on('close', dispose);
  backendPort.on('close', dispose);
  mainPort.start();
  backendPort.start();

  return {
    arm(nextOperation: Mutation) {
      if (used || disposed || released ||
          (nextOperation !== 'setCompanyEmailSecret' && nextOperation !== 'removeCompanyEmailSecret')) {
        throw new Error('ELECTRON_SECRET_REPLY_HOLD_INVALID');
      }
      operation = nextOperation;
      used = true;
    },
    snapshot() {
      if (failure !== undefined) throw new Error('ELECTRON_SECRET_REPLY_RELAY_FAILED', { cause: failure });
      return Object.freeze({ held: held !== undefined, released, disposed });
    },
    release() {
      if (released) return;
      released = true;
      const reply = held;
      held = undefined;
      if (!disposed && reply !== undefined) forward(backendPort, reply);
    },
    dispose,
  };
}
