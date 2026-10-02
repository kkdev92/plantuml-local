// Test fixture: a worker that answers each request at once, until one whose
// source holds HANG arrives. Like the real worker, which renders one request
// after another, it then answers nothing more. Used by client.test.ts to put
// ordinary requests in the queue behind a hung one.
const { parentPort } = require('node:worker_threads');

let wedged = false;
parentPort.on('message', (request) => {
  if (wedged || request.source.includes('HANG')) {
    wedged = true;
    return;
  }
  parentPort.postMessage({ id: request.id, svg: `<svg>${request.source}</svg>` });
});
setInterval(() => {}, 60_000);
