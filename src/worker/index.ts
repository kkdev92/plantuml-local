import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';

import type { RenderRequestMessage, RenderResponseMessage } from '../core/types';
import { loadEngine } from './engine';
import { disableNetworkAccess } from './network-guard';
import { createSerialQueue } from './queue';

/**
 * Render worker entry point.
 *
 * Rendering happens in a worker thread rather than the extension host for
 * two reasons. The engine demands `window` and `document` globals, and
 * planting those on the extension host's `globalThis` would break other
 * extensions that distinguish Node from browsers via
 * `typeof document === 'undefined'`. A worker has its own isolated
 * `globalThis`. It also keeps multi-hundred-millisecond renders off the
 * extension host thread.
 *
 * Rendering cannot happen in the Markdown preview itself: the preview's
 * Content-Security-Policy is `script-src 'nonce-…'` without
 * `wasm-unsafe-eval`, so Chromium refuses to compile the Graphviz
 * WebAssembly there. Node has no CSP, so the worker renders and only the
 * finished SVG crosses into the preview.
 */

// Fail-closed before anything else loads: no code in this worker may
// perform network I/O (see network-guard.ts).
disableNetworkAccess();

// dist/worker.js sits next to dist/engine/ and dist/stdlib/.
const engineDir = join(__dirname, 'engine');
const stdlibDir = join(__dirname, 'stdlib');

const queue = createSerialQueue();

function renderOnce(source: string, dark: boolean): Promise<string> {
  return queue.enqueue(async () => {
    const { engine, sanitize } = await loadEngine(engineDir, stdlibDir);
    const svg = await new Promise<string>((resolve, reject) => {
      engine.renderToString(
        source.split(/\r\n|\r|\n/),
        (result) => {
          resolve(result);
        },
        (message) => {
          reject(new Error(message !== '' ? String(message) : 'PlantUML rendering failed'));
        },
        { dark }
      );
    });
    return sanitize(svg);
  });
}

parentPort?.on('message', (request: RenderRequestMessage) => {
  renderOnce(request.source, request.dark).then(
    (svg) => {
      const response: RenderResponseMessage = { id: request.id, svg };
      parentPort?.postMessage(response);
    },
    (error: unknown) => {
      const response: RenderResponseMessage = {
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      };
      parentPort?.postMessage(response);
    }
  );
});
