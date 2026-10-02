/**
 * Finds the diagram blocks (` ```plantuml `, ` ```puml `) in Markdown source.
 *
 * Export and the editor commands need to know where the diagrams are and
 * what to call the files. The document is parsed with markdown-it 14, the
 * parser and options of VS Code's Markdown preview, so they find exactly
 * the blocks the preview draws: fences in block quotes and list items too,
 * and nothing inside an HTML comment or another code block. A PlantUML
 * file holds its diagrams directly; {@link findFileDiagrams} finds those.
 *
 * This module deliberately has no dependency on the `vscode` module, so
 * the scan is unit-testable on plain strings.
 */

import MarkdownIt from 'markdown-it';

import { isDiagramFence } from '../core/constants';
import { END, START, forEachCodeLine } from '../core/shape';

/** A `plantuml` fenced block found in a document, or a diagram of a PlantUML file. */
export interface PlantUmlBlock {
  /**
   * The word after the language in the info string
   * (` ```plantuml orders-api `), or null when the block is unnamed.
   * Export uses it as the file name.
   */
  name: string | null;
  /** The block's contents, without the fence lines. */
  source: string;
  /**
   * Zero-based line of the document where `source` begins. Blank lines
   * right after the opening fence are trimmed from `source`, so this can
   * lie below `openLine + 1`; line `n` of `source` (counting from 1) is
   * document line `sourceLine + n - 1`.
   */
  sourceLine: number;
  /** Zero-based line of the opening fence. */
  openLine: number;
  /** Zero-based line of the closing fence, or of the last content line. */
  closeLine: number;
  /**
   * What starts a new line inside the block quotes and list items that hold
   * the block: `> ` for a quote, the item's indentation for a list. Empty for
   * a block at the top level of the document.
   */
  container: string;
  /** Whether the block ends with a closing fence, rather than running on. */
  closed: boolean;
}

/**
 * Names are used as file names, so the character set is deliberately
 * narrow: anything else — a slash, a dot, whitespace, a drive letter —
 * would either escape the export directory or produce a path that does
 * not round-trip through a Markdown link. The length is capped well
 * under the 255 characters file systems commonly allow in a file name:
 * the file is first written under a temporary name that adds to it.
 */
const VALID_NAME = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Windows device names. `nul.svg` opens the null device rather than a
 * file, so the export would report success and leave nothing behind; the
 * others are equally not files. Reserved with any extension, and
 * case-insensitively.
 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Whether `name` may be used as an exported diagram's file name. */
export function isValidBlockName(name: string): boolean {
  return VALID_NAME.test(name) && !RESERVED_NAMES.has(name.toLowerCase());
}

/** VS Code's Markdown preview parses with `html: true`. */
const parser = new MarkdownIt({ html: true });

/**
 * Blanks out front matter the way VS Code's preview recognises it
 * (markdown-language-features, yamlPreamble): a first line of only `---`,
 * up to the next unindented line of only `---`. The preview shows it apart
 * from the body, so nothing in it is a diagram. Blanking rather than
 * removing the lines keeps every line number.
 */
function withoutFrontMatter(lines: string[]): string[] {
  const end = frontMatterEnd(lines);
  return end < 0 ? lines : lines.map((line, index) => (index <= end ? '' : line));
}

/** The closing line of the front matter, or -1 when there is none. */
function frontMatterEnd(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== '---') {
    return -1;
  }
  return lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
}

/**
 * Whether `line` of a Markdown document lies outside its front matter, code
 * blocks and HTML blocks: in the text the preview shows, where a new
 * diagram block can start.
 */
