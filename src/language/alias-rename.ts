import { RENAME_LIMITS } from '../core/constants';
import { splitLines } from '../core/lines';
import { blockAtLine, findPlantUmlBlocks, type PlantUmlBlock } from '../export/blocks';

/**
 * Renaming the alias of a sequence diagram's participant in a Markdown
 * block: the alias a declaration gives it with `as`, and every place the
 * diagram names it, in one edit.
 *
 * A rename that misses a place splits the participant in two, and one that
 * changes a label changes what the diagram shows; neither shows as an error.
 * So the diagram is read whole, and the rename goes ahead only when each of
 * its lines is of a form read here as the bundled engine reads it. Its
 * sequence diagram tries its commands on a line in a fixed order and takes
 * the first that reads it (SequenceDiagramFactory), so the forms are tried
 * in that order, and a line that an earlier command of the engine could read
 * is refused rather than read as a later one: `return x-> C` is a message
 * from a participant named `return`. A line of any other form refuses the
 * whole diagram, whether it names the participant or not, as what it names
 * cannot be told. test/integration/worker.test.ts draws the forms with the
 * bundled engine, so a new engine that reads them otherwise fails it.
 *
 * The forms: a declaration with one of the eight roles, as
 * `participant "Full" as A`, `participant A as "Full"` or
 * `participant Full as A`, with an `order`; a message between two names with
 * one of eight arrows, and a label; `activate`, `deactivate`, `create` and
 * `destroy` of a name; a note on one participant or over two, on one line
 * or several; a reference over participants, on one line or several; the
 * groups, with their `else` and `end`; and lines that name no participant,
 * left as they are: a title, a skinparam, a style, `return`, a divider, a
 * delay, a space, `autonumber`, comments and blank lines.
 *
 * Only a closed block holding one diagram, between `@startuml` and
 * `@enduml`, is read, and none of its lines may be one the preprocessor
 * reads: what an include or a definition brings in cannot be seen here. Only
 * an alias of ASCII letters, digits and `_` that one declaration gives with
 * `as` is renamed; a name used without one is also the text the diagram
 * shows.
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

/** Where a name is in the document: its line, and its columns in UTF-16 code units. */
export interface NamePlace {
  line: number;
  start: number;
  end: number;
}

/**
 * Why the participant's name at the cursor is not renamed: the block has no
 * closing fence; it holds no diagram alone between `@startuml` and
 * `@enduml`; one of its lines is not what the diagram is given; a line, on
 * `line`, is of a form not read here, is read by the preprocessor, or
 * starts a note, a reference, a style or a group that is not closed; or the
 * name is not an alias one declaration gives with `as`, is not of ASCII
 * letters, digits and `_`, or is used in more places than are renamed.
 */
export type RenameRefusal =
  | { reason: 'unclosed' | 'bounds' | 'mapping' }
  | { reason: 'line' | 'preprocessor' | 'open'; line: number }
  | { reason: 'undeclared' | 'without-as' | 'declared-twice' | 'not-ascii' | 'too-many'; name: string };

/** An alias that can be renamed: its place at the cursor, every place the diagram names it, and the names of all the participants. */
export interface RenameTarget {
  alias: string;
  at: NamePlace;
  places: NamePlace[];
  names: ReadonlySet<string>;
}

/** Why `name` is refused as the new alias: not a name an alias can take, too long, a keyword, or a participant's name already. */
export interface NewNameRefusal {
  reason: 'invalid' | 'too-long' | 'reserved' | 'taken';
  name: string;
}

/** A name on a line, with its columns in the line, and whether the line declares it, with `as` or without. */
interface Slot {
  name: string;
  start: number;
  end: number;
  declares?: 'as' | 'plain';
}

/** A name on a line of the document. */
interface PlacedName extends NamePlace {
  name: string;
  declares?: 'as' | 'plain';
}

type Body = 'note' | 'ref' | 'style';

/** What a line is read as. */
type Reading =
  | { kind: 'other' }
  | { kind: 'names'; slots: Slot[] }
  | { kind: 'body'; body: Body; slots: Slot[] }
  | { kind: 'group'; group: 'open' | 'else' | 'end' }
  | { kind: 'refused' };

