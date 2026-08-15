import { EXPORT_FRAGMENT } from '../core/constants';
import { findPlantUmlBlocks } from './blocks';

/**
 * Plans the image-reference lines that follow exported diagrams.
 *
 * Exporting produces the SVG file; this produces the line that lets other
 * hosts see it — `![name](images/name.svg#plantuml-local)` after the
 * block. The fragment marks the line as this extension's (see
 * {@link EXPORT_FRAGMENT}), and only marked lines are ever rewritten:
 * everything a person wrote by hand is out of bounds by construction.
 *
 * A block and its reference are paired by position — the first non-blank
 * line after the closing fence — not by searching the document for a
 * matching name. Position survives the edits that break the
 * alternatives: renaming the block updates the line in place, and a
 * reference left behind by a deleted block is simply no longer in any
 * block's slot, so it is left alone rather than guessed about.
 *
 * Like the fence scanner this module sees only text, keeping the whole
 * plan unit-testable; the extension applies the returned edits through a
 * WorkspaceEdit so one Undo reverts the lot.
 */

/** One text edit, in the coordinates of the text that was planned from. */
export type ReferenceEdit =
  | {
      kind: 'insert-after';
      /** Zero-based line at whose end `text` is inserted. */
      line: number;
      /** Starts with a newline; inserting at the line end keeps EOF safe. */
      text: string;
    }
  | {
      kind: 'replace-line';
      /** Zero-based line whose full content becomes `text`. */
      line: number;
      text: string;
    };

/**
 * A whole line that is exactly one image reference: optional indent,
 * `![alt](target)`, nothing else. Group 1/2 capture the target with and
 * without CommonMark's angle-bracket form.
 */
const IMAGE_LINE = /^\s*!\[[^\]]*\]\(\s*(?:<([^<>]*)>|([^)\s]+))\s*\)\s*$/;

/** The reference target for `name` under `directory`, POSIX separators. */
function targetPath(directory: string, name: string): string {
  const trimmed = directory.replace(/\/+$/, '');
  return trimmed === '' || trimmed === '.' ? `${name}.svg` : `${trimmed}/${name}.svg`;
}

/** The managed line for `name`: marked, and bracketed when the path needs it. */
function managedLine(directory: string, name: string): string {
  const target = `${targetPath(directory, name)}${EXPORT_FRAGMENT}`;
  // CommonMark cannot parse a bare destination containing spaces or
  // parentheses; the angle-bracket form carries them.
  const wrapped = /[ ()]/.test(target) ? `<${target}>` : target;
  return `![${name}](${wrapped})`;
}

/** The image target of a full-line reference, or null. */
function imageTarget(line: string): string | null {
  const match = IMAGE_LINE.exec(line);
  if (match === null) {
    return null;
  }
  return match[1] ?? match[2] ?? null;
}

/**
 * Plans the edits that bring `text`'s references in line with what was
 * just exported.
 *
 * Only blocks whose name is in `exportedNames` get a reference — a block
 * that failed to export must not gain a link to a file that is stale or
 * absent. Running the plan on its own output yields no edits, which is
 * the property the command's contract rests on.
 */
export function planReferenceEdits(
  text: string,
  exportedNames: ReadonlySet<string>,
  directory: string
): ReferenceEdit[] {
  const lines = text.split(/\r\n|\r|\n/);
  const edits: ReferenceEdit[] = [];

  for (const block of findPlantUmlBlocks(text)) {
    if (block.name === null || !exportedNames.has(block.name)) {
      continue;
    }
    const wanted = managedLine(directory, block.name);

    // The block's slot: the first non-blank line after the closing fence.
    let slot = block.closeLine + 1;
    while (slot < lines.length && (lines[slot] ?? '').trim() === '') {
      slot++;
    }
    const occupant = slot < lines.length ? (lines[slot] ?? '') : null;
    const target = occupant === null ? null : imageTarget(occupant);

    if (target !== null && target.endsWith(EXPORT_FRAGMENT)) {
      // Ours. Rewrite only if the name or directory moved under it.
      if (occupant !== wanted) {
        edits.push({ kind: 'replace-line', line: slot, text: wanted });
      }
      continue;
    }

    if (target !== null && target === targetPath(directory, block.name)) {
      // A hand-written reference to the very file this block exports to.
      // It renders the same image; adding a managed line above it would
      // show the diagram twice everywhere but the preview.
      continue;
    }

    // Empty slot (or occupied by unrelated content): insert after the
    // fence, keeping one blank line on each side that needs one.
    const next = lines[block.closeLine + 1];
    const separator = next !== undefined && next.trim() !== '' ? '\n' : '';
    edits.push({
      kind: 'insert-after',
      line: block.closeLine,
      text: `\n\n${wanted}${separator}`,
    });
  }

  return edits;
}
