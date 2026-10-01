import { DIAGRAM_BACKDROP, EMOJI_UNAVAILABLE, hasRemoteReference } from '../core/constants';
import { diagramShape } from '../core/shape';
import { recognizeEngineError } from '../render/engine-error';
import { isValidBlockName, type PlantUmlBlock } from './blocks';

/**
 * Renders diagrams to SVG files next to the document.
 *
 * The preview keeps its SVG in memory, which is enough to look at and no
 * use to anyone else: GitHub renders a ` ```plantuml ` block as source,
 * not as a diagram. Exporting writes the same sanitised SVG the preview
 * receives to a file, so the document can reference it and be readable
 * outside VS Code.
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
   * The text of the file at `path`, or null when there is none. Rejects
   * for a folder, which a diagram is never written in place of.
   */
  readExisting(path: string): Promise<string | null>;
  /**
   * Asks before replacing files that hold something other than their
   * diagram: 'replace' them, 'keep' them and write only the rest, or
   * undefined to write nothing. `canKeep` says whether there is a rest:
   * more than one diagram is being exported.
   */
  confirmReplace(
    paths: readonly string[],
    canKeep: boolean
  ): Promise<'replace' | 'keep' | undefined>;
  /**
   * Writes `content` to `path`, creating parent directories. Unless
   * `replace` is set, a file that has appeared there since the check is
   * an error rather than something to write over.
   */
  writeFile(path: string, content: string, replace: boolean): Promise<void>;
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
}

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

/** A diagram rendered and ready to write. */
interface Drawing {
  name: string;
  path: string;
  svg: string;
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
  name: string
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

    return {
      name,
      path: deps.resolve(documentPath, `${directory}/${name}.svg`),
      svg: addBackground(rendered, dark),
    };
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
 * something else: it may be a file someone put there by hand. A file that
 * already holds its drawing is left alone, since writing it again would
 * change nothing. Null when the replacement is declined outright.
 */
async function writeDrawings(
  deps: ExporterDeps,
  drawings: readonly Drawing[]
): Promise<Pick<ExportOutcome, 'written' | 'failed' | 'kept'> | null> {
  const failed: ExportResult[] = [];
  const checked: { drawing: Drawing; existing: string | null }[] = [];
  for (const drawing of drawings) {
    try {
      checked.push({ drawing, existing: await deps.readExisting(drawing.path) });
    } catch (error: unknown) {
      failed.push({ name: drawing.name, path: null, error: messageOf(error) });
    }
  }

  const replacing = checked.filter(
    ({ drawing, existing }) => existing !== null && existing !== drawing.svg
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
  for (const { drawing, existing } of checked) {
    const result = { name: drawing.name, path: drawing.path, error: null };
    if (existing === drawing.svg) {
      written.push(result);
    } else if (existing !== null && !replace) {
      kept += 1;
    } else {
      try {
        await deps.writeFile(drawing.path, drawing.svg, existing !== null);
        written.push(result);
      } catch (error: unknown) {
        failed.push({ name: drawing.name, path: null, error: messageOf(error) });
      }
    }
  }
  return { written, failed, kept };
}

/**
 * Exports a single block under an explicit name. Null when replacing the
 * file already there is declined.
 */
export async function exportOne(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string
): Promise<ExportResult | null> {
  const drawing = await drawBlock(deps, documentPath, directory, block, name);
  if (!('svg' in drawing)) {
    return drawing;
  }
  const outcome = await writeDrawings(deps, [drawing]);
  if (outcome === null || outcome.kept > 0) {
    return null;
  }
  return outcome.written[0] ?? outcome.failed[0] ?? null;
}

/**
 * Exports every named block of a document: its ` ```plantuml ` blocks
 * (findPlantUmlBlocks) or the diagrams of a PlantUML file
 * (findFileDiagrams). Null when replacing the files already there is
 * declined, in which case nothing is written.
 *
 * Unnamed blocks are counted rather than guessed at: a positional name
 * would move the moment a block is inserted above it, silently orphaning
 * whatever already referenced the old file. A name that cannot be a file
 * name is a failure, not a missing name.
 */
export async function exportAll(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  blocks: readonly PlantUmlBlock[],
  onProgress?: (done: number, total: number, name: string) => void
): Promise<ExportOutcome | null> {
  const named = blocks.filter(
    (block): block is PlantUmlBlock & { name: string } => block.name !== null
  );

  const drawings: Drawing[] = [];
  const failed: ExportResult[] = [];
  for (const [index, block] of named.entries()) {
    onProgress?.(index, named.length, block.name);
    const drawing = await drawBlock(deps, documentPath, directory, block, block.name);
    if ('svg' in drawing) {
      drawings.push(drawing);
    } else {
      failed.push(drawing);
    }
  }

  const outcome = await writeDrawings(deps, drawings);
  if (outcome === null) {
    return null;
  }
  return {
    written: outcome.written,
    failed: [...failed, ...outcome.failed],
    unnamed: blocks.length - named.length,
    kept: outcome.kept,
  };
}
