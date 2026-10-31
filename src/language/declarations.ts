/**
 * What a text declares for the preprocessor of the bundled engine
 * (`@plantuml/core` 1.2026.9): its procedures, functions, `!define` and
 * `!definelong` macros and variables, with their parameters as written;
 * the variables `!undef` removes; and the files `!include` and
 * `!includesub` read. The completion and the parameter hints offer what is
 * declared before the cursor (src/language/macros.ts), and
 * scripts/generate-stdlib.mjs records what the bundled libraries declare,
 * read the same way.
 *
 * Lines are read in the engine's order (TContext.buildCodeIterator
 * upstream): block comments and comment lines are skipped, a comment at
 * the start or the end of a line is taken off, and what is left is told
 * apart as the engine tells lines apart (TLineType): the directives in
 * lower case only, in the same order. A declaration is then read as its
 * Eater class reads it, and a line the engine would reject declares
 * nothing. Nothing is run: a default value, a variable's value and a
 * macro's text are kept as written. What the engine settles only by
 * running the text is recorded rather than settled: whether a definition
 * lies under `!if`, `!while` or `!foreach`, and the path of an include,
 * before any value is put in it.
 *
 * Like the folding, this has no dependency on the `vscode` module. Lines
 * and columns count from 0, columns in UTF-16 code units as VS Code counts
 * them.
 */

/** What declares a name. */
export type DefinitionKind =
  /** `!procedure`: a call stands for the lines of its body. */
  | 'procedure'
  /** `!function`: a call stands for what it returns. */
  | 'function'
  /** `!define NAME(…) text`: a call stands for the text. */
  | 'define'
  /** `!definelong NAME(…)` up to `!enddefinelong`. */
  | 'definelong'
  /** `!define NAME text`, which the engine keeps as a global variable. */
  | 'constant'
  /** An assignment (`!$name = …`, `?=`, `!global`, `!local`), or the variable of a `!foreach`. */
  | 'variable';

export interface Parameter {
  /** As declared, `$` and all. */
  name: string;
  /** The default value as written; absent when there is none. */
  default?: string;
}

/** Where a declaration is, and what may leave it out. */
interface Placed {
  line: number;
  /**
   * Whether running the text may leave it out: it lies in `!if`, `!ifdef`,
   * `!ifndef`, `!while` or `!foreach`.
   */
  conditional: boolean;
  /** In the body of a procedure, function or `!definelong`: the line that declares that one. */
  body?: number;
  /** Between `!startsub NAME` and `!endsub`: the name, which `!includesub` reads again, and the `!startsub` line. */
  sub?: { name: string; line: number };
}

export interface Definition extends Placed {
  type: 'definition';
  kind: DefinitionKind;
  /** As written, `$` and all: `$foo` and `foo` are two names to the engine. */
  name: string;
  /** The parameters of a procedure, function or macro; absent for a variable. */
  parameters?: readonly Parameter[];
  /** Columns of the name in its line. */
  start: number;
  end: number;
  /** The last line of its body, its `!end…` line; `line` for one written on a single line. */
  last: number;
  /** For a variable, `!global` or `!local` as written. */
  scope?: 'global' | 'local';
  /** `?=`: the variable is assigned only when it has no value yet. */
  ifUnset?: true;
  /** The variable of a `!foreach`, its value what the loop runs through. */
  foreach?: true;
  /** `!final`: the engine refuses another definition with the same name and number of parameters. */
  final?: boolean;
  /** `!unquoted`: the arguments of a call are read as text, without quotes. */
  unquoted?: boolean;
  /** The comment lines right above it, without their markers. */
  comment?: string;
  /** A variable's value, a macro's text, or what a function written on one line returns, as written. */
  value?: string;
}

/** `!undef`, which removes a variable; the engine has no way to remove a procedure or a function. */
export interface Undefinition extends Placed {
  type: 'undef';
  name: string;
}

