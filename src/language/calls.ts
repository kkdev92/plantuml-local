import {
  WHITESPACE,
  columnIn,
  columnOut,
  declaredName,
  lineType,
  nameEnd,
  withoutInnerComment,
  type CutLine,
  type LineType,
} from './declarations';

/**
 * The call the cursor is in, for the parameter hints: the procedure,
 * function or macro whose `(` the cursor follows, and its arguments up to
 * the cursor; and the call whose name the cursor is on, with all its
 * arguments, for Go to Definition. Both are read as the bundled engine
 * (`@plantuml/core` 1.2026.9) reads them (TContext.applyFunctionsAndVariables,
 * EaterFunctionCall, TokenStack and TokenType upstream).
 *
 * A line of text calls a name declared before it, written right before a
 * `(` and not going on from a letter, a digit or `_` (unless it starts with
 * `$`); a built-in function's name starts with `%`. Text outside a call is
 * not read for quotes: a call written between quotes is still a call. How
 * the arguments are read depends on what the name declares:
 *
 * - an argument of `!unquoted` procedures and functions, and of `!define`
 *   and `!definelong` macros, is text up to a `,` or `)` outside brackets,
 *   or a string when it starts with a quote; what it holds, a string's text
 *   too, is read again for calls;
 * - an argument of any other procedure or function is an expression.
 *
 * In an expression (an argument, the value of an assignment, what `!if`,
 * `!elseif`, `!while`, `!return` and `!foreach` read, the parameters of a
 * declared procedure or function), a quote opens a string only where a word
 * starts, and a word followed by `(`, white space between them or not, is a
 * call whose arguments are expressions too. The names `!ifdef`, `!ifndef`
 * and `!undef` read, and the lines that end a block, call nothing.
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

/** How a call's arguments are read. */
export type Reading =
  /** As expressions (EaterFunctionCall's own reading); `$name = …` names one. */
  | 'quoted'
  /** `!unquoted`: as text; `$name = …` names one. */
  | 'unquoted'
  /** `!define` and `!definelong`: as text, none named. */
  | 'legacy';

export interface CallArgument {
  /** Columns of the argument as written so far, the white space around it included. */
  start: number;
  end: number;
  /** For `$name = …`, the name, `$` and all. */
  name?: string;
}

export interface Call {
  name: string;
  /** Columns of the name. */
  start: number;
  end: number;
  /** How its arguments are read: as its name declares, or as expressions within an expression. */
  reading: Reading;
  /** The arguments up to the cursor, the last being the one the cursor is in; or all of them ({@link callNamedAt}). */
  arguments: CallArgument[];
}

/** Eater.AFFECTATION_PATTERN: an argument that starts with a name and `=`. */
const NAMED = /^\$?[_\p{L}][_\p{L}0-9]*[ \t\n\v\f\r]*=/u;

/** Character.isSpaceChar: the space, line and paragraph separators. */
const SPACE_CHAR = /^\p{Z}$/u;

/** TokenType.COMMERCIAL_MINUS_SIGN, which the engine reads as a minus. */
const MINUS = String.fromCharCode(0x2052);

/**
 * The lines that read an expression after their keyword (EaterIf,
 * EaterElseIf, EaterWhile, EaterReturn), or after `!foreach $name in`
 * (EaterForeach).
 */
const EXPRESSION_START =
  /^[ \t\n\v\f\r\xa0]*!(?:(if|elseif|while|return)\b|foreach[ \t\n\v\f\r]*\$?[_\p{L}][_\p{L}0-9]*[ \t\n\v\f\r]*in)/u;

/**
 * The lines the engine reads no call on (TContext.executeOneLineNotSafe and
 * the code iterators): the name `!ifdef`, `!ifndef` and `!undef` read, and
 * what ends or parts a block.
 */
const NO_CALLS: ReadonlySet<LineType> = new Set<LineType>([
  'if',
  'undef',
  'else',
  'endif',
  'while',
  'endwhile',
  'foreach',
  'endforeach',
  'end-function',
  'startsub',
  'endsub',
]);

/** TLineType.isLetterOrEmojiOrUnderscoreOrDigit, for one UTF-16 code unit. */
export function goesOnFrom(unit: string): boolean {
  const code = unit.charCodeAt(0);
  return unit === '_' || (unit >= '0' && unit <= '9') || (code >= 0xd800 && code <= 0xdfff) || /^\p{L}$/u.test(unit);
}

