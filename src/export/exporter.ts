import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { diagramShape } from '../core/shape';
import { recognizeEngineError } from '../render/engine-error';
import { isValidBlockName, type PlantUmlBlock } from './blocks';

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

export interface ExporterDeps {
  /** Renders PlantUML source to sanitised SVG (the worker round-trip). */
  render(source: string, dark: boolean): Promise<string>;
  /** Whether diagrams should currently render in dark colours. */
  isDark(): boolean;
  /**
   * The palette to draw `source` in when `dark` is asked for: the other one
   * for a diagram whose `!theme` cannot be read in it (src/render/palette.ts).
   */
  resolvePalette(source: string, dark: boolean): Promise<boolean>;
  /**
   * The bytes of the file at `path`, or null when there is none. Rejects
   * for a folder, which a diagram is never written in place of.
   */
  readExisting(path: string): Promise<Uint8Array | null>;
  /**
   * Whether `existing`, the file at `path`, is what an export from
   * `document` last wrote there, unchanged since (src/export/ownership.ts).
   * Such a file is replaced without asking.
   */
  wroteLast(path: string, document: string, existing: Uint8Array): boolean;
  /**
   * Records that the file at `path` holds `content`, exported from
   * `document`. Never rejects: a record that is not kept only means the
   * next export asks.
   */
  noteWritten(path: string, document: string, content: Uint8Array): Promise<void>;
  /**
   * Asks before replacing files that hold something other than their
   * diagram, and that the export did not write: 'replace' them, 'keep'
   * them and write only the rest, or undefined to write nothing. `canKeep`
   * says whether there is a rest: more than one diagram is being exported.
   */
  confirmReplace(
    paths: readonly string[],
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
  /**
   * Localised reason given for a diagram the engine drew as an error:
   * `message` is the engine's own text, `line` the document line it
   * blames (counting from 1), or null when it names none.
   */
  engineErrorMessage(message: string, line: number | null): string;
  /**
   * Localised reason given for a PNG past the size one can have: its
   * size, and the largest scale it fits at, or null when none does.
   */
  pngTooLargeMessage(width: number, height: number, fits: number | null): string;
  /** Localised reason given for a PNG that could not be made as asked. */
  pngFailedMessage: string;
  /** Localised reason given for a diagram headed for the file another one is written to. */
  sameFileMessage: string;
  /** Localised reason given for a file that changed after the export looked at it. */
  changedMessage: string;
}

/** The largest PNG made: pixels a side and in all, and bytes. */
export const PNG_LIMITS = { side: 8192, pixels: 16_000_000, bytes: 64 * 1024 * 1024 } as const;

/** The scales a PNG can be drawn at. */
export const PNG_SCALES = [1, 2, 4] as const;

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
}

export interface ExportOutcome {
  written: ExportResult[];
  failed: ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
  /** Existing files left as they were, replacing them having been declined. */
  kept: number;
}

