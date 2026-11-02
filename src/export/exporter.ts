import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { notationLabel, unsupportedKinds } from '../core/notation';
import { diagramShape } from '../core/shape';
import type { DiagramRender, IncludedStyle } from '../core/types';
import { withIncludeReason } from '../includes/describe';
import { recognizeEngineError } from '../render/engine-error';
import { drawReadable } from '../render/palette';
import { isValidBlockName, type PlantUmlBlock } from './blocks';
import { digestOf, OutputBuffer, sameDigest, type Digest, type Held, type SpoolDeps } from './buffer';
import { artifactKey, sameKey, type ArtifactKey, type ArtifactRecord, type RecordResult } from './history';
import { canonicalJson, inputManifest, type InputManifest, type RendererIdentity } from './manifest';
import type { DrawnFrom } from './recheck';
import type { ReplayReason } from './replay';

/**
 * Renders diagrams to SVG files next to the document, or one to a PNG.
 *
 * The preview keeps its SVG in memory, which is enough to look at and no
 * use to anyone else: GitHub renders a ` ```plantuml ` block as source,
 * not as a diagram. Exporting writes the same sanitised SVG the preview
 * receives to a file, so the document can reference it and be readable
 * outside VS Code. A PNG is that SVG drawn at a scale, for where SVG
 * does not go, such as a slide or a chat.
 *
 * Like the markdown-it plugin, this module has no dependency on the
 * `vscode` module — the file system and the renderer arrive through
 * {@link ExporterDeps} — so the whole flow is unit-testable.
 */

export interface ExporterDeps extends SpoolDeps {
  errorMessage(message: string): string;
  /**
   * Renders PlantUML source to sanitised SVG (the worker round-trip), its
   * local includes looked for next to the document being exported.
   */
  render(source: string, dark: boolean): Promise<DiagramRender>;
  /** Whether diagrams should currently render in dark colours. */
  isDark(): boolean;
  /**
   * The palette to draw `source` in when `dark` is asked for: the other one
   * for a diagram whose `!theme` cannot be read in it (src/render/palette.ts).
   */
  resolvePalette(source: string, dark: boolean, included?: IncludedStyle): Promise<boolean>;
  /**
   * The bytes of the file at `path`, or null when there is none. Rejects
   * for a folder, which a diagram is never written in place of.
   */
  readExisting(path: string): Promise<Uint8Array | null>;
  /**
   * The record of the file at `path`: the diagram an export last wrote it
   * for, and the SHA-256 of what it wrote (src/export/history.ts). Null
   * when there is none to go by.
   */
  ownerOf(path: string): ArtifactRecord | null;
  /**
   * Whether `existing`, the file at `path`, is what an earlier version of
   * the extension recorded exporting there from `document`, unchanged since
   * (src/export/ownership.ts). Such a file is replaced once that is
   * confirmed, as the records of this version are kept per diagram.
   */
  wroteBefore(path: string, document: string, existing: Uint8Array): boolean;
  /** Whether the file at `path` is open with unsaved changes: someone's work, whoever wrote it last. */
  isDirty(path: string): boolean;
  /**
   * Records that `content` was written to `path` for the diagram `key`
   * names, drawn from `input` when that is known, so that exporting it
   * again replaces the file without asking. Never rejects: what became of
   * the record is the answer.
   */
  record(key: ArtifactKey, path: string, content: Uint8Array, input?: InputManifest): Promise<RecordResult>;
  /**
   * The renderer as it ships, for the record of what an image was drawn
   * from (src/export/manifest.ts); null when it cannot be told, and the
   * image is recorded without.
   */
  rendererIdentity(): Promise<RendererIdentity | null>;
  /**
   * Why `drawing` is not to be written after all: what it was drawn from
   * (`drawnFrom`), looked at again as it is now (src/export/recheck.ts) —
   * the diagram's text, the files it included, where they are looked for —
   * has changed since. Null when nothing has, or the drawing does not say
   * what it was drawn from.
   */
  staleInputs(drawing: Drawing): Promise<string | null>;
  /** Runs `task` once no other export in this window is writing the file at `path`. */
  lock<T>(path: string, task: () => Promise<T>): Promise<T>;
  /**
   * Asks before replacing files that hold something other than their
   * diagram, and that are not their diagram's own export: 'replace' them,
   * 'keep' them and write only the rest, or undefined to write nothing.
   * `canKeep` says whether there is a rest: more than one diagram is being
   * exported.
   */
  confirmReplace(
    files: readonly ReplaceTarget[],
    canKeep: boolean
  ): Promise<'replace' | 'keep' | undefined>;
  /**
   * Writes `content` to `path`, text as UTF-8, creating parent
   * directories. Unless `replace` is set, a file that has appeared there
   * since the check is an error rather than something to write over.
   */
  writeFile(path: string, content: string | Uint8Array, replace: boolean): Promise<void>;
  /** The scale a PNG is drawn at: 1, 2 or 4 times the diagram's size. */
  pngScale(): number;
  /**
   * Draws `svg` at `width`×`height` pixels on `background` and returns the
   * PNG, or rejects with a reason fit to show.
   */
  toPng(svg: string, width: number, height: number, background: string): Promise<Uint8Array>;
  /** Joins a document path's directory with a relative path. */
  resolve(documentPath: string, relative: string): string;
  /** Localised reason given for a block carrying a URL-based include. */
  remoteReferenceMessage: string;
  /** Localised reason given for a diagram that uses an emoji. */
  emojiUnavailableMessage: string;
  /** Localised reason given for a block name unusable as a file name. */
  invalidNameMessage: string;
  /** Localised reason given for a block holding more than one diagram. */
  severalDiagramsMessage: string;
  /** Localised reason given for a diagram split into pages with `newpage`. */
  pagesMessage: string;
  /** Localised note for a formula in `tag` (`<math>` or `<latex>`), which the engine draws blank. */
  formulaMessage(tag: string): string;
  /** Localised note for a diagram embedded with `{{ … }}`, which the engine leaves out. */
  embeddedDiagramMessage: string;
  /** Localised note for an image the engine does not draw, writing placeholder text in its place. */
  imageMessage: string;
  /**
   * Localised reason given for a diagram the engine drew as an error:
   * `message` is the engine's own text, or for a local include that failed,
   * the file it asked for and why (withIncludeReason), `line` the document
   * line it blames (counting from 1), or null when it names none.
   */
  engineErrorMessage(message: string, line: number | null): string;
  /**
   * Localised reason given for a PNG past the size one can have: its
   * size, and the largest scale it fits at, or null when none does.
   */
  pngTooLargeMessage(width: number, height: number, fits: number | null): string;
  /** Localised reason given for a PNG that could not be made as asked. */
  pngFailedMessage: string;
  /** Localised reason given for SVG text of `bytes` bytes, past what is copied to the clipboard. */
  svgTooLargeMessage(bytes: number): string;
  /** Localised reason given for a diagram headed for the file another one is written to. */
  sameFileMessage: string;
  /** Localised reason given for a file that changed after the export looked at it. */
  changedMessage: string;
  /** Localised reason given for a file open with unsaved changes. */
  dirtyMessage: string;
  /** Localised reason given for a drawing whose file, held until its turn, changed meanwhile (src/export/buffer.ts). */
  spoolChangedMessage: string;
}