/** `word` in any case of its letters, as the engine matches its keywords: in ASCII only. */
function kw(word: string): string {
  return [...word].map((char) => (/[a-z]/.test(char) ? `[${char}${char.toUpperCase()}]` : char)).join('');
}

/** One of `list`, captured. */
const oneOf = (...list: string[]): string => `(${list.map(kw).join('|')})`;

/**
 * A participant's name, as the engine's JavaScript build reads one: letters,
 * ASCII digits, `_`, `.` and `@` (`%pLN` is `\p{L}[0-9]` there, Pattern2).
 */
const NAME = String.raw`[\p{L}0-9_.@]+`;
/**
 * The engine's whitespace inside a line (`%s`): the control characters it
 * also takes are refused on any line read here.
 */
const SPACE = String.raw`[ \t\u00A0]`;
/** A quoted display name: the engine's quotes (`%g`) are not taken inside it. */
const QUOTED = String.raw`"[^"\u201C\u201D\uE000-\uF8FF]+"`;
/** The `order` a declaration can end with. */
const ORDER = String.raw`(?:${SPACE}+${kw('order')}${SPACE}+-?\d{1,7})?`;

const TITLE = new RegExp(
  String.raw`^${kw('title')}(?:${SPACE}*:${SPACE}*|${SPACE}+)(?:["\u201C\u201D].*["\u201C\u201D]|.*[\p{L}0-9_.].*)$`,
  'u'
);
const SKINPARAM = new RegExp(String.raw`^${kw('skinparam')}${SPACE}+[\w.]*(?:<<[^<>]*>>)?[\w.]*${SPACE}+[^{}]*$`, 'u');
const STYLE_START = new RegExp(`^<${kw('style')}>$`, 'u');
const STYLE_LINE = new RegExp(String.raw`^<${kw('style')}>[-#.\w \t\u00A0;:{}]+</${kw('style')}>$`, 'u');
const ACTION = new RegExp(`^${oneOf('activate', 'deactivate', 'destroy', 'create')}${SPACE}+(${NAME})$`, 'du');
const ROLE = oneOf('participant', 'actor', 'boundary', 'control', 'entity', 'queue', 'database', 'collections');
/** `participant "Full" as A`, or `participant A`. */
const DECLARATION = new RegExp(`^${ROLE}${SPACE}+(?:(${QUOTED})${SPACE}+${kw('as')}${SPACE}+)?(${NAME})${ORDER}$`, 'du');
/** `participant A as "Full"`. */
const DECLARATION_FULL_AFTER = new RegExp(`^${ROLE}${SPACE}+(${NAME})${SPACE}+${kw('as')}${SPACE}+${QUOTED}${ORDER}$`, 'du');
/** `participant Full as A`: the first word is only shown. */
const DECLARATION_WORD_FULL = new RegExp(`^${ROLE}${SPACE}+${NAME}${SPACE}+${kw('as')}${SPACE}+(${NAME})${ORDER}$`, 'du');
/**
 * What may start a message (CommandArrow, and the message out of the
 * diagram, CommandExoArrowRight): a name, maybe given a display name, an
 * anchor, an arrow's start, then its dashes or a style in brackets before
 * them. Wider than the engine's: a line it holds that is not a message read
 * here is refused.
 */
