const mebibyte = 1024 * 1024;

export const supportBundleSizeBudget = Object.freeze({
  diagnosticEventsBytes: 16 * mebibyte,
  incidentSummariesBytes: 4 * mebibyte,
  maximumUncompressedBytes: 25 * mebibyte,
  minimumCoreHeadroomBytes: 5 * mebibyte,
});