/** A file the export asks before replacing. */
export interface ReplaceTarget {
  path: string;
  /** Whether an earlier version of the extension exported it, as {@link ExporterDeps.wroteBefore} says. */
  byEarlierVersion: boolean;
  /**
   * Whether, once replaced, it is recorded as its diagram's export, which
   * exporting the diagram again then replaces without asking: not for a
   * diagram exported under a name asked for, which has none of its own.
   */
  recorded: boolean;
}

/** What drawing a diagram as it is exported needs: the deps that do not touch files. */
export type DrawingDeps = Pick<
  ExporterDeps,
  | 'errorMessage'
  | 'render'
  | 'isDark'
  | 'resolvePalette'
  | 'pngScale'
  | 'remoteReferenceMessage'
  | 'emojiUnavailableMessage'
  | 'severalDiagramsMessage'
  | 'pagesMessage'
  | 'formulaMessage'
  | 'embeddedDiagramMessage'
  | 'imageMessage'
  | 'engineErrorMessage'
  | 'pngTooLargeMessage'
  | 'pngFailedMessage'
  | 'svgTooLargeMessage'
>;

/** What a PNG is drawn from: the SVG with its background, the size in pixels, and that background. */
export interface PngSource {
  svg: string;
  width: number;
  height: number;
  background: string;
}

/** The largest PNG made: pixels a side and in all, and bytes. */
export const PNG_LIMITS = { side: 8192, pixels: 16_000_000, bytes: 64 * 1024 * 1024 } as const;

/** The scales a PNG can be drawn at. */
export const PNG_SCALES = [1, 2, 4] as const;

/** The most SVG text that is copied to the clipboard, in UTF-8 bytes. */
export const SVG_TEXT_LIMIT = 32 * 1024 * 1024;

/** The most named diagrams exported at once, from a document or a folder. */
export const MAX_BULK_DIAGRAMS = 1000;

/** One diagram's outcome. */
export interface ExportResult {
  name: string;
  /** Absolute path written, or null when the diagram failed. */
  path: string | null;
  /** Failure reason, or null on success. */
  error: string | null;
  /**
   * For a diagram the engine drew as an error, what `error` was made
   * from: the engine's message and the document line it blames (counting
   * from 1, in the text that was exported), or null for no line. A caller
   * that inserts lines above the block afterwards needs these to say
   * where the problem is now.
   */
  engineError?: { message: string; line: number | null };
  /**
   * What a failure is about, so that a caller can offer the way out: the
   * diagram's source, whose problems the Problems panel lists too; the PNG
   * drawn from it, where an SVG may still do; the SVG text, too long for
   * the clipboard, where a file may still do; the file written; or what it
   * was drawn from, which changed before it was written.
   */
  cause?: 'source' | 'png' | 'text' | 'file' | 'inputs';
  /** For a PNG too large at the scale set, the largest scale it fits at. */
  fitsAt?: number;
  /** What a written diagram was drawn without: notation the engine does not draw, for the report. */
  notes?: string[];
  /** Set for a file that held the diagram already, and was left as it was. */
  unchanged?: true;
  /**
   * For a file written but not recorded as its diagram's export, which
   * exporting the diagram again then asks before replacing: why.
   */
  untracked?: Exclude<RecordResult, 'recorded'>;
}

export interface ExportOutcome {
  /** Diagrams written to their files. */
  written: ExportResult[];
  /** Diagrams whose files held them already, left as they were. */
  unchanged: ExportResult[];
  /** Diagrams written to their files, but not recorded as their exports. */
  untracked: ExportResult[];
  failed: ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
  /** Existing files left as they were, replacing them having been declined. */
  kept: number;
  /**
   * Diagrams not written because the export stopped part way: cancelled, or
   * unable to record what it wrote.
   */
  stopped: number;
}

