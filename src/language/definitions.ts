import { callNamedAt, goesOnFrom, writtenArguments } from './calls';
import { declarationsOf, lineType } from './declarations';
import { diagramLinesAt, placeIn, readDiagram, type DiagramText } from './macro-help';
import {
  definitionsFor,
  macroOf,
  parameterOf,
  readingOf,
  type DiagramLines,
  type Macro,
  type MacroEntry,
  type Macros,
  type Place,
} from './macros';
import { declarations, type Declaration } from './symbols';

/**
 * Go to Definition: what the name at the cursor stands for, read from the
 * diagram it is in and from what that diagram includes.
 *
 * A procedure, function or macro called, and a variable, are found as the
 * completion finds them (src/language/macros.ts): by the name and, for a
 * call, by the number of arguments it is given and the names of those
 * given by name, among what is defined before the cursor. Where the text
 * is quoted or is the text of a note or a title, and in the path of an
 * include, only a name starting with `$` stands for something, as only
 * those are offered there.
 *
 * Any other name, on a line of the diagram itself, may be the name of what
 * a line declares with its keyword: a participant, a class, a component
 * (src/language/symbols.ts). It is looked for in the diagram the cursor is
 * in alone, before the label of the line (what follows its `:`), and not
 * in quoted text: the same word in a label names nothing.
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

/** The name at the cursor, before what the diagram defines is read. */
export interface NameAt {
  /** The lines of the diagram the cursor is in, and the line of the document each one is. */
  diagram: DiagramLines;
  /** The cursor's line in the document. */
  cursor: number;
  /** The name, and its columns in its line. */
  name: string;
  start: number;
  end: number;
  /** Whether a `(` follows the name: a call. */
  call: boolean;
  /** Whether it may name an element the diagram declares: who it is, and where. */
  element: { name: string; start: number; end: number } | null;
}

/** Where a line starts going on into its label, after a `:`; Infinity for one that does not. */
export function labelStart(code: string): number {
  let depth = 0;
  for (let at = 0; at < code.length; at++) {
    const char = code.charAt(at);
    if (char === '[' || char === '(' || char === '{') {
      depth += 1;
    } else if ((char === ']' || char === ')' || char === '}') && depth > 0) {
      depth -= 1;
    } else if (char === ':' && depth === 0) {
      if (code.charAt(at + 1) === ':') {
        // A class's namespace or member: `A::b`.
        at += 1;
        continue;
      }
      // `:name:` names an actor where the line starts with it, or after `actor`.
      const before = code.slice(0, at).trim();
      const close = code.indexOf(':', at + 1);
      if ((before === '' || /^actor$/i.test(before)) && close > at + 1) {
        at = close;
        continue;
      }
      return at;
    }
  }
  return Infinity;
}

/** A character of an element's name as a declaration writes it (symbols.ts). */
const ELEMENT_CHAR = /^[\p{L}\p{N}_.@]$/u;

/** The name of an element around column `column` of `text`. */
function elementAround(text: string, column: number): { name: string; start: number; end: number } {
  // A name made of two UTF-16 units is read as one.
  const chars = (at: number): string => String.fromCodePoint(text.codePointAt(at) ?? 0);
  let start = column;
  while (start > 0) {
    const before = start >= 2 && /[\uDC00-\uDFFF]/.test(text.charAt(start - 1)) ? start - 2 : start - 1;
    if (!ELEMENT_CHAR.test(chars(before))) {
      break;
    }
    start = before;
  }
  let end = column;
  while (end < text.length && ELEMENT_CHAR.test(chars(end))) {
    end += chars(end).length;
  }
  return { name: text.slice(start, end), start, end };
}

/**
 * The name at column `column` of line `line` of `source`, as Go to
 * Definition reads it: `options` as for {@link macroPlace}. Null where no
 * name stands for anything: outside a diagram, in a comment, on the name a
 * line declares or a parameter it declares, and on a name not starting
 * with `$` in quoted text or the path of an include.
 */
export function nameAt(
  source: string,
  line: number,
  column: number,
  options: { bare: boolean; first: number }
): NameAt | null {
  const found = diagramLinesAt(source, line, options);
  if (found === null) {
    return null;
  }
  const at = nameIn(readDiagram(found.diagram), found.diagram.numbers.indexOf(found.cursor), column);
  return at === null ? null : { ...found, ...at };
}

/** As {@link nameAt}, at column `column` of the line of index `here` of a diagram read by {@link readDiagram}. */
export function nameIn(read: DiagramText, here: number, column: number): Omit<NameAt, 'diagram' | 'cursor'> | null {
  const text = read.diagram.lines[here] ?? '';
  // On the `$` a name starts with, the name is the one it starts.
  const from = text.charAt(column) === '$' && goesOnFrom(text.charAt(column + 1)) ? column + 1 : column;
  const place = placeIn(read, here, from);
  if (place === null || declaresParameterAt(text, place.start)) {
    return null;
  }
  const name = text.slice(place.start, place.end);
  if (name === '' || (place.dollarOnly && !name.startsWith('$'))) {
    return null;
  }
  const typed = read.typed[here];
  const around = elementAround(text, column);
  const element =
    !place.dollarOnly &&
    !name.startsWith('$') &&
    lineType(text) === 'plain' &&
    around.name !== '' &&
    typed !== undefined &&
    around.end <= labelStart(typed.code)
      ? around
      : null;
  return { name, start: place.start, end: place.end, call: place.callOpen, element };
}

/** Whether a parameter of what the line `text` declares starts at column `start`: a name declared, as the name the line declares is. */
function declaresParameterAt(text: string, start: number): boolean {
  return declarationsOf([text], [0]).some(
    (declaration) =>
      declaration.type === 'definition' &&
      (declaration.parameters ?? []).some((parameter) => parameterAt(text, declaration.end, parameter.name) === start)
  );
}