export function isProseLine(text: string, line: number): boolean {
  const lines = text.split(/\r\n|\r|\n/);
  if (line <= frontMatterEnd(lines)) {
    return false;
  }
  return !parser
    .parse(withoutFrontMatter(lines).join('\n'), {})
    .some(
      (token) =>
        (token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') &&
        token.map !== null &&
        line >= token.map[0] &&
        line < token.map[1]
    );
}

/**
 * The start of a new line inside the containers that hold a fence, from
 * what precedes the fence on its own line: quote markers stay, list markers
 * become the spaces they occupy.
 */
function containerOf(before: string): string {
  return before.replace(/(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/g, (marker) => ' '.repeat(marker.length));
}

/** Whether `line` closes a fence opened with `markup`, inside any container. */
function closesFence(line: string | undefined, markup: string): boolean {
  const run = /^(`{3,}|~{3,})[ \t]*$/.exec((line ?? '').replace(/^[ \t>]*/, ''))?.[1];
  return run !== undefined && run[0] === markup[0] && run.length >= markup.length;
}

/**
 * Returns every diagram block in `text`, in document order.
 *
 * Blocks in other languages are skipped — a ` ```markdown ` block
 * containing a ` ```plantuml ` example is not a diagram — and so is a
 * fence inside an HTML comment, as in the preview.
 */
export function findPlantUmlBlocks(text: string): PlantUmlBlock[] {
  const lines = withoutFrontMatter(text.split(/\r\n|\r|\n/));
  const blocks: PlantUmlBlock[] = [];

  for (const token of parser.parse(lines.join('\n'), {})) {
    if (token.type !== 'fence' || token.map === null || !isDiagramFence(token.info)) {
      continue;
    }
    const [openLine, end] = token.map;
    const opening = lines[openLine] ?? '';
    const name = token.info.trim().split(/\s+/)[1];
    const leadingBlank = token.content.split('\n').findIndex((line) => line.trim() !== '');
    blocks.push({
      name: name !== undefined && name !== '' ? name : null,
      source: token.content.trim(),
      sourceLine: openLine + 1 + Math.max(leadingBlank, 0),
      openLine,
      closeLine: end - 1,
      container: token.level === 0 ? '' : containerOf(opening.slice(0, Math.max(opening.indexOf(token.markup), 0))),
      closed: end - 1 > openLine && closesFence(lines[end - 1], token.markup),
    });
  }

  return blocks;
}

/** The block containing `line`, or null when the cursor is outside one. */
export function blockAtLine(blocks: readonly PlantUmlBlock[], line: number): PlantUmlBlock | null {
  return blocks.find((block) => line >= block.openLine && line <= block.closeLine) ?? null;
}

/** The `(id=…)` right after `@start…`: the name a diagram declares for itself. */
export const DECLARED_ID = /^\s*[@\\]start[A-Za-z0-9_]+\(id=([^)]*)\)/;

/**
 * Returns the diagrams of a PlantUML file, in order, each from its
 * `@start…` line (`openLine`) to its `@end…` line (`closeLine`); the engine
 * reads nothing between diagrams. A diagram is named by the `(id=…)` right
 * after `@start…`, or, as the only diagram of the file, by `fileName`. A
 * file with no `@start…` line is one diagram.
 */
export function findFileDiagrams(text: string, fileName: string): PlantUmlBlock[] {
  const lines = text.split(/\r?\n/);
  const found: { start: number; end: number; closed: boolean; id: string | null }[] = [];
  let open: (typeof found)[number] | null = null;
  let code = false;

  forEachCodeLine(text, (line, index) => {
    code ||= line.trim() !== '';
    if (START.test(line)) {
      // A second start before an end: the first diagram runs up to it.
      if (open !== null) {
        open.end = index - 1;
      }
      const id = DECLARED_ID.exec(line)?.[1] ?? null;
      open = { start: index, end: lines.length - 1, closed: false, id };
      found.push(open);
    } else if (open !== null && END.test(line)) {
      open.end = index;
      open.closed = true;
      open = null;
    }
  });
  if (found.length === 0 && code) {
    found.push({ start: 0, end: lines.length - 1, closed: false, id: null });
  }

  return found.map((diagram) => ({
    name: diagram.id ?? (found.length === 1 ? fileName : null),
    source: lines.slice(diagram.start, diagram.end + 1).join('\n'),
    sourceLine: diagram.start,
    openLine: diagram.start,
    closeLine: diagram.end,
    container: '',
    closed: diagram.closed,
  }));
}