/** A diagram rendered: the SVG's text, or a PNG. */
interface Drawn {
  name: string;
  path: string;
  /** The document the diagram is exported from. */
  document: string;
  /** The diagram the file is recorded as the export of, or null for one exported under a name asked for. */
  key: ArtifactKey | null;
  content: string | Uint8Array;
  /** Notation the engine drew the diagram without, said in the export's report. */
  notes?: string[];
  /** What it was drawn from, recorded with the file. */
  input?: InputManifest;
  /**
   * What it was drawn from, looked at again before it is written, when its
   * drawing says: a diagram without a name of its own, which is not
   * recorded, by its local includes alone.
   */
  drawnFrom?: DrawnFrom;
}

/** A diagram rendered and ready to write, its content held by the export's {@link OutputBuffer}. */
export interface Drawing extends Omit<Drawn, 'content'> {
  content: Held;
}

/** A diagram planned for export, before anything is drawn: the file it goes to, and what it is recorded as. */
export interface PlannedDiagram {
  block: PlantUmlBlock;
  name: string;
  path: string;
  key: ArtifactKey | null;
}

/** What a diagram is exported as. */
export type ExportFormat = 'svg' | 'png';

/**
 * The size an SVG gives itself, in CSS pixels: its `width` and `height`,
 * which PlantUML's `scale` sets, else its viewBox. Null without either.
 */
export function svgSize(svg: string): { width: number; height: number } | null {
  const open = /^<svg[^>]*>/.exec(svg)?.[0] ?? '';
  const width = Number(/\swidth="([\d.]+)"/.exec(open)?.[1]);
  const height = Number(/\sheight="([\d.]+)"/.exec(open)?.[1]);
  if (width > 0 && height > 0) {
    return { width, height };
  }
  const viewBox = /\sviewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(open);
  const boxWidth = Number(viewBox?.[1]);
  const boxHeight = Number(viewBox?.[2]);
  return boxWidth > 0 && boxHeight > 0 ? { width: boxWidth, height: boxHeight } : null;
}

/** Whether a PNG of `width`×`height` pixels is within {@link PNG_LIMITS}. */
function fitsPng(width: number, height: number): boolean {
  return width <= PNG_LIMITS.side && height <= PNG_LIMITS.side && width * height <= PNG_LIMITS.pixels;
}

/**
 * Whether `png` is a PNG of `width`×`height` pixels: its signature, then
 * its IHDR chunk, which comes first and holds the size as two big-endian
 * 32-bit integers. A canvas past what the browser can draw stops drawing
 * without saying so, so the size that came back is checked, not assumed.
 */
export function isPngOfSize(png: Uint8Array, width: number, height: number): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.byteLength < 24 || signature.some((byte, index) => png[index] !== byte)) {
    return false;
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const type = String.fromCharCode(...png.subarray(12, 16));
  return view.getUint32(8) === 13 && type === 'IHDR' && view.getUint32(16) === width && view.getUint32(20) === height;
}

/** The content as it would be written: text as UTF-8. */
function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

/**
 * Bakes an opaque background into an exported SVG.
 *
 * The engine leaves most diagram types transparent, and in the preview
 * that is fine — a stylesheet supplies the backdrop. An exported file is
 * viewed on pages this extension does not style: on GitHub's dark theme a
 * transparent light-palette diagram is black text on a near-black page.
 * The rect spans the viewBox, so it covers exactly the canvas.
 */
export function addBackground(svg: string, dark: boolean): string {
  const open = /^<svg[^>]*>/.exec(svg);
  if (open === null) {
    return svg;
  }
  const viewBox = /viewBox="(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(open[0]);
  const size =
    viewBox !== null
      ? `x="${viewBox[1] ?? '0'}" y="${viewBox[2] ?? '0'}" width="${viewBox[3] ?? '100%'}" height="${viewBox[4] ?? '100%'}"`
      : 'width="100%" height="100%"';
  const rect = `<rect ${size} fill="${dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light}"/>`;
  return svg.slice(0, open[0].length) + rect + svg.slice(open[0].length);
}

/** The text an error carries, for a failure's reason. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The notes an export's report carries for `source`: what the engine drew it without. */
function notationNotes(deps: DrawingDeps, source: string): string[] {
  const labels = { formula: deps.formulaMessage, embeddedDiagram: deps.embeddedDiagramMessage, image: deps.imageMessage };
  return unsupportedKinds(source).map((kind) => notationLabel(kind, labels));
}

/** A block drawn as it is exported. */
interface Rendered {
  /** The SVG, its background baked in. */
  svg: string;
  /** Whether it is drawn in the dark palette. */
  dark: boolean;
  /** Whether the dark palette was asked for. */
  asked: boolean;
  /** The drawing the SVG was made from. */
  drawing: DiagramRender;
  /** What the engine was given. */
  render: string;
}

/**
 * Renders a block as it is exported, in the export palette with its
 * background baked in, or says why it cannot be exported.
 */
