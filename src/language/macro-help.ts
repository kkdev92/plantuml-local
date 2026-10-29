import { ANALYSIS_LIMITS } from '../core/constants';
import { libraryFileName } from '../core/libraries';
import { splitLines } from '../core/lines';
import { forEachCodeLine } from '../core/shape';
import { goesOnFrom, readsFrom, type Call } from './calls';
import { diagramAt } from './completion';
import { lineType, type Parameter } from './declarations';
import { callablesNamed, type DiagramLines, type Macro, type MacroEntry, type MacroKind, type Macros, type Origin } from './macros';
import { protect, protectedAt } from './protected';

/**
 * What the completion and the parameter hints show of what is defined where
 * the cursor is (src/language/macros.ts).
 *
 * The completion offers each procedure, function and macro once for each
 * number of parameters, as the engine tells them apart, and each variable
 * once, with where it is defined, what defines it and how sure that is: a
 * definition the text may leave out, or one of several, is shown as such,
 * and of several none is shown as the one that holds. A call is inserted
 * with a placeholder for each parameter up to the last that has no
 * default. The parameter hints show each definition of the name called,
 * its parameters as declared with their defaults as written, and the one
 * the cursor is in, by position or by name.
 *
 * Like the folding, this has no dependency on the `vscode` module: the
 * caller gives the words, localised.
 */

export interface MacroLabels {
  /** What each kind of definition is called. */
  kinds: Readonly<Record<MacroKind, string>>;
  /** Where a definition in the diagram itself is. */
  diagram: string;
  /** Where a definition in a local file an include reads is, by the id the include session gives the file. */
  file(id: string): string;
  /** Where a definition in a bundled library's file is, by the library and the file's key ({@link libraryFile}). */
  library(library: string, key: string): string;
  /** How sure a definition is: one the text may leave out. */
  conditional: string;
  /** One of several, none of them sure. */
  ambiguous: string;
  /** One that text which was not read may stand for. */
  unresolved: string;
  /** `count` definitions of one name and number of parameters. */
  definitions(count: number): string;
  /** Where a definition is: its place, and its line counted from 1. */
  line(place: string, line: number): string;
}

/** Where the completion offers definitions, and what it replaces. */
export interface MacroPlace {
  /** The lines of the diagram the cursor is in, and the line of the document each one is. */
  diagram: DiagramLines;
  /** The cursor's line in the document. */
  cursor: number;
  /** Columns of the line: the name at the cursor, from its `$`. */
  start: number;
  end: number;
  /** Whether only names that start with `$` are offered. */
  dollarOnly: boolean;
  /** Whether a `(` follows the name already, so that a call is inserted without one. */
  callOpen: boolean;
}

/**
 * The diagram the line `line` of `source` lies in, as the engine reads it
 * for definitions: its lines after the start line, numbered as lines of
 * the document, `first` being the document's line of the first line of
 * `source`. Null outside a diagram, on its start or end line, and in a
 * JSON or YAML diagram. `bare` is a Markdown block, which is a diagram
 * without a start line.
 */
export function diagramLinesAt(
  source: string,
  line: number,
  options: { bare: boolean; first: number }
): { diagram: DiagramLines; cursor: number } | null {
  const found = diagramAt(source, line, options.bare);
  if (found === null || found.data) {
    return null;
  }
  const lines = splitLines(source).slice(found.from, found.to);
  return {
    diagram: { lines, numbers: lines.map((_, index) => options.first + found.from + index) },
    cursor: options.first + line,
  };
}

/** The name the cursor is at or in, as the engine reads a name: from its `$`, up to where it ends. */
export function nameAround(text: string, column: number): { start: number; end: number } {
  let start = column;
  while (start > 0 && goesOnFrom(text.charAt(start - 1))) {
    start -= 1;
  }
  if (start > 0 && text.charAt(start - 1) === '$') {
    start -= 1;
  }
  let end = column;
  while (end < text.length && goesOnFrom(text.charAt(end))) {
    end += 1;
  }
  return { start, end };
}

