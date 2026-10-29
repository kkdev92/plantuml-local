import { forEachCodeLine } from '../core/shape';
import type { IncludeKind } from '../core/types';
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
 * `!includesub` reads the same way, up to its first `!` instead: the
 * section it names follows. Without one, it names a section of the diagram
 * itself. `!theme name from folder` asks for `folder/puml-theme-name.puml`,
 * split at its first ` from `, in any case, both sides trimmed.
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
  /**
   * Columns of the path in its line: from `start` up to `end`. A theme read
   * from a folder has two, its name and its folder, each its own directive.
   */
  start: number;
  end: number;
  /** The path as written; for a theme read from a folder, its file there. */
  path: string;
  /** The operation the engine asks for it with. */
  kind: IncludeKind;
  /** Whether the engine asks for `path` as written. */
  literal: boolean;
  /** Whether it is written in a procedure or a function, so that it is read when that runs. */
  inBody: boolean;
}

/**
 * An include line, up to where its path begins: the engine skips what Java
 * counts as white space after the directive.
 */
const DIRECTIVE =
  /^([ \t]*!include(?:_once|_many|sub)?[\t-\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+)([\s\S]*)$/;
/** A `!theme` line, up to where its name begins. */
const THEME = /^([ \t]*!theme[\t-\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+)([\s\S]*)$/;
/** Where the engine splits a `!theme` line into the theme's name and its folder. */
const FROM = ' from ';
/** What the engine trims from the end of a line. */
const TRAILING = /[\t-\r \u00a0]+$/;
/** What it trims from the start of the folder of a theme. */
const LEADING = /^[\t-\r ]+/;
/** A block comment that ends a line, by its last `'/`. */
const END_COMMENT = /'\/[\t-\r ]*$/;

/** Words the text defines, which the engine puts the value of in place of the same word in a path. */
const DEFINITIONS: readonly RegExp[] = [
  /^\s*!(?:(?:global|local)\s+)?([\p{L}_][\p{L}\p{N}_]*)\s*\??=/iu,
  /^\s*!define(?:long)?\s+([\p{L}_][\p{L}\p{N}_]*)/iu,
  /^\s*!(?:(?:unquoted|final)\s+)*(?:function|procedure)\s+([\p{L}_][\p{L}\p{N}_]*)/iu,
];
const WORD = /[\p{L}\p{N}_]+/gu;

/** The words `source`, a diagram's text, defines, in lower case. */
export function definedWords(source: string): ReadonlySet<string> {
  const defined = new Set<string>();
  forEachCodeLine(source, (line) => {
    for (const definition of DEFINITIONS) {
      const name = definition.exec(line)?.[1];
      if (name !== undefined) {
        defined.add(name.toLowerCase());
      }
    }
  });
  return defined;
}

/**
 * Whether the engine reads `written` as it is written in a text that
 * defines `defined` ({@link definedWords}): with no `$` or `%`, nor a word
 * the text defines, it puts no value in its place.
 */
export function asWritten(written: string, defined: ReadonlySet<string>): boolean {
  return !/[$%]/.test(written) && !(written.match(WORD) ?? []).some((word) => defined.has(word.toLowerCase()));
}

/** A line without the block comment that ends it. */
function withoutEndComment(line: string): string {
  const comment = END_COMMENT.test(line) ? line.lastIndexOf("/'") : -1;
  return comment === -1 ? line : line.slice(0, comment);
}

/** A library (`<…>`) or a URL, which are not files of the workspace. */
const notLocal = (path: string): boolean => path.startsWith('<') || /^https?:\/\//.test(path);

/**
 * Where the path of an include line is, and what it is, perhaps empty; null
 * for a line that is not a local include.
 */
export function includePathOf(line: string): { start: number; end: number; path: string } | null {
  const found = DIRECTIVE.exec(withoutEndComment(line));
  if (found === null) {
    return null;
  }
  const directive = found[1] ?? '';
  const start = directive.length;
  const rest = (found[2] ?? '').replace(TRAILING, '');
  const selector = directive.trimStart().startsWith('!includesub') ? rest.indexOf('!') : rest.lastIndexOf('!');
  const path = selector === -1 ? rest : rest.slice(0, selector);
  if (notLocal(path)) {
    return null;
  }
  return { start, end: start + path.length, path };
}

/**
 * Where the folder of a `!theme … from` line is, and what it is, perhaps
 * empty, with the name of the theme and where that starts; null for a line
 * that is not one, or reads its theme from a library or a URL.
 */
export function themeFolderOf(
  line: string
): { start: number; end: number; path: string; name: string; nameStart: number } | null {
  const found = THEME.exec(withoutEndComment(line));
  if (found === null) {
    return null;
  }
  const nameStart = (found[1] ?? '').length;
  const rest = found[2] ?? '';
  const from = rest.toLowerCase().indexOf(FROM);
  if (from === -1) {
    return null;
  }
  const after = rest.slice(from + FROM.length);
  const path = after.replace(LEADING, '').replace(TRAILING, '');
  if (notLocal(path)) {
    return null;
  }
  const start = nameStart + from + FROM.length + (after.length - after.replace(LEADING, '').length);
  return { start, end: start + path.length, path, name: rest.slice(0, from).replace(TRAILING, ''), nameStart };
}

/** The file the engine asks for a theme read from a folder. */
function themeFile(name: string, folder: string): string {
  return `${folder}${folder.endsWith('/') ? '' : '/'}puml-theme-${name}.puml`;
}

/** The local includes of `source`, a diagram's text, in order. */
export function includeDirectives(source: string): IncludeDirective[] {
  const defined = definedWords(source);
  const found: (Omit<IncludeDirective, 'literal'> & { written: string })[] = [];
  let inBody = false;
  forEachCodeLine(source, (line, index) => {
    if (PROCEDURE.close.test(line)) {
      inBody = false;
      return;
    }
    inBody ||= PROCEDURE.open.test(line);
    const include = includePathOf(line);
    const sub = /^[ \t]*!includesub/.test(line);
    // An !includesub with no `!` after its path names a section of the diagram itself.
    const ownSection = sub && include !== null && line.charAt(include.end) !== '!';
    if (include !== null && include.path !== '' && !ownSection) {
      found.push({ line: index, ...include, kind: sub ? 'includesub' : 'include', written: include.path, inBody });
    }
    const theme = themeFolderOf(line);
    if (theme !== null && theme.path !== '' && theme.name !== '') {
      const path = themeFile(theme.name, theme.path);
      const written = `${theme.name} ${theme.path}`;
      const nameEnd = theme.nameStart + theme.name.length;
      found.push({ line: index, start: theme.nameStart, end: nameEnd, path, kind: 'theme', written, inBody });
      found.push({ line: index, start: theme.start, end: theme.end, path, kind: 'theme', written, inBody });
    }
  });
  return found.map(({ written, ...include }) => ({
    ...include,
    literal: !include.inBody && asWritten(written, defined),
  }));
}
