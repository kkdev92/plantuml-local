/**
 * Naming a diagram from the editor, for the export commands: the word after
 * the language of a ` ```plantuml ` block, or `(id=…)` after the start line
 * of a diagram in a PlantUML file. A diagram that has no such name, or one
 * that cannot be a file name, is offered one on the line it goes on. Every
 * kind of diagram takes an id: the engine reads the kind from the start of
 * the word after `@start` and ignores what follows it.
 *
 * Like the folding, this has no dependency on the `vscode` module. Lines
 * are counted from 0.
 */

import { splitLines } from '../core/lines';
import { diagramShape } from '../core/shape';
import { findFileDiagrams, findPlantUmlBlocks, isValidBlockName } from '../export/blocks';

/** A block's opening fence, up to its language, and the word after it. */
const FENCE = /^(.*?(?:`{3,}|~{3,})[ \t]*(?:plantuml|puml))(?=[ \t]|$)(?:[ \t]+(\S+))?/;
/** A diagram's start line, `@startuml` or another kind, and the id after it. */
const START = /^(\s*[@\\]start[A-Za-z0-9_]+)(?:\(id=([^)]*)\))?/;

/** Whether `line` could be where a diagram's name goes, before reading the whole text. */
export function namesDiagram(line: string, plantUml: boolean): boolean {
  return (plantUml ? START : FENCE).test(line);
}

/**
 * Whether the diagram that starts on `line` of `text` should be offered a
 * name, and the name written there now, which cannot be a file name, or
 * null. Undefined when there is no such diagram, or it has a usable name;
 * for a PlantUML file that includes the file's name, which its only
 * diagram exports under.
 */
export function unnamedAt(
  text: string,
  line: number,
  plantUml: boolean,
  fileName: string
): { current: string | null } | undefined {
  const written = (plantUml ? START : FENCE).exec(splitLines(text)[line] ?? '');
  if (written === null) {
    return undefined;
  }
  const blocks = plantUml ? findFileDiagrams(text, fileName) : findPlantUmlBlocks(text);
  const block = blocks.find((candidate) => candidate.openLine === line);
  if (block === undefined || (block.name !== null && isValidBlockName(block.name))) {
    return undefined;
  }
  return { current: written[2] ?? null };
}

/**
 * Where the end line a diagram lacks goes, for the quick fix on the problem
 * that reports it: the line to add, the line of the document it follows,
 * and what starts a line in the block's container (a quote marker, a list
 * item's indentation). The end follows the diagram's last line of content:
 * before the closing fence of a Markdown block, or before the next diagram
 * of a PlantUML file, leaving blank lines where they are.
 *
 * Undefined when no diagram starts on `line`, when the diagram has its end
 * line, when the block needs more than an end line (a second diagram, pages)
 * or when a Markdown block has no closing fence: the fence is what is
 * missing then.
 */
export function missingEndAt(
  text: string,
  line: number,
  plantUml: boolean,
  fileName: string
): { end: string; afterLine: number; prefix: string } | undefined {
  const blocks = plantUml ? findFileDiagrams(text, fileName) : findPlantUmlBlocks(text);
  for (const block of blocks) {
    const shape = diagramShape(block.source);
    if (shape.kind !== 'drawable' || shape.addedEnd === null || shape.startLine === null) {
      continue;
    }
    if (block.sourceLine + shape.startLine !== line) {
      continue;
    }
    if (!plantUml && !block.closed) {
      return undefined;
    }
    const lines = splitLines(text);
    // A line holding only quote markers or indentation is blank.
    const content = (index: number): string => {
      let rest = (lines[index] ?? '').trimStart();
      while (rest.startsWith('>')) {
        rest = rest.slice(1).trimStart();
      }
      return rest;
    };
    let afterLine = plantUml ? block.closeLine : block.closeLine - 1;
    while (afterLine > line && content(afterLine) === '') {
      afterLine--;
    }
    return { end: shape.addedEnd, afterLine, prefix: block.container };
  }
  return undefined;
}

/** `line` with `name` in place of the name it has, or added; null if it starts no diagram. */
export function withName(line: string, name: string, plantUml: boolean): string | null {
  const written = (plantUml ? START : FENCE).exec(line);
  if (written === null) {
    return null;
  }
  const named = plantUml ? `${written[1] ?? ''}(id=${name})` : `${written[1] ?? ''} ${name}`;
  return named + line.slice(written[0].length);
}
