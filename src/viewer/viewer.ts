/**
 * The diagram viewer: a panel showing one diagram of a PlantUML file, kept
 * to that file while the focus moves elsewhere.
 *
 * The page (media/viewer/viewer.js) shows the SVG through an `<img>`
 * holding a Blob URL. As an image, nothing in the SVG can run, whatever the
 * sanitiser might have missed. Each time the page is created — again
 * whenever the panel comes back into view — it says so, and gets the list
 * of diagrams and the drawing again. All it keeps is the file and diagram
 * it is told to, for a restart, and how each diagram was zoomed.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * panel and the renderer arrive as ports, and the caller hands over the
 * file's text.
 */

import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { diagramShape } from '../core/shape';
import type { DiagramRender, IncludedStyle } from '../core/types';
import { blockAtLine, findFileDiagrams, type PlantUmlBlock } from '../export/blocks';
import type { PngSource } from '../export/exporter';
import { withIncludeReason } from '../includes/describe';
import { changeTo } from '../includes/tracking';
import { drawReadable } from '../render/palette';
import { recognizeEngineError, recognizeEngineWarnings } from '../render/engine-error';

/** What the viewer needs of its panel. */
export interface ViewerPanel {
  post(message: unknown): Promise<boolean>;
}

/** Text shown in the panel, localised by the caller. */
export interface ViewerLabels {
  errorMessage(message: string): string;
  /** The name of an unnamed diagram, from its position counting from 1. */
  diagram(position: number): string;
  /** A diagram in the list: its name and the line it starts on. */
  entry(name: string, line: number): string;
  rendering: string;
  /** The diagram shown is no longer in the file. */
  gone: string;
  /** No diagram is chosen yet: one is to be picked from the list. */
  choose: string;
  /** The file holds no diagram. */
  empty: string;
  remoteReference: string;
  emojiUnavailable: string;
  pages: string;
  engineError(message: string, line: number | null): string;
  /** The diagram is drawn in the palette `dark` names, as its colours are hard to read in the one asked for. */
  otherPalette(dark: boolean): string;
}

export interface ViewerDeps {
  /** Renders a diagram of the file at `document`, a URI, next to which its local includes are looked for. */
  render(source: string, dark: boolean, document: string): Promise<DiagramRender>;
  resolvePalette(source: string, dark: boolean, included?: IncludedStyle): Promise<boolean>;
  isDark(): boolean;
  /**
   * Exports the diagram that starts on `line` of the file at `uri` as a
   * PNG, as Export Diagram as PNG does at the cursor.
   */
  exportPng(uri: string, line: number): Promise<void>;
  /**
   * What copying `diagram` of the file at `uri` puts on the clipboard: the
   * PNG Export Diagram as PNG would write, for the page to draw, or why
   * there is none.
   */
  copyPng(uri: string, diagram: PlantUmlBlock): Promise<PngSource | { error: string }>;
  labels: ViewerLabels;
}

/** What the page may ask for. Anything else it sends is ignored. */
export type ViewerRequest =
  | { type: 'ready' }
  | { type: 'select'; index: number }
  | { type: 'exportPng' }
  | { type: 'copyPng'; id: number };

/** Reads a message from the page, which is untrusted, against `count` diagrams. */
export function parseRequest(message: unknown, count: number): ViewerRequest | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const { type, index, id } = message as { type?: unknown; index?: unknown; id?: unknown };
  if (type === 'ready' || type === 'exportPng') {
    return { type };
  }
  if (type === 'select' && typeof index === 'number' && Number.isInteger(index)) {
    return index >= 0 && index < count ? { type: 'select', index } : null;
  }
  // The page numbers its copies, so that each answer finds its own.
  if (type === 'copyPng' && typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
    return { type, id };
  }
  return null;
}

/** The zoom toolbar's text, localised by the caller. */
export interface ToolbarLabels {
  selectDiagram: string;
  toolbar: string;
  zoomOut: string;
  zoomIn: string;
  fit: string;
  actualSize: string;
  /** The PNG button, which exports the diagram shown. */
  exportPng: string;
  /**
   * The Copy button, which copies the diagram shown as the PNG button
   * exports it, and what the page says of a copy.
   */
  copy: {
    text: string;
    label: string;
    copying: string;
    copied: string;
    /** A copy that failed, with the reason in place of `{0}`. */
    failed: string;
    /** The reason for a PNG the page could not draw at its size. */
    unmade: string;
    /** The reason for an image the clipboard did not take. */
    unwritten: string;
  };
}

