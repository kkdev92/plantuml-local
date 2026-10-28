import { splitLines } from '../core/lines';
import { WHITESPACE, javaTrim, withoutInnerComment } from '../language/declarations';

/**
 * The lines the bundled engine (`@plantuml/core` 1.2026.9) runs of a file
 * that `!include` or `!includesub` reads, with the line of the file each
 * one comes from, so that what they declare (src/language/declarations.ts)
 * can be found in the file.
 *
 * A local file with a diagram in it gives that diagram's lines: the first
 * diagram, or the one `file!2` or `file!ID` asks for. A file without one
 * gives all its lines. Either way a YAML header is skipped. Where a file
 * holds a diagram, a line ending with a single `\` goes on with the next
 * line, as it does in what `!includesub` reads (TContext.executeInclude,
 * DiagramDetector, DiagramExtractor, ReadLineWithYamlHeader and
 * TContext.executeIncludesub upstream). A bundled library's file is read
 * whole, without a diagram in it to choose.
 */

/** Lines, and the line of the text each one starts at. */
export interface NumberedLines {
  lines: string[];
  numbers: number[];
}

const BOM = String.fromCharCode(0xfeff);

function linesOf(text: string): NumberedLines {
  const lines = splitLines(text.startsWith(BOM) ? text.slice(1) : text);
  return { lines, numbers: lines.map((_, index) => index) };
}

/** Where `word` follows the white space at `from` and a `@` or `\`: the column after the word, or -1. */
function directiveAt(line: string, from: number, word: string): number {
  let at = from;
  while (at < line.length && WHITESPACE.has(line.charAt(at))) {
    at += 1;
  }
  const char = line.charAt(at);
  return (char === '@' || char === '\\') && line.startsWith(word, at + 1) ? at + 1 + word.length : -1;
}

/** StartUtils.isStartDirective: `@start` and something more, after white space. */
export function isStartDirective(line: string): boolean {
  const after = directiveAt(line, 0, 'start');
  return after !== -1 && after < line.length;
}

/** StartUtils.isEndDirective: `@end`, after white space. */
export function isEndDirective(line: string): boolean {
  return directiveAt(line, 0, 'end') !== -1;
}

/** A start line for ditaa (DiagramType.findStartTypes), whose lines are never joined. */
function startsDitaa(line: string): boolean {
  const after = directiveAt(line, 0, 'start');
  return after !== -1 && line.slice(after, after + 5).replace(/[A-Z]/g, (char) => char.toLowerCase()) === 'ditaa';
}

/** StringUtils.endsWithBackslash: one `\` at the end, not two. */
function endsWithBackslash(line: string): boolean {
  return line.endsWith('\\') && !line.endsWith('\\\\');
}

/**
 * ReadFilterQuoteComment: the next line from `from` that is not a comment,
 * without the comments inside it, and the line after it; null text when
 * the lines run out first.
 */
function nextCodeLine(lines: readonly string[], from: number): { text: string | null; next: number } {
  let longComment = false;
  for (let index = from; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const trim = javaTrim(line.replace(/\t/g, ' '));
    if (longComment) {
      longComment = !trim.endsWith("'/");
      continue;
    }
    if (trim.startsWith("'") || (trim.startsWith("/'") && trim.endsWith("'/"))) {
      continue;
    }
    if (trim.startsWith("/'") && !trim.includes("'/")) {
      longComment = true;
      continue;
    }
    return { text: withoutInnerComment(line).text, next: index + 1 };
  }
  return { text: null, next: lines.length };
}

/**
 * ReadFilterMergeLines: a line ending with a single `\` goes on with the
 * next line that is not a comment, the `\` dropped; not in a ditaa diagram.
 */
export function joinContinuedLines(text: NumberedLines): NumberedLines {
  const lines: string[] = [];
  const numbers: number[] = [];
  let joining = true;
  let index = 0;
  while (index < text.lines.length) {
    const number = text.numbers[index] ?? index;
    let line = text.lines[index] ?? '';
    index += 1;
    if (isStartDirective(line) && startsDitaa(line)) {
      joining = false;
    }
    if (isEndDirective(line)) {
      joining = true;
    }
    while (joining && endsWithBackslash(line)) {
      const next = nextCodeLine(text.lines, index);
      index = next.next;
      if (next.text === null) {
        break;
      }
      line = line.slice(0, -1) + next.text;
    }
    lines.push(line);
    numbers.push(number);
  }
  return { lines, numbers };
}

/** Character.isLetterOrDigit, for one UTF-16 code unit. */
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/**
 * StartUtils.beforeStartUml: what comes before `@start` on a line that has
 * no letter, digit, `_` or `~` before it (outside `<…>`); null for any other
 * line.
 */
function beforeStart(line: string): string | null {
  let inside = false;
  for (let at = 0; at < line.length; at++) {
    if (directiveAt(line, at, 'start') !== -1) {
      return line.slice(0, at);
    }
    const char = line.charAt(at);
    if (inside) {
      inside = char !== '>';
    } else if (char === '<') {
      inside = true;
    } else if (char === '~' || char === '_' || LETTER_OR_DIGIT.test(char)) {
      return null;
    }
  }
  return null;
}

