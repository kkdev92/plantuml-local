// Test fixture: a worker that answers each request at once, until one whose
// source holds CRASH arrives. That one, and every request after it, gets the
// report the engine draws when Graphviz crashed, as the real worker does once
// its Graphviz is broken. Used by client.test.ts: the answers it gives after
// the crash are already on their way when the client replaces it.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parentPort } = require('node:worker_threads');

const report = readFileSync(join(__dirname, '../../unit/fixtures/engine-output/graphviz-crash.svg'), 'utf8');

let broken = false;
parentPort.on('message', (request) => {
  broken = broken || request.source.includes('CRASH');
  parentPort.postMessage({ id: request.id, svg: broken ? report : `<svg>${request.source}</svg>` });
});
setInterval(() => {}, 60_000);
