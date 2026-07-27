/**
 * Shared types for the PlantUML Local extension.
 */

/** Message sent from the extension host to the render worker. */
export interface RenderRequestMessage {
  id: number;
  source: string;
  dark: boolean;
}

/** Message sent back from the render worker. Exactly one of svg / error is set. */
export interface RenderResponseMessage {
  id: number;
  svg?: string;
  error?: string;
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
