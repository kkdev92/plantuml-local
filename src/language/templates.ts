/**
 * Where Insert Diagram Template puts a template: a whole ` ```plantuml `
 * block in the text of a Markdown document, the bare diagram in an empty
 * block, or the diagram between the diagrams of a PlantUML file. Never in
 * a diagram, in a block of another language or in a comment. A template
 * goes on lines of its own: the cursor's line when it holds nothing, else
 * the line after it, with an empty line between it and what is around.
 *
 * Like the completion, this has no dependency on the `vscode` module.
 * Lines are counted from 0.
 */

import { findPlantUmlBlocks, isProseLine } from '../export/blocks';
import { lineContext } from './completion';

/** A snippet to insert at `line` and `character`. */
export interface TemplateEdit {
  line: number;
  character: number;
  text: string;
}

/**
 * Where the template goes: there (`insert`), after the block the cursor is
 * in, which holds a diagram, once that is agreed (`after`), or nowhere,
 * because the cursor is in a diagram or where none can start.
 */
export type TemplatePlace =
  | ({ kind: 'insert' | 'after' } & TemplateEdit)
  | { kind: 'refused'; reason: 'diagram' | 'elsewhere' };

/** A line with nothing on it but quote markers and spaces. */
const isEmpty = (line: string | undefined): boolean => (line ?? '').replace(/^[\s>]*/, '') === '';

/**
 * `body`, whole lines, put before line `at`: after the last line when `at`
 * is past it.
 */
function linesAt(lines: readonly string[], at: number, body: string): TemplateEdit {
  if (at < lines.length) {
    return { line: at, character: 0, text: `${body}\n` };
  }
  const last = lines.length - 1;
  return { line: last, character: (lines[last] ?? '').length, text: `\n${body}` };
}

/** `lines` of a template, each started with `lead`. */
function lead(template: string, prefix: string): string {
  return template
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/**
 * `body` with a line `blank` before it and after it where the lines around
 * line `at` hold something, so that it stands apart from them.
 */
function apart(lines: readonly string[], at: number, body: string, blank: string): string {
  const before = at > 0 && !isEmpty(lines[at - 1]) ? `${blank}\n` : '';
  const after = at < lines.length && !isEmpty(lines[at]) ? `\n${blank}` : '';
  return before + body + after;
}

/**
 * Where to insert the template `diagram` of `kind` for a cursor on `line`
 * of `text`, a PlantUML file or a Markdown document.
 */
export function templatePlace(
  text: string,
  line: number,
  plantUml: boolean,
  kind: string,
  diagram: string
): TemplatePlace {
  const lines = text.split(/\r\n|\r|\n/);
  const at = isEmpty(lines[line]) ? line : line + 1;

  if (plantUml) {
    const where = lineContext(text, line);
    if (where === null) {
      return { kind: 'refused', reason: 'elsewhere' };
    }
    if (where.open !== null) {
      return { kind: 'refused', reason: 'diagram' };
    }
    return { kind: 'insert', ...linesAt(lines, at, apart(lines, at, diagram, '')) };
  }

  const fenced = `\`\`\`plantuml \${1:${kind}-diagram}\n${diagram}\n\`\`\``;
  const block = findPlantUmlBlocks(text).find((candidate) => line >= candidate.openLine && line <= candidate.closeLine);
  if (block === undefined) {
    if (!isProseLine(text, line)) {
      return { kind: 'refused', reason: 'elsewhere' };
    }
    // In a quote, the template stays in it.
    const prefix = /^[\s>]*/.exec(lines[line] ?? '')?.[0] ?? '';
    return { kind: 'insert', ...linesAt(lines, at, apart(lines, at, lead(fenced, prefix), prefix.trimEnd())) };
  }
  if (block.source === '') {
    // An empty block gets the diagram alone, inside it.
    return { kind: 'insert', ...linesAt(lines, block.closed ? block.closeLine : block.closeLine + 1, lead(diagram, block.container)) };
  }
  if (!block.closed) {
    return { kind: 'refused', reason: 'diagram' };
  }
  const after = block.closeLine + 1;
  return {
    kind: 'after',
    ...linesAt(lines, after, apart(lines, after, lead(fenced, block.container), block.container.trimEnd())),
  };
}