async function renderBlock(deps: DrawingDeps, block: PlantUmlBlock, name: string): Promise<Rendered | ExportResult> {
  // The preview refuses these before the engine sees them; export has to
  // refuse them too, or the same block that shows an explanation on screen
  // would write out the engine's "cannot include" error diagram instead.
  if (hasRemoteReference(block.source)) {
    return { name, path: null, error: deps.remoteReferenceMessage, cause: 'source' };
  }

  // The engine would draw only the first diagram or page; written out, that
  // part would stand in for the whole block. A missing end line is added,
  // as the preview does, since nothing is lost by it.
  const shape = diagramShape(block.source);
  if (shape.kind === 'several') {
    return { name, path: null, error: deps.severalDiagramsMessage, cause: 'source' };
  }
  if (shape.kind === 'pages') {
    return { name, path: null, error: deps.pagesMessage, cause: 'source' };
  }

  try {
    const asked = deps.isDark();
    const drawn = await drawReadable(
      shape.source,
      asked,
      (source, palette, included) => deps.resolvePalette(source, palette, included),
      (palette) => deps.render(shape.source, palette)
    );
    const dark = drawn.palette;
    const { svg: rendered, failedIncludes } = drawn.result;

    // The engine reports a syntax error, a failed include or an empty
    // diagram by drawing it, through the same success path as a diagram.
    // Written out, that drawing would stand in for the diagram — and the
    // reference updater would link it from the document.
    const failure = recognizeEngineError(rendered);
    if (failure !== null) {
      // sourceLine counts from 0 and the engine's line from 1, so the sum
      // is the document line counting from 1, as an editor shows it.
      const line = failure.line === null ? null : block.sourceLine + failure.line;
      const message = withIncludeReason(failure.message, failedIncludes);
      return {
        name,
        path: null,
        error: deps.engineErrorMessage(message, line),
        engineError: { message, line },
        cause: 'source',
      };
    }

    return { svg: addBackground(rendered, dark), dark, asked, drawing: drawn.result, render: shape.source };
  } catch (error: unknown) {
    const message = messageOf(error);
    return {
      name,
      path: null,
      error: EMOJI_UNAVAILABLE.test(message) ? deps.emojiUnavailableMessage : deps.errorMessage(message),
      cause: 'source',
    };
  }
}

/**
 * What a PNG of `svg` is drawn from at `scale`, without the screen's own
 * pixel ratio, refused rather than shrunk or cut when it would be too
 * large.
 */
function pngSource(deps: DrawingDeps, name: string, svg: string, dark: boolean, scale: number): PngSource | ExportResult {
  const size = svgSize(svg);
  if (size === null) {
    return { name, path: null, error: deps.pngFailedMessage, cause: 'png' };
  }
  const width = Math.ceil(size.width * scale);
  const height = Math.ceil(size.height * scale);
  if (!fitsPng(width, height)) {
    const fits = [...PNG_SCALES]
      .reverse()
      .find((smaller) => fitsPng(Math.ceil(size.width * smaller), Math.ceil(size.height * smaller)));
    return {
      name,
      path: null,
      error: deps.pngTooLargeMessage(width, height, fits ?? null),
      cause: 'png',
      ...(fits === undefined ? {} : { fitsAt: fits }),
    };
  }
  return { svg, width, height, background: dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light };
}

/**
 * Plans the export of `block` under `name`, before anything is drawn: the
 * file it goes to and what the file is recorded as, or why it cannot be
 * exported.
 */
export function planDiagram(
  deps: Pick<ExporterDeps, 'resolve' | 'invalidNameMessage'>,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string,
  format: ExportFormat
): PlannedDiagram | ExportResult {
  // Names become file names, and they come from the document — so on a
  // repository someone else wrote, `x/../../..` would put a file wherever
  // the block asked. Checked here rather than only at the call sites so
  // that no future caller can route around it.
  if (!isValidBlockName(name)) {
    return { name, path: null, error: deps.invalidNameMessage, cause: 'source' };
  }
  return {
    block,
    name,
    path: deps.resolve(documentPath, `${directory}/${name}.${format}`),
    key: artifactKey(documentPath, block, name, format),
  };
}

/**
 * Renders one planned diagram, and holds what it drew in `buffer` until it
 * is written; or says why it cannot be exported.
 *
 * Renders are serialised inside the worker, so calling this in a loop is
 * already sequential; there is nothing to gain from firing them at once.
 */
async function drawBlock(
  deps: ExporterDeps,
  buffer: OutputBuffer,
  documentPath: string,
  planned: PlannedDiagram,
  format: ExportFormat
): Promise<Drawing | ExportResult> {
  const drawn = await renderPlanned(deps, documentPath, planned, format);
  if (!('content' in drawn)) {
    return drawn;
  }
  try {
    return { ...drawn, content: await buffer.hold(drawn.path, drawn.content) };
  } catch (error: unknown) {
    return { name: drawn.name, path: null, error: messageOf(error), cause: 'file' };
  }
}

/** Renders one planned diagram, or says why it cannot be exported. */
async function renderPlanned(
  deps: ExporterDeps,
  documentPath: string,
  { block, name, path, key }: PlannedDiagram,
  format: ExportFormat
): Promise<Drawn | ExportResult> {
  if (!isValidBlockName(name)) {
    return { name, path: null, error: deps.invalidNameMessage, cause: 'source' };
  }

  const rendered = await renderBlock(deps, block, name);
  if (!('svg' in rendered)) {
    return rendered;
  }
  const notes = notationNotes(deps, block.source);
  const drawnFrom = drawnFromOf(key, block, rendered.drawing);
  if (format === 'svg') {
    const input = await inputOf(deps, key, block, rendered, 'svg', null, notes);
    return { name, path, document: documentPath, key, content: rendered.svg, notes, ...input, ...drawnFrom };
  }

  const scale = deps.pngScale();
  const source = pngSource(deps, name, rendered.svg, rendered.dark, scale);
  if (!('svg' in source)) {
    return source;
  }
  let png: Uint8Array;
  try {
    png = await deps.toPng(source.svg, source.width, source.height, source.background);
  } catch (error: unknown) {
    return { name, path: null, error: deps.errorMessage(messageOf(error)), cause: 'png' };
  }
  if (!isPngOfSize(png, source.width, source.height) || png.byteLength > PNG_LIMITS.bytes) {
    return { name, path: null, error: deps.pngFailedMessage, cause: 'png' };
  }
  const input = await inputOf(deps, key, block, rendered, 'png', scale, notes);
  return { name, path, document: documentPath, key, content: png, notes, ...input, ...drawnFrom };
}

