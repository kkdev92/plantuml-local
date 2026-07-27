// Test fixture: a worker that accepts render requests and never answers,
// simulating an engine hang. Used by client.test.ts to exercise the
// render timeout and worker-restart path.
const { parentPort } = require('node:worker_threads');

parentPort.on('message', () => {
  // Swallow the request; keep the thread alive.
});
setInterval(() => {}, 60_000);
