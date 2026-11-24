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
 * A screen reader is told what a drawing comes to, not that one is under
 * way: the file is drawn again each time it stops changing, and being told
 * each time would get in the way of typing. The image and the panel are
 * named after the diagram, by the title it draws, else by its name, else by
 * its place in the file.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * panel and the renderer arrive as ports, and the caller hands over the
 * file's text.
 */

import { ViewerSelection, type TextChange } from './selection';
import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { notationLabel, unsupportedKinds } from '../core/notation';
import { diagramShape } from '../core/shape';
import type { DiagramRender, IncludedStyle } from '../core/types';
import { blockAtLine, type PlantUmlBlock } from '../export/blocks';
import type { PngSource } from '../export/exporter';
import { withIncludeReason } from '../includes/describe';
import { changeTo } from '../includes/tracking';
import { drawReadable } from '../render/palette';
import { recognizeEngineError, recognizeEngineWarnings } from '../render/engine-error';
import { drawnTitle } from '../render/title';

/** What the viewer needs of its panel. */
export interface ViewerPanel {
  post(message: unknown): Promise<boolean>;
}

/** Text shown in the panel, localised by the caller. */
export interface ViewerLabels {
  errorMessage(message: string): string;
  /** The name of an unnamed diagram, from its position counting from 1. */
  diagram(position: number): string;
  /**
   * What a screen reader calls an unnamed diagram among several: its
   * position counting from 1, in the file named `file`.
   */
  unnamed(position: number, file: string): string;
  /** A diagram in the list: its name and the line it starts on. */
  entry(name: string, line: number): string;
  rendering: string;
  /** What a screen reader is told once the diagram called `name` is drawn. */
  rendered(name: string): string;
  /** The diagram shown is no longer in the file. */
  gone: string;
  /** No diagram is chosen yet: one is to be picked from the list. */
  choose: string;
  /** The file holds no diagram. */
  empty: string;
  remoteReference: string;
  emojiUnavailable: string;
  pages: string;
  /** A formula in `tag` (`<math>` or `<latex>`), which the engine draws blank. */
  formula(tag: string): string;
  /** A diagram embedded with `{{ … }}`, which the engine leaves out. */
  embeddedDiagram: string;
  /** An image the engine does not draw, writing placeholder text in its place. */
  image: string;
  engineError(message: string, line: number | null): string;
  /** The diagram is drawn in the palette `dark` names, as its colours are hard to read in the one asked for. */
  otherPalette(dark: boolean): string;
}

export interface ViewerDeps {
  /** Renders a diagram of the file at `document`, a URI, next to which its local includes are looked for. */
  render(source: string, dark: boolean, document: string): Promise<DiagramRender>;
  resolvePalette(source: string, dark: boolean, included?: IncludedStyle): Promise<boolean>;
  isDark(): boolean;
  exportPng(snapshot: ViewerSnapshot): Promise<void>;
  copySvgText(snapshot: ViewerSnapshot): Promise<void>;
  /**
   * What copying `diagram` of the file at `uri` puts on the clipboard: the
   * PNG Export Diagram as PNG would write, for the page to draw, or why
   * there is none.
   */
  copyPng(uri: string, diagram: PlantUmlBlock): Promise<PngSource | { error: string }>;
  labels: ViewerLabels;
}

export interface ViewerSnapshot {
  text: string;
  block: PlantUmlBlock;
  blocks: PlantUmlBlock[];
  targetToken: number;
}

type ViewerRequest =
  | { type: 'ready' }
  | { type: 'select'; index: number; listRevision: number }
  | { type: 'exportPng' | 'copySvg'; targetToken: number }
  | { type: 'copyPng'; targetToken: number; id: number };

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function parseRequest(message: unknown): ViewerRequest | null {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return null;
  }
  const { type, index, id, listRevision, targetToken } = message as Record<string, unknown>;
  if (type === 'ready') {return { type };}
  if (type === 'select' && positive(listRevision) && typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) {
    return { type, listRevision, index };
  }
  if (!positive(targetToken)) {
    return null;
  }
  if (type === 'exportPng' || type === 'copySvg') {return { type, targetToken };}
  if (type === 'copyPng' && positive(id)) {return { type, targetToken, id };}
  return null;
}

/**
 * What the panel's context menu has the page do: take the next drag as
 * marking an area to zoom to, or move the view to an edge of the diagram or
 * to its centre.
 */
export type ViewAction = 'zoomToArea' | 'top' | 'bottom' | 'left' | 'right' | 'centre';

