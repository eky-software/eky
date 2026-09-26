import { prepareManagedLaunch, startManagedCommand } from './managedNamespaceCommand.mjs';
import { listenManagedControl } from './managedNamespaceControl.mjs';
import { managedLaunchCommand } from './managedNamespaceLaunchContract.mjs';
import { inspectManagedHost } from './managedNamespacePreflight.mjs';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { createDeadline, message, NamespaceFailure, requireCondition, validateIdentity,
  waitWithin, writeMessage } from './pidNamespaceContract.mjs';

const failureReasons = new Set([
  'invalidContext', 'invalidIdentity', 'invalidArguments', 'invalidMessage', 'rootFailed', 'sentinelFailed',
  'channelFailed', 'channelLimit', 'unexpectedEof', 'deadlineExceeded', 'cleanupUnverified',
  'metadataInvalid', 'metadataReadFailed', 'cgroupV2Unverified', 'spawnFailed', 'processError',
  'exitFailed', 'terminalIncomplete', 'streamMissing', 'streamError', 'streamIncomplete',
  'streamInvalid', 'outputLimit', 'stderrNotEmpty', 'outputInvalid', 'observationInvalid',
]);

function failureAt(stage, error) {
  return Object.freeze({ stage, reason: failureReasons.has(error?.reason) ? error.reason : 'unverified' });
}

// One CI experiment session. No root deletion, sentinel ownership, public report,
// fixture migration or process-tree acceptance is implied by this inner result.
export async function runManagedSession({ config, runtime = process, fs, hostFs,
  tempDirectory, createListener, spawnChild, now, time = globalThis, beforeGo = () => {},
}) {
  const facts = { metadata: false, manager: false, policies: false, launchAttempted: false,
    launchAccepted: false, ready: false, owned: false, go: false, workload: false,
    controlClosed: false, waitingWrapper: 'unverified', stop: 'notRequested', commandsClosed: false };
  let stage = 'configuration';
  let failure = null;
  let cleanupFailure = null;
  let deadline;
  let prepared;
  let transport;
  let owned;
  const commands = [];
  const wait = (value, phase) => waitWithin(value, deadline, phase, time);
  try {
    managedLaunchCommand(config); // Validate descriptors before copying any caller value.
    config = Object.freeze({ ...config });
    deadline = createDeadline(config.started, now);
    prepared = prepareManagedLaunch({ config, deadline, runtime, spawnChild, time });
    const command = async operation => {
      const handle = startManagedCommand({ operation, generation: config.generation,
        deadline, runtime, spawnChild, time });
      commands.push(handle);
      return handle.result;
    };
    stage = 'metadata';
    await inspectManagedHost({ deadline, runtime, fs: hostFs, time });
    facts.metadata = true;
    stage = 'manager';
    await command('managerProbe');
    facts.manager = true;
    stage = 'policy';
    await command('authorizeObservation');
    await command('authorizeStop');
    await prepared.authorize().result;
    facts.policies = true;
    stage = 'control';
    transport = await listenManagedControl({ config, deadline, runtime, fs, tempDirectory, createListener, time });
    stage = 'launch';
    facts.launchAttempted = true;
    await prepared.launch().result;
    facts.launchAccepted = true;
    stage = 'ready';
    const connection = await wait(transport.connection, 'ready');
    await wait(connection.ready, 'ready');
    transport.checkOpen();
    facts.ready = true;
    stage = 'ownership';
    owned = await prepared.own();
    facts.owned = true;
    stage = 'go';
    await wait(beforeGo(), 'ready');
    validateIdentity(currentIdentity(runtime), config);
    transport.checkOpen();
    deadline.check('ready');
    const workload = connection.replies.expect('WORKLOAD', config.generation, 'workload');
    facts.go = true; // An ambiguous write is already post-GO; never retry it.
    await wait(writeMessage(connection.socket, message('GO', config.generation), deadline, 'ready'), 'ready');
    stage = 'workload';
    await wait(workload, 'workload');
    transport.checkOpen();
    facts.workload = true;
    stage = 'controlClose';
    transport.end();
    await wait(transport.closed, 'wrapper');
    transport.verifyClosed();
    facts.controlClosed = true;
    stage = 'wrapper';
    for (;;) {
      const observation = await owned.observeWrapper();
      if (observation.waitingWrapper === 'normalExit') {
        facts.waitingWrapper = 'normalExit';
        break;
      }
      // Pacing only; time passage never constitutes terminal evidence.
      deadline.check('wrapper');
      await new Promise(resolve => time.setTimeout(resolve, Math.min(25, deadline.remaining('wrapper'))));
      deadline.check('wrapper');
    }
  } catch (error) {
    failure = failureAt(stage, error);
  } finally {
    if (failure && transport) transport.dispose();
    if (failure && owned) {
      facts.stop = 'unverified';
      try {
        await owned.stop();
        facts.stop = 'commandAccepted'; // Not service or descendant closure.
      } catch (error) { cleanupFailure = failureAt('stop', error); }
    }
    if (deadline) {
      try {
        if (transport) await wait(transport.closed, 'wrapper');
        if (prepared) await prepared.settleCommands();
        await wait(Promise.all(commands.map(handle => handle.closed)), 'wrapper');
      } catch (error) { cleanupFailure ??= failureAt('commandDrain', error); }
    }
    facts.commandsClosed = (prepared?.commandsClosed() ?? true) &&
      commands.every(handle => handle.snapshot().commandCleanup !== 'unverified');
    if (!facts.commandsClosed) cleanupFailure ??= failureAt('commandDrain', new NamespaceFailure('cleanupUnverified'));
    // Disposal can be terminal while its protocol remains invalid. Preserve both.
    if (!failure) {
      try {
        requireCondition(facts.controlClosed && facts.waitingWrapper === 'normalExit' && !cleanupFailure,
          'cleanupUnverified');
        transport.verifyClosed();
      } catch (error) { failure = failureAt('finalize', error); }
    }
  }
  return Object.freeze({ outcome: failure ? 'unverified' : 'observed', failure, cleanupFailure,
    facts: Object.freeze(facts) });
}
