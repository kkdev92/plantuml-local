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
}

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
export type IncludeLoader = (path: string, from: string | null) => Promise<IncludedFile>;

/** A diagram drawn for the document it is written in. */
export interface DiagramRender {
  svg: string;
  /**
   * Each local include that failed, by the path it named, with why, in the
   * order the engine asked. The engine itself only says "cannot include".
   */
  failedIncludes: ReadonlyMap<string, string>;
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
