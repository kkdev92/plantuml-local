/**
 * What Go to Symbol in Workspace (`Ctrl+T`) searches: which files it reads
 * under the workspace folders, what it lists of each, and which of those a
 * query matches.
 *
 * A workspace folder is walked as the export of a folder walks one
 * (src/export/folder.ts), directory by directory in name order: `.git`,
 * `.hg`, `.svn`, `node_modules`, `dist` and `build` are skipped, no link is
 * followed, and a workspace folder inside another is left to be walked as
 * its own, so that each file is read once, for the innermost folder. What
 * `plantumlLocal.workspaceSymbols.exclude` names is left out too, in a small
 * glob grammar of its own ({@link compileExclude}) that cannot bring back
 * what is skipped. The folders share one budget, WORKSPACE_SYMBOL_LIMITS: a
 * walk that stops at a limit, or cannot list a directory, says so, and is
 * not taken for the whole. A directory is listed one entry at a time, so
 * that one too large to list stops at the limit, not after it.
 *
 * A file lists the names of its diagrams (the `id=` of a start line, the
 * name of a Markdown block), what its lines declare with a keyword
 * (src/language/symbols.ts) and the procedures, functions and macros it
 * defines (src/language/declarations.ts), in the diagrams the engine reads
 * (findFileDiagrams). Nothing is run: what lies under `!if`, `!while` or
 * `!foreach` is listed as conditional, and what lies in a diagram, a block
 * or a body without its end line as unclosed.
 *
 * Like the folder walk, this has no dependency on the `vscode` module: the
 * caller lists directories and joins paths. Lines and columns count from 0.
 */

import { WORKSPACE_SYMBOL_LIMITS } from '../core/constants';
import { splitLines } from '../core/lines';
import { DATA, START } from '../core/shape';
import { DECLARED_ID, findFileDiagrams, findPlantUmlBlocks } from '../export/blocks';
import { MARKDOWN, PLANTUML, SKIPPED } from '../export/folder';
import { conditionalLines, declarationsOf, type Definition } from './declarations';
import { declarations as declared, type Declaration as Declared } from './symbols';

export type WorkspaceSymbolLimits = { readonly [K in keyof typeof WORKSPACE_SYMBOL_LIMITS]: number };

/** Why a pattern of `plantumlLocal.workspaceSymbols.exclude` is refused. */
export type PatternProblem =
  | 'not-text'
  | 'too-long'
  | 'empty'
  | 'negation'
  | 'backslash'
  | 'colon'
  | 'brackets'
  | 'absolute'
  | 'trailing-slash'
  | 'empty-segment'
  | 'dot-segment'
  | 'double-star';

/** Why the setting is refused: its folder is then not searched, rather than searched more widely. */
export type ExcludeProblem =
  | { kind: 'not-a-list' }
  | { kind: 'too-many'; count: number }
  | { kind: 'pattern'; index: number; pattern: unknown; problem: PatternProblem };

/** Whether a path, from its workspace folder and in segments, is left out. */
export type ExcludeTest = (segments: readonly string[]) => boolean;

/** A pattern: each segment in code points, with null for `*`; or null for `**`. */
type Pattern = readonly (readonly (string | null)[] | null)[];

function problemOf(pattern: string): PatternProblem | null {
  const segments = pattern.split('/');
  if (pattern === '') {
    return 'empty';
  }
  if (pattern.startsWith('!')) {
    return 'negation';
  }
  if (pattern.includes('\\')) {
    return 'backslash';
  }
  if (pattern.includes(':')) {
    return 'colon';
  }
  if (/[{}[\]]/.test(pattern)) {
    return 'brackets';
  }
  if (pattern.startsWith('/')) {
    return 'absolute';
  }
  if (pattern.endsWith('/')) {
    return 'trailing-slash';
  }
  if (segments.includes('')) {
    return 'empty-segment';
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'dot-segment';
  }
  if (segments.some((segment) => segment !== '**' && segment.includes('**'))) {
    return 'double-star';
  }
  return null;
}

/**
 * The paths `plantumlLocal.workspaceSymbols.exclude` leaves out, as written:
 * a list of at most `patterns` patterns of at most `patternLength`
 * characters. A pattern is a path from the workspace folder, its segments
 * separated by `/`, compared with the path case by case and code point by
 * code point. In a segment, `?` stands for one character and `*` for any
 * number; `**`, a segment of its own, for any number of segments, none
 * included: `docs/**` is the folder `docs` and what it holds, `**\/*.puml`
 * every `.puml` file, in the folder itself too. A folder left out is not
 * walked. Anything else this grammar does not read is refused — a pattern
 * starting with `/` or ending with one, an empty segment, `.` or `..`, a
 * drive or a URL, `\`, `!`, braces and brackets — and so is the whole
 * setting, rather than any pattern being skipped. Nothing is trimmed or
 * expanded.
 */
