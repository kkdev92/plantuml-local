import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';

import { splitLines } from '../core/lines';
import type { IncludeResponseMessage, LibraryRead, RenderRequestMessage, RenderResponseMessage } from '../core/types';
import { loadEngine } from './engine';
import { installFileLoader } from './file-loader';
import { disableNetworkAccess } from './network-guard';
import { createSerialQueue } from './queue';
import { watchLibraryReads } from './stdlib';

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

// Local includes are answered by the host (see file-loader.ts).
const files = installFileLoader((message) => {
  parentPort?.postMessage(message);
});

/**
 * A diagram that makes the engine forget the previous render.
 *
 * For a source of ten lines or more, the engine first tries the diagram
 * type that accepted the previous diagram (`lastFactory` in upstream's
 * PSystemBuilderJs), where the command-line PlantUML always tries them in
 * the same order. A source that reads as two types — lines of
 * `A -> B : message` are both a sequence and a class diagram — therefore
 * depended on what happened to be rendered before it, in any open
 * document. A short creole document resets that: it is under ten lines,
 * and creole has a diagram type of its own, so remembering it changes
 * nothing for the next diagram. It takes around 10 ms.
 */
const RESET_SOURCE = ['@startcreole', 'x', '@endcreole'];

/** What a render answers, but its id: the SVG or the error, with the library files read. */
type Drawn = Omit<RenderResponseMessage, 'id'>;

function renderOnce(request: RenderRequestMessage): Promise<Drawn> {
  const result = queue.enqueue(async (): Promise<Drawn> => {
    const { engine, sanitize } = await loadEngine(engineDir, stdlibDir);
    files.begin(request.id, request.includes);
    // Each file once, in the order first read: the engine reads them again
    // each time it starts the diagram over.
    const libraries = new Map<string, LibraryRead>();
    watchLibraryReads((library, key, found) => {
      const name = `${library}/${key}`;
      if (!libraries.has(name)) {
        libraries.set(name, { library, key, found });
      }
    });
    try {
      const svg = await new Promise<string>((resolve, reject) => {
        engine.renderToString(
          splitLines(request.source),
          (result) => {
            resolve(result);
          },
          (message) => {
            reject(new Error(message !== '' ? String(message) : 'PlantUML rendering failed'));
          },
          { dark: request.dark }
        );
      });
      return { svg: sanitize(svg), libraries: [...libraries.values()] };
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error), libraries: [...libraries.values()] };
    } finally {
      watchLibraryReads(null);
      files.end();
    }
  });
  // Queued behind this render and ahead of the next one, so the next
  // render always starts clean, while this result is not held up.
  queue.enqueue(forgetPreviousRender).catch(() => undefined);
  return result;
}

async function forgetPreviousRender(): Promise<void> {
  const { engine } = await loadEngine(engineDir, stdlibDir);
  await new Promise<void>((resolve) => {
    engine.renderToString(RESET_SOURCE, () => resolve(), () => resolve(), { dark: false });
  });
}

parentPort?.on('message', (request: RenderRequestMessage | IncludeResponseMessage) => {
  if ('type' in request) {
    files.answer(request);
    return;
  }
  renderOnce(request).then(
    (drawn) => {
      const response: RenderResponseMessage = { id: request.id, ...drawn };
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