/**
 * TContext.getFunctionNameAt: the end of the name of a call in text that
 * starts at `at`, or -1. The name of a built-in function starts with `%`.
 */
function callNameEnd(line: string, at: number): number {
  const char = line.charAt(at);
  const afterLetter =
    at > 0 &&
    goesOnFrom(line.charAt(at - 1)) &&
    !(at >= 2 && line.charAt(at - 2) === '\\' && line.charAt(at - 1) === 'n');
  if (afterLetter && char !== '%' && char !== '$') {
    return -1;
  }
  const end = char === '%' ? nameEnd(line, at + 1) : nameEnd(line, at);
  return end > at + (char === '%' ? 1 : 0) && line.charAt(end) === '(' ? end : -1;
}

/** TokenType.isPlainTextBreak: whether the character at `at` ends a word of an expression. */
function endsWord(line: string, at: number): boolean {
  const char = line.charAt(at);
  const next = line.charAt(at + 1);
  return (
    SPACE_CHAR.test(char) ||
    '(),=-*/+<>'.includes(char) ||
    char === MINUS ||
    (char === '!' && next === '=') ||
    ((char === '&' || char === '|') && next === char)
  );
}

/** A call being read, or the expression a line reads (no call). */
interface Frame {
  call: Call | null;
  /** How many brackets inside the argument are open. */
  depth: number;
  /** The quote of the string the reading is in, or null. */
  quote: string | null;
  /** Read as text: where a quote opens the argument's string. */
  valueStart: number;
  /** Read as expressions: the word the reading is in, or the last one when nothing came after it but space. */
  word: { start: number; end: number } | null;
  inWord: boolean;
  lastWord: boolean;
  /** Read as expressions: the second character of `&&` or `||`. */
  skip: boolean;
}

/** What a character does to a call being read. */
type Step =
  | 'none'
  /** A `,` that starts its next argument. */
  | 'comma'
  /** The `)` that ends it. */
  | 'close'
  /** The end of a string whose text is read for calls: the calls in it end there. */
  | 'cut'
  /** A `(` after a word of an expression: a call. */
  | { open: { start: number; end: number } };

/** An argument that starts at `from`: whether it names itself, and where its value starts. */
function argumentFrom(line: string, from: number, reading: Reading): { argument: CallArgument; valueStart: number } {
  let at = from;
  while (at < line.length && WHITESPACE.has(line.charAt(at))) {
    at += 1;
  }
  const argument: CallArgument = { start: from, end: from };
  const named = reading === 'legacy' ? null : NAMED.exec(line.slice(at));
  if (named !== null) {
    argument.name = line.slice(at, nameEnd(line, at));
    at += named[0].length;
    while (at < line.length && WHITESPACE.has(line.charAt(at))) {
      at += 1;
    }
  }
  return { argument, valueStart: at };
}

function frameOf(line: string, call: Call | null, from: number): Frame {
  const reading = call?.reading ?? 'quoted';
  const first = argumentFrom(line, from, reading);
  call?.arguments.push(first.argument);
  return {
    call,
    depth: 0,
    quote: null,
    valueStart: first.valueStart,
    word: null,
    inWord: false,
    lastWord: false,
    skip: false,
  };
}

/** EaterFunctionCall reading `!unquoted` and `!define` arguments: text, or a string from its start. */
function readText(frame: Frame, line: string, at: number): Step {
  const char = line.charAt(at);
  if (frame.quote !== null) {
    if (char !== frame.quote) {
      return 'none';
    }
    frame.quote = null;
    return 'cut';
  }
  if (char === '(') {
    frame.depth += 1;
  } else if (char === ')') {
    if (frame.depth === 0) {
      return 'close';
    }
    frame.depth -= 1;
  } else if (char === ',' && frame.depth === 0) {
    return 'comma';
  } else if ((char === '"' || char === "'") && at === frame.valueStart) {
    frame.quote = char;
  }
  return 'none';
}