export interface Inclusion extends Placed {
  type: 'include';
  /** `!includeurl` reads a path the way `!include` does. */
  directive: 'include' | 'include_once' | 'include_many' | 'includesub';
  /**
   * What the line asks for, as written, before the engine puts the values
   * of variables in it: a path, or `<library/file>` for a bundled library.
   * For `!includesub`, the file; empty when it names a section of the text
   * itself.
   */
  target: string;
  /** Columns of `target` in its line. */
  start: number;
  end: number;
  /**
   * What follows the target's `!`: the diagram of the file to read (`!1`,
   * `!ID`), or the section an `!includesub` reads. Null without one.
   */
  selector: string | null;
}

export type Declaration = Definition | Undefinition | Inclusion;

/** `%s` in the engine's line patterns: Java's `\s` and the no-break space. */
const SPACE = '[ \\t\\n\\v\\f\\r\\xa0]';
/** Characters past U+FFFF, which the engine reads as emoji and takes in a name. */
const ASTRAL = `${String.fromCodePoint(0x10000)}-${String.fromCodePoint(0x10ffff)}`;
/** A name, as the engine's line patterns read one (IDENTIFIER_WITH_UNICODE_SURROGATES_SUPPORT). */
const IDENTIFIER = `[\\p{L}_${ASTRAL}][\\p{L}_0-9${ASTRAL}]*`;

const pattern = (source: string): RegExp => new RegExp(`^${SPACE}*${source}`, 'u');
/** A directive written alone: the word, then anything but a letter, a digit or `_`. */
const keyword = (word: string): RegExp => pattern(`!${word}\\b`);

const COMMENT = pattern("'");
const COMMENT_ON_LINE = pattern(`/'.*'/${SPACE}*$`);
const COMMENT_START = pattern("/'");
const LEGACY_DEFINE = pattern(`!define${SPACE}+${IDENTIFIER}\\(`);
const LEGACY_DEFINELONG = pattern(`!definelong${SPACE}+${IDENTIFIER}`);
const AFFECTATION_DEFINE = pattern(`!define${SPACE}+${IDENTIFIER}`);
const AFFECTATION = pattern(`!${SPACE}*(?:local|global)?${SPACE}*\\$?${IDENTIFIER}${SPACE}*\\??=`);
/** The flags take Java's `\s` after them, without the no-break space. */
const FLAGS = '(?:unquoted[ \\t\\n\\v\\f\\r]|final[ \\t\\n\\v\\f\\r])*';
const DECLARE_FUNCTION = pattern(`!${FLAGS}function${SPACE}+\\$?${IDENTIFIER}`);
const DECLARE_PROCEDURE = pattern(`!${FLAGS}procedure${SPACE}+\\$?${IDENTIFIER}`);
const END_FUNCTION = pattern(`!end${SPACE}*(?:function|definelong|procedure)\\b`);
const INCLUDE = pattern(`!include${SPACE}*(?:url|_many|_once)?\\b`);

/** What the engine's line patterns read a line as: only what this file and the call reader act on. */
export type LineType =
  | 'comment'
  | 'comment-start'
  | 'plain'
  | 'legacy-define'
  | 'legacy-definelong'
  | 'affectation-define'
  | 'affectation'
  | 'if'
  | 'undef'
  | 'function'
  | 'procedure'
  | 'else'
  | 'endif'
  | 'while'
  | 'endwhile'
  | 'foreach'
  | 'endforeach'
  | 'end-function'
  | 'include'
  | 'startsub'
  | 'endsub'
  | 'includesub'
  | 'other';

/** TLineType.getFromLineInternal, in its order. */
const ORDER: readonly (readonly [RegExp, LineType])[] = [
  [LEGACY_DEFINE, 'legacy-define'],
  [LEGACY_DEFINELONG, 'legacy-definelong'],
  [AFFECTATION_DEFINE, 'affectation-define'],
  [AFFECTATION, 'affectation'],
  [keyword('ifdef'), 'if'],
  [keyword('undef'), 'undef'],
  [keyword('ifndef'), 'if'],
  [keyword('assert'), 'other'],
  [keyword('if'), 'if'],
  [DECLARE_FUNCTION, 'function'],
  [DECLARE_PROCEDURE, 'procedure'],
  [keyword('else'), 'else'],
  [keyword('elseif'), 'else'],
  [keyword('endif'), 'endif'],
  [keyword('while'), 'while'],
  [keyword('endwhile'), 'endwhile'],
  [keyword('foreach'), 'foreach'],
  [keyword('endfor'), 'endforeach'],
  [END_FUNCTION, 'end-function'],
  [keyword('return'), 'other'],
  [keyword('theme'), 'other'],
  [INCLUDE, 'include'],
  [keyword('includedef'), 'other'],
  [keyword('import'), 'other'],
  [keyword('startsub'), 'startsub'],
  [keyword('endsub'), 'endsub'],
  [keyword('includesub'), 'includesub'],
];