/** The zoom toolbar's text, localised by the caller. */
export interface ToolbarLabels {
  selectDiagram: string;
  toolbar: string;
  zoomOut: string;
  zoomIn: string;
  fit: string;
  actualSize: string;
  /** The toggle that has a drag mark an area to zoom to. */
  zoomToArea: string;
  /** What a screen reader is told of a zoom it changed, the percentage in place of `{0}`. */
  zoomLevel: string;
  /** The PNG button, which exports the diagram shown. */
  exportPng: string;
  /** The Copy SVG button, which copies the diagram shown as SVG text. */
  copySvgText: string;
  /** The words on the Copy SVG button. */
  copySvgButton: string;
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
 * tooltip names the key that does the same. The status line is not read out
 * as it changes: what a screen reader is told goes to the two regions of
 * `announcer`, which take turns so that the same words are said again, as
 * VS Code's own announcements do.
 */
export function viewerBody(labels: ToolbarLabels, escape: (text: string) => string): string {
  const button = (id: string, text: string, label: string, key: string, more = ''): string =>
    `<button id="${id}" type="button" aria-label="${escape(label)}" title="${escape(`${label} (${key})`)}"${more}>${escape(text)}</button>`;
  return [
    `<header><select id="diagrams" aria-label="${escape(labels.selectDiagram)}" hidden></select><span id="status"></span>`,
    // The zoom, then PNG and Copy, which a narrow panel wraps together.
    '<div id="bar">',
    `<div id="tools" role="toolbar" aria-label="${escape(labels.toolbar)}">`,
    button('zoom-out', '−', labels.zoomOut, '-'),
    `<span id="zoom" data-spoken="${escape(labels.zoomLevel)}"></span>`,
    button('zoom-in', '+', labels.zoomIn, '+'),
    button('fit', labels.fit, labels.fit, '0', ' aria-pressed="true"'),
    button('actual', '100%', labels.actualSize, '1'),
    button('area', labels.zoomToArea, labels.zoomToArea, 'Z', ' aria-pressed="false"'),
    '</div>',
    '<div id="actions">',
    `<button id="export-png" type="button" aria-label="${escape(labels.exportPng)}" title="${escape(labels.exportPng)}">PNG</button>`,
    `<button id="copy-png" type="button" aria-label="${escape(labels.copy.label)}" title="${escape(labels.copy.label)}"` +
      ` data-copying="${escape(labels.copy.copying)}" data-copied="${escape(labels.copy.copied)}"` +
      ` data-failed="${escape(labels.copy.failed)}" data-unmade="${escape(labels.copy.unmade)}" data-unwritten="${escape(labels.copy.unwritten)}">` +
      `${escape(labels.copy.text)}</button>`,
    `<button id="copy-svg" type="button" aria-label="${escape(labels.copySvgText)}" title="${escape(labels.copySvgText)}">` +
      `${escape(labels.copySvgButton)}</button>`,
    '</div>',
    '</div>',
    '</header>',
    // Focused, the drawing area is described by the status line. The
    // marquee outlines an area being marked to zoom to.
    '<main id="stage" tabindex="0" aria-describedby="status"><div id="canvas">' +
      '<img id="diagram" alt="" hidden draggable="false"><div id="marquee" hidden></div></div></main>',
    '<div id="announcer"><div role="status"></div><div role="status"></div></div>',
  ].join('');
}

/** One PlantUML file's viewer. */
export class DiagramViewer {
  private readonly selection: ViewerSelection;
  private targetToken = 0;
  private lost = false;
  private resetViews = false;
  private renderedToken = -1;
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
  ) {
    this.selection = new ViewerSelection(fileName);
  }

  restore(state: Parameters<ViewerSelection['restore']>[0], text: string): void {
    this.selection.read(text);
    this.selection.restore(state);
    this.resetViews = true;
    this.invalidate();
  }

  private invalidate(): void {
    this.targetToken++;
    this.generation++;
    this.dependencies = [];
    this.renderedToken = -1;
  }

  dispose(): void {
    this.invalidate();
  }

  select(text: string, line: number | null): void {
    this.selection.read(text);
    const at = line === null ? null : blockAtLine(this.selection.diagrams, line);
    this.selection.choose(at ? this.selection.diagrams.indexOf(at) : 0);
    this.selection.waiting = this.selection.diagrams.length === 0;
    this.lost = false;
    this.invalidate();
  }

  async show(text: string, line: number | null): Promise<void> {
    this.select(text, line);
    await this.update(text);
  }

  /** Update identity synchronously even when drawing is deferred until a save. */
  sync(text: string, changes?: readonly TextChange[], replaced = false): boolean {
    const before = this.selection.current;
    const waiting = this.selection.waiting;
    this.selection.read(text, changes, replaced);
    if (before !== this.selection.current) {
      this.lost = !this.selection.current;
      this.invalidate();
    }
    return waiting && !!this.selection.current;
  }

  /** A reopened document, or a changed version for which no edit event was delivered. */
  reconcile(text: string): void {
    this.sync(text, undefined, true);
    void this.list();
    if (!this.selection.current) {
      void this.noSelection();
    }
  }

  changed(text: string, changes: readonly TextChange[], replaced: boolean, note: string | null): boolean {
    if (this.sync(text, changes, replaced)) {
      void this.update(text);
      return false;
    }
    void this.list();
    if (!this.selection.current) {
      void this.noSelection();
      return false;
    }
    if (note !== null) {
      void this.stale(note);
    }
    return note === null;
  }