/**
 * The body of the page, which media/viewer/viewer.js fills. Each button's
 * tooltip names the key that does the same.
 */
export function viewerBody(labels: ToolbarLabels, escape: (text: string) => string): string {
  const button = (id: string, text: string, label: string, key: string, more = ''): string =>
    `<button id="${id}" type="button" aria-label="${escape(label)}" title="${escape(`${label} (${key})`)}"${more}>${escape(text)}</button>`;
  return [
    `<header><select id="diagrams" aria-label="${escape(labels.selectDiagram)}" hidden></select><span id="status" role="status"></span>`,
    // The zoom, then PNG and Copy, which a narrow panel wraps together.
    '<div id="bar">',
    `<div id="tools" role="toolbar" aria-label="${escape(labels.toolbar)}">`,
    button('zoom-out', '−', labels.zoomOut, '-'),
    '<span id="zoom" aria-live="polite"></span>',
    button('zoom-in', '+', labels.zoomIn, '+'),
    button('fit', labels.fit, labels.fit, '0', ' aria-pressed="true"'),
    button('actual', '100%', labels.actualSize, '1'),
    '</div>',
    '<div id="actions">',
    `<button id="export-png" type="button" aria-label="${escape(labels.exportPng)}" title="${escape(labels.exportPng)}">PNG</button>`,
    `<button id="copy-png" type="button" aria-label="${escape(labels.copy.label)}" title="${escape(labels.copy.label)}"` +
      ` data-copying="${escape(labels.copy.copying)}" data-copied="${escape(labels.copy.copied)}"` +
      ` data-failed="${escape(labels.copy.failed)}" data-unmade="${escape(labels.copy.unmade)}" data-unwritten="${escape(labels.copy.unwritten)}">` +
      `${escape(labels.copy.text)}</button>`,
    '</div>',
    '</div>',
    '</header>',
    '<main id="stage" tabindex="0"><div id="canvas"><img id="diagram" alt="" hidden draggable="false"></div></main>',
  ].join('');
}

/** One PlantUML file's viewer. */
export class DiagramViewer {
  /** The diagram shown: by its name when it has one, else by its position. */
  private target: { name: string | null; index: number } = { name: null, index: 0 };
  /** Counts draws, so an older render finishing late is dropped. */
  private generation = 0;
  /** Says the diagram is not drawn again since the file changed, or ''. */
  private note = '';
  /** What the local includes of the diagram drawn last looked at (path keys). */
  private dependencies: readonly string[] = [];

  constructor(
    private readonly panel: ViewerPanel,
    private readonly deps: ViewerDeps,
    /** The file's name without its extension, which names a lone diagram. */
    private readonly fileName: string,
    /** The file's URI, which the page keeps so the panel can come back after a restart. */
    private readonly uri: string
  ) {}

