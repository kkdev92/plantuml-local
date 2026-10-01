/**
 * Finds the diagram blocks (` ```plantuml `, ` ```puml `) in Markdown source.
 *
 * Export and the editor commands need to know where the diagrams are and
 * what to call the files. The document is parsed with markdown-it 14, the
 * parser and options of VS Code's Markdown preview, so they find exactly
 * the blocks the preview draws: fences in block quotes and list items too,
 * and nothing inside an HTML comment or another code block.
 *
 * This module deliberately has no dependency on the `vscode` module, so
 * the scan is unit-testable on plain strings.
 */

import MarkdownIt from 'markdown-it';

import { isDiagramFence } from '../core/constants';

/** A `plantuml` fenced block found in a document. */
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
   * What precedes the opening fence on its line: indentation, and the
   * markers of a block quote or a list item (`> `, `- `) when the block is
   * inside one.
   */
  prefix: string;
}

/**
 * Names are used as file names, so the character set is deliberately
 * narrow: anything else — a slash, a dot, whitespace, a drive letter —
 * would either escape the export directory or produce a path that does
 * not round-trip through a Markdown link.
 */
const VALID_NAME = /^[A-Za-z0-9_-]+$/;

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
  if (lines[0]?.trimEnd() !== '---') {
    return lines;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (end < 0) {
    return lines;
  }
  return lines.map((line, index) => (index <= end ? '' : line));
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
      prefix: opening.slice(0, Math.max(opening.indexOf(token.markup), 0)),
    });
  }

  return blocks;
}

/** The block containing `line`, or null when the cursor is outside one. */
export function blockAtLine(blocks: readonly PlantUmlBlock[], line: number): PlantUmlBlock | null {
  return blocks.find((block) => line >= block.openLine && line <= block.closeLine) ?? null;
}
