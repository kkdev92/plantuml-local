import { ANALYSIS_LIMITS, INCLUDE_LIMITS } from '../core/constants';
import { splitLines } from '../core/lines';
import { includedLines, sectionLines } from '../includes/included-lines';
import { goesOnFrom, type Reading } from './calls';
import {
  declarationsOf,
  type Declaration,
  type Definition,
  type DefinitionKind,
  type Inclusion,
  type Parameter,
} from './declarations';

/**
 * What is defined where the cursor is in a diagram: the procedures,
 * functions, macros and variables that the completion and the parameter
 * hints offer, each with how sure that is.
 *
 * The diagram's declarations (src/language/declarations.ts) are taken in
 * order up to the cursor's line, and with them those of what its includes
 * read, at the include's line: a local file through the render's include
 * session (the same search, bounds and limits, unsaved changes and all),
 * and a bundled library's file from what scripts/generate-stdlib.mjs
 * recorded of it. As in the bundled engine (`@plantuml/core` 1.2026.9,
 * TContext.executeInclude upstream), `!include` skips a file it has read,
 * `!include_once` stops on one, `!include_many` reads it again, and the
 * includes of a library read their file each time.
 *
 * Nothing is run. A procedure, function or macro is known by its name and
 * number of parameters, a variable by its name, and a later definition
 * stands for an earlier one. One the text may leave out, as it lies under
 * `!if`, `!while` or `!foreach` or comes from a file read under one, is
 * conditional, and is kept along with what it may stand for. A definition
 * is resolved when it is the only one and nothing may leave it out. Text
 * that is not read (an include whose path is put together when the text
 * runs, a file past the analysis limits) may define anything again, so the
 * definitions before it are unresolved.
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

/** What a definition is written in. */
export type Place =
  /** The diagram the cursor is in. */
  | { source: 'document' }
  /** A local file an include reads, by the id the include session gives it. */
  | { source: 'file'; id: string }
  /** A file of a bundled library, by the key its asset has it under. */
  | { source: 'library'; library: string; key: string };

/** Where a definition or an include is written: its line, and the columns of its name or path. */
export type Origin = Place & { line: number; start: number; end: number };

/** What defines a name: a declaration, or a parameter of the body the cursor is in. */
export type MacroKind = DefinitionKind | 'parameter';

export interface Macro {
  kind: MacroKind;
  /** As written, `$` and all. */
  name: string;
  /** Of a procedure, function or macro. */
  parameters?: readonly Parameter[];
  /** The comment lines right above it. */
  comment?: string;
  /** A variable's value, a macro's text, what a function written on one line returns, or a parameter's default, as written. */
  value?: string;
  /** How a variable is assigned: `!global` or `!local`, `?=`, or as the variable of a `!foreach`. */
  scope?: 'global' | 'local';
  ifUnset?: true;
  foreach?: true;
  /** `!unquoted`: its arguments are read as text. */
  unquoted?: boolean;
  /** `!final`: no definition with the same name and number of parameters may follow. */
  final?: boolean;
  /** Where it is written; for a parameter, the procedure or function that declares it. */
  origin: Origin;
}

export interface Candidate {
  macro: Macro;
  /** Whether running the text may leave it out, or another definition stand for it. */
  conditional: boolean;
  /** Where it was taken, among the definitions and the text that was not read. */
  order: number;
}

/**
 * How sure a definition is: the one that holds (resolved); one of several,
 * or one the text may leave out (ambiguous); or one that text that was not
 * read may stand for (unresolved).
 */
export type Certainty = 'resolved' | 'ambiguous' | 'unresolved';

export interface MacroEntry {
  /** In the order they were taken. The first is the last that nothing may leave out, when there is one. */
  candidates: readonly Candidate[];
  certainty: Certainty;
}