/** A diagram rendered and ready to write: the SVG's text, or a PNG. */
export interface Drawing {
  name: string;
  path: string;
  /** The document the diagram is exported from. */
  document: string;
  content: string | Uint8Array;
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

/** Whether a file holds `content` already. */
function holds(existing: Uint8Array, content: string | Uint8Array): boolean {
  const bytes = bytesOf(content);
  return existing.byteLength === bytes.byteLength && existing.every((byte, index) => byte === bytes[index]);
}

/**
 * Rejects a directory that would escape the document's own folder.
 *
 * The value comes from settings, so it is not hostile input so much as
 * mistyped input — but `../../..` or an absolute path would scatter files
 * outside the workspace, and a Markdown link could not reference them.
 */
export function isValidExportDirectory(directory: string): boolean {
  if (directory === '') {
    return false;
  }
  if (/^([A-Za-z]:|\\\\|\/)/.test(directory)) {
    return false;
  }
  return !directory
    .split(/[/\\]/)
    .some((segment) => segment === '..');
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

/**
 * Renders one block, or says why it cannot be exported.
 *
 * Renders are serialised inside the worker, so calling this in a loop is
 * already sequential; there is nothing to gain from firing them at once.
 */
async function drawBlock(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string,
  format: ExportFormat
): Promise<Drawing | ExportResult> {
  // Names become file names, and they come from the document — so on a
  // repository someone else wrote, `x/../../..` would put a file wherever
  // the block asked. Checked here rather than only at the call sites so
  // that no future caller can route around it.
  if (!isValidBlockName(name)) {
    return { name, path: null, error: deps.invalidNameMessage };
  }

  // The preview refuses these before the engine sees them; export has to
  // refuse them too, or the same block that shows an explanation on screen
  // would write out the engine's "cannot include" error diagram instead.
  if (hasRemoteReference(block.source)) {
    return { name, path: null, error: deps.remoteReferenceMessage };
  }

  // The engine would draw only the first diagram or page; written out, that
  // part would stand in for the whole block. A missing end line is added,
  // as the preview does, since nothing is lost by it.
  const shape = diagramShape(block.source);
  if (shape.kind === 'several') {
    return { name, path: null, error: deps.severalDiagramsMessage };
  }
  if (shape.kind === 'pages') {
    return { name, path: null, error: deps.pagesMessage };
  }

  try {
    const dark = await deps.resolvePalette(shape.source, deps.isDark());
    const rendered = await deps.render(shape.source, dark);

    // The engine reports a syntax error, a failed include or an empty
    // diagram by drawing it, through the same success path as a diagram.
    // Written out, that drawing would stand in for the diagram — and the
    // reference updater would link it from the document.
    const failure = recognizeEngineError(rendered);
    if (failure !== null) {
      // sourceLine counts from 0 and the engine's line from 1, so the sum
      // is the document line counting from 1, as an editor shows it.
      const line = failure.line === null ? null : block.sourceLine + failure.line;
      return {
        name,
        path: null,
        error: deps.engineErrorMessage(failure.message, line),
        engineError: { message: failure.message, line },
      };
    }

    const svg = addBackground(rendered, dark);
    const path = deps.resolve(documentPath, `${directory}/${name}.${format}`);
    if (format === 'svg') {
      return { name, path, document: documentPath, content: svg };
    }

    // Drawn at the scale asked for, without the screen's own pixel ratio,
    // and refused rather than shrunk or cut when it would be too large.
    const size = svgSize(svg);
    if (size === null) {
      return { name, path: null, error: deps.pngFailedMessage };
    }
    const scale = deps.pngScale();
    const width = Math.ceil(size.width * scale);
    const height = Math.ceil(size.height * scale);
    if (!fitsPng(width, height)) {
      const fits = [...PNG_SCALES]
        .reverse()
        .find((smaller) => fitsPng(Math.ceil(size.width * smaller), Math.ceil(size.height * smaller)));
      return { name, path: null, error: deps.pngTooLargeMessage(width, height, fits ?? null) };
    }
    const backdrop = dark ? DIAGRAM_BACKDROP.dark : DIAGRAM_BACKDROP.light;
    const png = await deps.toPng(svg, width, height, backdrop);
    if (!isPngOfSize(png, width, height) || png.byteLength > PNG_LIMITS.bytes) {
      return { name, path: null, error: deps.pngFailedMessage };
    }
    return { name, path, document: documentPath, content: png };
  } catch (error: unknown) {
    const message = messageOf(error);
    return {
      name,
      path: null,
      error: EMOJI_UNAVAILABLE.test(message) ? deps.emojiUnavailableMessage : message,
    };
  }
}

/**
 * Writes the drawings, asking once before replacing any file that holds
 * something else: it may be a file someone put there by hand, or changed.
 * A file an export from the same document wrote, unchanged since, is the
 * export's own to replace. A file that already holds its drawing is left
 * alone, since writing it again would change nothing. A file that changed
 * after it was looked at, while the question was open say, is no longer
 * the one the answer was about, and is left as it is. Null when the
 * replacement is declined outright.
 */
async function writeDrawings(
  deps: ExporterDeps,
  drawings: readonly Drawing[]
): Promise<Pick<ExportOutcome, 'written' | 'failed' | 'kept'> | null> {
  const failed: ExportResult[] = [];
  const checked: { drawing: Drawing; existing: Uint8Array | null; own: boolean }[] = [];
  for (const drawing of drawings) {
    try {
      const existing = await deps.readExisting(drawing.path);
      const own = existing !== null && deps.wroteLast(drawing.path, drawing.document, existing);
      checked.push({ drawing, existing, own });
    } catch (error: unknown) {
      failed.push({ name: drawing.name, path: null, error: messageOf(error) });
    }
  }

  const replacing = checked.filter(
    ({ drawing, existing, own }) => existing !== null && !own && !holds(existing, drawing.content)
  );
  let replace = false;
  if (replacing.length > 0) {
    const answer = await deps.confirmReplace(
      replacing.map(({ drawing }) => drawing.path),
      drawings.length > 1
    );
    if (answer === undefined) {
      return null;
    }
    replace = answer === 'replace';
  }

  const written: ExportResult[] = [];
  let kept = 0;
  for (const { drawing, existing, own } of checked) {
    const result = { name: drawing.name, path: drawing.path, error: null };
    if (existing !== null && holds(existing, drawing.content)) {
      await deps.noteWritten(drawing.path, drawing.document, bytesOf(drawing.content));
      written.push(result);
    } else if (existing !== null && !own && !replace) {
      kept += 1;
    } else {
      try {
        const now = existing === null ? null : await deps.readExisting(drawing.path);
        if (existing !== null && now !== null && !holds(now, existing)) {
          failed.push({ name: drawing.name, path: null, error: deps.changedMessage });
          continue;
        }
        await deps.writeFile(drawing.path, drawing.content, now !== null);
        await deps.noteWritten(drawing.path, drawing.document, bytesOf(drawing.content));
        written.push(result);
      } catch (error: unknown) {
        failed.push({ name: drawing.name, path: null, error: messageOf(error) });
      }
    }
  }
  return { written, failed, kept };
}

/**
 * Exports a single block under an explicit name, as an SVG or a PNG.
 * Null when replacing the file already there is declined.
 */
export async function exportOne(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string,
  format: ExportFormat = 'svg'
): Promise<ExportResult | null> {
  const drawing = await drawBlock(deps, documentPath, directory, block, name, format);
  if (!('content' in drawing)) {
    return drawing;
  }
  const outcome = await writeDrawings(deps, [drawing]);
  if (outcome === null || outcome.kept > 0) {
    return null;
  }
  return outcome.written[0] ?? outcome.failed[0] ?? null;
}

/** A document's named blocks drawn as SVG, for {@link writeDocuments}. */
export interface DrawnDocument {
  drawings: readonly Drawing[];
  failed: readonly ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
}

/**
 * Draws every named block of a document: its ` ```plantuml ` blocks
 * (findPlantUmlBlocks) or the diagrams of a PlantUML file
 * (findFileDiagrams).
 *
 * Unnamed blocks are counted rather than guessed at: a positional name
 * would move the moment a block is inserted above it, silently orphaning
 * whatever already referenced the old file. A name that cannot be a file
 * name is a failure, not a missing name.
 */
export async function drawDocument(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  blocks: readonly PlantUmlBlock[],
  onProgress?: (done: number, total: number, name: string) => void
): Promise<DrawnDocument> {
  const named = blocks.filter(
    (block): block is PlantUmlBlock & { name: string } => block.name !== null
  );

  const drawings: Drawing[] = [];
  const failed: ExportResult[] = [];
  for (const [index, block] of named.entries()) {
    onProgress?.(index, named.length, block.name);
    const drawing = await drawBlock(deps, documentPath, directory, block, block.name, 'svg');
    if ('content' in drawing) {
      drawings.push(drawing);
    } else {
      failed.push(drawing);
    }
  }
  return { drawings, failed, unnamed: blocks.length - named.length };
}

/**
 * Writes what {@link drawDocument} drew, of one document or several, asking
 * once before replacing files. A drawing headed for the same file as one
 * before it fails rather than overwrite it; files are compared regardless
 * of case, as Windows and macOS compare them. Null when replacing the
 * files already there is declined, in which case nothing is written.
 */
export async function writeDocuments(
  deps: ExporterDeps,
  documents: readonly DrawnDocument[]
): Promise<ExportOutcome | null> {
  const failed = documents.flatMap((document) => document.failed);
  const drawings: Drawing[] = [];
  const taken = new Set<string>();
  for (const drawing of documents.flatMap((document) => document.drawings)) {
    const file = drawing.path.toLowerCase();
    if (taken.has(file)) {
      failed.push({ name: drawing.name, path: null, error: deps.sameFileMessage });
    } else {
      taken.add(file);
      drawings.push(drawing);
    }
  }

  const outcome = await writeDrawings(deps, drawings);
  if (outcome === null) {
    return null;
  }
  return {
    written: outcome.written,
    failed: [...failed, ...outcome.failed],
    unnamed: documents.reduce((sum, document) => sum + document.unnamed, 0),
    kept: outcome.kept,
  };
}

/**
 * Exports every named block of a document as SVG (see {@link drawDocument}).
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
  return writeDocuments(deps, [await drawDocument(deps, documentPath, directory, blocks, onProgress)]);
}
