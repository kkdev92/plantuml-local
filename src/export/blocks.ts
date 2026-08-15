/**
 * Finds ` ```plantuml ` blocks in Markdown source.
 *
 * Export needs to know where the diagrams are and what to call the files,
 * which the preview never had to: markdown-it hands the plugin one token
 * at a time, already parsed. Here there is only the document text, so the
 * fences are scanned directly.
 *
 * The scan follows CommonMark closely enough for real documents: a fence
 * is three or more backticks or tildes indented by at most three spaces,
 * it closes on a fence of the same character that is at least as long,
 * and an unclosed fence runs to the end of the file. Content lines are
 * de-indented by the opening fence's indent.
 *
 * This module deliberately has no dependency on the `vscode` module, so
 * the scan is unit-testable on plain strings.
 */

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
  /** Zero-based line of the opening fence. */
  openLine: number;
  /** Zero-based line of the closing fence, or of the last content line. */
  closeLine: number;
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

interface Fence {
  indent: number;
  marker: string;
  length: number;
  info: string;
}

/** Parses a line as a fence opener, or returns null. */
function openingFence(line: string): Fence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) {
    return null;
  }
  const [, indent = '', run = '', info = ''] = match;
  // A backtick fence's info string may not contain a backtick; that rule
  // is what stops `` `a``b` `` from being read as a fence.
  if (run.startsWith('`') && info.includes('`')) {
    return null;
  }
  return { indent: indent.length, marker: run[0] ?? '`', length: run.length, info: info.trim() };
}

/** Whether `line` closes a fence opened by `open`. */
function closesFence(line: string, open: Fence): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (match === null) {
    return false;
  }
  const [, , run = ''] = match;
  return run[0] === open.marker && run.length >= open.length;
}

/**
 * Returns every `plantuml` block in `text`, in document order.
 *
 * Blocks in other languages are skipped, but still consume their lines —
 * a ` ```markdown ` block containing a ` ```plantuml ` example must not
 * be mistaken for a diagram.
 */
export function findPlantUmlBlocks(text: string): PlantUmlBlock[] {
  const lines = text.split(/\r\n|\r|\n/);
  const blocks: PlantUmlBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const open = openingFence(lines[index] ?? '');
    if (open === null) {
      index++;
      continue;
    }

    const openLine = index;
    const content: string[] = [];
    let closeLine = lines.length - 1;

    index++;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (closesFence(line, open)) {
        closeLine = index;
        index++;
        break;
      }
      // Strip at most the opening fence's indent, never more.
      content.push(line.slice(0, open.indent).trim() === '' ? line.slice(open.indent) : line);
      index++;
      closeLine = index - 1;
    }

    const words = open.info.split(/\s+/);
    if (words[0] !== 'plantuml') {
      continue;
    }

    const name = words[1];
    blocks.push({
      name: name !== undefined && name !== '' ? name : null,
      source: content.join('\n').trim(),
      openLine,
      closeLine,
    });
  }

  return blocks;
}

/** The block containing `line`, or null when the cursor is outside one. */
export function blockAtLine(blocks: readonly PlantUmlBlock[], line: number): PlantUmlBlock | null {
  return blocks.find((block) => line >= block.openLine && line <= block.closeLine) ?? null;
}
