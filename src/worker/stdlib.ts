import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUNDLED_LIBRARIES } from '../core/libraries';

/**
 * Serves PlantUML standard-library includes from the package.
 *
 * `@plantuml/core` ships without the sprite libraries — upstream's README
 * says to "load them from the project site if you need them", which for
 * this extension is not an option. Left alone the engine reacts to
 * `!include <azure/…>` by appending `<script src="azure.min.js">` to the
 * document and waiting for it to load, which here would mean either a
 * network request or, since nothing ever resolves that script, a render
 * that hangs until the timeout kills the worker.
 *
 * Both are avoided by populating the globals the engine reads before it
 * loads:
 *
 * - `window.PLANTUML_STDLIB[library][key]` holds the file contents, where
 *   `key` is the include path lower-cased and without the extension
 *   (`<azure/Compute/AzureFunction>` -> `compute/azurefunction`). The
 *   value must be an **array of lines**; a single string with newlines is
 *   rejected by the parser.
 * - `window.PLANTUML_STDLIB_JSON[library][key]` holds the library's JSON
 *   files, parsed, keyed the same way without `.json`: what
 *   `%load_json('<azure/all.json>')` reads. `<azure/all>` includes each
 *   category that file lists.
 * - `window.PLANTUML_STDLIB_INFO[library]` is read for library metadata.
 * - `window.__pl_script_state[<library>.min.js]` marked as `loaded` stops
 *   the script-injection path from running at all.
 * - `window.PLANTUML_STDLIB_LOADER` answers for every other script the
 *   engine asks for: it failed to load (see {@link refuseScript}).
 *
 * Libraries are read from disk lazily, on the first include that needs
 * one, so a diagram without sprites pays nothing.
 */

interface StdlibFile {
  library: string;
  upstream: string;
  license: string;
  entries: Record<string, string>;
  /** Absent for a library without JSON files. */
  json?: Record<string, unknown>;
}

interface ScriptState {
  state: string;
  ok: (() => void)[];
  err: ((message: string) => void)[];
}

/** Reads a library's asset the first time it is called, and returns that from then on. */
function lazyAsset(stdlibDir: string, library: string): () => StdlibFile {
  let file: StdlibFile | null = null;
  return () => (file ??= JSON.parse(readFileSync(join(stdlibDir, `${library}.json`), 'utf8')) as StdlibFile);
}

/**
 * Lazily reads assets and hands the engine arrays of lines. Missing keys
 * return null, which is what the engine expects for "not in this library".
 */
function createLibraryProxy(asset: () => StdlibFile): Record<string, string[] | null> {
  const lines = new Map<string, string[]>();

  return new Proxy(
    {},
    {
      get(_target, property: string | symbol): string[] | null {
        if (typeof property === 'symbol') {
          return null;
        }
        const { entries } = asset();

        const cached = lines.get(property);
        if (cached !== undefined) {
          return cached;
        }

        const content = entries[property];
        if (content === undefined) {
          return null;
        }
        const split = content.split('\n');
        lines.set(property, split);
        return split;
      },
    }
  );
}

/**
 * Lazily reads assets and hands the engine a JSON file's value; null for a
 * file the library does not have. The name comes from the diagram, so only
 * the asset's own keys count: `constructor` would otherwise be a function,
 * which the engine cannot write as JSON, and the render would stop.
 */
function createJsonProxy(asset: () => StdlibFile): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, property: string | symbol): unknown {
        if (typeof property === 'symbol') {
          return null;
        }
        const { json } = asset();
        return json !== undefined && Object.hasOwn(json, property) ? json[property] : null;
      },
    }
  );
}

/**
 * Installs the bundled libraries on `globalThis`. Must run before
 * `plantuml.js` is imported.
 */
export function installStdlib(stdlibDir: string): void {
  const globals = globalThis as Record<string, unknown>;

  const stdlib: Record<string, Record<string, string[] | null>> = {};
  const json: Record<string, Record<string, unknown>> = {};
  const info: Record<string, { version: string }> = {};
  const scriptState: Record<string, ScriptState> = {};

  // Bundled in assets/stdlib/ and copied to dist/stdlib/, each under the
  // lower-cased name the engine looks it up by, whatever case the include
  // writes it in.
  for (const { name: library } of BUNDLED_LIBRARIES) {
    const asset = lazyAsset(stdlibDir, library);
    stdlib[library] = createLibraryProxy(asset);
    json[library] = createJsonProxy(asset);
    info[library] = { version: 'bundled' };
    // Pretend the library's script is already loaded: the engine then
    // reads PLANTUML_STDLIB directly and never touches document.head.
    scriptState[`${library}.min.js`] = { state: 'loaded', ok: [], err: [] };
  }

  globals.PLANTUML_STDLIB = stdlib;
  globals.PLANTUML_STDLIB_INFO = info;
  globals.PLANTUML_STDLIB_JSON = json;
  globals.__pl_script_state = scriptState;
  globals.PLANTUML_STDLIB_LOADER = refuseScript;
}

/**
 * The engine's loader for a script it is not given: a library that is
 * not bundled (`!include <aws/…>`), or `emoji.js`. The engine documents
 * this callback for hosts that cannot load scripts. Without it, the
 * engine appends a `<script>` to `document.head` for each include of such
 * a library, and nothing ever takes one out. The failure is reported on
 * the next tick, as a script's error event would be, in the words the
 * engine uses for a script that failed to load. Returning anything but
 * `false` tells the engine the script is taken care of.
 */
function refuseScript(name: string, _loaded: () => void, failed: (message: string) => void): void {
  setTimeout(() => {
    failed(`Failed to load ${name}`);
  }, 0);
}

/**
 * Makes a `<script>` element report failure instead of loading, and then
 * takes it out of the document.
 *
 * The engine loads every script through {@link refuseScript}, and as of
 * 1.2026.9 creates a `<script>` nowhere else; this covers one it might
 * create another way. happy-dom would either try to fetch the URL or
 * simply never fire an event, and an engine waiting on an `onerror` that
 * never arrives hangs the render until the timeout kills the worker.
 * Reporting the failure immediately turns that into a normal PlantUML
 * error message on the diagram instead.
 */
export function rejectScriptLoad(element: object): void {
  const script = element as { onerror?: ((message: string) => void) | null; remove?: () => void };

  Object.defineProperty(element, 'src', {
    configurable: true,
    get: () => '',
    set(value: string) {
      // The engine assigns src and then appends the node, registering its
      // handler in between; reject on the next tick so it is in place.
      setTimeout(() => {
        script.onerror?.(`Failed to load ${value}`);
        script.remove?.();
      }, 0);
    },
  });
}