/** Why what an include names was not read. */
export type ShortfallReason =
  /** Its path is put together when the text runs, from a variable or a function. */
  | 'dynamic'
  /** `file!ID` with an ID the engine reads as a pattern. */
  | 'pattern'
  /** The file is larger or longer than the background reads, or would hold more text than it may. */
  | 'too-large'
  /** What the bundled library declares could not be read. */
  | 'index'
  /** The include session could not read it, and keeps why. */
  | 'unreadable'
  /** No bundled library has the file, so the engine cannot include it either. */
  | 'not-bundled'
  /** The file has no diagram or section of that number or name. */
  | 'no-part'
  /** `!include_once` of a file read before, where the engine stops. */
  | 'once'
  /** In the body of a procedure or function: it is read when that runs. */
  | 'in-body'
  /** Includes nested deeper than the engine follows. */
  | 'depth';

export interface Shortfall {
  reason: ShortfallReason;
  /** The path, or `<library/file>`, as written, with its `!` and what follows. */
  path: string;
  /** Where the include is written. */
  at: Origin;
}

/** The reasons after which the definitions before may be defined again by what was not read. */
const GAPS: ReadonlySet<ShortfallReason> = new Set<ShortfallReason>(['dynamic', 'pattern', 'too-large', 'index']);

export interface Macros {
  /** Partial when something an include names was not read; cancelled when the answer stopped being wanted. */
  status: 'complete' | 'partial' | 'cancelled';
  shortfalls: readonly Shortfall[];
  /** Procedures, functions and macros, by {@link callableKey}. */
  callables: ReadonlyMap<string, MacroEntry>;
  /** Variables, by name. */
  variables: ReadonlyMap<string, MacroEntry>;
}

/** Where the files that includes name are read from. */
export interface MacroSources {
  /**
   * The local file a path names, read as the render reads it, or null when
   * it cannot be. `from` is the id of the file the include is written in,
   * null for the diagram.
   */
  file(path: string, from: string | null, kind: 'include' | 'includesub'): Promise<{ id: string; text: string } | null>;
  /**
   * What a bundled library's file declares, by the library's name and the
   * file's key in lower case: undefined when no bundled library has that
   * name, null when it has no such file. Rejects when it cannot be read.
   */
  library(library: string, key: string): Promise<readonly Declaration[] | null | undefined>;
  /** Whether the answer is no longer wanted. */
  cancelled(): boolean;
}

/** The lines the engine reads of the diagram the cursor is in, after its start line, and the line of the document each one is. */
export interface DiagramLines {
  lines: readonly string[];
  numbers: readonly number[];
}

export type AnalysisLimits = { readonly [K in keyof typeof ANALYSIS_LIMITS]: number };

/** The key of a procedure, function or macro: its name and number of parameters, which the engine tells apart (TFunctionSignature). */
export function callableKey(name: string, parameters: number): string {
  return `${name}/${parameters}`;
}

/** The name in a {@link callableKey}. */
function nameOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf('/'));
}

/** Whether the background reads no more of `text` than this: a file larger or longer than the limits. */
export function pastAnalysisLimits(text: string, limits: AnalysisLimits = ANALYSIS_LIMITS): boolean {
  return Buffer.byteLength(text, 'utf8') > limits.fileBytes || splitLines(text).length > limits.fileLines;
}

const CALLABLE: ReadonlySet<MacroKind> = new Set<MacroKind>(['procedure', 'function', 'define', 'definelong']);

/** A procedure, `!definelong` or function written over several lines, which the engine takes at its `!end…` line. */
function hasBody(definition: Definition): boolean {
  return (
    definition.kind === 'procedure' ||
    definition.kind === 'definelong' ||
    (definition.kind === 'function' && definition.value === undefined)
  );
}

/** The path of an include as written, with its `!` and what follows. */
function writtenOf(inclusion: Inclusion): string {
  return inclusion.selector === null ? inclusion.target : `${inclusion.target}!${inclusion.selector}`;
}

function originOf(place: Place, at: { line: number; start: number; end: number }): Origin {
  return { ...place, line: at.line, start: at.start, end: at.end };
}

function macroOf(definition: Definition, place: Place): Macro {
  return {
    kind: definition.kind,
    name: definition.name,
    ...(definition.parameters === undefined ? {} : { parameters: definition.parameters }),
    ...(definition.comment === undefined ? {} : { comment: definition.comment }),
    ...(definition.value === undefined ? {} : { value: definition.value }),
    ...(definition.scope === undefined ? {} : { scope: definition.scope }),
    ...(definition.ifUnset === true ? { ifUnset: true as const } : {}),
    ...(definition.foreach === true ? { foreach: true as const } : {}),
    ...(definition.unquoted === true ? { unquoted: true } : {}),
    ...(definition.final === true ? { final: true } : {}),
    origin: originOf(place, definition),
  };
}