  snapshot(token: number): ViewerSnapshot | null {
    const current = this.selection.current;
    if (token !== this.targetToken || token !== this.renderedToken || !current) {
      return null;
    }
    return { text: this.selection.text, block: this.selection.diagrams[current.index]!, blocks: this.selection.diagrams, targetToken: token };
  }

  async receive(message: unknown, text: string): Promise<void> {
    const request = parseRequest(message);
    if (!request) {
      return;
    }
    const before = this.selection.revision;
    this.sync(text);
    if (request.type === 'ready') {
      this.selection.revision++;
      this.invalidate();
      const drawing = this.update(text);
      this.resetViews = false;
      await drawing;
    } else if (request.type === 'select') {
      if (request.listRevision !== this.selection.revision) {
        await this.list();
        return;
      }
      if (request.index >= this.selection.diagrams.length) {
        return;
      }
      this.selection.choose(request.index);
      this.lost = false;
      this.invalidate();
      await this.update(text);
    } else {
      if (before !== this.selection.revision) {
        void this.list();
        if (!this.selection.current) {
          void this.noSelection();
        }
      }
      const snapshot = this.snapshot(request.targetToken);
      if (request.type === 'copyPng') {
        await this.copy(snapshot?.block, request.id, request.targetToken);
      } else if (snapshot) {
        await (request.type === 'exportPng' ? this.deps.exportPng(snapshot) : this.deps.copySvgText(snapshot));
      }
    }
  }

  private list(): Promise<boolean> {
    const { labels } = this.deps;
    const resetViews = this.resetViews;
    return this.panel.post({
      type: 'diagrams',
      resetViews,
      viewKey: this.selection.current?.key,
      listRevision: this.selection.revision,
      targetToken: this.targetToken,
      generation: this.generation,
      items: this.selection.diagrams.map((d, i) => labels.entry(d.name ?? labels.diagram(i + 1), d.openLine + 1)),
      selected: this.selection.current?.index ?? -1,
      keep: { uri: this.uri, stateVersion: 2, ...this.selection.saved() },
    });
  }

  private noSelection(): Promise<void> {
    const { labels } = this.deps;
    const reason = !this.selection.diagrams.length ? labels.empty : this.lost ? labels.gone : labels.choose;
    return this.status(reason, this.lost, true);
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

  /** Has the page do `action`, chosen in the panel's context menu. */
  async act(action: ViewAction): Promise<void> {
    await this.panel.post({ type: 'act', action });
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
    this.sync(text);
    const generation = ++this.generation;
    this.note = '';
    const { labels } = this.deps;
    const current = this.selection.current;
    const index = current?.index ?? -1;
    const diagram = this.selection.diagrams[index];
    await this.list();
    if (generation !== this.generation) {
      return;
    }
    if (!diagram || !current) {
      await this.noSelection();
      return;
    }

    if (hasRemoteReference(diagram.source)) {
      await this.status(labels.remoteReference, true, true);
      return;
    }
    const shape = diagramShape(diagram.source);
    if (shape.kind !== 'drawable') {
      await this.status(labels.pages, true, true);
      return;
    }

    await this.status(labels.rendering, false, false, null);
    if (generation !== this.generation) {
      return;
    }
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
      const label = drawnTitle(svg) ?? diagram.name ?? labels.unnamed(index + 1, this.fileName);
      this.renderedToken = this.targetToken;
      await this.panel.post({
        type: 'render',
        targetToken: this.targetToken,
        generation,
        svg,
        backdrop: dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light,
        // Which diagram this is, so the page keeps each one's zoom apart.
        key: current.key,
        // What the image and the drawing area are called.
        label,
      });
      if (generation !== this.generation) {
        return;
      }
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
        // And what the engine drew the diagram without.
        const leftOut = unsupportedKinds(shape.source).map((kind) => notationLabel(kind, labels));
        const text = [...warnings, ...leftOut, why].filter((part) => part !== '').join(' ');
        await this.status(text, false, false, [labels.rendered(label), text].filter((part) => part !== '').join(' '));
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
  private async copy(diagram: PlantUmlBlock | undefined, id: number, targetToken: number): Promise<void> {
    let drawn: PngSource | { error: string };
    try {
      drawn = diagram === undefined ? { error: this.deps.labels.gone } : await this.deps.copyPng(this.uri, diagram);
    } catch (error: unknown) {
      drawn = { error: this.deps.labels.errorMessage(error instanceof Error ? error.message : String(error)) };
    }
    await this.panel.post(
      'error' in drawn
        ? { type: 'copyFailed', id, targetToken, message: drawn.error }
        : { type: 'copy', id, targetToken, svg: drawn.svg, width: drawn.width, height: drawn.height, background: drawn.background }
    );
  }

  /**
   * Shows `text` in the status line, and has the page tell a screen reader
   * `spoken` once drawing settles, unless it told it the same last. Null
   * while a drawing is under way, which a screen reader is not told of.
   */
  private async status(text: string, error: boolean, clear: boolean, spoken: string | null = text): Promise<void> {
    if (clear) {
      this.renderedToken = -1;
    }
    await this.panel.post({ type: 'status', targetToken: this.targetToken, generation: this.generation, text, error, clear, spoken });
  }
}
