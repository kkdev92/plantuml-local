/**
 * Folding ranges of a PlantUML file, read from its syntax: each diagram,
 * block comment, multi-line note or text, `{ … }` body, preprocessor
 * section, sequence group and activity block.
 *
 * Registering a folding provider for a language replaces folding by
 * indentation there. VS Code falls back to indentation only when every
 * provider returns no list at all, not when one returns an empty list, so
 * a file in which none of these is found should be given no list.
 *
 * Each kind of section is matched on a stack of its own, so a stray or a
 * missing end of one kind leaves the others alone: a bare `end` closes a
 * sequence group, but in an activity diagram it ends the flow. A section left
 * open folds nothing, nothing folds across a diagram's start or end, and
 * the lines of a comment, a note or a JSON or YAML diagram are not read for
 * sections. Keywords are matched regardless of case, as the engine matches
 * them; a diagram's start and end lines are not (see START).
 *
 * Like the completion, this has no dependency on the `vscode` module.
 * Lines are counted from 0.
 */

import { END, START } from '../core/shape';

/** A range to fold: the lines after `start`, up to and including `end`. */
export interface Fold {
  start: number;
  end: number;
  /** A block comment, which folds with its last line. */
  comment: boolean;
}

/**
 * A procedure or function body. A function with `!return` on its first line
 * has no end line.
 */
export const PROCEDURE = {
  open: /^\s*!(?:(?:unquoted|final)\s+)*(?:procedure\s|function\s(?!.*\)\s*!?return\b))|^\s*!definelong\s/i,
  close: /^\s*!end\s*(?:function|procedure|definelong)\b/i,
};

/**
 * Sections, by kind: the line that opens one and the line that closes it.
 * A line closes the first kind whose closing line it matches, or failing
 * that, opens the first kind whose opening line it matches.
 */
const SECTIONS: readonly { open: RegExp; close: RegExp }[] = [
  // Class, package, state and other bodies, skinparam and style blocks.
  { open: /\{\s*$/, close: /^\s*\}/ },
  { open: /^\s*!(?:if|ifdef|ifndef)\b/i, close: /^\s*!endif\b/i },
  { open: /^\s*!while\b/i, close: /^\s*!endwhile\b/i },
  { open: /^\s*!foreach\b/i, close: /^\s*!endfor\b/i },
  { open: /^\s*!startsub\b/i, close: /^\s*!endsub\b/i },
  PROCEDURE,
  { open: /^\s*(?:#\S+?:)?if\s*[("]/i, close: /^\s*end\s*if\b/i },
  { open: /^\s*(?:#\S+?:)?while\s*\(/i, close: /^\s*(?:end\s*while|while\s*end)\b/i },
  { open: /^\s*fork\s*;?\s*$/i, close: /^\s*(?:end\s*(?:fork|merge)|fork\s*end)\b/i },
  // Sequence groups: `end`, or `end` and a word that names no other block.
  {
    open: /^\s*(?:&\s*)?(?:opt|alt|loop|par2?|break|critical|group|partition)(?:#\w+)?(?:\s|$)/i,
    close: /^\s*end(?:\s+(?!(?:note|hnote|rnote|ref|box|legend|title|header|footer|split|switch)\b)\S.*)?$/i,
  },
];

/** Multi-line texts other than notes, whose lines are not read for sections. */
const TEXTS: readonly { open: RegExp; close: RegExp }[] = [
  {
    open: /^\s*legend(?:\s+(?:top|bottom))?(?:\s+(?:left|right|center))?\s*$/i,
    close: /^\s*end\s?legend\s*$/i,
  },
  { open: /^\s*(?:(?:left|right|center)\s*)?(?:header|footer)\s*$/i, close: /^\s*end\s?(?:header|footer)\s*$/i },
  { open: /^\s*title\s*$/i, close: /^\s*end\s?title\s*$/i },
  // The one-line form has a colon and text after the participants.
  { open: /^\s*ref(?:#\w+)?\s+over\s+[^:]*$/i, close: /^\s*end\s?(?:ref)?\s*$/i },
];

const NOTE = /^\s*(?:&\s*)?\/?\s*(?:floating\s+)?[hr]?note\b(.*)$/i;
const NOTE_END = /^\s*end\s?[hr]?note\s*$/i;
const BRACE_END = /^\s*\}\s*$/;
/** `note "text" as N1`, which is one line. */
const FLOATING_TEXT = /^\s*"[^"]*"\s+as\s/i;
/** A colon of its own, before a one-line note's text: `::` is part of a member's name. */
const LABEL_COLON = /(?<!:):(?!:)/;
/** Diagrams whose lines are data rather than PlantUML. */
export const DATA = /^\s*[@\\]start(?:json|yaml)\b/;

/** The line that ends the multi-line note or text `line` starts, or null. */
export function textEnd(line: string): RegExp | null {
  const note = NOTE.exec(line);
  if (note !== null) {
    const rest = note[1] ?? '';
    if (FLOATING_TEXT.test(rest) || LABEL_COLON.test(rest)) {
      return null;
    }
    return /\{\s*$/.test(rest) ? BRACE_END : NOTE_END;
  }
  return TEXTS.find((text) => text.open.test(line))?.close ?? null;
}

export function foldingRanges(source: string): Fold[] {
  const folds: Fold[] = [];
  const add = (start: number, end: number, comment = false): void => {
    if (end > start) {
      folds.push({ start, end, comment });
    }
  };
  let sections: number[][] = SECTIONS.map(() => []);
  let diagram: { start: number; data: boolean } | null = null;
  // A block comment has no `close`: it ends on a line ending in `'/`.
  let text: { start: number; close: RegExp | null } | null = null;

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (text?.close === null) {
      if (trimmed.endsWith("'/")) {
        add(text.start, index, true);
        text = null;
      }
      return;
    }
    if (text !== null) {
      if (text.close.test(line)) {
        add(text.start, index - 1);
        text = null;
        return;
      }
      // A line taken for a note's start by mistake does not hide the
      // diagrams after it.
      if (!START.test(line) && !END.test(line)) {
        return;
      }
      text = null;
    }

    // Comments, as the engine tells them apart.
    if (trimmed.startsWith("/'") && !trimmed.includes("'/")) {
      text = { start: index, close: null };
      return;
    }
    if (trimmed.startsWith("'") || (trimmed.startsWith("/'") && trimmed.endsWith("'/"))) {
      return;
    }

    if (START.test(line)) {
      diagram = { start: index, data: DATA.test(line) };
      sections = SECTIONS.map(() => []);
      return;
    }
    if (END.test(line)) {
      if (diagram !== null) {
        add(diagram.start, index - 1);
      }
      diagram = null;
      sections = SECTIONS.map(() => []);
      return;
    }
    if (diagram?.data === true) {
      return;
    }

    const close = textEnd(line);
    if (close !== null) {
      text = { start: index, close };
      return;
    }
    const closing = SECTIONS.findIndex((section) => section.close.test(line));
    if (closing !== -1) {
      const start = sections[closing]?.pop();
      if (start !== undefined) {
        add(start, index - 1);
      }
      return;
    }
    const opening = SECTIONS.findIndex((section) => section.open.test(line));
    if (opening !== -1) {
      sections[opening]?.push(index);
    }
  });

  return folds.sort((a, b) => a.start - b.start);
}
