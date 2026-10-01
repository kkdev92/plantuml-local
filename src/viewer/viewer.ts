/**
 * The diagram viewer: a panel showing one diagram of a PlantUML file, kept
 * to that file while the focus moves elsewhere.
 *
 * The page (media/viewer/viewer.js) shows the SVG through an `<img>`
 * holding a Blob URL. As an image, nothing in the SVG can run, whatever the
 * sanitiser might have missed. The page keeps no state: each time it is
 * created — again whenever the panel comes back into view — it says so, and
 * gets the list of diagrams and the drawing again.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * panel and the renderer arrive as ports, and the caller hands over the
 * file's text.
 */

import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { diagramShape } from '../core/shape';
import { blockAtLine, findFileDiagrams } from '../export/blocks';
import { recognizeEngineError } from '../render/engine-error';

/** What the viewer needs of its panel. */
export interface ViewerPanel {
  post(message: unknown): Promise<boolean>;
}

/** Text shown in the panel, localised by the caller. */
export interface ViewerLabels {
  /** The name of an unnamed diagram, from its position counting from 1. */
  diagram(position: number): string;
  /** A diagram in the list: its name and the line it starts on. */
  entry(name: string, line: number): string;
  rendering: string;
  /** The diagram shown is no longer in the file. */
  gone: string;
  /** The file holds no diagram. */
  empty: string;
  remoteReference: string;
  emojiUnavailable: string;
  pages: string;
  engineError(message: string, line: number | null): string;
}

export interface ViewerDeps {
  render(source: string, dark: boolean): Promise<string>;
  resolvePalette(source: string, dark: boolean): Promise<boolean>;
  isDark(): boolean;
  labels: ViewerLabels;
}

/** What the page may ask for. Anything else it sends is ignored. */
export type ViewerRequest = { type: 'ready' } | { type: 'select'; index: number };

/** Reads a message from the page, which is untrusted, against `count` diagrams. */
export function parseRequest(message: unknown, count: number): ViewerRequest | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const { type, index } = message as { type?: unknown; index?: unknown };
  if (type === 'ready') {
    return { type: 'ready' };
  }
  if (type === 'select' && typeof index === 'number' && Number.isInteger(index)) {
    return index >= 0 && index < count ? { type: 'select', index } : null;
  }
  return null;
}

/** The body of the page; media/viewer/viewer.js fills it. */
export const VIEWER_BODY = [
  '<header><select id="diagrams" hidden></select><span id="status" role="status"></span></header>',
  '<main id="stage"><img id="diagram" alt="" hidden></main>',
].join('');

/** One PlantUML file's viewer. */
export class DiagramViewer {
  /** The diagram shown: by its name when it has one, else by its position. */
  private target: { name: string | null; index: number } = { name: null, index: 0 };
  /** Counts draws, so an older render finishing late is dropped. */
  private generation = 0;

  constructor(
    private readonly panel: ViewerPanel,
    private readonly deps: ViewerDeps,
    /** The file's name without its extension, which names a lone diagram. */
    private readonly fileName: string
  ) {}

  /**
   * Makes the diagram of `text` at `line` (the cursor) the one shown, or
   * the first one, without drawing it: a new page asks once it runs.
   */
  select(text: string, line: number | null): void {
    const diagrams = findFileDiagrams(text, this.fileName);
    const at = line === null ? null : blockAtLine(diagrams, line);
    const index = at === null ? 0 : diagrams.indexOf(at);
    this.target = { name: diagrams[index]?.name ?? null, index };
  }

  /** Shows the diagram of `text` at `line`, drawing it. */
  async show(text: string, line: number | null): Promise<void> {
    this.select(text, line);
    await this.update(text);
  }

  /** Handles a message from the page against the file's current `text`. */
  async receive(message: unknown, text: string): Promise<void> {
    const diagrams = findFileDiagrams(text, this.fileName);
    const request = parseRequest(message, diagrams.length);
    if (request?.type === 'select') {
      this.target = { name: diagrams[request.index]?.name ?? null, index: request.index };
    }
    if (request !== null) {
      await this.update(text);
    }
  }

  /** Lists the diagrams of `text` and draws the one shown, again. */
  async update(text: string): Promise<void> {
    const generation = ++this.generation;
    const diagrams = findFileDiagrams(text, this.fileName);
    const { labels } = this.deps;
    const index =
      this.target.name === null
        ? this.target.index
        : diagrams.findIndex((diagram) => diagram.name === this.target.name);
    const diagram = diagrams[index];

    await this.panel.post({
      type: 'diagrams',
      items: diagrams.map((candidate, position) =>
        labels.entry(candidate.name ?? labels.diagram(position + 1), candidate.openLine + 1)
      ),
      selected: Math.max(index, 0),
    });
    if (diagram === undefined) {
      // Not another diagram in its place: the one asked for has gone.
      await this.status(diagrams.length === 0 ? labels.empty : labels.gone, true, true);
      return;
    }
    this.target = { name: diagram.name, index };

    if (hasRemoteReference(diagram.source)) {
      await this.status(labels.remoteReference, true, true);
      return;
    }
    const shape = diagramShape(diagram.source);
    if (shape.kind !== 'drawable') {
      await this.status(labels.pages, true, true);
      return;
    }

    await this.status(labels.rendering, false, false);
    try {
      const dark = await this.deps.resolvePalette(shape.source, this.deps.isDark());
      const svg = await this.deps.render(shape.source, dark);
      if (generation !== this.generation) {
        return;
      }
      await this.panel.post({
        type: 'render',
        svg,
        backdrop: dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light,
      });
      // The engine draws its errors: the drawing stays, and the reason is
      // named with the line of the file it points to. sourceLine counts
      // from 0 and the engine's line from 1.
      const failure = recognizeEngineError(svg);
      if (failure === null) {
        await this.status('', false, false);
      } else {
        const line = failure.line === null ? null : diagram.sourceLine + failure.line;
        await this.status(labels.engineError(failure.message, line), true, false);
      }
    } catch (error: unknown) {
      if (generation !== this.generation) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.status(EMOJI_UNAVAILABLE.test(message) ? labels.emojiUnavailable : message, true, true);
    }
  }

  private async status(text: string, error: boolean, clear: boolean): Promise<void> {
    await this.panel.post({ type: 'status', text, error, clear });
  }
}