/** Whether two definitions are one, written on the same line of the same text: a line declares one thing. */
function sameOrigin(one: Origin, other: Origin): boolean {
  return (
    one.line === other.line &&
    (one.source === 'document'
      ? other.source === 'document'
      : one.source === 'file'
        ? other.source === 'file' && one.id === other.id
        : other.source === 'library' && one.library === other.library && one.key === other.key)
  );
}

/** Whether `$` or a written `\n` lets a name start right after a letter (VariableManager.justAfterBackslashN). */
function startsAt(text: string, at: number, name: string): boolean {
  return (
    at === 0 ||
    !goesOnFrom(text.charAt(at - 1)) ||
    name.startsWith('$') ||
    (at >= 2 && text.charAt(at - 2) === '\\' && text.charAt(at - 1) === 'n')
  );
}

/** VariableManager.getVarnameAt: whether the engine puts the value of variable `name` in `text`. */
function mentionsVariable(text: string, name: string): boolean {
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    const after = at + name.length;
    if (startsAt(text, at, name) && (after === text.length || !goesOnFrom(text.charAt(after)))) {
      return true;
    }
  }
  return false;
}

/** TContext.getFunctionNameAt: whether `text` calls `name`. */
function mentionsCall(text: string, name: string): boolean {
  const call = `${name}(`;
  for (let at = text.indexOf(call); at !== -1; at = text.indexOf(call, at + 1)) {
    if (startsAt(text, at, name)) {
      return true;
    }
  }
  return false;
}