/** A name in a line of a diagram, as {@link nameIn} reads it there, and the index of its line. */
export type Occurrence = Omit<NameAt, 'diagram' | 'cursor'> & { index: number };

/**
 * Each place in the lines of `read` where {@link nameIn} reads `name`, as
 * a call, a variable or an element: written whole, from where it starts.
 * The name and the parameters a line declares are not one, nor is anything
 * in a comment or, but for a name that starts with `$`, in quoted text; a
 * name in a label is one, though not as an element.
 */
export function occurrencesIn(read: DiagramText, name: string): Occurrence[] {
  const found: Occurrence[] = [];
  read.diagram.lines.forEach((text, index) => {
    for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
      const named = nameIn(read, index, at);
      if (
        named !== null &&
        ((named.name === name && named.start === at) || (named.element?.name === name && named.element.start === at))
      ) {
        found.push({ ...named, index });
      }
    }
  });
  return found;
}

/**
 * The definition whose name, or one of whose parameters, the line of index
 * `here` of `diagram` declares at column `column`, as the walk of what is
 * defined takes it at `place` (src/language/macros.ts); null elsewhere.
 */
export function declaredAt(diagram: DiagramLines, here: number, column: number, place: Place): Macro | null {
  const line = diagram.numbers[here];
  const text = diagram.lines[here];
  if (line === undefined || text === undefined) {
    return null;
  }
  for (const declaration of declarationsOf(diagram.lines, diagram.numbers)) {
    if (declaration.type !== 'definition' || declaration.line !== line) {
      continue;
    }
    if (column >= declaration.start && column <= declaration.end) {
      return macroOf(declaration, place);
    }
    for (const parameter of declaration.parameters ?? []) {
      const at = parameterAt(text, declaration.end, parameter.name);
      if (at !== -1 && column >= at && column <= at + parameter.name.length) {
        return parameterOf(declaration, parameter, place);
      }
    }
  }
  return null;
}

/** The name of the element a line of `diagram` declares with its keyword at column `column` of the line of index `here`; null elsewhere. */
export function elementDeclaredAt(diagram: DiagramLines, here: number, column: number): string | null {
  let found: string | null = null;
  const visit = (declared: Declaration): void => {
    if (declared.start === here && declared.at !== undefined && column >= declared.at.start && column <= declared.at.end) {
      found = declared.name;
    }
    declared.children.forEach(visit);
  };
  declarations(diagram.lines.join('\n')).forEach(visit);
  return found;
}

/**
 * The definitions `at` stands for, among `macros` (those of its diagram
 * where the cursor is): those of a call by the arguments it is given, read
 * whole on its line `text`, as the engine picks one; those of a variable by
 * its name. Null when nothing defines it.
 */
export function definitionsOfName(
  macros: Macros,
  at: Pick<NameAt, 'name' | 'start' | 'call'>,
  text: string
): MacroEntry | null {
  if (at.call) {
    const call = callNamedAt(text, at.start, (name) => readingOf(macros, name));
    if (call === null) {
      return null;
    }
    const { count, named } = writtenArguments(call, text);
    return definitionsFor(macros, at.name, count, named);
  }
  return macros.variables.get(at.name) ?? null;
}

/**
 * The column of parameter `name` in the line `text` that declares it, after
 * column `from` (the end of the name the line declares); -1 when it is not
 * there.
 */
export function parameterAt(text: string, from: number, name: string): number {
  for (let at = text.indexOf(name, from); at !== -1; at = text.indexOf(name, at + 1)) {
    if (!goesOnFrom(text.charAt(at + name.length)) && (at === 0 || !goesOnFrom(text.charAt(at - 1)))) {
      return at;
    }
  }
  return -1;
}

/** An element a line of a diagram declares: the line of the document, the columns of its name, and the last line of its body. */
export interface ElementDefinition {
  line: number;
  start: number;
  end: number;
  last: number;
}

/** What the lines of `diagram` declare with a keyword under `name`, in order. */
export function elementsNamed(diagram: DiagramLines, name: string): ElementDefinition[] {
  const found: ElementDefinition[] = [];
  const visit = (declared: Declaration): void => {
    if (declared.name === name && declared.at !== undefined) {
      found.push({
        line: diagram.numbers[declared.start] ?? declared.start,
        ...declared.at,
        last: diagram.numbers[declared.end] ?? declared.end,
      });
    }
    declared.children.forEach(visit);
  };
  declarations(diagram.lines.join('\n')).forEach(visit);
  return found;
}

/**
 * The bundled library's file the include on line `text` names, when the
 * cursor at `column` is on its path: `<C4/C4_Context>` names file
 * `c4_context` of library `c4`, as the engine looks it up, in lower case.
 * Null on any other line, and for a path put together when the diagram is
 * drawn.
 */
export function libraryIncludeAt(text: string, column: number): { library: string; key: string; start: number; end: number } | null {
  const inclusion = declarationsOf([text], [0]).find((declaration) => declaration.type === 'include');
  if (
    inclusion?.type !== 'include' ||
    inclusion.directive === 'includesub' ||
    column < inclusion.start ||
    column > inclusion.end ||
    !inclusion.target.startsWith('<') ||
    !inclusion.target.endsWith('>') ||
    /[$%]/.test(inclusion.target)
  ) {
    return null;
  }
  const inner = inclusion.target.slice(1, -1).toLowerCase();
  const slash = inner.indexOf('/');
  if (slash === -1) {
    return null;
  }
  return { library: inner.slice(0, slash), key: inner.slice(slash + 1), start: inclusion.start, end: inclusion.end };
}