/**
 * Where the completion offers definitions at column `column` of line
 * `line` of `source`: on a line of a diagram where the preprocessor reads
 * calls and variables, from where it starts reading them. In quoted text,
 * notes and the like, and in the path of an include, only names starting
 * with `$` are offered: the engine puts a variable's value there too, but a
 * word typed there is seldom a call. Null in a comment, on the name a line
 * declares, and where nothing is offered.
 */
export function macroPlace(
  source: string,
  line: number,
  column: number,
  options: { bare: boolean; first: number }
): MacroPlace | null {
  const found = diagramLinesAt(source, line, options);
  if (found === null) {
    return null;
  }
  const here = found.diagram.numbers.indexOf(found.cursor);
  const lines = found.diagram.lines;
  let code = false;
  forEachCodeLine(lines.join('\n'), (_text, index) => {
    code ||= index === here;
  });
  const text = lines[here] ?? '';
  const from = readsFrom(text);
  if (!code || from === null) {
    return null;
  }
  const name = nameAround(text, column);
  // Before where the line is read, and on the name a line declares as it is typed.
  if (name.start < from) {
    return null;
  }
  const type = lineType(text);
  const typed = protect(lines, false)[here];
  return {
    ...found,
    start: name.start,
    end: name.end,
    dollarOnly: type === 'include' || type === 'includesub' || (typed !== undefined && protectedAt(typed, column)),
    callOpen: text.charAt(name.end) === '(',
  };
}

/**
 * A bundled library's file as an include names it, such as
 * `<C4/C4_Context>`: `name` is its path as upstream writes it, when known;
 * else the files the library lists, or the key, name it.
 */
export function libraryFile(library: string, key: string, name?: string): string {
  const { label, file } = libraryFileName(library, key, name);
  return `<${label}/${file}>`;
}

/** The place a definition is in. */
function placeOf(origin: Origin, labels: MacroLabels): string {
  switch (origin.source) {
    case 'document':
      return labels.diagram;
    case 'file':
      return labels.file(origin.id);
    case 'library':
      return labels.library(origin.library, origin.key);
  }
}

/** The parameters as declared: each name, and its default as written. */
function parameterTexts(parameters: readonly Parameter[]): string[] {
  return parameters.map(({ name, default: value }) => (value === undefined ? name : `${name} = ${value}`));
}

/** How a definition is declared, on one line, its parameters as {@link parameterTexts} shows them. */
export function declarationOf(macro: Macro): string {
  const parameters = `(${parameterTexts(macro.parameters ?? []).join(', ')})`;
  const flags = `${macro.unquoted === true ? 'unquoted ' : ''}${macro.final === true ? 'final ' : ''}`;
  const value = macro.value === undefined ? '' : ` ${macro.value}`;
  switch (macro.kind) {
    case 'procedure':
      return `!${flags}procedure ${macro.name}${parameters}`;
    case 'function':
      return `!${flags}function ${macro.name}${parameters}${macro.value === undefined ? '' : ` !return ${macro.value}`}`;
    case 'define':
      return `!define ${macro.name}${parameters}${value}`;
    case 'definelong':
      return `!definelong ${macro.name}${parameters}`;
    case 'constant':
      return `!define ${macro.name}${value}`;
    case 'variable':
      return macro.foreach === true
        ? `!foreach ${macro.name} in${value}`
        : `!${macro.scope === undefined ? '' : `${macro.scope} `}${macro.name} ${macro.ifUnset === true ? '?=' : '='}${value}`;
    case 'parameter':
      return macro.value === undefined ? macro.name : `${macro.name} = ${macro.value}`;
  }
}