export function compileExclude(value: unknown, limits: WorkspaceSymbolLimits = WORKSPACE_SYMBOL_LIMITS): ExcludeTest | ExcludeProblem {
  if (!Array.isArray(value)) {
    return { kind: 'not-a-list' };
  }
  if (value.length > limits.patterns) {
    return { kind: 'too-many', count: value.length };
  }
  const patterns: Pattern[] = [];
  for (const [index, pattern] of (value as unknown[]).entries()) {
    const problem =
      typeof pattern !== 'string' ? 'not-text' : pattern.length > limits.patternLength ? 'too-long' : problemOf(pattern);
    if (typeof pattern !== 'string' || problem !== null) {
      return { kind: 'pattern', index, pattern, problem: problem ?? 'not-text' };
    }
    patterns.push(
      pattern.split('/').map((segment) => (segment === '**' ? null : Array.from(segment, (char) => (char === '*' ? null : char))))
    );
  }
  return (segments) => {
    const path = segments.map((segment) => Array.from(segment));
    return patterns.some((pattern) => matchesPath(pattern, path));
  };
}

/**
 * Matches `items` against `pattern`, where a null in the pattern stands for
 * any number of items and anything else for one item that `one` accepts.
 * Going back only to just after the last null, it takes at worst the
 * product of the two lengths, and no regular expression is built.
 */
function matchesWith<P, I>(pattern: readonly (P | null)[], items: readonly I[], one: (part: P, item: I) => boolean): boolean {
  let at = 0;
  let item = 0;
  let star = -1;
  let resume = 0;
  while (item < items.length) {
    const part = pattern[at];
    if (part === null) {
      star = at;
      resume = item;
      at += 1;
    } else if (part !== undefined && one(part, items[item] as I)) {
      at += 1;
      item += 1;
    } else if (star !== -1) {
      at = star + 1;
      resume += 1;
      item = resume;
    } else {
      return false;
    }
  }
  while (pattern[at] === null) {
    at += 1;
  }
  return at === pattern.length;
}

function matchesPath(pattern: Pattern, path: readonly (readonly string[])[]): boolean {
  return matchesWith(pattern, path, (segment, name) =>
    matchesWith(segment, name, (char, got) => char === '?' || char === got)
  );
}

/** What a directory listing says an entry is, without following a link. */
export type EntryKind = 'file' | 'directory' | 'link' | 'other';

export interface WalkDeps {
  /** The entries of the directory at `path`, one at a time; it rejects when the directory cannot be listed. */
  list(path: string): AsyncIterable<{ name: string; kind: EntryKind }>;
  /** `path` with `name` appended. */
  join(path: string, name: string): string;
  /** The time, in milliseconds. */
  now(): number;
  /** Whether the walk is no longer wanted. */
  stopped(): boolean;
}

export interface WalkRoot {
  /** Where its walk starts. */
  path: string;
  /** What its setting leaves out. */
  exclude: ExcludeTest;
  /** Whether the directory at a path from it, in segments, is another workspace folder, walked as its own. */
  inner(segments: readonly string[]): boolean;
}

export interface FoundFile {
  /** The root it was found under, by its place in the list walked. */
  root: number;
  /** Its path, as `join` made it. */
  path: string;
  /** Its path from the root, in segments. */
  segments: readonly string[];
  markdown: boolean;
}

/** Why a walk did not reach every file it would read: a limit, or a directory that could not be listed. */
export type Shortfall = 'files' | 'directories' | 'entries' | 'depth' | 'time' | 'unlisted';

export interface Walk {
  files: FoundFile[];
  shortfalls: Set<Shortfall>;
  /** The paths of the directories that could not be listed. */
  unlisted: string[];
  /** Whether it ended because it was no longer wanted. */
  stopped: boolean;
}

/**
 * The Markdown and PlantUML files under `roots`, root by root, each walked
 * directory by directory in name order, within `limits` for all of them
 * together, counted from `started`.
 */