export function lineType(line: string): LineType {
  if (COMMENT.test(line) || COMMENT_ON_LINE.test(line)) {
    return 'comment';
  }
  if (COMMENT_START.test(line) && !line.includes("'/")) {
    return 'comment-start';
  }
  if (!line.includes('!')) {
    return 'plain';
  }
  return ORDER.find(([test]) => test.test(line))?.[1] ?? 'plain';
}

const LETTER = /^\p{L}$/u;

/** Character.isWhitespace, which the engine skips between the parts of a line. */
export const WHITESPACE: ReadonlySet<string> = new Set(
  [
    ...[9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 0x1680, 0x2028, 0x2029, 0x205f, 0x3000],
    ...[0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200a],
  ].map((code) => String.fromCharCode(code))
);

/** A letter, `_` or an emoji: what may start a name after its `$`. */
function startsName(char: string): boolean {
  return char === '_' || char.length === 2 || LETTER.test(char);
}

/** What may go on in a name: also the digits 0 to 9. */
function continuesName(char: string): boolean {
  return startsName(char) || (char >= '0' && char <= '9');
}

/** The character (a code point) at `at`, or '' at the end. */
function charAt(text: string, at: number): string {
  const code = text.codePointAt(at);
  return code === undefined ? '' : String.fromCodePoint(code);
}

/**
 * Reads a line as the engine's Eater classes do: one position that moves
 * along it. Each reading method returns null where the engine would throw.
 */
class Reader {
  at: number;

  constructor(
    readonly text: string,
    at = 0
  ) {
    this.at = at;
  }

  peek(): string {
    return charAt(this.text, this.at);
  }

  skipSpaces(): void {
    while (this.at < this.text.length && WHITESPACE.has(this.text.charAt(this.at))) {
      this.at += 1;
    }
  }

  /** checkAndEatChar for a word: whether the text goes on with it, eating it when it does. */
  eat(word: string): boolean {
    if (!this.text.startsWith(word, this.at)) {
      return false;
    }
    this.at += word.length;
    return true;
  }

  /** eatAndGetVarname: a letter, an emoji, `_` or `$`, then letters, emoji, `_` and digits. */
  name(): { name: string; start: number; end: number } | null {
    const start = this.at;
    const first = this.peek();
    if (first !== '$' && !startsName(first)) {
      return null;
    }
    this.at += first.length;
    for (let next = this.peek(); next !== '' && continuesName(next); next = this.peek()) {
      this.at += next.length;
    }
    return { name: this.text.slice(start, this.at), start, end: this.at };
  }

  /** The text up to the end. */
  rest(): string {
    const rest = this.text.slice(this.at);
    this.at = this.text.length;
    return rest;
  }
}

/** The end of a name that starts at `at`, `$` and all (eatAndGetVarname); `at` when none does. */
export function nameEnd(text: string, at: number): number {
  return new Reader(text, at).name()?.end ?? at;
}

/**
 * TokenStack.eatUntilCloseParenthesisOrComma: the text of a default value
 * or an argument, up to a `,` or `)` outside quotes and brackets. Null when
 * the line ends first.
 */
export function readUntilCommaOrClose(text: string, from: number): number | null {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    const char = text.charAt(at);
    if (char === '"' || char === "'") {
      const close = text.indexOf(char, at + 1);
      if (close === -1) {
        return null;
      }
      at = close;
    } else if (depth === 0 && (char === ',' || char === ')')) {
      return at;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }
  }
  return null;
}

/**
 * Eater.eatDeclareFunction from the name on: the name, and the parameters
 * in brackets right after it, each with its default value as written. With
 * `optional`, a name without brackets declares no parameters
 * (`!definelong`).
 */
