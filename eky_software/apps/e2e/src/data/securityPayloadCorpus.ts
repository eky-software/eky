export const securityPayloadCorpus = Object.freeze({
  controlText: 'line-one\r\nline-two\u0000\u0007',
  htmlText: '<script>globalThis.__ekyInjected = true</script>',
  longUnicode: `${'A\u0308'.repeat(2_501)}🙂`,
  massAssignmentFields: Object.freeze({
    actorUserId: 'forged-actor',
    companyId: 'forged-company',
    invoiceNumber: 'FORGED-2026-001',
    sentAt: '2026-07-29T00:00:00.000Z',
    status: 'sent',
    unknownField: 'must-be-rejected',
  }),
  pathValues: Object.freeze([
    '../outside',
    '..\\outside',
    '%2e%2e%2foutside',
    'C:\\Windows\\system.ini',
    '/etc/passwd',
    'file:///etc/passwd',
  ]),
  prototypeJsonKeys: Object.freeze([
    '__proto__',
    'constructor',
    'prototype',
  ]),
  sqlLikeText: "Synthetic Customer ' OR 1=1; DROP TABLE customers; --",
  svgText: '<svg onload="globalThis.__ekyInjected = true"></svg>',
});