const ARROWISH = new RegExp(
  String.raw`^${NAME}(?:${SPACE}+${kw('as')}${SPACE}*["\u201C\u201D].*?["\u201C\u201D])?(?:\{[^}]*\}${SPACE}*)?${SPACE}*` +
    String.raw`(?:${SPACE}[oxOX]|(?:${SPACE}[oxOX]|\(\d+\))?<<?_?|(?:${SPACE}[oxOX])?\/\/?|(?:${SPACE}[oxOX])?\\\\?)?` +
    String.raw`(?:-|\[[^\]]*\]-)`,
  'u'
);
/** A message between two names, with one of `->`, `-->`, `<-`, `<--`, `->>`, `-->>`, `<<-` and `<<--`, and a label. */
const MESSAGE = new RegExp(`^(${NAME})${SPACE}*(?:<<?--?|--?>>?)${SPACE}*(${NAME})${SPACE}*(?::.*)?$`, 'du');
const SIDE = `(?:${kw('left')}|${kw('right')}|${kw('over')})`;
const NOTE = new RegExp(`^${kw('note')}${SPACE}*${SIDE}${SPACE}+(?:${kw('of')}${SPACE})?(${NAME})${SPACE}*:.*$`, 'du');
const NOTE_OVER_TWO = new RegExp(
  `^${kw('note')}${SPACE}*${kw('over')}${SPACE}+(${NAME})${SPACE}*,${SPACE}*(${NAME})${SPACE}*:.*$`,
  'du'
);
const NOTE_START = new RegExp(`^${kw('note')}${SPACE}*${SIDE}${SPACE}+(?:${kw('of')}${SPACE}+)?(${NAME})$`, 'du');
const NOTE_OVER_TWO_START = new RegExp(
  `^${kw('note')}${SPACE}*${kw('over')}${SPACE}+(${NAME})${SPACE}*,${SPACE}*(${NAME})$`,
  'du'
);
const GROUP = new RegExp(
  String.raw`^${oneOf('opt', 'alt', 'loop', 'par', 'par2', 'break', 'critical', 'else', 'end', 'also', 'group', 'partition')}` +
    String.raw`(?:(?<!${kw('else')})(?<!${kw('also')})(?<!${kw('end')})#\w+)?(?:${SPACE}+#\w+)?(?:${SPACE}+(.*?))?$`,
  'u'
);
/** `A ++`: an activation (CommandActivate2), tried before `return` and what follows it. */
const ACTIVATION = new RegExp(String.raw`^${NAME}${SPACE}*(?:\+\+|--)${SPACE}*(?:#\w+)?$`, 'u');
const RETURN = new RegExp(`^${kw('return')}(?:${SPACE}+.*)?$`, 'u');
const PARTS = `${NAME}(?:${SPACE}*,${SPACE}*${NAME})*`;
const REF = new RegExp(`^${kw('ref')}${SPACE}+${kw('over')}${SPACE}+(${PARTS})${SPACE}*:.*$`, 'du');
const REF_START = new RegExp(`^${kw('ref')}${SPACE}+${kw('over')}${SPACE}+(${PARTS})$`, 'du');
const DIVIDER = /^==.*==$/u;
const SPACING = /^\|\|\d*\|+$/;
const DELAY = /^(?:\.{3}|\u2026)(?:.*(?:\.{3}|\u2026))?$/u;
const FORMAT = String.raw`"[^"\u201C\u201D\uE000-\uF8FF]+"`;
const AUTONUMBER: readonly RegExp[] = [
  new RegExp(
    String.raw`^${kw('autonumber')}${SPACE}*(?:\d(?:(?:[^\p{L}0-9 \t\u00A0]+|\d+)*\d)?)?(?:${SPACE}+\d+)?(?:${SPACE}+${FORMAT})?$`,
    'u'
  ),
  new RegExp(`^${kw('autonumber')}${SPACE}+${kw('stop')}$`, 'u'),
  new RegExp(String.raw`^${kw('autonumber')}${SPACE}+${kw('resume')}(?:${SPACE}+\d+)?(?:${SPACE}+${FORMAT})?$`, 'u'),
  new RegExp(`^${kw('autonumber')}${SPACE}+${kw('inc')}(?:${SPACE}+[A-Za-z])?$`, 'u'),
];

/** The line that ends a note, a reference or a style that spans lines. */
const BODY_END: Record<Body, RegExp> = {
  note: new RegExp(`^${kw('end')}${SPACE}?(?:${kw('note')}|${kw('hnote')}|${kw('rnote')})$`, 'u'),
  ref: new RegExp(`^${kw('end')}${SPACE}?(?:${kw('ref')})?$`, 'u'),
  style: new RegExp(`^</?${kw('style')}>$`, 'u'),
};

/** The first word of a line: what the engine's keywords are matched against. */
const FIRST_WORD = /^[\p{L}0-9_.@]*/u;
/**
 * First words of lines the engine reads before a message, as a title, a
 * frame, a legend, a skin or the scale, and does not read here. A footer or
 * a header can have its place written before it with no space between
 * (CommandFooter, CommandHeader): `centerfooter -> B : x` is a footer.
 */