function readSignature(
  reader: Reader,
  optional: boolean
): { name: { name: string; start: number; end: number }; parameters: Parameter[] } | null {
  const name = reader.name();
  if (name === null) {
    return null;
  }
  reader.skipSpaces();
  if (!reader.eat('(')) {
    return optional ? { name, parameters: [] } : null;
  }
  const parameters: Parameter[] = [];
  for (;;) {
    reader.skipSpaces();
    const char = reader.peek();
    if (char === '$' || startsName(char)) {
      const parameter = reader.name();
      if (parameter === null) {
        return null;
      }
      reader.skipSpaces();
      if (reader.eat('=')) {
        const end = readUntilCommaOrClose(reader.text, reader.at);
        if (end === null) {
          return null;
        }
        parameters.push({ name: parameter.name, default: reader.text.slice(reader.at, end).trim() });
        reader.at = end;
      } else {
        parameters.push({ name: parameter.name });
      }
    } else if (char === ',') {
      reader.at += 1;
    } else if (char === ')') {
      reader.at += 1;
      reader.skipSpaces();
      return { name, parameters };
    } else {
      return null;
    }
  }
}

/** StringUtils.isTrimmable: what getTrimmed takes off both ends of a line. */
const trimmable = (char: string): boolean => char <= ' ' || char === String.fromCharCode(0xa0);

/** A line as getTrimmed leaves it: a reader at its first character, and the end of what is left. */
function trimmed(line: string): Reader {
  let end = line.length;
  while (end > 0 && trimmable(line.charAt(end - 1))) {
    end -= 1;
  }
  let start = 0;
  while (start < end && trimmable(line.charAt(start))) {
    start += 1;
  }
  return new Reader(line.slice(0, end), start);
}

/** Whether a line ends a block comment: its getTrimmed text ends with `'/`. */
function endsBlockComment(line: string): boolean {
  const reader = trimmed(line);
  return reader.text.endsWith("'/");
}

/** Java's String.trim: the characters up to the space taken off both ends. */
export function javaTrim(text: string): string {
  return text.replace(/^[\0-\x20]+|[\0-\x20]+$/g, '');
}

/**
 * A line with comments taken out of it, and where what is left was in the
 * line: the parts taken out, as columns of the line, in order.
 */
export interface CutLine {
  text: string;
  removed: readonly (readonly [number, number])[];
}

/** The column in the line of column `at` of what is left. */
export function columnIn(cut: CutLine, at: number): number {
  let column = at;
  for (const [from, to] of cut.removed) {
    if (from > column) {
      break;
    }
    column += to - from;
  }
  return column;
}

/** The column in what is left of column `at` of the line; null within a part taken out. */
export function columnOut(cut: CutLine, at: number): number | null {
  let column = at;
  for (const [from, to] of cut.removed) {
    if (at <= from) {
      break;
    }
    if (at < to) {
      return null;
    }
    column -= to - from;
  }
  return column;
}

/** StringLocated.removeSpecialInnerComment: `/'''name'''/` taken out anywhere. */
const SPECIAL_COMMENT = /\/'''[-\w]*'''\//g;

function withoutSpecialComments(line: string, from: number, to: number): CutLine {
  const kept = line.slice(from, to);
  const inner: (readonly [number, number])[] = [];
  if (kept.includes("/'''") && kept.includes("'''/")) {
    for (const match of kept.matchAll(SPECIAL_COMMENT)) {
      inner.push([from + match.index, from + match.index + match[0].length]);
    }
  }
  return {
    text: inner.length === 0 ? kept : kept.replace(SPECIAL_COMMENT, ''),
    removed: [
      ...(from > 0 ? [[0, from] as const] : []),
      ...inner,
      ...(to < line.length ? [[to, line.length] as const] : []),
    ],
  };
}

/**
 * StringLocated.removeInnerComment: a line without the block comment it
 * starts with, or else without the one it ends with, and without
 * `/'''name'''/` comments.
 */