export async function walkRoots(
  roots: readonly WalkRoot[],
  deps: WalkDeps,
  started: number = deps.now(),
  limits: WorkspaceSymbolLimits = WORKSPACE_SYMBOL_LIMITS
): Promise<Walk> {
  const walk: Walk = { files: [], shortfalls: new Set(), unlisted: [], stopped: false };
  let directories = 0;
  let entries = 0;
  /** Why the walk is to end now, if it is. */
  const ended = (): boolean => {
    if (deps.stopped()) {
      walk.stopped = true;
    } else if (deps.now() - started > limits.milliseconds) {
      walk.shortfalls.add('time');
    }
    return walk.stopped || walk.shortfalls.has('time');
  };

  for (const [index, root] of roots.entries()) {
    const pending: { path: string; segments: readonly string[] }[] = [{ path: root.path, segments: [] }];
    while (pending.length > 0) {
      if (ended()) {
        return walk;
      }
      if (directories >= limits.directories) {
        walk.shortfalls.add('directories');
        return walk;
      }
      const directory = pending.shift() as (typeof pending)[number];
      directories += 1;
      const listed: { name: string; kind: EntryKind }[] = [];
      let full = false;
      try {
        for await (const entry of deps.list(directory.path)) {
          if (entries >= limits.entries) {
            walk.shortfalls.add('entries');
            full = true;
            break;
          }
          entries += 1;
          listed.push(entry);
          if (ended()) {
            return walk;
          }
        }
      } catch {
        walk.shortfalls.add('unlisted');
        walk.unlisted.push(directory.path);
        continue;
      }
      listed.sort(({ name: a }, { name: b }) => (a < b ? -1 : a > b ? 1 : 0));
      for (const { name, kind } of listed) {
        const segments = [...directory.segments, name];
        if (kind === 'directory') {
          if (SKIPPED.has(name) || root.inner(segments) || root.exclude(segments)) {
            continue;
          }
          if (segments.length > limits.depth) {
            walk.shortfalls.add('depth');
            continue;
          }
          pending.push({ path: deps.join(directory.path, name), segments });
        } else if (kind === 'file' && (MARKDOWN.test(name) || PLANTUML.test(name)) && !root.exclude(segments)) {
          if (walk.files.length >= limits.files) {
            walk.shortfalls.add('files');
            return walk;
          }
          walk.files.push({ root: index, path: deps.join(directory.path, name), segments, markdown: MARKDOWN.test(name) });
        }
      }
      if (full) {
        return walk;
      }
    }
  }
  return walk;
}

/** Something a file declares, which the search lists. */
export interface FileSymbol {
  name: string;
  /**
   * `diagram`; the keyword of an element in lower case (`participant`,
   * `class`, `abstract` for `abstract class`); or the kind of a definition:
   * `procedure`, `function`, `define`, `definelong`, or `constant` for
   * `!define NAME text`.
   */
  kind: string;
  /**
   * What declares it, as written: the start of a diagram (`@startuml`), the
   * opening of a Markdown block (` ```plantuml `), the keyword of an
   * element, or the directive of a definition (`!procedure`).
   */
  label: string;
  /** Where its name is: its line, and the columns in that line. */
  line: number;
  start: number;
  end: number;
  /** The name of the diagram it lies in, or '' when that has none. */
  diagram: string;
  /** It lies under `!if`, `!ifdef`, `!ifndef`, `!while` or `!foreach`, which running the text may leave it out of. */
  conditional: boolean;
  /** The diagram, the block or the body it lies in has no end line. */
  unclosed: boolean;
}

/** The kinds of definition listed, and their directives. */
const DEFINITIONS: Readonly<Partial<Record<Definition['kind'], string>>> = {
  procedure: '!procedure',
  function: '!function',
  define: '!define',
  definelong: '!definelong',
  constant: '!define',
};

/** A procedure, `!definelong` or function written over several lines, which its `!end…` line closes. */
function opensBody(definition: Definition): boolean {
  return (
    definition.kind === 'procedure' ||
    definition.kind === 'definelong' ||
    (definition.kind === 'function' && definition.value === undefined)
  );
}

/** Columns of `name` in `line`, from `from`; the start of the line's text when it is not there. */
function columnsOf(line: string, name: string, from: number): { start: number; end: number } {
  const at = line.indexOf(name, from);
  const start = at === -1 ? line.length - line.trimStart().length : at;
  return { start, end: at === -1 ? start : start + name.length };
}

/**
 * What a PlantUML text declares, by its lines and columns. `named` names a
 * diagram without `id=`: the name of the Markdown block it is in.
 */
