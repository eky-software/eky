// Keep original failure fields, but never export reporter configuration or inline attachments.
export function projectPlaywrightFailureReport(report) {
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors)) {
    throw new Error('CI_FAILURE_EVIDENCE_REPORT_INVALID');
  }
  const pick = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined)
    .map(name => [name, value[name]]));
  const location = ['title', 'file', 'line', 'column'];
  const step = value => ({ ...pick(value, ['title', 'duration', 'error']),
    ...(value.steps === undefined ? {} : { steps: value.steps.map(step) }) });
  const result = value => ({
    ...pick(value, ['workerIndex', 'parallelIndex', 'status', 'duration', 'error', 'errors',
      'stdout', 'stderr', 'retry', 'startTime', 'annotations', 'errorLocation']),
    ...(value.steps === undefined ? {} : { steps: value.steps.map(step) }),
    attachments: (value.attachments ?? []).map(attachment => pick(attachment, ['name', 'contentType', 'path'])),
  });
  const suite = value => ({ ...pick(value, location),
    suites: (value.suites ?? []).map(suite),
    specs: (value.specs ?? []).map(spec => ({ ...pick(spec, [...location, 'ok', 'tags', 'id']),
      tests: spec.tests.map(test => ({
        ...pick(test, ['timeout', 'annotations', 'expectedStatus', 'projectId', 'projectName', 'status']),
        results: test.results.map(result),
      })),
    })),
  });
  return { suites: report.suites.map(suite), errors: report.errors,
    stats: pick(report.stats ?? {}, ['startTime', 'duration', 'expected', 'skipped', 'unexpected', 'flaky']) };
}
