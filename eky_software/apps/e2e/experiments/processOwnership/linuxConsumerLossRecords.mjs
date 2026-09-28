import { exactKeys, isNonce, waitWithin } from './pidNamespaceContract.mjs';
import { managedUnitName } from './managedNamespaceUnitContract.mjs';
import { servicePath } from './linuxServiceContract.mjs';
import { consumerLossCase, requireConsumerLoss, validateConsumerLossArm } from './linuxConsumerLossContract.mjs';
import { validateConsumerLossOutcome } from './linuxConsumerLossOutcome.mjs';

const timestamp = value => typeof value === 'string' && /^[1-9][0-9]{0,23}$/u.test(value);
const generation = value => {
  requireConsumerLoss(exactKeys(value, ['generation']) && isNonce(value.generation));
};
const intent = value => {
  requireConsumerLoss(exactKeys(value, ['generation', 'startUntil', 'workUntil']) &&
    isNonce(value.generation) && timestamp(value.startUntil) && timestamp(value.workUntil) &&
    BigInt(value.startUntil) <= BigInt(value.workUntil));
};
const receipt = value => {
  requireConsumerLoss(exactKeys(value, ['generation', 'unit', 'invocation', 'started']) &&
    isNonce(value.generation) && isNonce(value.invocation) && timestamp(value.started) &&
    BigInt(value.started) <= 18446744073709551615n &&
    value.unit === managedUnitName(value.generation));
};

// These files coordinate trusted experiment roles only. They do not authorize
// process stops or replace an independent manager observation.
export function consumerLossRecords(caseId) {
  const selected = consumerLossCase(caseId);
  const records = selected.profiles.flatMap(profile => [
    { name: `${profile}-intent.json`, writer: 'caller', validate: intent },
    { name: `${profile}-ack.json`, writer: 'observer', validate: generation },
    { name: `${profile}-owned.json`, writer: 'caller', validate: receipt },
    { name: `${profile}-go.json`, writer: 'observer', validate: receipt },
    ...(selected.profile === null || selected.profile === profile ? [
      { name: `${profile}-armed.json`, writer: 'caller', validate(value) {
        requireConsumerLoss(exactKeys(value, ['caseId', 'profile', 'generation', 'cause']));
        validateConsumerLossArm(value, caseId, profile, value.generation);
      } },
      { name: `${profile}-passive.json`, writer: 'observer', validate: receipt },
    ] : []),
  ]);
  records.push({ name: 'ready.json', writer: 'caller', validate(value) {
    requireConsumerLoss(exactKeys(value, ['testRoot', 'workerRoot', 'admissionDirectory']));
    servicePath(value.testRoot);
    if (selected.profile === 'backend') {
      requireConsumerLoss(value.workerRoot === null && value.admissionDirectory === null);
    } else {
      servicePath(value.workerRoot); servicePath(value.admissionDirectory);
      requireConsumerLoss(value.workerRoot !== value.testRoot);
    }
  } }, { name: 'grant.json', writer: 'observer', validate(value) {
    requireConsumerLoss(exactKeys(value, ['caseId']) && value.caseId === caseId);
  } });
  if (selected.cause !== 'caller') records.push({ name: 'result.json', writer: 'caller', validate(value) {
    validateConsumerLossOutcome(value, caseId);
  } });
  return Object.freeze(records.map(value => Object.freeze(value)));
}

export function ownerLossRecords(profile, generation) {
  const caseId = `${profile}-owner`;
  consumerLossCase(caseId);
  requireConsumerLoss(isNonce(generation));
  return Object.freeze([Object.freeze({ name: 'armed.json', writer: 'caller', validate(value) {
    validateConsumerLossArm(value, caseId, profile, generation);
  } })]);
}

export async function waitConsumerLossRecord(exchange, name, deadline, phase, time = globalThis) {
  for (;;) {
    deadline.check(phase);
    const value = exchange.read(name);
    if (value !== undefined) {
      deadline.check(phase);
      const consumed = exchange.consume(name);
      deadline.check(phase);
      return consumed;
    }
    // Poll only the fixed publication condition within the caller's original
    // deadline. Publication has no cross-process notification primitive.
    await waitWithin(new Promise(resolve => time.setTimeout(resolve,
      Math.min(25, deadline.remaining(phase)))), deadline, phase, time);
  }
}