/** TokenStack and TokenType reading an expression, one character at a time. */
function readExpression(frame: Frame, line: string, at: number): Step {
  const char = line.charAt(at);
  if (frame.skip) {
    frame.skip = false;
    return 'none';
  }
  if (frame.quote !== null) {
    frame.quote = char === frame.quote ? null : frame.quote;
    return 'none';
  }
  if (frame.inWord) {
    if (!endsWord(line, at)) {
      if (frame.word !== null) {
        frame.word.end = at + 1;
      }
      return 'none';
    }
    frame.inWord = false;
  }
  if (WHITESPACE.has(char) || SPACE_CHAR.test(char)) {
    return 'none';
  }
  const word = frame.lastWord ? frame.word : null;
  frame.lastWord = false;
  if (char === '"' || char === "'") {
    frame.quote = char;
  } else if (char === '(') {
    frame.depth += 1;
    return word === null ? 'none' : { open: word };
  } else if (char === ')') {
    if (frame.depth === 0) {
      return 'close';
    }
    frame.depth -= 1;
  } else if (char === ',') {
    return frame.depth === 0 ? 'comma' : 'none';
  } else if ((char === '&' || char === '|') && line.charAt(at + 1) === char) {
    frame.skip = true;
  } else if (!endsWord(line, at) && !(char >= '0' && char <= '9')) {
    // A word starts here. A number is no word: a new token starts after its digits.
    frame.inWord = true;
    frame.lastWord = true;
    frame.word = { start: at, end: at + 1 };
  }
  return 'none';
}

/** Where a line starts reading for calls, and how; null for one that reads none. */
function rootOf(text: string): { expression: boolean; from: number } | null {
  const type = lineType(text);
  if (type === 'comment' || type === 'comment-start') {
    return null;
  }
  const keyword = type === 'affectation' ? null : EXPRESSION_START.exec(text);
  let from = type === 'affectation' ? text.indexOf('=') + 1 : (keyword?.[0].length ?? null);
  if (from !== null) {
    while (from < text.length && WHITESPACE.has(text.charAt(from))) {
      from += 1;
    }
    // Eater.eatExpression reads JSON data, not an expression, from a brace or a
    // square bracket; `!while` reads an expression only.
    const first = text.charAt(from);
    return (first === '{' || first === '[') && keyword?.[1] !== 'while' ? null : { expression: true, from };
  }
  if (NO_CALLS.has(type)) {
    return null;
  }
  const declared = declaredName(text);
  if (declared !== null) {
    return { expression: type === 'function' || type === 'procedure', from: declared.end };
  }
  return { expression: false, from: 0 };
}

/**
 * The column of `line` from which the engine reads calls and variables, as
 * {@link callAt} reads them: after the keyword of a line that reads an
 * expression, after the name a line declares, from the start of any other
 * line. Null on a comment line and on a line that reads none (`!ifdef`,
 * `!undef`, `!endif` and the like).
 */
export function readsFrom(line: string): number | null {
  const raw = lineType(line);
  if (raw === 'comment' || raw === 'comment-start') {
    return null;
  }
  const cut = withoutInnerComment(line);
  const root = rootOf(cut.text);
  return root === null ? null : columnIn(cut, root.from);
}

/** Columns of the cut line mapped back to the line. */
function inLine(cut: CutLine, start: number, end: number): { start: number; end: number } {
  const from = columnIn(cut, start);
  return { start: from, end: end === start ? from : columnIn(cut, end - 1) + 1 };
}

/** A line without its inner comments, and where it starts reading for calls; null for a comment and a line that reads none. */
function readable(line: string): { cut: CutLine; root: { expression: boolean; from: number } } | null {
  const raw = lineType(line);
  if (raw === 'comment' || raw === 'comment-start') {
    return null;
  }
  const cut = withoutInnerComment(line);
  const root = rootOf(cut.text);
  return root === null ? null : { cut, root };
}

/** A call with its columns mapped back to the line. */
function inLineCall(cut: CutLine, call: Call): Call {
  return {
    ...call,
    ...inLine(cut, call.start, call.end),
    arguments: call.arguments.map((argument) => ({ ...argument, ...inLine(cut, argument.start, argument.end) })),
  };
}

/**
 * The innermost call around column `column` of `line`. `reading` tells how
 * a name declared before the line reads its arguments, or null for a name
 * that is not declared there; a built-in function (`%name`) reads
 * expressions. Null when the cursor is in no call, or in a comment.
 */
export function callAt(line: string, column: number, reading: (name: string) => Reading | null): Call | null {
  const read = readable(line);
  const cursor = read === null ? null : columnOut(read.cut, column);
  if (read === null || cursor === null) {
    return null;
  }
  const call = readCalls(read.cut.text, read.root, cursor, reading).open.at(-1)?.call ?? null;
  if (call === null) {
    return null;
  }
  const last = call.arguments[call.arguments.length - 1];
  if (last !== undefined) {
    last.end = cursor;
  }
  return inLineCall(read.cut, call);
}