/** A built-in function called in a path, such as `%getenv(`. */
const BUILT_IN_CALL = /%[_\p{L}][_\p{L}0-9]*\(/u;
/** A variable's name, which text that was not read may have defined. */
const VARIABLE = /\$[_\p{L}]/u;

type Seen = 'conditional' | 'unconditional';
type Read = { id: string; text: string } | 'unreadable' | 'too-large';

class Walk {
  readonly callables = new Map<string, Candidate[]>();
  readonly variables = new Map<string, Candidate[]>();
  readonly shortfalls: Shortfall[] = [];
  private order = 0;
  /** The order of the last text that was not read, or -1. */
  private lastGap = -1;
  /** Each (file, diagram) `!include` has read, and whether every run of the text reads it. */
  private readonly seen = new Map<string, Seen>();
  /** Each file read, by the file it is named from and its path. */
  private readonly files = new Map<string, Read>();

  constructor(
    private readonly sources: MacroSources,
    private readonly limits: AnalysisLimits,
    /** The bytes of text held. */
    private held: number
  ) {}

  get stopped(): boolean {
    return this.sources.cancelled();
  }

  /** Takes what the diagram declares before line `cursor`. */
  async diagram(declarations: readonly Declaration[], cursor: number): Promise<void> {
    const place: Place = { source: 'document' };
    // The body the cursor is in is not taken yet, but its parameters and what it declares before the cursor are.
    // A body holds no other, and one after the cursor is not come to.
    const open = declarations.find(
      (declaration): declaration is Definition =>
        declaration.type === 'definition' &&
        hasBody(declaration) &&
        (declaration.last === declaration.line || cursor <= declaration.last)
    );
    for (const declaration of declarations) {
      if (this.stopped || declaration.line >= cursor) {
        return;
      }
      if (declaration === open) {
        for (const parameter of open.parameters ?? []) {
          const value = parameter.default === undefined ? {} : { value: parameter.default };
          this.define({ kind: 'parameter', name: parameter.name, ...value, origin: originOf(place, open) }, false);
        }
      } else if (declaration.body === undefined || declaration.body === open?.line) {
        await this.take(declaration, place, declaration.conditional, 0);
      } else if (declaration.type === 'include') {
        this.fall({ reason: 'in-body', path: writtenOf(declaration), at: originOf(place, declaration) });
      }
    }
  }

  /** Takes what a file an include reads declares, all of it: `conditional` when the include may not read it. */
  private async walk(
    declarations: readonly Declaration[],
    place: Place,
    conditional: boolean,
    depth: number
  ): Promise<void> {
    for (const declaration of declarations) {
      if (this.stopped) {
        return;
      }
      if (declaration.body === undefined) {
        await this.take(declaration, place, conditional || declaration.conditional, depth);
      } else if (declaration.type === 'include') {
        this.fall({ reason: 'in-body', path: writtenOf(declaration), at: originOf(place, declaration) });
      }
    }
  }

  private async take(declaration: Declaration, place: Place, conditional: boolean, depth: number): Promise<void> {
    switch (declaration.type) {
      case 'definition':
        // A body that is never closed is never taken.
        if (!hasBody(declaration) || declaration.last !== declaration.line) {
          this.define(macroOf(declaration, place), conditional, declaration.ifUnset === true);
        }
        return;
      case 'undef':
        this.undef(declaration.name, conditional);
        return;
      case 'include':
        await this.include(declaration, place, conditional, depth);
        return;
    }
  }

  private define(macro: Macro, conditional: boolean, ifUnset = false): void {
    const callable = CALLABLE.has(macro.kind);
    const table = callable ? this.callables : this.variables;
    const key = callable ? callableKey(macro.name, macro.parameters?.length ?? 0) : macro.name;
    const list = table.get(key) ?? [];
    if (callable && list.some((other) => other.macro.final === true && !other.conditional)) {
      // The engine refuses to define a `!final` one again.
      return;
    }
    let maybe = conditional;
    if (ifUnset) {
      if (list.some((other) => !other.conditional)) {
        // `?=` leaves a value as it is.
        return;
      }
      // A value it may have, or one text that was not read may have given it.
      maybe ||= list.length > 0 || this.lastGap !== -1;
    }
    const candidate: Candidate = { macro, conditional: maybe, order: this.order++ };
    if (!maybe) {
      table.set(key, [candidate]);
    } else if (!list.some((other) => sameOrigin(other.macro.origin, macro.origin))) {
      // The same definition read again, in a file included again, changes nothing.
      table.set(key, [...list, candidate]);
    }
  }

  /** `!undef` removes a variable; nothing removes a procedure, function or macro. */
  private undef(name: string, conditional: boolean): void {
    const list = this.variables.get(name);
    if (list === undefined) {
      return;
    }
    if (conditional) {
      this.variables.set(
        name,
        list.map((candidate) => ({ ...candidate, conditional: true }))
      );
    } else {
      this.variables.delete(name);
    }
  }

  private fall(shortfall: Shortfall): void {
    this.shortfalls.push(shortfall);
    if (GAPS.has(shortfall.reason)) {
      this.lastGap = this.order++;
    }
  }

  /**
   * Whether the engine puts a value in the include's path when the text
   * runs (TContext.applyFunctionsAndVariables): it calls a built-in
   * function, holds a variable or calls a function defined before, or,
   * after text that was not read, holds a name that starts with `$`.
   */
  private isDynamic(text: string): boolean {
    if (BUILT_IN_CALL.test(text) || (this.lastGap !== -1 && VARIABLE.test(text))) {
      return true;
    }
    for (const name of this.variables.keys()) {
      if (mentionsVariable(text, name)) {
        return true;
      }
    }
    for (const key of this.callables.keys()) {
      if (mentionsCall(text, nameOfKey(key))) {
        return true;
      }
    }
    return false;
  }

  private async include(inclusion: Inclusion, place: Place, conditional: boolean, depth: number): Promise<void> {
    const path = inclusion.target;
    const written = writtenOf(inclusion);
    const at = originOf(place, inclusion);
    const fall = (reason: ShortfallReason): void => this.fall({ reason, path: written, at });
    if (inclusion.directive === 'includesub' && path === '') {
      // A section of the text itself, read where it is written.
      return;
    }
    if (this.isDynamic(written)) {
      return fall('dynamic');
    }
    if (depth + 1 > INCLUDE_LIMITS.depth) {
      return fall('depth');
    }
    if (path.startsWith('<') && path.endsWith('>')) {
      return this.includeLibrary(path, inclusion.directive, fall, conditional, depth);
    }
    if (place.source === 'library') {
      return fall('unreadable');
    }
    const includesub = inclusion.directive === 'includesub';
    const file = await this.read(
      path,
      place.source === 'file' ? place.id : null,
      includesub ? 'includesub' : 'include'
    );
    if (this.stopped) {
      return;
    }
    if (file === 'unreadable' || file === 'too-large') {
      return fall(file);
    }
    const into: Place = { source: 'file', id: file.id };
    if (includesub) {
      const section = sectionLines(file.text, inclusion.selector ?? '');
      if (section === null) {
        return fall('no-part');
      }
      return this.walk(declarationsOf(section.lines, section.numbers), into, conditional, depth + 1);
    }
    const key = `${file.id}\n${inclusion.selector ?? ''}`;
    const seen = this.seen.get(key);
    let maybe = conditional;
    if (inclusion.directive !== 'include_many') {
      if (seen === 'unconditional') {
        // `!include` skips a file it has read; `!include_once` stops on one.
        return inclusion.directive === 'include_once' ? fall('once') : undefined;
      }
      // Read before or not, depending on how the text runs.
      maybe ||= seen === 'conditional';
    }
    if (seen !== 'unconditional') {
      this.seen.set(key, conditional ? 'conditional' : 'unconditional');
    }
    const lines = includedLines(file.text, inclusion.selector);
    if ('problem' in lines) {
      return fall(lines.problem === 'pattern' ? 'pattern' : 'no-part');
    }
    await this.walk(declarationsOf(lines.lines, lines.numbers), into, maybe, depth + 1);
  }

  /**
   * A bundled library's file, which a path between `<` and `>` names
   * once what follows its last `!` is taken off (TContext.executeInclude,
   * PathSystem.getTeaVMStdlibInputStream): in lower case, its library
   * before the first `/` and its key after it, an extension and all. It is
   * read whole, whatever follows the `!`.
   */
  private async includeLibrary(
    path: string,
    directive: Inclusion['directive'],
    fall: (reason: ShortfallReason) => void,
    conditional: boolean,
    depth: number
  ): Promise<void> {
    if (directive === 'includesub') {
      return fall('unreadable');
    }
    const inner = path.slice(1, -1).toLowerCase();
    const slash = inner.indexOf('/');
    if (slash === -1) {
      return fall('not-bundled');
    }
    const library = inner.slice(0, slash);
    const key = inner.slice(slash + 1);
    let declarations: readonly Declaration[] | null | undefined;
    try {
      declarations = await this.sources.library(library, key);
    } catch {
      return this.stopped ? undefined : fall('index');
    }
    if (this.stopped) {
      return;
    }
    if (declarations === null || declarations === undefined) {
      return fall('not-bundled');
    }
    await this.walk(declarations, { source: 'library', library, key }, conditional, depth + 1);
  }

  /** A file an include names, read once for each file it is named from. */
  private async read(path: string, from: string | null, kind: 'include' | 'includesub'): Promise<Read> {
    const key = `${from ?? ''}\n${path}`;
    const known = this.files.get(key);
    if (known !== undefined) {
      return known;
    }
    const file = await this.sources.file(path, from, kind);
    let read: Read = 'unreadable';
    if (file !== null) {
      const bytes = Buffer.byteLength(file.text, 'utf8');
      if (pastAnalysisLimits(file.text, this.limits) || this.held + bytes > this.limits.totalBytes) {
        read = 'too-large';
      } else {
        this.held += bytes;
        read = file;
      }
    }
    this.files.set(key, read);
    return read;
  }

  result(): Macros {
    if (this.stopped) {
      return { status: 'cancelled', shortfalls: [], callables: new Map(), variables: new Map() };
    }
    const entries = (table: Map<string, Candidate[]>): Map<string, MacroEntry> =>
      new Map([...table].map(([key, list]) => [key, { candidates: list, certainty: this.certainty(list) }]));
    return {
      status: this.shortfalls.length > 0 ? 'partial' : 'complete',
      shortfalls: this.shortfalls,
      callables: entries(this.callables),
      variables: entries(this.variables),
    };
  }

  private certainty(list: readonly Candidate[]): Certainty {
    const first = list[0];
    if (first === undefined || this.lastGap > first.order) {
      return 'unresolved';
    }
    return list.length === 1 && !first.conditional ? 'resolved' : 'ambiguous';
  }
}

/**
 * What is defined at line `line` of the document, in the diagram whose
 * lines are `diagram`: what the diagram declares before that line, and
 * what the files its includes read declare, through `sources`.
 */
export async function macrosAt(
  diagram: DiagramLines,
  line: number,
  sources: MacroSources,
  limits: AnalysisLimits = ANALYSIS_LIMITS
): Promise<Macros> {
  const walk = new Walk(sources, limits, Buffer.byteLength(diagram.lines.join('\n'), 'utf8'));
  await walk.diagram(declarationsOf(diagram.lines, diagram.numbers), line);
  return walk.result();
}

/** The procedures, functions and macros named `name`, fewest parameters first. */
export function callablesNamed(macros: Macros, name: string): MacroEntry[] {
  return [...macros.callables]
    .filter(([key]) => nameOfKey(key) === name)
    .sort(
      ([one], [other]) => Number(one.slice(one.lastIndexOf('/') + 1)) - Number(other.slice(other.lastIndexOf('/') + 1))
    )
    .map(([, entry]) => entry);
}

/**
 * How a call of `name` reads its arguments (TContext.isLegacyDefine and
 * isUnquoted upstream): as text, none named, when any definition of the
 * name is a `!define` or `!definelong` macro; as text when any is
 * `!unquoted`; as expressions otherwise. Null when nothing defines it.
 */
export function readingOf(macros: Macros, name: string): Reading | null {
  let reading: Reading | null = null;
  for (const entry of callablesNamed(macros, name)) {
    for (const { macro } of entry.candidates) {
      if (macro.kind === 'define' || macro.kind === 'definelong') {
        return 'legacy';
      }
      reading = macro.unquoted === true || reading === 'unquoted' ? 'unquoted' : 'quoted';
    }
  }
  return reading;
}

/**
 * TFunctionImpl.canCover: whether parameters take `count` arguments by
 * position and those named in `named`, the others having defaults.
 */
export function covers(parameters: readonly Parameter[], count: number, named: readonly string[]): boolean {
  if (count > parameters.length || named.some((name) => !parameters.some((parameter) => parameter.name === name))) {
    return false;
  }
  const needed = parameters.filter((parameter) => parameter.default === undefined && !named.includes(parameter.name));
  return count >= needed.length;
}

/**
 * The definitions a call of `name` with `count` arguments by position and
 * those named in `named` may stand for, as the engine picks one
 * (FunctionsSet.getFunctionSmart): those with as many parameters as there
 * are arguments by position, or else each that takes the call. The engine
 * picks among several of the latter in an order that is not the order they
 * were written in, so more than one leaves the call ambiguous. Null when
 * none may.
 */
export function definitionsFor(
  macros: Macros,
  name: string,
  count: number,
  named: readonly string[]
): MacroEntry | null {
  const exact = macros.callables.get(callableKey(name, count));
  if (exact?.candidates.some((candidate) => !candidate.conditional) === true) {
    return exact;
  }
  // Without one that is surely there, the call may fall to one that takes it.
  const found = callablesNamed(macros, name).flatMap((entry) =>
    entry.candidates
      .filter((candidate) => entry === exact || covers(candidate.macro.parameters ?? [], count, named))
      .map((candidate) => ({ candidate, entry }))
  );
  const only = found.length === 1 ? found[0] : undefined;
  if (only !== undefined) {
    // One of several of its name and number of parameters is never resolved.
    return { candidates: [only.candidate], certainty: only.entry.certainty };
  }
  if (found.length === 0) {
    return null;
  }
  const unresolved = found.some(({ entry }) => entry.certainty === 'unresolved');
  return { candidates: found.map(({ candidate }) => candidate), certainty: unresolved ? 'unresolved' : 'ambiguous' };
}
