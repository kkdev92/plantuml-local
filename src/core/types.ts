/**
 * Shared types for the PlantUML Local extension.
 */

/** Message sent from the extension host to the render worker. */
export interface RenderRequestMessage {
  id: number;
  source: string;
  dark: boolean;
  /** Whether the host answers the local includes of this render (src/includes/). */
  includes: boolean;
}

/** Message sent back from the render worker. Exactly one of svg / error is set. */
export interface RenderResponseMessage {
  id: number;
  svg?: string;
  error?: string;
  /** The files of the bundled libraries the engine read, in the order first read. */
  libraries?: LibraryRead[];
}

/** A file of a bundled library the engine read, by the key it looked up. */
export interface LibraryRead {
  /** The library, as the extension bundles it: `c4`. */
  library: string;
  /** The file's key: its path in the library, in lower case, without the extension. */
  key: string;
  /** Whether the library has it. */
  found: boolean;
}

/** Sent by the worker when the engine asks for the file of a local include. */
export interface IncludeRequestMessage {
  type: 'include';
  /** The render the include belongs to. */
  render: number;
  /** Numbers the request, for the answer. */
  request: number;
  /** The file the directive names, as the engine hands it over. */
  path: string;
  /** The file the include is written in, as an id given earlier, or null for the diagram. */
  from: string | null;
  /** The operation the engine is performing, when its loader API supplies it. */
  kind?: IncludeKind;
}

export type IncludeKind = 'include' | 'includesub' | 'theme';

/** The host's answer to an {@link IncludeRequestMessage}. Exactly one of file / error is set. */
export interface IncludeResponseMessage {
  type: 'include';
  request: number;
  file?: IncludedFile;
  error?: string;
}

/** A file delivered for a local include. */
export interface IncludedFile {
  /** Its real path, which the engine compares to tell a repeated include. */
  id: string;
  text: string;
}

/** Answers the local includes of one render, rejecting a file it does not deliver. */
export type IncludeLoader = (path: string, from: string | null, kind?: IncludeKind) => Promise<IncludedFile>;

/** A diagram drawn for the document it is written in. */
export interface DiagramRender {
  svg: string;
  /**
   * Each local include that failed, by the path it named, with why, in the
   * order the engine asked. The engine itself only says "cannot include".
   */
  failedIncludes: ReadonlyMap<string, string>;
  /**
   * The paths its local includes looked at — the files read, and the places
   * found empty first — as compared with file events (src/includes/tracking.ts):
   * a change to one of them can change the drawing.
   */
  dependencies: readonly string[];
  /**
   * What the files it included set for its palette (src/render/palette.ts),
   * when they set anything.
   */
  includedStyle?: IncludedStyle;
  /** What it asked for, when drawn for a document (src/includes/host.ts). */
  log?: DrawingLog;
}

/**
 * What a drawing asked for: the requests for local files, in the order the
 * engine asked, and the files of the bundled libraries it read.
 */
export interface DrawingLog {
  requests: readonly DrawnRequest[];
  libraries: readonly LibraryRead[];
}

/** How a request for a local file ended. */
export type DrawnRequestState = 'read' | 'missing' | 'refused' | 'unavailable' | 'outside' | 'path' | 'limit';

/** A request for a local file, as answered. Paths are as the editor knows them. */
export interface DrawnRequest {
  /** The file the directive names, as the engine handed it over. */
  path: string;
  /** The id of the file it was asked from, or null for the diagram. */
  from: string | null;
  kind?: IncludeKind;
  state: DrawnRequestState;
  /** The id of the file read; `file` is its path. */
  id?: string;
  file?: string;
  /** The places looked at first and found empty, and the one refused. */
  looked: readonly string[];
  /** Why it failed, in the words the preview uses. */
  reason?: string;
}

/** What the files a diagram included set for its palette. */
export interface IncludedStyle {
  /** Their `!theme` lines, trimmed, in the order they were included. */
  themes: readonly string[];
  /** Whether one of them includes a bundled library made for a white page. */
  whitePageLibrary: boolean;
}

/**
 * Minimal logging surface used by modules that must stay importable
 * without the `vscode` module (workers, unit tests). The extension
 * entry point adapts @kkdev92/vscode-ext-kit's Logger to this shape.
 */
export interface RenderLog {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
}

/**
 * The subset of the `@plantuml/core` API this extension uses.
 *
 * The fourth argument is not documented in the package README but exists
 * in the implementation (the minified `CPe` helper reads
 * `options.dark === true`), which lets us produce dark-mode SVGs through
 * `renderToString` as well.
 */
export interface PlantUmlEngine {
  renderToString: (
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark: boolean }
  ) => void;
}