/**
 * The call whose name starts at column `start` of `line`, with all its
 * arguments: up to its `)`, or up to the end of the line when it has
 * none. `reading` is as for {@link callAt}. Null when no call starts
 * there.
 */
export function callNamedAt(line: string, start: number, reading: (name: string) => Reading | null): Call | null {
  const read = readable(line);
  const target = read === null ? null : columnOut(read.cut, start);
  if (read === null || target === null) {
    return null;
  }
  const text = read.cut.text;
  const { open, closed } = readCalls(text, read.root, text.length, reading, target);
  const call = closed ?? open.find((frame) => frame.call?.start === target)?.call ?? null;
  if (call === null) {
    return null;
  }
  const last = call.arguments[call.arguments.length - 1];
  if (closed === null && last !== undefined) {
    last.end = text.length;
  }
  return inLineCall(read.cut, call);
}

/**
 * The arguments `call` has, read whole: how many are given by position,
 * `name()` having none, and the names of those given by name.
 */
export function writtenArguments(call: Call, line: string): { count: number; named: string[] } {
  const args = call.arguments;
  const only = args.length === 1 ? args[0] : undefined;
  const none = only !== undefined && only.name === undefined && line.slice(only.start, only.end).trim() === '';
  return {
    count: none ? 0 : args.filter((argument) => argument.name === undefined).length,
    named: args.flatMap((argument) => (argument.name === undefined ? [] : [argument.name])),
  };
}

/**
 * Reads `text` for calls as the engine does, from where `root` starts up
 * to `cursor`: the calls still open there, innermost last. With `target`,
 * it stops at the `)` of the call whose name starts at that column, and
 * gives that call, its last argument ending there.
 */
function readCalls(
  text: string,
  root: { expression: boolean; from: number },
  cursor: number,
  reading: (name: string) => Reading | null,
  target?: number
): { open: Frame[]; closed: Call | null } {
  const stack: Frame[] = root.expression ? [frameOf(text, null, root.from)] : [];
  let pending: Call | null = null;
  for (let at = root.from; at < cursor; at++) {
    const inner = stack[stack.length - 1];
    const inText = inner === undefined || (inner.call !== null && inner.call.reading !== 'quoted');
    if (pending === null && inText) {
      // A call in text: what the line holds, or what an argument read as text holds.
      const end = callNameEnd(text, at);
      const name = end === -1 ? '' : text.slice(at, end);
      const read = end === -1 ? null : name.startsWith('%') ? 'quoted' : reading(name);
      if (read !== null) {
        pending = { name, start: at, end, reading: read, arguments: [] };
      }
    }

    let opened: { start: number; end: number } | null = null;
    for (let index = 0; index < stack.length; index++) {
      const frame = stack[index] as Frame;
      const step =
        (frame.call?.reading ?? 'quoted') === 'quoted' ? readExpression(frame, text, at) : readText(frame, text, at);
      if (step === 'none') {
        continue;
      }
      if (typeof step === 'object') {
        opened = index === stack.length - 1 ? step.open : null;
        continue;
      }
      // The calls within it end with it.
      stack.length = index + 1;
      pending = null;
      opened = null;
      if (frame.call === null) {
        // A stray `,` or `)` of the expression the line reads.
        break;
      }
      const last = frame.call.arguments[frame.call.arguments.length - 1];
      if (step === 'close' && frame.call.start === target) {
        if (last !== undefined) {
          last.end = at;
        }
        return { open: stack, closed: frame.call };
      }
      if (step === 'close') {
        stack.pop();
      } else if (step === 'comma' && last !== undefined) {
        last.end = at;
        const next = argumentFrom(text, at + 1, frame.call.reading);
        frame.call.arguments.push(next.argument);
        frame.valueStart = next.valueStart;
      }
      break;
    }

    if (pending !== null && at === pending.end) {
      stack.push(frameOf(text, pending, at + 1));
      pending = null;
    } else if (opened !== null) {
      // A call within an expression reads its arguments as expressions, whatever its name declares.
      const call: Call = {
        name: text.slice(opened.start, opened.end),
        start: opened.start,
        end: opened.end,
        reading: 'quoted',
        arguments: [],
      };
      stack.push(frameOf(text, call, at + 1));
    }
  }
  return { open: stack, closed: null };
}
