import { startManagedObservation } from './managedNamespaceObservation.mjs';
import { managedStopCommand } from './managedNamespaceLaunchContract.mjs';
import { captureRunningUnit, verifyOwnedUnitObservation } from './managedNamespaceUnitContract.mjs';
import { watchChild, emergencyStop } from './runPidNamespaceExperiment.mjs';
import { observeBoundedChildOutput } from './boundedChildOutput.mjs';
import { waitWithin } from './pidNamespaceContract.mjs';
import { consumerLossCase, observeConsumerLossExit, requireConsumerLoss,
  validateConsumerLossArm } from './linuxConsumerLossContract.mjs';
import { waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';

const sameReceipt = (left, right) => ['generation', 'unit', 'invocation', 'started']
  .every(key => left?.[key] === right?.[key]);

// Independent observation never stops a live caller's units. Ownership transfer
// is permitted only after the outer driver proves its retained leaf has closed.
export function createLinuxConsumerObserver({ caseId, exchange, deadline, commands, callerClosed }, {
  startObservation = startManagedObservation, waitRecord = waitConsumerLossRecord, time = globalThis,
} = {}) {
  const selected = consumerLossCase(caseId);
  const receipts = new Map();
  const intents = new Map();
  const passive = new Set();
  let nextProfile = 0;
  let accepting = true;
  const query = async (generation, takeover = false) => {
    requireConsumerLoss(accepting || takeover);
    const handle = startObservation({ generation, deadline, phase: 'wrapper', spawnChild: commands.spawnChild, time });
    const value = await handle.result;
    await waitWithin(handle.closed, deadline, 'wrapper', time);
    await commands.drain(deadline, 'wrapper');
    deadline.check('wrapper');
    return value;
  };
  const poll = () => waitWithin(new Promise(resolve => time.setTimeout(resolve,
    Math.min(25, deadline.remaining('wrapper')))), deadline, 'wrapper', time);
  return Object.freeze({
    stopAdmission() { accepting = false; },
    async register(profile) {
      requireConsumerLoss(accepting && profile === selected.profiles[nextProfile] && !intents.has(profile));
      const intent = await waitRecord(exchange, `${profile}-intent.json`, deadline, 'work');
      requireConsumerLoss(accepting);
      intents.set(profile, intent);
      exchange.publish(`${profile}-ack.json`, { generation: intent.generation });
      deadline.check('work');
      const announced = await waitRecord(exchange, `${profile}-owned.json`, deadline, 'work');
      requireConsumerLoss(accepting && announced.generation === intent.generation);
      const receipt = captureRunningUnit(await query(intent.generation), intent.generation);
      requireConsumerLoss(accepting && sameReceipt(receipt, announced));
      receipts.set(profile, receipt);
      deadline.check('work');
      exchange.publish(`${profile}-go.json`, receipt);
      deadline.check('work');
      nextProfile++;
    },
    async observePassive(profile) {
      requireConsumerLoss(accepting && receipts.has(profile) && !passive.has(profile) &&
        (selected.profile === null || selected.profile === profile));
      const receipt = receipts.get(profile);
      const arm = await waitRecord(exchange, `${profile}-armed.json`, deadline, 'work');
      requireConsumerLoss(accepting);
      validateConsumerLossArm(arm, caseId, profile, receipt.generation);
      for (;;) {
        const observed = observeConsumerLossExit(await query(receipt.generation), receipt, arm);
        requireConsumerLoss(accepting);
        if (observed.waitingWrapper === 'armedFailureExit') break;
        await poll();
      }
      passive.add(profile);
      // Release THIS live session immediately, not after another service or the
      // caller's finalization, which may itself be waiting for this receipt.
      if (selected.cause !== 'caller') exchange.publish(`${profile}-passive.json`, receipt);
      deadline.check('wrapper');
      return receipt;
    },
    async containAfterCallerClosed() {
      requireConsumerLoss(callerClosed() === true);
      for (const [profile, intent] of intents) {
        requireConsumerLoss(callerClosed() === true);
        const observation = await query(intent.generation, true);
        let receipt = receipts.get(profile);
        if (!receipt) {
          // A pre-GO failed attempt grants no guessed ownership. Only a fresh
          // running receipt for this announced generation can permit takeover.
          receipt = captureRunningUnit(observation, intent.generation);
          receipts.set(profile, receipt);
        }
        verifyOwnedUnitObservation(observation, receipt);
        const command = managedStopCommand(receipt.generation);
        deadline.check('wrapper');
        const owned = watchChild(commands.spawnChild(command.file, command.args, {
          cwd: '/', env: command.env, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
        }));
        const output = observeBoundedChildOutput(owned.child);
        try {
          await output.guard(waitWithin(owned.completion, deadline, 'wrapper', time));
          await commands.drain(deadline, 'wrapper');
          requireConsumerLoss(owned.closed && owned.exited && owned.code === 0 && owned.signal === null &&
            owned.spawnCode === null && output.output.length === 0);
        } catch (error) {
          emergencyStop(owned);
          try { await commands.drain(deadline, 'wrapper'); } catch { /* No invented close receipt. */ }
          throw error;
        }
      }
    },
    readState: () => Object.freeze({ registered: receipts.size, passive: passive.size,
      complete: nextProfile === selected.profiles.length }),
  });
}
