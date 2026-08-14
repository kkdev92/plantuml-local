/**
 * Shared constants for the PlantUML Local extension.
 */

/** Extension identifier used for configuration keys and commands. */
export const EXTENSION_ID = 'plantumlLocal';

/** Display name shown in the Output panel and user-facing messages. */
export const EXTENSION_NAME = 'PlantUML Local';

/** Command identifiers contributed in package.json. */
export const COMMANDS = {
  CLEAR_CACHE: `${EXTENSION_ID}.clearCache`,
} as const;

/** Configuration keys under the `plantumlLocal.` prefix. */
export const CONFIG = {
  THEME: 'theme',
  LOG_LEVEL: 'logLevel',
} as const;

/**
 * Maximum number of rendered diagrams kept in the preview cache.
 * Entries are evicted oldest-first.
 */
export const MAX_CACHE_ENTRIES = 200;

/**
 * Maximum total size of the cached SVGs, in bytes.
 *
 * An entry count alone is a poor proxy for memory once sprites are in
 * play: a plain sequence diagram is a few KB, while one carrying a dozen
 * rasterised icons is 100-150 KB, so 200 entries can mean anything from
 * half a megabyte to thirty. Whichever limit is reached first evicts.
 */
export const MAX_CACHE_BYTES = 16 * 1024 * 1024;

/**
 * How long to coalesce preview refresh requests, in milliseconds.
 * A page with five diagrams finishes five renders in quick succession;
 * without batching it would refresh the preview five times.
 */
export const REFRESH_DEBOUNCE_MS = 80;

/**
 * Hard ceiling for a single render, in milliseconds.
 *
 * Renders normally finish in well under a second (the first one pays
 * ~0.4 s of WASM initialisation). Pathological input, however, can spin
 * the engine indefinitely, and because renders are serialised a hung
 * render wedges every render queued behind it. On timeout the client
 * rejects the request and restarts the worker, which unwedges the queue.
 */
export const RENDER_TIMEOUT_MS = 30_000;

/**
 * How long the render worker may sit idle before it is shut down.
 *
 * The worker holds the engine, the Graphviz WebAssembly and any sprite
 * libraries a diagram pulled in — a couple of hundred megabytes once
 * icon-heavy diagrams have been rendered, none of which is useful to
 * someone who has moved on to another file. It restarts lazily on the
 * next render, paying the one-off WASM initialisation again, so the
 * window is long enough that ordinary editing never trips it.
 */
export const WORKER_IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * Matches PlantUML preprocessor directives that reference a URL
 * (`!include https://…`, `!theme x from https://…`).
 *
 * The engine never performs network I/O, so such diagrams would fail
 * silently mid-render; rejecting them up front gives the author an
 * actionable message instead.
 */
export const REMOTE_REFERENCE = /^[^\n]*![a-z]+[^\n]*\bhttps?:\/\//im;
