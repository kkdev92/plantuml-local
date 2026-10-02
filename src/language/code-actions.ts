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
  const written = (plantUml ? START : FENCE).exec(text.split(/\r?\n/)[line] ?? '');
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

/** `line` with `name` in place of the name it has, or added; null if it starts no diagram. */
export function withName(line: string, name: string, plantUml: boolean): string | null {
  const written = (plantUml ? START : FENCE).exec(line);
  if (written === null) {
    return null;
  }
  const named = plantUml ? `${written[1] ?? ''}(id=${name})` : `${written[1] ?? ''} ${name}`;
  return named + line.slice(written[0].length);
}
