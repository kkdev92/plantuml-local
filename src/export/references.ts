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
 * line after the closing fence, inside the same block quote or list item
 * as the block — not by searching the document for a
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

/**
 * Reads lines as the block's container sees them: the rest of a line once
 * the container's quote markers are taken off, or null for a line outside
 * the quote. A list item has no markers to check, so every line is inside.
 */
function insideContainer(container: string): (line: string) => string | null {
  const depth = (container.match(/>/g) ?? []).length;
  return (line) => {
    let rest = line;
    for (let level = 0; level < depth; level++) {
      const marker = /^ {0,3}> ?/.exec(rest);
      if (marker === null) {
        return null;
      }
      rest = rest.slice(marker[0].length);
    }
    return rest;
  };
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
    // A fence that never closes runs to the end of its container: a line
    // written "after" it would be part of the code.
    if (block.name === null || !exportedNames.has(block.name) || !block.closed) {
      continue;
    }
    const wanted = managedLine(directory, block.name);
    const { container } = block;
    const inside = insideContainer(container);

    // The block's slot: the first non-blank line after the closing fence,
    // within the block's container.
    let slot = block.closeLine + 1;
    let occupant: string | null = null;
    for (; slot < lines.length; slot++) {
      const body = inside(lines[slot] ?? '');
      if (body === null) {
        break;
      }
      if (body.trim() !== '') {
        occupant = body;
        break;
      }
    }
    const target = occupant === null ? null : imageTarget(occupant);

    if (target !== null && target.endsWith(EXPORT_FRAGMENT)) {
      // Ours. Rewrite only if the name or directory moved under it, keeping
      // whatever the line starts with.
      const line = lines[slot] ?? '';
      const kept = `${line.slice(0, line.indexOf('!['))}${wanted}`;
      if (line !== kept) {
        edits.push({ kind: 'replace-line', line: slot, text: kept });
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
    // fence, keeping one blank line on each side that needs one. Inside a
    // block quote, the blank lines keep the quote's marker; a line right
    // after the quote gets a plain one, or it would join the reference's
    // paragraph inside the quote.
    const blank = container.trimEnd();
    const next = lines[block.closeLine + 1];
    const nextBody = next === undefined ? null : inside(next);
    const separator =
      next === undefined || next.trim() === '' || nextBody?.trim() === ''
        ? ''
        : nextBody === null
          ? '\n'
          : `\n${blank}`;
    edits.push({
      kind: 'insert-after',
      line: block.closeLine,
      text: `\n${blank}\n${container}${wanted}${separator}`,
    });
  }

  return edits;
}

/**
 * Where line `line` (counting from 1) of the planned-from text sits once
 * `edits` are applied. Each insertion pushes down the lines below it;
 * replacing a line moves nothing.
 */
export function lineAfterEdits(edits: readonly ReferenceEdit[], line: number): number {
  let moved = line;
  for (const edit of edits) {
    // An insertion lands after edit.line, which counts from 0, so the
    // line it follows and everything above stay put.
    if (edit.kind === 'insert-after' && edit.line < line - 1) {
      moved += edit.text.split('\n').length - 1;
    }
  }
  return moved;
}