/**
 * What a diagram exported under `key` was drawn from, to be looked at again
 * before its file is written (src/export/recheck.ts), when `drawing` says:
 * the diagram's text, by which one with a name of its own is found again,
 * and its local includes. One exported under a name asked for has no
 * name to be found again by; its text is the one the export was asked for.
 */
function drawnFromOf(key: ArtifactKey | null, block: PlantUmlBlock, drawing: DiagramRender): { drawnFrom?: DrawnFrom } {
  const inputs = drawing.inputs;
  if (inputs === undefined) {
    return {};
  }
  return {
    drawnFrom: {
      source: key === null ? null : digestOf(block.raw).sha256,
      context: inputs.context,
      requests: inputs.requests,
      files: inputs.files.map(({ file, sha256 }) => ({ file, sha256 })),
    },
  };
}

/**
 * What a diagram exported under `key` was drawn from, when its drawing
 * says (src/export/manifest.ts): nothing for one exported under a name
 * asked for, which is not recorded.
 */
async function inputOf(
  deps: ExporterDeps,
  key: ArtifactKey | null,
  block: PlantUmlBlock,
  rendered: Rendered,
  format: ExportFormat,
  pngScale: number | null,
  notes: readonly string[]
): Promise<{ input?: InputManifest }> {
  if (key === null || rendered.drawing.inputs === undefined) {
    return {};
  }
  const renderer = await deps.rendererIdentity();
  const input =
    renderer === null
      ? null
      : inputManifest({
          key,
          source: block.raw,
          render: rendered.render,
          drawn: rendered.drawing,
          dark: { asked: rendered.asked, drawn: rendered.dark },
          format,
          pngScale,
          renderer,
          losses: notes.length,
        });
  return input === null ? {} : { input };
}

/**
 * Renders a block as Export Diagram as PNG does, short of drawing the PNG:
 * what to draw it from, or why it cannot be exported. For copying the
 * diagram to the clipboard, which needs neither a name nor a file.
 */
export async function preparePng(deps: DrawingDeps, block: PlantUmlBlock): Promise<PngSource | ExportResult> {
  const name = block.name ?? '';
  const rendered = await renderBlock(deps, block, name);
  return 'svg' in rendered ? pngSource(deps, name, rendered.svg, rendered.dark, deps.pngScale()) : rendered;
}

/**
 * Renders a block as Export Diagram as SVG writes it — the export palette,
 * the background baked in — for copying the text to the clipboard, which
 * needs neither a name nor a file: the text, with what the diagram was
 * drawn without for the notice, or why there is none. Text past
 * {@link SVG_TEXT_LIMIT} is refused rather than handed to the clipboard.
 */
export async function prepareSvg(deps: DrawingDeps, block: PlantUmlBlock): Promise<{ svg: string; notes: string[] } | ExportResult> {
  const name = block.name ?? '';
  const rendered = await renderBlock(deps, block, name);
  if (!('svg' in rendered)) {
    return rendered;
  }
  const bytes = bytesOf(rendered.svg).byteLength;
  if (bytes > SVG_TEXT_LIMIT) {
    return { name, path: null, error: deps.svgTooLargeMessage(bytes), cause: 'text' };
  }
  return { svg: rendered.svg, notes: notationNotes(deps, block.source) };
}

/**
 * Why a diagram's SVG is not exported again on its own when its files are
 * saved, as drawn from them: it cannot be exported at all, as `result`
 * says; the engine drew it without some of its notation; the renderer
 * cannot be told, so neither can what it was drawn from; files it asked
 * for were not delivered, `unread` as they were asked for; or its text may
 * draw it otherwise another time.
 */
export type AutoExportRefusal =
  | { why: 'export'; result: ExportResult }
  | { why: 'loss'; notes: readonly string[] }
  | { why: 'renderer' }
  | { why: 'incomplete'; unread: readonly string[] }
  | { why: 'replay'; replay: 'volatile' | 'unclassified'; reasons: readonly ReplayReason[] };

/** A diagram's SVG drawn as Export Diagram as SVG writes it, with what it was drawn from. */
export interface AutoExportDrawing {
  name: string;
  /** The file it goes to. */
  path: string;
  /** The document the diagram is in. */
  document: string;
  key: ArtifactKey;
  content: string | Uint8Array;
  input: InputManifest;
  /** What it was drawn from, to look at again before it is written (src/export/recheck.ts). */
  drawnFrom: DrawnFrom;
}

/**
 * Draws a diagram planned as an SVG as Export Diagram as SVG draws it —
 * the same bytes — for exporting it with no one asked: or says why it is
 * not to be. Only a diagram the engine draws in full, from inputs all
 * delivered and that draw it the same each time, is. A palette other than
 * the one asked for, which a theme can call for, is no loss.
 */