const BEFORE_MESSAGES: ReadonlySet<string> = new Set([
  'title',
  'mainframe',
  'caption',
  'legend',
  'footer',
  'header',
  ...['left', 'right', 'center'].flatMap((place) => [`${place}footer`, `${place}header`]),
  'skinparamlocked',
  'skin',
  'minwidth',
  'page',
  'rotate',
  'sprite',
  'scale',
  'hide',
  'show',
]);
const ACTIONS: ReadonlySet<string> = new Set(['activate', 'deactivate', 'destroy', 'create']);
const ROLES: ReadonlySet<string> = new Set([
  'participant',
  'actor',
  'boundary',
  'control',
  'entity',
  'queue',
  'database',
  'collections',
]);

/**
 * Words a new alias cannot be, in any case: the keywords of the lines read
 * here, and the first words of the lines the engine reads before a message,
 * which a message from a participant of that name would turn into.
 */
const RESERVED: ReadonlySet<string> = new Set([
  ...ROLES,
  ...ACTIONS,
  ...BEFORE_MESSAGES,
  'as',
  'note',
  'ref',
  'left',
  'right',
  'of',
  'over',
  'order',
  'alt',
  'opt',
  'loop',
  'par',
  'group',
  'critical',
  'break',
  'else',
  'end',
  'autonumber',
  'skinparam',
]);

/** An alias that can be renamed, and a name it can be given. */
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The line that starts the diagram, and the one that ends it, trimmed. */
const START_LINE = /^@startuml(?:\(id=[^)]*\))?$/;
const END_LINE = /^@enduml$/;
/** Any line that starts or ends a diagram. */
const BOUNDARY = /^[@\\](?:start|end)/i;

