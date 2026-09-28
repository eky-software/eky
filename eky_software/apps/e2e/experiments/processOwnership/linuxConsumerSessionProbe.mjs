import { createServer } from 'node:net';
import { posix } from 'node:path';
import { prepareLinuxService } from './linuxServiceConfiguration.mjs';
import { createLinuxServiceManager } from './linuxServiceManager.mjs';
import { listenLinuxServiceControl } from './linuxServiceControl.mjs';
import { startManagedCommand } from './managedNamespaceCommand.mjs';
import { captureRunningUnit } from './managedNamespaceUnitContract.mjs';
import { consumerLossCase, requireConsumerLoss } from './linuxConsumerLossContract.mjs';
import { ownerLossRecords, waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';

const sameReceipt = (left, right) => ['generation', 'unit', 'invocation', 'started']
  .every(key => left?.[key] === right?.[key]);

// Wraps the existing owners only for the fixed consumer-loss experiment. The
// real session still starts work, latches cleanup time, and owns containment.
export function createLinuxConsumerSessionProbe({ caseId, profile, repositoryRoot, exchange, commands }, {
  prepare = prepareLinuxService, createManager = createLinuxServiceManager,
  listen = listenLinuxServiceControl, startCommand = startManagedCommand,
  createListener = createServer, openExchange = openLinuxConsumerExchange,
  waitRecord = waitConsumerLossRecord,
} = {}) {
  const selected = consumerLossCase(caseId);
  requireConsumerLoss(selected.profiles.includes(profile));
  const affected = selected.profile === null || selected.profile === profile;
  const initPath = posix.join(repositoryRoot, 'apps/e2e/experiments/processOwnership',
    affected && selected.cause === 'owner' ? 'linuxConsumerLossInit.mjs' : 'linuxServiceInit.mjs');
  let prepared;
  let deadline;
  let receipt;
  let socket;
  let owning = false;
  let armed = false;
  let lost = false;
  let workloadRunning = false;
  let terminalObserved = false;
  let passive = false;
  let gateFailed = false;
  const dependencies = Object.freeze({
    prepare(actualProfile, input) {
      requireConsumerLoss(!prepared && actualProfile === profile && input.repositoryRoot === repositoryRoot);
      prepared = prepare(profile, input, { initPath });
      return prepared;
    },
    createManager(config, serviceDeadline) {
      requireConsumerLoss(prepared?.config === config && !deadline);
      deadline = serviceDeadline;
      const manager = createManager(config, deadline, { initPath, spawnChild: commands.spawnChild,
        startCommand(input) {
          const handle = startCommand(input);
          if (!owning || input.operation !== 'observation') return handle;
          const result = handle.result.then(value => {
            requireConsumerLoss(!receipt);
            receipt = captureRunningUnit(value, config.generation);
            return value;
          });
          result.catch(() => {});
          return Object.freeze({ ...handle, result });
        } });
      return Object.freeze({ ...manager,
        async prepare() {
          exchange.publish(`${profile}-intent.json`, { generation: config.generation,
            startUntil: config.startUntil, workUntil: config.workUntil });
          const ack = await waitRecord(exchange, `${profile}-ack.json`, deadline, 'ready');
          requireConsumerLoss(ack.generation === config.generation);
          await manager.prepare();
        },
        async own() {
          requireConsumerLoss(!owning && !receipt);
          owning = true;
          try { await manager.own(); } finally { owning = false; }
          requireConsumerLoss(receipt);
          await commands.drain(deadline, 'ready');
          exchange.publish(`${profile}-owned.json`, receipt);
          const grant = await waitRecord(exchange, `${profile}-go.json`, deadline, 'ready');
          requireConsumerLoss(sameReceipt(grant, receipt));
          deadline.check('ready');
        },
        async emergencyStop() {
          let first;
          if (affected && armed) {
            try {
              const proof = await waitRecord(exchange, `${profile}-passive.json`, deadline, 'wrapper');
              requireConsumerLoss(sameReceipt(proof, receipt));
              deadline.check('wrapper');
              passive = true;
            } catch (error) { gateFailed = true; first = error; }
          }
          // A missing proof cannot block containment beyond the existing clock,
          // or turn the ensuing manager stop into passive-teardown evidence.
          try { await manager.emergencyStop(); } catch (error) { first ??= error; }
          if (first) throw first;
        },
      });
    },
    listen(actualPrepared, serviceDeadline, onReply, onLost) {
      requireConsumerLoss(actualPrepared === prepared && serviceDeadline === deadline);
      return listen(prepared, deadline, value => {
        terminalObserved ||= ['exited', 'unavailable'].includes(value.state);
        workloadRunning = value.spawned === true && value.state === 'running';
        onReply(value);
      }, () => { lost = true; onLost(); }, {
        createListener(options) {
          const server = createListener(options);
          server.on('connection', channel => {
            if (!socket) socket = channel;
          });
          return server;
        },
      });
    },
  });
  return Object.freeze({
    dependencies,
    requireHealthy() {
      requireConsumerLoss(prepared && receipt && socket && !socket.destroyed && !lost && !armed &&
        workloadRunning && !terminalObserved);
      deadline.check('work');
    },
    arm() {
      requireConsumerLoss(affected);
      this.requireHealthy();
      armed = true;
      const config = prepared.config;
      const arm = Object.freeze({ caseId, profile, generation: config.generation, cause: selected.cause });
      exchange.publish(`${profile}-armed.json`, arm);
      deadline.check('work');
      if (selected.cause === 'owner') {
        const ownerExchange = openExchange({ root: config.root, identity: { uid: config.uid, gid: config.gid },
          nonce: config.generation, caseId, role: 'caller', serviceRoot: true,
          records: ownerLossRecords(profile, config.generation) });
        ownerExchange.publish('armed.json', arm);
      } else if (selected.cause === 'control') socket.destroy();
      deadline.check('work');
      return arm;
    },
    readState: () => Object.freeze({ receipt, deadline, armed, lost, passive, gateFailed }),
  });
}