/** How sure a definition is, unless it is the one that holds. */
function surenessOf(entry: MacroEntry, labels: MacroLabels): string | null {
  switch (entry.certainty) {
    case 'resolved':
      return null;
    case 'ambiguous':
      return entry.candidates.length > 1 ? labels.ambiguous : labels.conditional;
    case 'unresolved':
      return labels.unresolved;
  }
}

/** Where an entry is defined and what defines it, and how sure that is. */
function describe(entry: MacroEntry, labels: MacroLabels): string {
  const first = entry.candidates[0]?.macro;
  const kinds = new Set(entry.candidates.map(({ macro }) => macro.kind));
  const where =
    entry.candidates.length === 1 && first !== undefined
      ? placeOf(first.origin, labels)
      : labels.definitions(entry.candidates.length);
  return [where, kinds.size === 1 && first !== undefined ? labels.kinds[first.kind] : null, surenessOf(entry, labels)]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** Each definition of an entry, for the details: as declared, where, and the comment above it. */
export interface MacroDefinition {
  declaration: string;
  where: string;
  comment?: string;
}

function definitionsOf(entry: MacroEntry, labels: MacroLabels): MacroDefinition[] {
  return entry.candidates.map(({ macro }) => ({
    declaration: declarationOf(macro),
    where: labels.line(placeOf(macro.origin, labels), macro.origin.line + 1),
    ...(macro.comment === undefined ? {} : { comment: macro.comment }),
  }));
}

/** Text in a snippet, its `$`, `}` and `\` escaped. */
function escaped(text: string): string {
  return text.replace(/[$}\\]/g, (char) => `\\${char}`);
}

export interface MacroSuggestion {
  /** As written, `$` and all: what the list shows and filters by. */
  name: string;
  kind: MacroKind;
  /** For a procedure, function or macro: its parameters, `(…)`, or `(…)` with `…` when its definitions differ in them. */
  parameters?: string;
  /** Where it is defined and what defines it, and how sure that is. */
  description: string;
  definitions: readonly MacroDefinition[];
  /** What is inserted, in snippet syntax. */
  snippet: string;
  /** Whether it is a call, which the parameter hints can follow. */
  call: boolean;
  sortText: string;
}

/** How the list orders definitions: parameters, the diagram's, those of local files, those of libraries. */
const GROUPS: Readonly<Record<Origin['source'], string>> = { document: '1', file: '2', library: '3' };

const CALLS: ReadonlySet<MacroKind> = new Set<MacroKind>(['procedure', 'function', 'define', 'definelong']);

function suggestionOf(entry: MacroEntry, callOpen: boolean, labels: MacroLabels): MacroSuggestion | null {
  const first = entry.candidates[0]?.macro;
  if (first === undefined) {
    return null;
  }
  const call = CALLS.has(first.kind);
  const lists = new Set(entry.candidates.map(({ macro }) => parameterTexts(macro.parameters ?? []).join(', ')));
  const count = first.parameters?.length ?? 0;
  const parameters = lists.size === 1 ? (first.parameters ?? []) : null;
  let snippet = escaped(first.name);
  if (call && !callOpen) {
    // Each parameter up to the last that has no default; or else one place to type in.
    let last = -1;
    parameters?.forEach((parameter, index) => {
      last = parameter.default === undefined ? index : last;
    });
    const placeholders =
      parameters !== null && last >= 0
        ? parameters.slice(0, last + 1).map((parameter, index) => `\${${String(index + 1)}:${escaped(parameter.name)}}`)
        : count > 0
          ? ['$1']
          : [];
    snippet += `(${placeholders.join(', ')})`;
  }
  const group = first.kind === 'parameter' ? '0' : GROUPS[first.origin.source];
  return {
    name: first.name,
    kind: first.kind,
    ...(call ? { parameters: lists.size === 1 ? `(${[...lists][0] ?? ''})` : `(${count > 0 ? '…' : ''})` } : {}),
    description: describe(entry, labels),
    definitions: definitionsOf(entry, labels),
    snippet,
    call,
    sortText: `2${group}${first.name} ${String(count).padStart(3, '0')}`,
  };
}

