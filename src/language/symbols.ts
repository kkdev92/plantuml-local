/**
 * The diagrams of a PlantUML file and what they declare, for the Outline,
 * the breadcrumbs and Go to Symbol: each diagram, and the participants,
 * classes, components, states, packages and the like that a line declares
 * with its keyword.
 *
 * Only what the text declares is listed, at the line that declares it. A
 * name that only appears in a relation (`A --> B`), what a procedure or an
 * include creates, and the words of a comment or a note are left out. The
 * engine's output names elements too, but only once a drawing succeeds,
 * and including what has no line of this file. One declaration is read per
 * line, in the forms the engine accepts.
 *
 * A declaration whose line ends with `{` holds what its body declares;
 * everything else sits under its diagram. Like the folding, this has no
 * dependency on the `vscode` module. Lines are counted from 0.
 */

import { END, START } from '../core/shape';
import { DECLARED_ID } from '../export/blocks';
import { DATA, PROCEDURE, textEnd } from './folding';

export interface Declaration {
  /** The alias, or the name when there is no alias. */
  name: string;
  /** The name the diagram shows, when an alias stands for it; else ''. */
  detail: string;
  /** `diagram`, or the keyword of the declaration in lower case (`abstract` for `abstract class`). */
  keyword: string;
  /** The line it is declared on, and the last line of its body. */
  start: number;
  end: number;
  children: Declaration[];
}

const DECLARATION =
  /^\s*(?:create\s+)?(abstract\s+class|participant|actor|boundary|control|entity|database|collections|queue|class|interface|enum|annotation|abstract|component|node|package|namespace|state|usecase)\s+(.*)$/i;
/**
 * A name: the text a diagram shows, in quotes or in the brackets of the
 * description diagrams (`(…)`, `[…]`, `:…:`), or an identifier (the last group).
 */
const NAME = /^(?:"([^"]+)"|“([^”]+)”|\(([^()]+)\)|\[([^[\]]+)\]|:([^:]+):|([\p{L}\p{N}_.@]+))/u;
/** What may follow the names: a stereotype, a colour, a body, a description. */
const AFTER_NAMES = /^(?:\s|$|[{<#:;])/;
const AS = /^\s+as\s+/i;

function valueOf(name: RegExpExecArray): string {
  return (name.slice(1).find((group) => group !== undefined) ?? '').trim();
}

/** The name and the alias at the start of `text`, or null. */
function namesOf(text: string): { name: string; detail: string } | null {
  const first = NAME.exec(text);
  if (first === null) {
    return null;
  }
  let rest = text.slice(first[0].length);
  let name = valueOf(first);
  let detail = '';
  const as = AS.exec(rest);
  const second = as === null ? null : NAME.exec(rest.slice(as[0].length));
  if (as !== null && second !== null) {
    rest = rest.slice(as[0].length + second[0].length);
    // The identifier is the alias, on whichever side of `as` it is.
    [name, detail] = second[6] !== undefined ? [valueOf(second), name] : [name, valueOf(second)];
  }
  if (name === '' || !AFTER_NAMES.test(rest)) {
    return null;
  }
  return { name, detail: detail === name ? '' : detail };
}

function declarationAt(line: string, index: number): Declaration | null {
  const declared = DECLARATION.exec(line);
  const names = declared === null ? null : namesOf(declared[2] ?? '');
  if (declared === null || names === null) {
    return null;
  }
  const keyword = (declared[1] ?? '').toLowerCase().replace(/\s+class$/, '');
  return { ...names, keyword, start: index, end: index, children: [] };
}

export function declarations(source: string): Declaration[] {
  const lines = source.split(/\r?\n/);
  const top: Declaration[] = [];
  let diagram: Declaration | null = null;
  // The `{` lines still open, each with the declaration it begins, if any.
  let bodies: (Declaration | null)[] = [];
  let comment = false;
  let text: RegExp | null = null;
  let procedure = false;
  let data = false;

  /** Ends the diagram at `end`, and what is still open in it at `bodyEnd`. */
  const close = (end: number, bodyEnd: number): void => {
    for (const body of bodies) {
      if (body !== null) {
        body.end = bodyEnd;
      }
    }
    if (diagram !== null) {
      diagram.end = end;
    }
    diagram = null;
    bodies = [];
    procedure = false;
    data = false;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (comment) {
      comment = !trimmed.endsWith("'/");
      return;
    }
    if (text !== null) {
      if (text.test(line)) {
        text = null;
        return;
      }
      if (!START.test(line) && !END.test(line)) {
        return;
      }
      text = null;
    }
    if (trimmed.startsWith("/'") && !trimmed.includes("'/")) {
      comment = true;
      return;
    }
    if (trimmed.startsWith("'") || (trimmed.startsWith("/'") && trimmed.endsWith("'/"))) {
      return;
    }

    const start = START.exec(line);
    if (start !== null) {
      close(index - 1, index - 1);
      const kind = `${start[1] ?? '@'}start${start[2] ?? 'uml'}`;
      const id = DECLARED_ID.exec(line)?.[1]?.trim() ?? '';
      diagram = { name: id || kind, detail: id === '' ? '' : kind, keyword: 'diagram', start: index, end: index, children: [] };
      top.push(diagram);
      data = DATA.test(line);
      return;
    }
    if (END.test(line)) {
      close(index, index - 1);
      return;
    }
    if (data) {
      return;
    }
    if (procedure) {
      procedure = !PROCEDURE.close.test(line);
      return;
    }
    if (PROCEDURE.open.test(line)) {
      procedure = true;
      return;
    }
    const ends = textEnd(line);
    if (ends !== null) {
      text = ends;
      return;
    }
    if (/^\s*\}/.test(line)) {
      const body = bodies.pop();
      if (body !== null && body !== undefined) {
        body.end = index;
      }
      return;
    }

    const declared = declarationAt(line, index);
    if (declared !== null) {
      const parent = bodies.filter((body): body is Declaration => body !== null).at(-1) ?? diagram;
      (parent?.children ?? top).push(declared);
    }
    if (/\{\s*$/.test(line)) {
      bodies.push(declared);
    }
  });
  close(lines.length - 1, lines.length - 1);

  return top;
}