export async function drawAutoExport(
  deps: ExporterDeps,
  documentPath: string,
  planned: PlannedDiagram & { key: ArtifactKey }
): Promise<AutoExportDrawing | AutoExportRefusal> {
  const drawn = await renderPlanned(deps, documentPath, planned, 'svg');
  if (!('content' in drawn)) {
    return { why: 'export', result: drawn };
  }
  const notes = drawn.notes ?? [];
  if (notes.length > 0) {
    return { why: 'loss', notes };
  }
  const { input, drawnFrom } = drawn;
  if (input === undefined || drawnFrom === undefined) {
    return { why: 'renderer' };
  }
  if (input.completeness === 'known-loss') {
    return { why: 'loss', notes };
  }
  if (input.completeness === 'unknown') {
    // Each named once: a local file by the path the diagram wrote, a file
    // of a bundled library as an include of it is written.
    const { requests, libraries } = input.resources;
    const unread = [
      ...requests.filter(({ outcome }) => outcome !== 'read').map(({ path }) => path),
      ...libraries.filter(({ found }) => !found).map(({ library, key }) => `<${library}/${key}>`),
    ];
    return { why: 'incomplete', unread: [...new Set(unread)] };
  }
  if (input.replay.class !== 'stable-inputs') {
    return { why: 'replay', replay: input.replay.class, reasons: input.replay.reasons };
  }
  return { name: drawn.name, path: drawn.path, document: drawn.document, key: planned.key, content: drawn.content, input, drawnFrom };
}

/** A file a drawing goes to, looked at before any is written. */
interface Checked {
  drawing: Drawing;
  /** The digest of the file's bytes, or null when there was none: the bytes themselves are not kept. */
  existing: Digest | null;
  /** The file's record. */
  owner: ArtifactRecord | null;
  /**
   * What is done with it: written without asking, as a new file or the
   * diagram's own export, unchanged since; left alone, as it holds the
   * drawing already; or written once that is confirmed.
   */
  action: 'write' | 'unchanged' | 'ask';
  /** For a file asked about, whether an earlier version of the extension exported it. */
  byEarlierVersion: boolean;
}

/** Whether `existing` is the drawing's diagram's own export, as `owner` records it, unchanged since. */
function isOwn(drawing: Drawing, owner: ArtifactRecord | null, existing: Digest): boolean {
  return drawing.key !== null && owner !== null && sameKey(owner.key, drawing.key) && owner.sha256 === existing.sha256;
}

/** Whether two records, or the lack of one, say the same. */
function sameRecord(a: ArtifactRecord | null, b: ArtifactRecord | null): boolean {
  return a === null || b === null ? a === b : a.output === b.output && a.sha256 === b.sha256 && sameKey(a.key, b.key);
}

/** Looks at the file a drawing goes to: what is done with it, or why nothing can be. */
async function check(deps: ExporterDeps, drawing: Drawing): Promise<Checked | ExportResult> {
  try {
    if (deps.isDirty(drawing.path)) {
      return { name: drawing.name, path: null, error: deps.dirtyMessage, cause: 'file' };
    }
    const bytes = await deps.readExisting(drawing.path);
    const owner = deps.ownerOf(drawing.path);
    if (bytes === null) {
      return { drawing, existing: null, owner, action: 'write', byEarlierVersion: false };
    }
    const existing = digestOf(bytes);
    const looked = { drawing, existing, owner, byEarlierVersion: false };
    if (sameDigest(existing, drawing.content)) {
      return { ...looked, action: 'unchanged' };
    }
    if (isOwn(drawing, owner, existing)) {
      return { ...looked, action: 'write' };
    }
    // A file recorded as another diagram's export is that diagram's,
    // whatever an earlier version recorded.
    return { ...looked, action: 'ask', byEarlierVersion: owner === null && deps.wroteBefore(drawing.path, drawing.document, bytes) };
  } catch (error: unknown) {
    return { name: drawing.name, path: null, error: messageOf(error), cause: 'file' };
  }
}

/**
 * What became of a drawing given its turn: written, and the record of it if
 * it has a name of its own; or why not, and what that is about — the file,
 * or what the drawing was drawn from.
 */
type Committed =
  | { written: true; recorded: RecordResult | null }
  | { written: false; error: string; cause: 'file' | 'inputs' };

/**
 * Writes a drawing once no other export in this window is writing its
 * file, if the file is as it was looked at: the same bytes, the same
 * record, no unsaved changes. A file that changed since, while a question
 * was open say, is no longer the one the answer was about, and is left as
 * it is. A file removed since is written as a new one. A drawing whose
 * diagram, included files or include settings changed since it was drawn
 * is not written either: it is an image of what is there no longer. A
 * drawing held in a file of its own until now is written only if that file
 * still holds it.
 */
function commit(deps: ExporterDeps, buffer: OutputBuffer, { drawing, existing, owner }: Checked): Promise<Committed> {
  return deps.lock(drawing.path, async (): Promise<Committed> => {
    if (deps.isDirty(drawing.path)) {
      return { written: false, error: deps.dirtyMessage, cause: 'file' };
    }
    const now = await deps.readExisting(drawing.path);
    const changed = existing === null ? now !== null : now !== null && !sameDigest(digestOf(now), existing);
    if (changed || !sameRecord(deps.ownerOf(drawing.path), owner)) {
      return { written: false, error: deps.changedMessage, cause: 'file' };
    }
    const stale = await deps.staleInputs(drawing);
    if (stale !== null) {
      return { written: false, error: stale, cause: 'inputs' };
    }
    const content = await buffer.read(drawing.content);
    if (content === null) {
      return { written: false, error: deps.spoolChangedMessage, cause: 'file' };
    }
    await deps.writeFile(drawing.path, content, now !== null);
    const recorded = drawing.key === null ? null : await deps.record(drawing.key, drawing.path, bytesOf(content), drawing.input);
    return { written: true, recorded };
  });
}