function textSymbols(source: string, named: string): FileSymbol[] {
  const lines = splitLines(source);
  const symbols: FileSymbol[] = [];
  const elements: Declared[] = [];
  const flatten = (list: readonly Declared[]): void => {
    for (const declaration of list) {
      if (declaration.keyword !== 'diagram') {
        elements.push(declaration);
      }
      flatten(declaration.children);
    }
  };
  flatten(declared(source));

  for (const diagram of findFileDiagrams(source, '')) {
    const opening = lines[diagram.openLine] ?? '';
    const start = START.exec(opening);
    const id = start === null ? '' : (DECLARED_ID.exec(opening)?.[1] ?? '').trim();
    const name = id || named;
    const unclosed = start !== null && !diagram.closed;
    if (id !== '') {
      symbols.push({
        name: id,
        kind: 'diagram',
        label: `${start?.[1] ?? '@'}start${start?.[2] ?? 'uml'}`,
        line: diagram.openLine,
        ...columnsOf(opening, id, opening.indexOf('(id=') + 4),
        diagram: id,
        conditional: false,
        unclosed,
      });
    }
    if (start !== null && DATA.test(opening)) {
      continue;
    }
    // The lines the engine reads: after the start line, before the end line.
    const from = start === null ? diagram.openLine : diagram.openLine + 1;
    const to = diagram.closed ? diagram.closeLine : diagram.closeLine + 1;
    const read = lines.slice(from, to);
    const conditional = conditionalLines(read);
    for (const element of elements) {
      if (element.start >= from && element.start < to && element.at !== undefined) {
        symbols.push({
          name: element.name,
          kind: element.keyword,
          label: element.keyword,
          line: element.start,
          start: element.at.start,
          end: element.at.end,
          diagram: name,
          conditional: conditional[element.start - from] === true,
          unclosed,
        });
      }
    }
    for (const definition of declarationsOf(
      read,
      read.map((_, index) => from + index)
    )) {
      const label = definition.type === 'definition' ? DEFINITIONS[definition.kind] : undefined;
      if (definition.type !== 'definition' || label === undefined || definition.body !== undefined) {
        continue;
      }
      symbols.push({
        name: definition.name,
        kind: definition.kind,
        label,
        line: definition.line,
        start: definition.start,
        end: definition.end,
        diagram: name,
        conditional: definition.conditional,
        unclosed: unclosed || (opensBody(definition) && definition.last === definition.line),
      });
    }
  }
  return symbols.filter((symbol) => symbol.name !== '').sort((a, b) => a.line - b.line || a.start - b.start);
}

/** The column where line `source` of a Markdown block starts in its document line `line`. */
function offsetIn(line: string, source: string, container: string): number {
  const base = line.startsWith(container) ? container.length : 0;
  if (line.startsWith(source, base)) {
    return base;
  }
  // The first line of a block has its indentation taken off.
  const at = line.indexOf(source, base);
  return at === -1 ? base : at;
}

/**
 * What a Markdown or PlantUML file declares, by the lines and columns of
 * the file. In Markdown, each `plantuml` or `puml` block the preview draws
 * is read as a diagram, and the name of a named block is listed as one.
 */
export function fileSymbols(text: string, markdown: boolean): FileSymbol[] {
  if (!markdown) {
    return textSymbols(text, '');
  }
  const lines = splitLines(text);
  const symbols: FileSymbol[] = [];
  for (const block of findPlantUmlBlocks(text)) {
    const opening = lines[block.openLine] ?? '';
    if (block.name !== null) {
      const fence = /(`{3,}|~{3,})\s*(plantuml|puml)/.exec(opening);
      symbols.push({
        name: block.name,
        kind: 'diagram',
        label: fence === null ? '```plantuml' : `${fence[1] ?? ''}${fence[2] ?? ''}`,
        line: block.openLine,
        ...columnsOf(opening, block.name, fence === null ? 0 : fence.index + fence[0].length),
        diagram: block.name,
        conditional: false,
        unclosed: !block.closed,
      });
    }
    const source = splitLines(block.source);
    for (const symbol of textSymbols(block.source, block.name ?? '')) {
      const line = block.sourceLine + symbol.line;
      const offset = offsetIn(lines[line] ?? '', source[symbol.line] ?? '', block.container);
      symbols.push({
        ...symbol,
        line,
        start: symbol.start + offset,
        end: symbol.end + offset,
        unclosed: symbol.unclosed || !block.closed,
      });
    }
  }
  return symbols;
}

/**
 * Whether the characters of `query` appear in `name` in its order, in any
 * case: `OrdSvc` matches `OrderService`. VS Code asks for this much, and
 * scores and filters what it gets itself.
 */
export function matchesQuery(name: string, query: string): boolean {
  const wanted = Array.from(query.toLowerCase());
  let at = 0;
  for (const char of name.toLowerCase()) {
    if (char === wanted[at]) {
      at += 1;
    }
  }
  return at === wanted.length;
}
