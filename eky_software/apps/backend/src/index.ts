import { startServer } from './http/server.js';

const server = await startServer();

console.log(`Backend listening on http://${server.hostname}:${server.port}`);
