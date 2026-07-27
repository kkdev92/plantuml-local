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
 * Entries are evicted oldest-first; each entry is one SVG string
 * (typically a few KB), so the cap mostly guards long editing sessions
 * that touch many files.
 */
export const MAX_CACHE_ENTRIES = 200;

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
 * Matches PlantUML preprocessor directives that reference a URL
 * (`!include https://…`, `!theme x from https://…`).
 *
 * The engine never performs network I/O, so such diagrams would fail
 * silently mid-render; rejecting them up front gives the author an
 * actionable message instead.
 */
export const REMOTE_REFERENCE = /^[^\n]*![a-z]+[^\n]*\bhttps?:\/\//im;
