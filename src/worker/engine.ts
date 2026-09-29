import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

import type { PlantUmlEngine } from '../core/types';
import { createRasterCanvas } from './raster-canvas';
import { installStdlib, rejectScriptLoad } from './stdlib';
import { createCanvas2DContextStub } from './text-metrics';
import { sanitizeSvg } from './sanitize';

/**
 * Loads @plantuml/core inside the worker.
 *
 * The engine is compiled for browsers, so three gaps have to be filled
 * before it runs under Node:
 *
 * 1. `window` — PlantUML looks for the Graphviz engine at `window.Viz`.
 *    `viz-global.js` is a UMD file, but `@plantuml/core` declares
 *    `"type": "module"`, so under its original name Node would parse it
 *    as ESM and fail on `require`. The build copies it as
 *    `dist/engine/viz-global.cjs` so it can simply be required.
 * 2. `document` — PlantUML assembles the SVG through DOM calls
 *    (`createElementNS`), not string concatenation. happy-dom provides
 *    the DOM.
 * 3. Canvas — PlantUML measures label widths through a Canvas 2D context
 *    and rasterises `sprite` definitions through the same object, neither
 *    of which happy-dom implements. Text metrics come from a stub with
 *    approximate advance widths (text-metrics.ts) and the pixel side from
 *    a software raster canvas (raster-canvas.ts). Both live on a context
 *    created per canvas element, because sprite pixels are per-canvas
 *    state that a shared object would let one sprite overwrite.
 *
 * The engine also reads two data tables from globals, when a diagram needs
 * them: the `!theme` library (`PLANTUML_THEMES`) and the OpenIconic icons
 * (`<&check>`, `PLANTUML_OPENICONIC`). Missing, it would load them with a
 * `<script>` element, which the worker refuses (see stdlib.ts), and
 * `!theme` was ignored while an icon failed the whole diagram. The build
 * writes both as `.cjs` scripts — the icons copied, the themes without the
 * few it does not ship (see scripts/build.mjs) — and requiring them fills
 * the tables. The emoji table is not bundled: a diagram with an emoji
 * fails, and the preview and the export explain why (EMOJI_UNAVAILABLE).
 *
 * Load order matters: viz-global.js must load *before* `document` exists,
 * because with a `document` present it derives its own URL from
 * `new URL('viz-global.js', document.baseURI)` and crashes on the
 * about:blank base. The standard library must be installed before
 * plantuml.js is imported (see stdlib.ts).
 */

const requireEngine = createRequire(__filename);

export interface LoadedEngine {
  engine: PlantUmlEngine;
  sanitize: (svg: string) => string;
}

let loading: Promise<LoadedEngine> | null = null;

export function loadEngine(engineDir: string, stdlibDir: string): Promise<LoadedEngine> {
  loading ??= doLoad(engineDir, stdlibDir).catch((error: unknown) => {
    // Drop the failed promise so a transient failure (e.g. missing file
    // during development) is retried instead of being replayed forever.
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Fills the `!theme` and OpenIconic tables. The engine passes every such
 * file through its script loader before reading the table (upstream's
 * TeaVmScriptLoader), and the loader's fast path is the file marked as
 * loaded in `__pl_script_state` — the way it documents for hosts that
 * provide the data themselves.
 */
function installEngineData(engineDir: string): void {
  const globals = globalThis as Record<string, unknown>;
  const scriptState = (globals.__pl_script_state ??= {}) as Record<string, unknown>;
  for (const script of ['themes.js', 'openiconic.js']) {
    requireEngine(join(engineDir, script.replace(/\.js$/, '.cjs')));
    scriptState[script] = { state: 'loaded', ok: [], err: [] };
  }
}

async function doLoad(engineDir: string, stdlibDir: string): Promise<LoadedEngine> {
  const globals = globalThis as Record<string, unknown>;

  // 1) Graphviz first, before `document` exists (see module comment).
  globals.window = globalThis;
  globals.Viz = requireEngine(join(engineDir, 'viz-global.cjs'));

  // 2) Bundled standard library, before the engine can look for it.
  installStdlib(stdlibDir);

  // Themes and icons, after the standard library, which resets the
  // script-loading state they are marked in.
  installEngineData(engineDir);

  // 3) DOM.
  const window = new Window({ url: 'http://localhost/' });
  const document = window.document;

  // 4) Canvas, created fresh per element (see module comment).
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string): ReturnType<typeof createElement> => {
    const element = createElement(tag);
    const name = String(tag).toLowerCase();

    if (name === 'canvas') {
      const raster = createRasterCanvas();
      const context = Object.assign(createCanvas2DContextStub(), raster);
      Object.assign(element, {
        getContext: () => context,
        // PlantUML reads the rendered sprite off the element, not the
        // context. Returning an empty data URL rather than null keeps the
        // engine on its normal path when nothing was drawn.
        toDataURL: () => raster.toDataURL() ?? 'data:image/png;base64,',
      });
    } else if (name === 'script') {
      rejectScriptLoad(element);
    }

    return element;
  });

  globals.document = document;
  globals.XMLSerializer = window.XMLSerializer;
  globals.DOMParser = window.DOMParser;

  // plantuml.js is an ES module (7 MB); import it at runtime. esbuild's
  // CJS output lowers a literal `import()` into `require()`, which cannot
  // load ES modules — the Function indirection hides it from the bundler.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above; the string is a constant, not user input.
  const dynamicImport = new Function('url', 'return import(url)') as (
    url: string
  ) => Promise<PlantUmlEngine>;
  const engine = await dynamicImport(pathToFileURL(join(engineDir, 'plantuml.js')).href);

  return {
    engine,
    sanitize: (svg: string) => sanitizeSvg(window, svg),
  };
}
