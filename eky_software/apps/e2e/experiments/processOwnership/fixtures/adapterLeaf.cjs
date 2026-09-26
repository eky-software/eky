'use strict';
const { workspace, writeOnce } = require('./adapterFixture.cjs');
const { generation } = workspace();
process.on('SIGTERM', () => {});
writeOnce('adapter-leaf.json', { schemaVersion: 1, generation, ready: true });
// A final synthetic fail-safe, not an ownership or cleanup proof.
setTimeout(() => process.exit(73), 24_000);
