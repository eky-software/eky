import { compose } from 'node:stream';
import { spec } from 'node:test/reporters';
import { createRunnerFailureSink } from './runnerFailureEvidence.mjs';

export async function* observeNodeFailures(source, sink) {
  try {
    for await (const event of source) {
      if (event.type === 'test:fail' && !event.data.todo && !event.data.skip) {
        const { name, file, line, column, testNumber, details } = event.data;
        // Parent summaries are not another original test failure.
        if (details?.error?.failureType !== 'subtestsFailed') {
          sink.record({ runner: 'node', phase: 'testFailure', testName: name, file, line, column,
            testId: String(testNumber), attempt: 0, error: details?.error });
        }
      }
      yield event;
    }
  } finally { await sink.flush(); }
}

export default async function* nodeFailureReporter(source) {
  // Node 24's normal default is spec. Its event stream and formatting stay intact.
  yield* compose(observeNodeFailures(source, createRunnerFailureSink()), new spec());
}