/**
 * What the completion offers of `macros` at `place`, in the order of their
 * sort texts, and whether more than the results limit were cut off.
 */
export function macroSuggestions(
  macros: Macros,
  place: Pick<MacroPlace, 'dollarOnly' | 'callOpen'>,
  labels: MacroLabels,
  limit: number = ANALYSIS_LIMITS.results
): { items: MacroSuggestion[]; cut: boolean } {
  const items = [...macros.callables.values(), ...macros.variables.values()]
    .map((entry) => suggestionOf(entry, place.callOpen, labels))
    .filter((item): item is MacroSuggestion => item !== null && (!place.dollarOnly || item.name.startsWith('$')))
    .sort((one, other) => (one.sortText < other.sortText ? -1 : one.sortText > other.sortText ? 1 : 0));
  return { items: items.slice(0, limit), cut: items.length > limit };
}

export interface SignatureSuggestion {
  /** `name(…)`, its parameters as declared. */
  label: string;
  /** Where each parameter is in the label: from, and up to. */
  parameters: readonly (readonly [number, number])[];
  /** Where it is defined and what defines it, and how sure that is. */
  description: string;
  comment?: string;
  /** The parameter the cursor is in, or -1 when it is in none. */
  activeParameter: number;
}

/**
 * The parameter hints for `call`, written on `line`: each definition of
 * its name, fewest parameters first, and the one shown first: `chosen`
 * while it takes the arguments written so far, or else the first that
 * does, or else the first. The arguments by name are matched by name, and
 * those by position go to the other parameters in order
 * (TFunctionImpl.getNewMemory upstream). Null when the name has no
 * definition.
 */
export function signaturesFor(
  macros: Macros,
  call: Call,
  line: string,
  labels: MacroLabels,
  chosen?: number
): { signatures: SignatureSuggestion[]; active: number } | null {
  const args = call.arguments;
  const current = args[args.length - 1];
  const named = args.flatMap((argument) => (argument.name === undefined ? [] : [argument.name]));
  const before = args.slice(0, -1).filter((argument) => argument.name === undefined).length;
  // `name()` has no argument, and `name(` with the cursor right after it none yet.
  const none =
    args.length === 1 && current?.name === undefined && line.slice(current?.start, current?.end).trim() === '';
  const positional = before + (current?.name === undefined && !none ? 1 : 0);

  const signatures: (SignatureSuggestion & { takes: boolean })[] = [];
  for (const entry of callablesNamed(macros, call.name)) {
    const description = describe(entry, labels);
    for (const { macro } of entry.candidates) {
      const parameters = macro.parameters ?? [];
      const texts = parameterTexts(parameters);
      const offsets: [number, number][] = [];
      let label = `${macro.name}(`;
      texts.forEach((text, index) => {
        label += index > 0 ? ', ' : '';
        offsets.push([label.length, label.length + text.length]);
        label += text;
      });
      const free = parameters.flatMap((parameter, index) => (named.includes(parameter.name) ? [] : [index]));
      signatures.push({
        label: `${label})`,
        parameters: offsets,
        description: entry.candidates.length > 1 ? `${description} · ${placeOf(macro.origin, labels)}` : description,
        ...(macro.comment === undefined ? {} : { comment: macro.comment }),
        activeParameter:
          current?.name !== undefined
            ? parameters.findIndex((parameter) => parameter.name === current.name)
            : (free[before] ?? -1),
        takes: named.every((name) => parameters.some((parameter) => parameter.name === name)) && positional <= free.length,
      });
    }
  }
  if (signatures.length === 0) {
    return null;
  }
  const kept = chosen !== undefined && signatures[chosen]?.takes === true ? chosen : undefined;
  const active = kept ?? Math.max(0, signatures.findIndex((signature) => signature.takes));
  return { signatures: signatures.map(({ takes: _takes, ...signature }) => signature), active };
}