  /**
   * Makes the diagram named `name` the one shown, for a panel brought back
   * after a restart. Without a name there is nothing to go by — the
   * diagram had none — so the page asks for a choice rather than guessing.
   */
  restore(name: string | null): void {
    this.target = { name, index: name === null ? -1 : 0 };
  }

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
    if (request?.type === 'exportPng') {
      const diagram = diagrams[this.indexIn(diagrams)];
      if (diagram !== undefined) {
        await this.deps.exportPng(this.uri, diagram.openLine);
      }
      return;
    }
    if (request?.type === 'copyPng') {
      await this.copy(diagrams[this.indexIn(diagrams)], request.id);
      return;
    }
    if (request?.type === 'select') {
      this.target = { name: diagrams[request.index]?.name ?? null, index: request.index };
    }
    if (request !== null) {
      await this.update(text);
    }
  }

  /**
   * Keeps the diagram shown, saying with `note` that the file has changed
   * since it was drawn, for a file drawn again only on save or on request.
   * A render still in progress keeps the note once it lands.
   */
  async stale(note: string): Promise<void> {
    this.note = note;
    await this.status(note, false, false);
  }

  /**
   * How `changes` (path key → saved or changed on disk) touch the files the
   * diagram shown includes: 'none' when they do not.
   */
  dependsOn(changes: ReadonlyMap<string, boolean>): 'none' | 'edited' | 'saved' {
    return changeTo(this.dependencies, changes);
  }

  /** Lists the diagrams of `text` and draws the one shown, again. */
  async update(text: string): Promise<void> {
    const generation = ++this.generation;
    this.note = '';
    const diagrams = findFileDiagrams(text, this.fileName);
    const { labels } = this.deps;
    const index = this.indexIn(diagrams);
    const diagram = diagrams[index];

    await this.panel.post({
      type: 'diagrams',
      items: diagrams.map((candidate, position) =>
        labels.entry(candidate.name ?? labels.diagram(position + 1), candidate.openLine + 1)
      ),
      selected: diagram === undefined ? -1 : index,
      keep: { uri: this.uri, name: diagram?.name ?? this.target.name },
    });
    if (diagram === undefined) {
      // Not another diagram in its place: the one asked for has gone, or
      // none was chosen yet.
      const unchosen = this.target.name === null && this.target.index === -1;
      const reason = diagrams.length === 0 ? labels.empty : unchosen ? labels.choose : labels.gone;
      await this.status(reason, !unchosen, true);
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
      const asked = this.deps.isDark();
      const { result, palette: dark } = await drawReadable(
        shape.source,
        asked,
        (source, palette, included) => this.deps.resolvePalette(source, palette, included),
        (palette) => this.deps.render(shape.source, palette, this.uri)
      );
      const { svg, failedIncludes, dependencies } = result;
      if (generation !== this.generation) {
        return;
      }
      this.dependencies = dependencies;
      await this.panel.post({
        type: 'render',
        svg,
        backdrop: dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light,
        // Which diagram this is, so the page keeps each one's zoom apart.
        key: diagram.name ?? `#${String(index)}`,
      });
      // The engine draws its errors: the drawing stays, and the reason is
      // named with the line of the file it points to. sourceLine counts
      // from 0 and the engine's line from 1.
      const failure = recognizeEngineError(svg);
      if (failure === null) {
        // Not drawn as asked: say why, unless the drawing is not up to date.
        const why = this.note === '' && dark !== asked ? labels.otherPalette(dark) : this.note;
        const warnings = recognizeEngineWarnings(svg).flatMap((message) => {
          const translated = labels.errorMessage(message);
          return translated === message ? [] : [translated];
        });
        await this.status([...warnings, why].filter((text) => text !== '').join(' '), false, false);
      } else {
        const line = failure.line === null ? null : diagram.sourceLine + failure.line;
        const message = withIncludeReason(failure.message, failedIncludes);
        await this.status(labels.engineError(message, line), true, false);
      }
    } catch (error: unknown) {
      if (generation !== this.generation) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.status(EMOJI_UNAVAILABLE.test(message) ? labels.emojiUnavailable : labels.errorMessage(message), true, true);
    }
  }

  /**
   * Answers the page's copy `id` of `diagram`: what to draw onto the
   * clipboard, or why nothing will be. The page waits for an answer either
   * way, so an error is answered too.
   */
  private async copy(diagram: PlantUmlBlock | undefined, id: number): Promise<void> {
    let drawn: PngSource | { error: string };
    try {
      drawn = diagram === undefined ? { error: this.deps.labels.gone } : await this.deps.copyPng(this.uri, diagram);
    } catch (error: unknown) {
      drawn = { error: this.deps.labels.errorMessage(error instanceof Error ? error.message : String(error)) };
    }
    await this.panel.post(
      'error' in drawn
        ? { type: 'copyFailed', id, message: drawn.error }
        : { type: 'copy', id, svg: drawn.svg, width: drawn.width, height: drawn.height, background: drawn.background }
    );
  }

  /** Where the diagram shown is among `diagrams`: by its name, else its position. */
  private indexIn(diagrams: readonly PlantUmlBlock[]): number {
    return this.target.name === null
      ? this.target.index
      : diagrams.findIndex((diagram) => diagram.name === this.target.name);
  }

  private async status(text: string, error: boolean, clear: boolean): Promise<void> {
    await this.panel.post({ type: 'status', text, error, clear });
  }
}