/** A call the preprocessor makes: a built-in function, or a procedure or function of the diagram's. */
const PREPROCESSOR_CALL = /[%$][A-Za-z_][A-Za-z0-9_]*[ \t]*\(/;
/**
 * What a line read here may not hold: an embedded diagram, a comment that
 * does not take its whole line, and the three marks the engine can split a
 * line at.
 */
const UNREAD = /\{\{|\/'|'\/|"""|'''|!!!/;

/** The engine's single-line comments (TLineType): a quote first, or a block comment that takes its whole line. */
const COMMENT = new RegExp(`^${SPACE}*'`, 'u');
const BLOCK_COMMENT = new RegExp(`^${SPACE}*/'.*'/${SPACE}*$`, 'u');
const BLOCK_COMMENT_START = new RegExp(`^${SPACE}*/'`, 'u');

/** `text` with its ASCII letters in lower case. */
const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** Whether the engine trims `code` from the ends of a line (StringUtils.trin): a control character, a space or a no-break space. */
const trimmable = (code: number): boolean => code <= 0x20 || code === 0xa0;

/** Where `text` starts and ends without what the engine trims from its ends. */
function trimmedSpan(text: string): [number, number] {
  let start = 0;
  let end = text.length;
  while (start < end && trimmable(text.charCodeAt(start))) {
    start++;
  }
  while (end > start && trimmable(text.charCodeAt(end - 1))) {
    end--;
  }
  return [start, end];
}

/** `text` as the engine trims it. */
function trimmed(text: string): string {
  const [start, end] = trimmedSpan(text);
  return text.slice(start, end);
}

/** Whether `text` holds a control character other than a tab, or a line or paragraph separator, which the engine reads otherwise. */
function hasControl(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if ((code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

/** The name captured as group `group` of `match`, at its columns. */
function slot(match: RegExpExecArray, group: number, declares?: 'as' | 'plain'): Slot {
  const [start, end] = match.indices?.[group] ?? [0, 0];
  return { name: match[group] ?? '', start, end, ...(declares === undefined ? {} : { declares }) };
}

/** The names of a list of participants captured as group `group`, at their columns. */
function listed(match: RegExpExecArray, group: number): Slot[] {
  const [from] = match.indices?.[group] ?? [0, 0];
  return [...(match[group] ?? '').matchAll(new RegExp(NAME, 'gu'))].map((found) => ({
    name: found[0],
    start: from + found.index,
    end: from + found.index + found[0].length,
  }));
}

const OTHER: Reading = { kind: 'other' };
const REFUSED: Reading = { kind: 'refused' };
const names = (...slots: Slot[]): Reading => ({ kind: 'names', slots });
const body = (kind: Body, ...slots: Slot[]): Reading => ({ kind: 'body', body: kind, slots });

/** What `text`, a trimmed line that is not blank, a comment or in a body, is read as, in the order the engine tries its commands. */
function readLine(text: string): Reading {
  const first = asciiLower(FIRST_WORD.exec(text)?.[0] ?? '');
  if (TITLE.test(text)) {
    return OTHER;
  }
  if (BEFORE_MESSAGES.has(first)) {
    return REFUSED;
  }
  if (first === 'skinparam') {
    return SKINPARAM.test(text) ? OTHER : REFUSED;
  }
  if (text.startsWith('<')) {
    return STYLE_START.test(text) ? body('style') : STYLE_LINE.test(text) ? OTHER : REFUSED;
  }
  if (ACTIONS.has(first)) {
    const action = ACTION.exec(text);
    return action === null ? REFUSED : names(slot(action, 2));
  }
  if (ROLES.has(first)) {
    const declared = DECLARATION.exec(text);
    if (declared !== null) {
      return names(slot(declared, 3, declared[2] === undefined ? 'plain' : 'as'));
    }
    const declaredFull = DECLARATION_FULL_AFTER.exec(text) ?? DECLARATION_WORD_FULL.exec(text);
    return declaredFull === null ? REFUSED : names(slot(declaredFull, 2, 'as'));
  }
  if (first !== '') {
    if (ARROWISH.test(text)) {
      const message = MESSAGE.exec(text);
      return message === null ? REFUSED : names(slot(message, 1), slot(message, 2));
    }
  } else if (!text.startsWith('==') && !text.startsWith('||') && !text.startsWith('\u2026')) {
    return REFUSED;
  }
  const note = NOTE.exec(text);
  if (note !== null) {
    return names(slot(note, 1));
  }
  const noteOverTwo = NOTE_OVER_TWO.exec(text);
  if (noteOverTwo !== null) {
    return names(slot(noteOverTwo, 1), slot(noteOverTwo, 2));
  }
  const group = GROUP.exec(text);
  if (group !== null) {
    const type = asciiLower(group[1] ?? '');
    if (type === 'par2' || type === 'also' || type === 'partition') {
      return REFUSED;
    }
    if (type === 'end') {
      // `end box` closes a box, which is not read here.
      return asciiLower(group[2] ?? '') === 'box' ? REFUSED : { kind: 'group', group: 'end' };
    }
    return { kind: 'group', group: type === 'else' ? 'else' : 'open' };
  }
  if (ACTIVATION.test(text)) {
    return REFUSED;
  }
  if (RETURN.test(text)) {
    return OTHER;
  }
  const noteStart = NOTE_START.exec(text);
  if (noteStart !== null) {
    return body('note', slot(noteStart, 1));
  }
  const noteOverTwoStart = NOTE_OVER_TWO_START.exec(text);
  if (noteOverTwoStart !== null) {
    return body('note', slot(noteOverTwoStart, 1), slot(noteOverTwoStart, 2));
  }
  if (DIVIDER.test(text) || SPACING.test(text)) {
    return OTHER;
  }
  const ref = REF.exec(text);
  if (ref !== null) {
    return names(...listed(ref, 1));
  }
  const refStart = REF_START.exec(text);
  if (refStart !== null) {
    return body('ref', ...listed(refStart, 1));
  }
  return AUTONUMBER.some((form) => form.test(text)) || DELAY.test(text) ? OTHER : REFUSED;
}

/** Why the engine's reading of `text`, a line of the diagram that is not a comment, cannot be followed here; null when it can. */
function lineRefusal(text: string): 'line' | 'preprocessor' | 'bounds' | null {
  if (text.length > RENAME_LIMITS.lineLength || hasControl(text)) {
    return 'line';
  }
  const line = trimmed(text);
  if (line.startsWith('!') || PREPROCESSOR_CALL.test(line)) {
    return 'preprocessor';
  }
  if (BOUNDARY.test(line)) {
    return 'bounds';
  }
  return line.endsWith('\\') || UNREAD.test(line) ? 'line' : null;
}

/** A diagram as read here: the names on its lines, the lines not read here, and the first reason it cannot be renamed in. */
interface DiagramReading {
  places: PlacedName[];
  refusedLines: ReadonlySet<number>;
  problem: RenameRefusal | null;
}

/** Reads the diagram of `block`, a Markdown block of the document `lines`. */
function readDiagram(lines: readonly string[], block: PlantUmlBlock): DiagramReading {
  const first = block.openLine + 1;
  const last = block.closed ? block.closeLine - 1 : block.closeLine;
  // Each line of the block without the quote markers and indentation of the
  // container it is in, and where it starts in its line of the document.
  const code: { line: number; text: string; offset: number }[] = [];
  for (let line = first; line <= last; line++) {
    const whole = lines[line] ?? '';
    const offset = whole.startsWith(block.container)
      ? block.container.length
      : block.container.startsWith(whole)
        ? whole.length
        : 0;
    code.push({ line, text: whole.slice(offset), offset });
  }

  const problems: RenameRefusal[] = [];
  if (!block.closed) {
    problems.push({ reason: 'unclosed' });
  }
  // The lines read here must be what the diagram is given, line by line.
  const source = splitLines(block.source);
  const mapped = code.every(({ line, text }) => {
    const index = line - block.sourceLine;
    return trimmed(text) === trimmed(index >= 0 && index < source.length ? (source[index] ?? '') : '');
  });
  if (!mapped) {
    problems.push({ reason: 'mapping' });
  }

  // Comments, which the engine takes out before it reads the lines, in a
  // note's text too: a block comment runs to the line that ends with `'/`.
  let inComment = false;
  const comment = code.map(({ text }) => {
    if (inComment) {
      inComment = !trimmed(text).endsWith("'/");
      return true;
    }
    if (COMMENT.test(text) || BLOCK_COMMENT.test(text)) {
      return true;
    }
    if (BLOCK_COMMENT_START.test(text) && !text.includes("'/")) {
      inComment = true;
      return true;
    }
    return false;
  });

  // The diagram: between its first line and its last that are not blank.
  const filled = code.map(({ text }) => trimmed(text) !== '');
  const top = filled.indexOf(true);
  const bottom = filled.lastIndexOf(true);
  const bounded =
    top !== -1 &&
    bottom > top &&
    comment[top] === false &&
    comment[bottom] === false &&
    START_LINE.test(trimmed(code[top]?.text ?? '')) &&
    END_LINE.test(trimmed(code[bottom]?.text ?? ''));
  if (!bounded) {
    problems.push({ reason: 'bounds' });
  }

  const places: PlacedName[] = [];
  const refusedLines = new Set<number>();
  const refuse = (reason: 'line' | 'preprocessor' | 'bounds', line: number): void => {
    refusedLines.add(line);
    problems.push(reason === 'bounds' ? { reason } : { reason, line });
  };
  let open: { body: Body; line: number } | null = null;
  const groups: number[] = [];
  const from = bounded ? top + 1 : 0;
  const to = bounded ? bottom - 1 : code.length - 1;
  for (let index = from; index <= to; index++) {
    const entry = code[index];
    if (entry === undefined || comment[index] === true) {
      continue;
    }
    const { line, text, offset } = entry;
    const refusal = lineRefusal(text);
    if (refusal !== null) {
      refuse(refusal, line);
      continue;
    }
    const [start, end] = trimmedSpan(text);
    const read = text.slice(start, end);
    if (open !== null) {
      // The text of a note, a reference or a style, up to its end line.
      if (BODY_END[open.body].test(read)) {
        open = null;
      }
      continue;
    }
    if (read === '') {
      continue;
    }
    const reading = readLine(read);
    if (reading.kind === 'refused') {
      refuse('line', line);
      continue;
    }
    if (reading.kind === 'group') {
      if (reading.group === 'open') {
        groups.push(line);
      } else if (groups.length === 0) {
        refuse('line', line);
      } else if (reading.group === 'end') {
        groups.pop();
      }
      continue;
    }
    if (reading.kind === 'body') {
      open = { body: reading.body, line };
    }
    if (reading.kind === 'names' || reading.kind === 'body') {
      for (const found of reading.slots) {
        places.push({
          line,
          start: offset + start + found.start,
          end: offset + start + found.end,
          name: found.name,
          ...(found.declares === undefined ? {} : { declares: found.declares }),
        });
      }
    }
  }
  if (open !== null) {
    problems.push({ reason: 'open', line: open.line });
  }
  const unclosedGroup = groups[0];
  if (unclosedGroup !== undefined) {
    problems.push({ reason: 'open', line: unclosedGroup });
  }
  return { places, refusedLines, problem: problems[0] ?? null };
}

/** The name around `character` on `text`, a line not read here, before any colon: null on none. */
function nameAround(text: string, character: number): string | null {
  const colon = text.indexOf(':');
  for (const found of text.matchAll(new RegExp(NAME, 'gu'))) {
    const start = found.index;
    const end = start + found[0].length;
    if (colon !== -1 && start > colon) {
      return null;
    }
    if (character >= start && character <= end) {
      return found[0];
    }
  }
  return null;
}

/**
 * What the cursor at `character` of `line` in the Markdown document `text`
 * is on: an alias that can be renamed; a participant's name that cannot,
 * with the reason; or null, for anything else — what the cursor is on is
 * then left to the other renames of the document.
 */
export function renameAt(text: string, line: number, character: number): RenameTarget | { refused: RenameRefusal } | null {
  const block = blockAtLine(findPlantUmlBlocks(text), line);
  if (block === null || line === block.openLine || (block.closed && line === block.closeLine)) {
    return null;
  }
  const lines = splitLines(text);
  const diagram = readDiagram(lines, block);
  const here = diagram.places.find((place) => place.line === line && character >= place.start && character <= place.end);
  let name = here?.name;
  if (name === undefined) {
    // On a line not read here, a name the other lines give a participant
    // is taken for that participant.
    const token = diagram.refusedLines.has(line) ? nameAround(lines[line] ?? '', character) : null;
    if (token === null || !diagram.places.some((place) => place.name === token)) {
      return null;
    }
    name = token;
  }
  if (diagram.problem !== null) {
    return { refused: diagram.problem };
  }
  if (here === undefined) {
    return null;
  }
  const declarations = diagram.places.filter((place) => place.name === name && place.declares !== undefined);
  const [declaration] = declarations;
  if (declaration === undefined) {
    return { refused: { reason: 'undeclared', name } };
  }
  if (declarations.length > 1) {
    return { refused: { reason: 'declared-twice', name } };
  }
  if (declaration.declares !== 'as') {
    return { refused: { reason: 'without-as', name } };
  }
  if (!ALIAS.test(name) || name.length > RENAME_LIMITS.nameLength) {
    return { refused: { reason: 'not-ascii', name } };
  }
  const places = diagram.places.filter((place) => place.name === name);
  if (places.length > RENAME_LIMITS.places) {
    return { refused: { reason: 'too-many', name } };
  }
  // Each place holds the name in the document, and none overlaps another.
  const sorted = [...places].sort((a, b) => a.line - b.line || a.start - b.start);
  const exact = sorted.every(
    (place, index) =>
      lines[place.line]?.slice(place.start, place.end) === name &&
      (index === 0 || sorted[index - 1]?.line !== place.line || (sorted[index - 1]?.end ?? 0) <= place.start)
  );
  if (!exact) {
    return { refused: { reason: 'mapping' } };
  }
  return {
    alias: name,
    at: { line: here.line, start: here.start, end: here.end },
    places: sorted.map((place) => ({ line: place.line, start: place.start, end: place.end })),
    names: new Set(diagram.places.map((place) => place.name)),
  };
}

/** Why `name` cannot be the new name of `target`'s alias; null when it can, or is the alias itself. */
export function newNameRefusal(target: RenameTarget, name: string): NewNameRefusal | null {
  if (name === target.alias) {
    return null;
  }
  if (name.length > RENAME_LIMITS.nameLength) {
    return { reason: 'too-long', name };
  }
  if (!ALIAS.test(name)) {
    return { reason: 'invalid', name };
  }
  if (RESERVED.has(asciiLower(name))) {
    return { reason: 'reserved', name };
  }
  return target.names.has(name) ? { reason: 'taken', name } : null;
}