/**
 * Records what a drawing was drawn from when the diagram's own export
 * holds it already: the file is the export of those inputs too. Nothing is
 * written to the file. Left as it is when the file or its record changed
 * since they were looked at, or what the drawing was drawn from has; a
 * record the state does not take leaves the one before, and `deps.record`
 * says why.
 */
function refresh(deps: ExporterDeps, { drawing, existing, owner }: Checked): Promise<void> {
  const { key, input } = drawing;
  if (
    key === null ||
    input === undefined ||
    existing === null ||
    !isOwn(drawing, owner, existing) ||
    canonicalJson(owner?.input ?? null) === canonicalJson(input)
  ) {
    return Promise.resolve();
  }
  return deps.lock(drawing.path, async () => {
    const now = await deps.readExisting(drawing.path);
    if (
      now !== null &&
      sameDigest(digestOf(now), existing) &&
      sameRecord(deps.ownerOf(drawing.path), owner) &&
      (await deps.staleInputs(drawing)) === null
    ) {
      await deps.record(key, drawing.path, now, input);
    }
  });
}

/**
 * Writes the drawings. A file that already holds its drawing is left
 * alone, since writing it again would change nothing, and is not taken
 * for the export of the diagram either; when it is the diagram's own
 * export already, its record takes what it was drawn from this time. A
 * file the diagram's own export is recorded in, unchanged since, is
 * replaced without asking. Before replacing any other — a file someone put
 * there by hand, or changed, or one exported for another diagram — the
 * export asks once for all of them. A file open with unsaved changes is not
 * written at all, nor is a drawing whose diagram or included files changed
 * once it was drawn. Writing stops part way once `stop` says so, or once what
 * was written cannot be recorded. Each drawing is let go of from `buffer`
 * once its turn is over. Null when the replacement is declined outright.
 */
async function writeDrawings(
  deps: ExporterDeps,
  buffer: OutputBuffer,
  drawings: readonly Drawing[],
  stop?: () => boolean
): Promise<Omit<ExportOutcome, 'unnamed'> | null> {
  const failed: ExportResult[] = [];
  const checked: Checked[] = [];
  for (const drawing of drawings) {
    const looked = await check(deps, drawing);
    if ('action' in looked) {
      checked.push(looked);
    } else {
      failed.push(looked);
      await buffer.release(drawing.content);
    }
  }

  const asking = checked.filter((entry) => entry.action === 'ask');
  let replace = false;
  if (asking.length > 0) {
    const answer = await deps.confirmReplace(
      asking.map(({ drawing, byEarlierVersion }) => ({ path: drawing.path, byEarlierVersion, recorded: drawing.key !== null })),
      drawings.length > 1
    );
    if (answer === undefined) {
      return null;
    }
    replace = answer === 'replace';
  }

  const outcome: Omit<ExportOutcome, 'unnamed'> = { written: [], unchanged: [], untracked: [], failed, kept: 0, stopped: 0 };
  let halted = false;
  for (const entry of checked) {
    const { drawing } = entry;
    const result: ExportResult = {
      name: drawing.name,
      path: drawing.path,
      error: null,
      ...(drawing.notes !== undefined && drawing.notes.length > 0 ? { notes: drawing.notes } : {}),
    };
    if (entry.action === 'unchanged') {
      try {
        if (!halted && stop?.() !== true) {
          await refresh(deps, entry);
        }
        outcome.unchanged.push({ ...result, unchanged: true });
      } catch (error: unknown) {
        failed.push({ name: drawing.name, path: null, error: messageOf(error), cause: 'file' });
      }
    } else if (entry.action === 'ask' && !replace) {
      outcome.kept += 1;
    } else if (halted || stop?.() === true) {
      outcome.stopped += 1;
    } else {
      try {
        const committed = await commit(deps, buffer, entry);
        if (!committed.written) {
          failed.push({ name: drawing.name, path: null, error: committed.error, cause: committed.cause });
        } else if (committed.recorded === null || committed.recorded === 'recorded') {
          outcome.written.push(result);
        } else {
          outcome.untracked.push({ ...result, untracked: committed.recorded });
          // A state that did not take this record will not take the next.
          halted = committed.recorded === 'not-saved';
        }
      } catch (error: unknown) {
        failed.push({ name: drawing.name, path: null, error: messageOf(error), cause: 'file' });
      }
    }
    await buffer.release(drawing.content);
  }
  return outcome;
}

/**
 * Exports a single block under an explicit name, as an SVG or a PNG.
 * `blocks`, the diagrams of the document, are looked through for another
 * headed for the same file: the export fails then, as Export All fails
 * both. Null when replacing the file already there is declined.
 */
export async function exportOne(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string,
  format: ExportFormat = 'svg',
  blocks: readonly PlantUmlBlock[] = []
): Promise<ExportResult | null> {
  const planned = planDiagram(deps, documentPath, directory, block, name, format);
  if (!('block' in planned)) {
    return planned;
  }
  const file = planned.path.toLowerCase();
  const shared = blocks.some(
    (other) =>
      other.openLine !== block.openLine &&
      other.name !== null &&
      isValidBlockName(other.name) &&
      deps.resolve(documentPath, `${directory}/${other.name}.${format}`).toLowerCase() === file
  );
  if (shared) {
    return { name, path: null, error: deps.sameFileMessage, cause: 'source' };
  }
  const buffer = new OutputBuffer(deps);
  try {
    const drawing = await drawBlock(deps, buffer, documentPath, planned, format);
    if (!('content' in drawing)) {
      return drawing;
    }
    const outcome = await writeDrawings(deps, buffer, [drawing]);
    if (outcome === null || outcome.kept > 0) {
      return null;
    }
    return outcome.written[0] ?? outcome.unchanged[0] ?? outcome.untracked[0] ?? outcome.failed[0] ?? null;
  } finally {
    await buffer.dispose();
  }
}