export function withoutInnerComment(line: string): CutLine {
  const trim = javaTrim(line.replace(/\t/g, ' '));
  if (trim.startsWith("/'")) {
    const close = line.indexOf("'/");
    if (close !== -1) {
      return withoutSpecialComments(line, close + 2, line.length);
    }
  }
  if (trim.endsWith("'/")) {
    const open = line.lastIndexOf("/'");
    if (open !== -1) {
      return withoutSpecialComments(line, 0, open);
    }
  }
  if (trim.includes("/'''") && trim.includes("'''/")) {
    return withoutSpecialComments(line, 0, line.length);
  }
  return { text: line, removed: [] };
}

/** The flags before `function` or `procedure` (EaterDeclareProcedure), and whether the keyword follows. */
function readFlags(reader: Reader, word: 'function' | 'procedure'): { unquoted: boolean; final: boolean } | null {
  if (!reader.eat('!')) {
    return null;
  }
  const flags = { unquoted: false, final: false };
  for (;;) {
    if (reader.peek() === 'u') {
      if (!reader.eat('unquoted')) {
        return null;
      }
      flags.unquoted = true;
    } else if (reader.text.startsWith('fi', reader.at)) {
      if (!reader.eat('final')) {
        return null;
      }
      flags.final = true;
    } else {
      break;
    }
    reader.skipSpaces();
  }
  if (!reader.eat(word)) {
    return null;
  }
  reader.skipSpaces();
  return flags;
}

