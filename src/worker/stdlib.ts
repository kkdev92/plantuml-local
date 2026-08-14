import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * - `window.PLANTUML_STDLIB_INFO[library]` is read for library metadata.
 * - `window.__pl_script_state[<library>.min.js]` marked as `loaded` stops
 *   the script-injection path from running at all.
 *
 * Libraries are read from disk lazily, on the first include that needs
 * one, so a diagram without sprites pays nothing.
 */

/** Libraries bundled in assets/stdlib/ and copied to dist/stdlib/. */
const BUNDLED = ['azure'] as const;

interface StdlibFile {
  library: string;
  upstream: string;
  license: string;
  entries: Record<string, string>;
}

interface ScriptState {
  state: string;
  ok: (() => void)[];
  err: ((message: string) => void)[];
}

/**
 * Lazily reads assets and hands the engine arrays of lines. Missing keys
 * return null, which is what the engine expects for "not in this library".
 */
function createLibraryProxy(stdlibDir: string, library: string): Record<string, string[] | null> {
  let entries: Record<string, string> | null = null;
  const lines = new Map<string, string[]>();

  return new Proxy(
    {},
    {
      get(_target, property: string | symbol): string[] | null {
        if (typeof property === 'symbol') {
          return null;
        }
        entries ??= (
          JSON.parse(readFileSync(join(stdlibDir, `${library}.json`), 'utf8')) as StdlibFile
        ).entries;

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
 * Installs the bundled libraries on `globalThis`. Must run before
 * `plantuml.js` is imported.
 */
export function installStdlib(stdlibDir: string): void {
  const globals = globalThis as Record<string, unknown>;

  const stdlib: Record<string, Record<string, string[] | null>> = {};
  const info: Record<string, { version: string }> = {};
  const scriptState: Record<string, ScriptState> = {};

  for (const library of BUNDLED) {
    stdlib[library] = createLibraryProxy(stdlibDir, library);
    info[library] = { version: 'bundled' };
    // Pretend the library's script is already loaded: the engine then
    // reads PLANTUML_STDLIB directly and never touches document.head.
    scriptState[`${library}.min.js`] = { state: 'loaded', ok: [], err: [] };
  }

  globals.PLANTUML_STDLIB = stdlib;
  globals.PLANTUML_STDLIB_INFO = info;
  globals.PLANTUML_STDLIB_JSON = {};
  globals.__pl_script_state = scriptState;
}

/**
 * Makes a `<script>` element report failure instead of loading.
 *
 * A library that is *not* bundled — `!include <aws/…>` — still reaches
 * the script-injection path. happy-dom would either try to fetch the URL
 * or simply never fire an event, and an engine waiting on an `onerror`
 * that never arrives hangs the render until the timeout kills the worker.
 * Reporting the failure immediately turns that into a normal PlantUML
 * error message on the diagram instead.
 */
export function rejectScriptLoad(element: object): void {
  const script = element as { onerror?: ((message: string) => void) | null };

  Object.defineProperty(element, 'src', {
    configurable: true,
    get: () => '',
    set(value: string) {
      // The engine assigns src and then appends the node, registering its
      // handler in between; reject on the next tick so it is in place.
      setTimeout(() => {
        script.onerror?.(`Failed to load ${value}`);
      }, 0);
    },
  });
}