/**
 * UncommentReadLine: after a line like `' @startuml`, the lines lose what
 * came before its `@start` (`' `), so that a diagram can be written in the
 * comments of another language.
 */
export function uncommented(text: NumberedLines): NumberedLines {
  let header: string | null = null;
  const lines = text.lines.map((line) => {
    header = beforeStart(line) ?? header;
    if (header === null) {
      return line;
    }
    if (header.startsWith(line)) {
      return '';
    }
    return line.startsWith(header) ? line.slice(header.length) : line;
  });
  return { lines, numbers: text.numbers };
}

/** ReadLineWithYamlHeader: without a header from a first line `---` to the next `---`. */
function withoutYamlHeader(text: NumberedLines): NumberedLines {
  if (text.lines[0] !== '---') {
    return text;
  }
  const close = text.lines.indexOf('---', 1);
  const from = close === -1 ? text.lines.length : close + 1;
  return { lines: text.lines.slice(from), numbers: text.numbers.slice(from) };
}

/** Why the engine cannot include a file, or why what it reads cannot be told. */
export type IncludedLinesProblem =
  /** It holds no diagram that `file!N` or `file!ID` asks for: "cannot include". */
  | 'no-diagram'
  /** `file!ID` with an ID the engine reads as a pattern, which is not followed here. */
  | 'pattern';

/**
 * DiagramExtractor.checkUid: the start line has `id=ID` and then a
 * character other than a letter, a digit or `_`.
 */
function hasId(line: string, id: string): boolean {
  for (let at = line.indexOf(`id=${id}`); at !== -1; at = line.indexOf(`id=${id}`, at + 1)) {
    const after = line.charAt(at + 3 + id.length);
    if (after !== '' && !/[A-Za-z0-9_]/.test(after)) {
      return true;
    }
  }
  return false;
}

/**
 * The lines the engine runs of a local file that `!include` reads, with
 * `selector` the text after the path's last `!`, or null without one.
 */
export function includedLines(
  text: string,
  selector: string | null
): NumberedLines | { problem: IncludedLinesProblem } {
  const raw = linesOf(text);
  const read = uncommented(joinContinuedLines(raw));
  if (!read.lines.some(isStartDirective)) {
    return withoutYamlHeader(raw);
  }
  let block = 0;
  let id: string | null = null;
  if (selector !== null && /^[0-9]+$/.test(selector)) {
    // A number past the largest int fails in the engine; it is past the diagrams of any file here.
    block = Number(selector);
  } else if (selector !== null) {
    if (!/^[\w-]*$/.test(selector)) {
      return { problem: 'pattern' };
    }
    id = selector;
  }
  const start = read.lines.findIndex((line) => {
    if (!isStartDirective(line) || (id !== null && !hasId(line, id))) {
      return false;
    }
    block -= 1;
    return block < 0;
  });
  if (start === -1) {
    return { problem: 'no-diagram' };
  }
  const end = read.lines.findIndex((line, index) => index > start && isEndDirective(line));
  const to = end === -1 ? read.lines.length : end;
  return withoutYamlHeader({ lines: read.lines.slice(start + 1, to), numbers: read.numbers.slice(start + 1, to) });
}

/** The lines the engine runs of a bundled library's file: all of them, without a YAML header. */
export function libraryLines(text: string): NumberedLines {
  return withoutYamlHeader(linesOf(text));
}

/** `!startsub NAME`, as Sub.fromFile reads it: a name of letters, digits and `_`. */
const STARTSUB = /^[ \t\n\v\f\r\xa0]*!startsub\b/;
const ENDSUB = /^[ \t\n\v\f\r\xa0]*!endsub\b/;

function startsubName(line: string): string | null {
  if (!STARTSUB.test(line)) {
    return null;
  }
  const rest = line.replace(/[\0-\x20\xa0]+$/, '').replace(STARTSUB, '');
  let at = 0;
  while (at < rest.length && WHITESPACE.has(rest.charAt(at))) {
    at += 1;
  }
  const name = rest.slice(at);
  return /^\w+$/.test(name) ? name : null;
}

/**
 * The lines of a file's section `name` that `!includesub file!name` runs
 * (Sub.fromFile): those between each `!startsub name` and the next
 * `!endsub`, one after the other. Null when the engine cannot include it:
 * the file has no such section, or a `!startsub` without a good name.
 */
export function sectionLines(text: string, name: string): NumberedLines | null {
  const read = joinContinuedLines(uncommented(linesOf(text)));
  const lines: string[] = [];
  const numbers: number[] = [];
  let found = false;
  let skip = false;
  let badName = false;
  read.lines.forEach((line, index) => {
    if (STARTSUB.test(line)) {
      const sub = startsubName(line);
      badName ||= sub === null;
      if (sub === name) {
        skip = false;
        found = true;
      }
      return;
    }
    if (ENDSUB.test(line) && found) {
      skip = true;
    }
    if (found && !skip) {
      lines.push(line);
      numbers.push(read.numbers[index] ?? index);
    }
  });
  return found && !badName ? { lines, numbers } : null;
}