/** A document's named blocks, planned for export before anything is drawn. */
export interface PlannedDocument {
  document: string;
  format: ExportFormat;
  diagrams: readonly PlannedDiagram[];
  /** Diagrams refused before they are drawn. */
  failed: readonly ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
}

/**
 * Plans the export of every named block of a document, as `format`: its
 * ` ```plantuml ` blocks (findPlantUmlBlocks) or the diagrams of a PlantUML
 * file (findFileDiagrams).
 *
 * Unnamed blocks are counted rather than guessed at: a positional name
 * would move the moment a block is inserted above it, silently orphaning
 * whatever already referenced the old file. A name that cannot be a file
 * name is a failure, not a missing name.
 */
export function planDocument(
  deps: Pick<ExporterDeps, 'resolve' | 'invalidNameMessage'>,
  documentPath: string,
  directory: string,
  blocks: readonly PlantUmlBlock[],
  format: ExportFormat = 'svg'
): PlannedDocument {
  const diagrams: PlannedDiagram[] = [];
  const failed: ExportResult[] = [];
  let unnamed = 0;
  for (const block of blocks) {
    if (block.name === null) {
      unnamed += 1;
      continue;
    }
    const planned = planDiagram(deps, documentPath, directory, block, block.name, format);
    if ('block' in planned) {
      diagrams.push(planned);
    } else {
      failed.push(planned);
    }
  }
  return { document: documentPath, format, diagrams, failed, unnamed };
}

/**
 * Fails every diagram of `documents` headed for a file another one is
 * headed for too, before any is drawn: none of them is written, since
 * which one the file should hold is not for the export to choose. Files
 * are compared regardless of case, as Windows and macOS compare them.
 * What else the plans carry is kept.
 */
export function refuseSharedFiles<T extends PlannedDocument>(
  deps: Pick<ExporterDeps, 'sameFileMessage'>,
  documents: readonly T[]
): T[] {
  const headed = new Map<string, number>();
  for (const { path } of documents.flatMap((document) => document.diagrams)) {
    const file = path.toLowerCase();
    headed.set(file, (headed.get(file) ?? 0) + 1);
  }
  const shared = (diagram: PlannedDiagram): boolean => (headed.get(diagram.path.toLowerCase()) ?? 0) > 1;
  return documents.map((document) => ({
    ...document,
    diagrams: document.diagrams.filter((diagram) => !shared(diagram)),
    failed: [
      ...document.failed,
      ...document.diagrams
        .filter(shared)
        .map((diagram): ExportResult => ({ name: diagram.name, path: null, error: deps.sameFileMessage, cause: 'source' })),
    ],
  }));
}

/** A document's planned diagrams drawn as SVG or PNG, for {@link writeDocuments}. */
export interface DrawnDocument {
  drawings: readonly Drawing[];
  failed: readonly ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
}

/**
 * Draws what {@link planDocument} planned for a document, holding the
 * drawings in `buffer`, which the export lets go of once it ends.
 */
export async function drawDocument(
  deps: ExporterDeps,
  buffer: OutputBuffer,
  plan: PlannedDocument,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<DrawnDocument> {
  const drawings: Drawing[] = [];
  const failed: ExportResult[] = [...plan.failed];
  for (const [index, diagram] of plan.diagrams.entries()) {
    onProgress?.(index, plan.diagrams.length, diagram.name);
    const drawing = await drawBlock(deps, buffer, plan.document, diagram, plan.format);
    if ('content' in drawing) {
      drawings.push(drawing);
    } else {
      failed.push(drawing);
    }
  }
  return { drawings, failed, unnamed: plan.unnamed };
}

/**
 * Writes what {@link drawDocument} drew into `buffer`, of one document or
 * several, asking once before replacing files. `stop` is asked before each
 * file is written, and ends the export part way. Null when replacing the
 * files already there is declined, in which case nothing is written.
 */
export async function writeDocuments(
  deps: ExporterDeps,
  buffer: OutputBuffer,
  documents: readonly DrawnDocument[],
  stop?: () => boolean
): Promise<ExportOutcome | null> {
  const outcome = await writeDrawings(
    deps,
    buffer,
    documents.flatMap((document) => document.drawings),
    stop
  );
  if (outcome === null) {
    return null;
  }
  return {
    ...outcome,
    failed: [...documents.flatMap((document) => document.failed), ...outcome.failed],
    unnamed: documents.reduce((sum, document) => sum + document.unnamed, 0),
  };
}

/**
 * Exports every named block of a document as SVG (see {@link planDocument}).
 * Null when replacing the files already there is declined, in which case
 * nothing is written.
 */
export async function exportAll(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  blocks: readonly PlantUmlBlock[],
  onProgress?: (done: number, total: number, name: string) => void
): Promise<ExportOutcome | null> {
  const buffer = new OutputBuffer(deps);
  try {
    const drawn: DrawnDocument[] = [];
    for (const plan of refuseSharedFiles(deps, [planDocument(deps, documentPath, directory, blocks)])) {
      drawn.push(await drawDocument(deps, buffer, plan, onProgress));
    }
    return await writeDocuments(deps, buffer, drawn);
  } finally {
    await buffer.dispose();
  }
}