/** The text of a comment line without its markers. */
function commentText(line: string): string {
  return line.trim().replace(/^\/'/, '').replace(/'\/$/, '').replace(/^'+/, '').trim();
}

/** What Java's String.trim takes off the end of a path, and the no-break space (getTrimmed). */
const TRAILING = /[\0-\x20\xa0]+$/;

/**
 * The target and selector of an include line (EaterInclude,
 * EaterIncludesub): the text after the directive and the white space after
 * it, up to its last `!` (its first for `!includesub`). The line is one
 * {@link lineType} reads as an include, comments taken off.
 */
function includeOf(
  line: string,
  type: 'include' | 'includesub'
): Pick<Inclusion, 'directive' | 'target' | 'start' | 'end' | 'selector'> | null {
  const reader = trimmed(line);
  let directive: Inclusion['directive'];
  if (type === 'includesub') {
    if (!reader.eat('!includesub')) {
      return null;
    }
    directive = 'includesub';
  } else {
    if (!reader.eat('!include')) {
      return null;
    }
    reader.eat('url');
    directive = reader.eat('_once') ? 'include_once' : reader.eat('_many') ? 'include_many' : 'include';
  }
  reader.skipSpaces();
  const start = reader.at;
  const rest = reader.text.slice(start).replace(TRAILING, '');
  const mark = directive === 'includesub' ? rest.indexOf('!') : rest.lastIndexOf('!');
  const target = mark === -1 ? (directive === 'includesub' ? '' : rest) : rest.slice(0, mark);
  return {
    directive,
    target,
    start,
    end: start + target.length,
    selector: mark === -1 ? (directive === 'includesub' ? rest : null) : rest.slice(mark + 1),
  };
}

/** EaterStartsub: the name of a section, letters, digits and `_` only. */
function subOf(line: string): string | null {
  const reader = trimmed(line);
  if (!reader.eat('!startsub')) {
    return null;
  }
  reader.skipSpaces();
  const name = reader.rest();
  return /^\w+$/.test(name) ? name : null;
}

/**
 * The columns of the name a line declares as a procedure, function or
 * macro, even while its parameters are still being written: the bracket
 * after it opens no call. Null for any other line.
 */
export function declaredName(line: string): { start: number; end: number } | null {
  const rawType = lineType(line);
  if (rawType === 'comment' || rawType === 'comment-start') {
    return null;
  }
  const cut = withoutInnerComment(line);
  const type = lineType(cut.text);
  const reader = trimmed(cut.text);
  if (type === 'legacy-define' || type === 'legacy-definelong') {
    reader.at += 1;
    reader.eat(type === 'legacy-define' ? 'define' : 'definelong');
    reader.skipSpaces();
  } else if ((type !== 'function' && type !== 'procedure') || readFlags(reader, type) === null) {
    return null;
  }
  const name = reader.name();
  return name === null ? null : { start: columnIn(cut, name.start), end: columnIn(cut, name.end - 1) + 1 };
}

/** A procedure, function or `!definelong` whose body is still being read. */
interface OpenBody {
  definition: Definition;
  /** How deep the `!if`, `!while` and `!foreach` of the body are. */
  depth: number;
}

/**
 * The declarations of `lines`, in order. `lines` are what the engine reads
 * of a text: one diagram's lines between its start and end lines, or a
 * file to include. `numbers` gives the line each of them was read from
 * when lines were joined (a line ending with `\`); without it, line `i` is
 * number `i`.
 */
export function declarationsOf(lines: readonly string[], numbers?: readonly number[]): Declaration[] {
  return read(lines, numbers, undefined);
}

/**
 * For each of `lines`, whether running the text may leave it out, as
 * {@link declarationsOf} tells it for a declaration: whether it lies in
 * `!if`, `!ifdef`, `!ifndef`, `!while` or `!foreach`, which in a body are
 * the body's own.
 */
export function conditionalLines(lines: readonly string[]): boolean[] {
  const flags: boolean[] = [];
  read(lines, undefined, flags);
  return flags;
}

/** {@link declarationsOf}, with `flags`, when given, set for every line as {@link conditionalLines} tells it. */
function read(lines: readonly string[], numbers: readonly number[] | undefined, flags?: boolean[]): Declaration[] {
  const declarations: Declaration[] = [];
  /** The `!if`, `!while` and `!foreach` open outside a body. */
  let depth = 0;
  let body: OpenBody | null = null;
  let sub: { name: string; line: number } | null = null;
  let blockComment = false;
  /** The comment lines right above the current line. */
  let comments: string[] = [];

  lines.forEach((raw, index) => {
    const number = numbers?.[index] ?? index;
    if (flags !== undefined) {
      flags[index] = (body === null ? depth : body.depth) > 0;
    }
    if (blockComment) {
      blockComment = !endsBlockComment(raw);
      comments.push(commentText(raw));
      return;
    }
    const rawType = lineType(raw);
    if (rawType === 'comment' || rawType === 'comment-start') {
      blockComment = rawType === 'comment-start';
      comments.push(commentText(raw));
      return;
    }
    const cut = withoutInnerComment(raw);
    const line = cut.text;
    const type = cut.removed.length === 0 ? rawType : lineType(line);
    const above = comments.filter((text) => text !== '').join('\n');
    comments = [];
    if (type === 'plain' || type === 'comment' || type === 'comment-start') {
      return;
    }
    /** Columns of what is left of the line, as columns of the line. */
    const span = (start: number, end: number): { start: number; end: number } => ({
      start: columnIn(cut, start),
      end: end > start ? columnIn(cut, end - 1) + 1 : columnIn(cut, start),
    });

    if (type === 'startsub') {
      const name = subOf(line);
      sub = name === null ? null : { name, line: number };
      return;
    }
    if (type === 'endsub') {
      sub = null;
      return;
    }
    const conditional = (body === null ? depth : body.depth) > 0;
    const placed = {
      line: number,
      conditional,
      ...(body === null ? {} : { body: body.definition.line }),
      ...(sub === null ? {} : { sub }),
    };

    if (body !== null) {
      // In a body only what a call runs: its blocks, its variables, its includes.
      if (type === 'end-function') {
        body.definition.last = number;
        body = null;
        return;
      }
      if (type === 'if' || type === 'while' || type === 'foreach') {
        body.depth += 1;
      } else if (type === 'endif' || type === 'endwhile' || type === 'endforeach') {
        body.depth = Math.max(0, body.depth - 1);
      }
    } else if (type === 'if' || type === 'while' || type === 'foreach') {
      depth += 1;
    } else if (type === 'endif' || type === 'endwhile' || type === 'endforeach') {
      depth = Math.max(0, depth - 1);
    }

    const documented = above === '' ? {} : { comment: above };
    const reader = trimmed(line);
    switch (type) {
      case 'legacy-define':
      case 'legacy-definelong': {
        if (body !== null) {
          return;
        }
        reader.at += 1;
        reader.eat(type === 'legacy-define' ? 'define' : 'definelong');
        reader.skipSpaces();
        const signature = readSignature(reader, type === 'legacy-definelong');
        if (signature === null) {
          return;
        }
        const definition: Definition = {
          type: 'definition',
          kind: type === 'legacy-define' ? 'define' : 'definelong',
          name: signature.name.name,
          parameters: signature.parameters,
          ...placed,
          ...span(signature.name.start, signature.name.end),
          last: number,
          ...documented,
        };
        if (type === 'legacy-define') {
          definition.value = reader.rest();
        } else {
          body = { definition, depth: 0 };
        }
        declarations.push(definition);
        return;
      }
      case 'affectation-define': {
        if (body !== null) {
          return;
        }
        reader.at += 1;
        reader.eat('define');
        reader.skipSpaces();
        const name = reader.name();
        if (name === null) {
          return;
        }
        reader.skipSpaces();
        declarations.push({
          type: 'definition',
          kind: 'constant',
          name: name.name,
          ...placed,
          ...span(name.start, name.end),
          last: number,
          ...documented,
          value: reader.rest(),
        });
        return;
      }
      case 'affectation': {
        // EaterAffectation: `local` or `global` is a scope unless `=` follows it.
        reader.at += 1;
        reader.skipSpaces();
        let name = reader.name();
        let scope: 'global' | 'local' | undefined;
        if (name !== null && (name.name === 'local' || name.name === 'global')) {
          reader.skipSpaces();
          if (reader.peek() !== '?' && reader.peek() !== '=') {
            scope = name.name;
            name = reader.name();
          }
        }
        if (name === null) {
          return;
        }
        reader.skipSpaces();
        const unset = reader.eat('?');
        if (!reader.eat('=')) {
          return;
        }
        // Outside a body the engine refuses `!local`.
        if (scope === 'local' && body === null) {
          return;
        }
        reader.skipSpaces();
        declarations.push({
          type: 'definition',
          kind: 'variable',
          name: name.name,
          ...placed,
          ...span(name.start, name.end),
          last: number,
          ...(scope === undefined ? {} : { scope }),
          ...(unset ? { ifUnset: true as const } : {}),
          ...documented,
          value: reader.rest(),
        });
        return;
      }
      case 'undef': {
        reader.at += 1;
        reader.eat('undef');
        reader.skipSpaces();
        const name = reader.name();
        if (name !== null) {
          declarations.push({ type: 'undef', name: name.name, ...placed });
        }
        return;
      }
      case 'function':
      case 'procedure': {
        if (body !== null) {
          return;
        }
        const flags = readFlags(reader, type);
        const signature = flags === null ? null : readSignature(reader, false);
        if (flags === null || signature === null) {
          return;
        }
        const definition: Definition = {
          type: 'definition',
          kind: type,
          name: signature.name.name,
          parameters: signature.parameters,
          ...placed,
          ...span(signature.name.start, signature.name.end),
          last: number,
          ...(flags.final ? { final: true } : {}),
          ...(flags.unquoted ? { unquoted: true } : {}),
          ...documented,
        };
        // A function returns on its line with `return …` or `!return …`; anything else opens a body.
        const returns = type === 'function' && (reader.peek() === 'r' || reader.peek() === '!');
        if (returns) {
          if (!reader.eat(reader.peek() === 'r' ? 'return' : '!return')) {
            return;
          }
          reader.skipSpaces();
          definition.value = reader.rest();
        } else {
          body = { definition, depth: 0 };
        }
        declarations.push(definition);
        return;
      }
      case 'foreach': {
        // EaterForeach: `!foreach $name in …` sets the variable for the loop.
        reader.at += 1;
        reader.eat('foreach');
        reader.skipSpaces();
        const name = reader.name();
        if (name === null) {
          return;
        }
        reader.skipSpaces();
        if (!reader.eat('in')) {
          return;
        }
        reader.skipSpaces();
        declarations.push({
          type: 'definition',
          kind: 'variable',
          name: name.name,
          ...placed,
          conditional: true,
          ...span(name.start, name.end),
          last: number,
          foreach: true,
          ...documented,
          value: reader.rest(),
        });
        return;
      }
      case 'include':
      case 'includesub': {
        const include = includeOf(line, type);
        if (include !== null) {
          declarations.push({ type: 'include', ...include, ...placed, ...span(include.start, include.end) });
        }
        return;
      }
      default:
        return;
    }
  });
  return declarations;
}
