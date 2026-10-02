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
  EXPORT_SVG: `${EXTENSION_ID}.exportSvg`,
  EXPORT_ALL_SVG: `${EXTENSION_ID}.exportAllSvg`,
  EXPORT_ALL_UPDATE_REFS: `${EXTENSION_ID}.exportAllAndUpdateRefs`,
  OPEN_PREVIEW: `${EXTENSION_ID}.openPreview`,
  OPEN_PREVIEW_TO_SIDE: `${EXTENSION_ID}.openPreviewToSide`,
  EXPORT_PNG: `${EXTENSION_ID}.exportPng`,
  EXPORT_FOLDER_SVG: `${EXTENSION_ID}.exportFolderSvg`,
  EXPORT_FOLDER_PNG: `${EXTENSION_ID}.exportFolderPng`,
  ASSIGN_DIAGRAM_NAME: `${EXTENSION_ID}.assignDiagramName`,
  INSERT_TEMPLATE: `${EXTENSION_ID}.insertTemplate`,
} as const;

/** The view type of the diagram viewer's panels. */
export const VIEWER_TYPE = `${EXTENSION_ID}.viewer`;

/** The view type of the panel a PNG is drawn in. */
export const PNG_PANEL_TYPE = `${EXTENSION_ID}.png`;

/**
 * Context keys behind the editor context-menu entries, set with the
 * `setContext` command. They gate the menu items so that an ordinary
 * Markdown file's right-click menu is not taxed with export commands
 * that would only report there is nothing to do.
 */
export const CONTEXT_KEYS = {
  /** The active document contains at least one ```plantuml block. */
  HAS_DIAGRAMS: `${EXTENSION_ID}.hasDiagrams`,
  /** The cursor is inside a ```plantuml block. */
  CURSOR_IN_DIAGRAM: `${EXTENSION_ID}.cursorInDiagram`,
} as const;

/** Configuration keys under the `plantumlLocal.` prefix. */
export const CONFIG = {
  THEME: 'theme',
  LOG_LEVEL: 'logLevel',
  EXPORT_DIRECTORY: 'exportDirectory',
  EXPORT_THEME: 'exportTheme',
  EXPORT_PNG_SCALE: 'exportPngScale',
  HIDE_EXPORTED_IMAGES: 'hideExportedImages',
  PREVIEW_UPDATE_MODE: 'preview.updateMode',
  DIAGNOSTICS_ENABLED: 'diagnostics.enabled',
} as const;

/**
 * Fragment appended to the image references the extension writes
 * (`![name](images/name.svg#plantuml-local)`).
 *
 * It marks the reference as this extension's, which serves two purposes:
 * the preview hides marked images so a document does not show the block's
 * render and the exported file side by side, and the reference updater
 * only ever rewrites lines that carry it. GitHub passes a fragment on an
 * image source through untouched (verified against its Markdown API), so
 * the same line still renders the SVG there.
 */
export const EXPORT_FRAGMENT = '#plantuml-local';

/**
 * Where exported SVGs go, relative to the Markdown file rather than to
 * the workspace root — so moving a document keeps its diagrams beside it
 * and the links in it still resolve.
 */
export const DEFAULT_EXPORT_DIRECTORY = 'images';

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
 * How many documents' previews keep the diagrams they show in the cache
 * past both limits: those previewed last. Evicting a diagram a preview
 * shows would only have the next refresh render it again.
 */
export const MAX_DOCUMENTS_IN_VIEW = 8;

/**
 * What a diagram is drawn on, by palette: the backdrop media/plantuml.css
 * gives the preview, and the background baked into an exported SVG. The
 * dark one matches the background the engine paints for dark renders.
 */
export const DIAGRAM_BACKDROP = { light: '#FFFFFF', dark: '#1b1b1b' } as const;

/**
 * How long to coalesce preview refresh requests, in milliseconds.
 * A page with five diagrams finishes five renders in quick succession;
 * without batching it would refresh the preview five times.
 */
export const REFRESH_DEBOUNCE_MS = 80;

/**
 * How long after a save to refresh the Markdown preview. A save also marks
 * the document changed, and VS Code's preview waits 300 ms before the
 * update that schedules, dropping a refresh asked for in the meantime.
 */
export const SAVE_REFRESH_DELAY_MS = 400;

/**
 * How long a document must stay unchanged before its diagrams are checked
 * for the Problems panel, in milliseconds: long enough not to render while
 * someone is typing.
 */
export const DIAGNOSTICS_DEBOUNCE_MS = 500;

/**
 * How long a PlantUML file must stay unchanged before its viewer draws it
 * again, in milliseconds: the delay VS Code's Markdown preview waits too.
 */
export const VIEWER_DEBOUNCE_MS = 300;

/**
 * Hard ceiling for a single render, in milliseconds.
 *
 * Renders normally finish in well under a second (the first one pays
 * ~0.4 s of WASM initialisation). Pathological input, however, can spin
 * the engine indefinitely, and because renders are serialised a hung
 * render wedges every render queued behind it. On timeout the client
 * rejects the request and restarts the worker, which draws the renders
 * that were queued behind it.
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
 * Whether a fence with this info string is a diagram: its first word is
 * exactly `plantuml`, or `puml` as an alias. The preview, export and the
 * editor commands decide with this, and the Markdown injection grammars
 * match the same two words.
 */
export function isDiagramFence(info: string): boolean {
  const language = info.trim().split(/\s+/)[0];
  return language === 'plantuml' || language === 'puml';
}

/**
 * The preprocessor directives that read a URL: the include family and
 * `!import` take it as their argument, `!theme` after `from`. Like the
 * engine, only an argument that starts with the scheme counts.
 */
const URL_DIRECTIVE = /^\s*!(?:include(?:url|_once|_many|sub)?|import)\s*https?:\/\//i;
const URL_THEME = /^\s*!theme\s+\S.*?\sfrom\s+https?:\/\//i;

/**
 * Whether the source has a PlantUML preprocessor directive that references
 * a URL (`!include https://…`, `!theme x from https://…`).
 *
 * The engine never performs network I/O, so such diagrams would fail
 * mid-render; rejecting them up front gives the author an actionable
 * message instead. Only directives are looked at, so a URL in a label or a
 * title, or a directive in a comment, does not stop a diagram that would
 * render. Comments are skipped the way the engine skips them: a line
 * starting with `'`, and from a line starting with `/'` to one ending with
 * `'/`.
 */
export function hasRemoteReference(source: string): boolean {
  return remoteReferenceLine(source) !== null;
}

/** The line (counting from 0) of the first such directive, or null. */
export function remoteReferenceLine(source: string): number | null {
  let inBlockComment = false;
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (inBlockComment || trimmed.startsWith("/'")) {
      inBlockComment = !trimmed.endsWith("'/");
      continue;
    }
    if (URL_DIRECTIVE.test(line) || URL_THEME.test(line)) {
      return index;
    }
  }
  return null;
}

/**
 * Matches the render error of a diagram that uses an emoji (`<:smile:>`).
 *
 * The emoji images are not bundled, so the engine asks for its emoji.js
 * and the worker refuses the load ("Failed to load emoji.js", see
 * stdlib.ts). The source is not checked up front the way
 * {@link hasRemoteReference} is: `<:name:>` can also be plain text, so the
 * error is recognised instead and replaced with a message that says what
 * is missing.
 */
export const EMOJI_UNAVAILABLE = /\bFailed to load emoji\.js\b/;
