import { forEachCodeLine } from '../core/shape';
import { PROCEDURE } from '../language/folding';

/**
 * Where the local includes of a diagram's text are written, and the path
 * each asks for, read the way the engine reads an include line.
 *
 * The engine takes `!include`, `!include_once` and `!include_many`, in
 * lower case, at the start of a line, and drops a block comment that ends
 * the line. The rest of the line, trimmed, up to its last `!` (a selector
 * follows it), is the path it asks the file loader for, spaces and quotes
 * included. A library (`<…>`) and a URL are not files of the workspace.
 *
 * Before asking, the engine puts the values of variables and functions in
 * the path, and those of `!define` too: `!include common.puml` asks for
 * `other.puml` once `!common = "other"` has run. A path holding `$` or `%`,
 * or a word the text defines, is therefore not taken as written; nor is
 * one written in a procedure or a function, which is looked for next to the
 * file that calls it. Words defined in an included file are not seen.
 *
 * Lines and columns count from 0. Like the completion, this has no
 * dependency on the `vscode` module.
 */

/** A local include written in a diagram's text. */
export interface IncludeDirective {
  line: number;
  /** Columns of the path in its line: from `start` up to `end`. */
  start: number;
  end: number;
  /** The path as written. */
  path: string;
  /** Whether the engine asks for `path` as written. */
  literal: boolean;
}

/**
 * An include line, up to where its path begins: the engine skips what Java
 * counts as white space after the directive.
 */
const DIRECTIVE =
  /^([ \t]*!include(?:_once|_many)?[\t-\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+)([\s\S]*)$/;
/** What the engine trims from the end of a line. */
const TRAILING = /[\t-\r \u00a0]+$/;
/** A block comment that ends a line, by its last `'/`. */
const END_COMMENT = /'\/[\t-\r ]*$/;

/** Words the text defines, which the engine puts the value of in place of the same word in a path. */
const DEFINITIONS: readonly RegExp[] = [
  /^\s*!(?:(?:global|local)\s+)?([\p{L}_][\p{L}\p{N}_]*)\s*\??=/iu,
  /^\s*!define(?:long)?\s+([\p{L}_][\p{L}\p{N}_]*)/iu,
  /^\s*!(?:(?:unquoted|final)\s+)*(?:function|procedure)\s+([\p{L}_][\p{L}\p{N}_]*)/iu,
];
const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * Where the path of an include line is, and what it is, perhaps empty; null
 * for a line that is not a local include.
 */
export function includePathOf(line: string): { start: number; end: number; path: string } | null {
  let text = line;
  if (END_COMMENT.test(text)) {
    const comment = text.lastIndexOf("/'");
    if (comment !== -1) {
      text = text.slice(0, comment);
    }
  }
  const found = DIRECTIVE.exec(text);
  if (found === null) {
    return null;
  }
  const start = (found[1] ?? '').length;
  const rest = (found[2] ?? '').replace(TRAILING, '');
  const selector = rest.lastIndexOf('!');
  const path = selector === -1 ? rest : rest.slice(0, selector);
  if (path.startsWith('<') || /^https?:\/\//.test(path)) {
    return null;
  }
  return { start, end: start + path.length, path };
}

/** The local includes of `source`, a diagram's text, in order. */
export function includeDirectives(source: string): IncludeDirective[] {
  const defined = new Set<string>();
  const found: (Omit<IncludeDirective, 'literal'> & { inBody: boolean })[] = [];
  let inBody = false;
  forEachCodeLine(source, (line, index) => {
    if (PROCEDURE.close.test(line)) {
      inBody = false;
      return;
    }
    inBody ||= PROCEDURE.open.test(line);
    for (const definition of DEFINITIONS) {
      const name = definition.exec(line)?.[1];
      if (name !== undefined) {
        defined.add(name.toLowerCase());
      }
    }
    const include = includePathOf(line);
    if (include !== null && include.path !== '') {
      found.push({ line: index, ...include, inBody });
    }
  });
  return found.map(({ inBody: written, ...include }) => ({
    ...include,
    literal:
      !written &&
      !/[$%]/.test(include.path) &&
      !(include.path.match(WORD) ?? []).some((word) => defined.has(word.toLowerCase())),
  }));
}
