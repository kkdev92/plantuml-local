import { REMOTE_REFERENCE } from '../core/constants';
import { findPlantUmlBlocks, isValidBlockName, type PlantUmlBlock } from './blocks';

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
  /** Writes `content` to `path`, creating parent directories. */
  writeFile(path: string, content: string): Promise<void>;
  /** Joins a document path's directory with a relative path. */
  resolve(documentPath: string, relative: string): string;
  /** Localised reason given for a block carrying a URL-based include. */
  remoteReferenceMessage: string;
  /** Localised reason given for a block name unusable as a file name. */
  invalidNameMessage: string;
}

/** One diagram's outcome. */
export interface ExportResult {
  name: string;
  /** Absolute path written, or null when the diagram failed. */
  path: string | null;
  /** Failure reason, or null on success. */
  error: string | null;
}

export interface ExportOutcome {
  written: ExportResult[];
  failed: ExportResult[];
  /** Blocks skipped because they carry no name. */
  unnamed: number;
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

/** Matches the backdrops media/plantuml.css gives the preview. */
const BACKGROUND = { light: '#FFFFFF', dark: '#1b1b1b' } as const;

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
  const rect = `<rect ${size} fill="${dark ? BACKGROUND.dark : BACKGROUND.light}"/>`;
  return svg.slice(0, open[0].length) + rect + svg.slice(open[0].length);
}

/**
 * Renders one block and writes it.
 *
 * Renders are serialised inside the worker, so calling this in a loop is
 * already sequential; there is nothing to gain from firing them at once.
 */
async function exportBlock(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string
): Promise<ExportResult> {
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
  if (REMOTE_REFERENCE.test(block.source)) {
    return { name, path: null, error: deps.remoteReferenceMessage };
  }

  try {
    const dark = deps.isDark();
    const svg = addBackground(await deps.render(block.source, dark), dark);
    const path = deps.resolve(documentPath, `${directory}/${name}.svg`);
    await deps.writeFile(path, svg);
    return { name, path, error: null };
  } catch (error: unknown) {
    return {
      name,
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Exports a single block under an explicit name. */
export async function exportOne(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  block: PlantUmlBlock,
  name: string
): Promise<ExportResult> {
  return exportBlock(deps, documentPath, directory, block, name);
}

/**
 * Exports every named block in `text`.
 *
 * Unnamed blocks are counted rather than guessed at: a positional name
 * would move the moment a block is inserted above it, silently orphaning
 * whatever already referenced the old file.
 */
export async function exportAll(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  text: string,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<ExportOutcome> {
  const blocks = findPlantUmlBlocks(text);
  const named = blocks.filter(
    (block): block is PlantUmlBlock & { name: string } =>
      block.name !== null && isValidBlockName(block.name)
  );

  const written: ExportResult[] = [];
  const failed: ExportResult[] = [];

  for (const [index, block] of named.entries()) {
    onProgress?.(index, named.length, block.name);
    const result = await exportBlock(deps, documentPath, directory, block, block.name);
    (result.error === null ? written : failed).push(result);
  }

  return { written, failed, unnamed: blocks.length - named.length };
}
