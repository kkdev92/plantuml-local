import { opendir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import * as vscode from 'vscode';

import { ANALYSIS_LIMITS, WORKSPACE_SYMBOL_LIMITS } from '../core/constants';
import { splitLines } from '../core/lines';
import type { MessageLocalizer } from '../core/messages';
import { MARKDOWN, PLANTUML, SKIPPED } from '../export/folder';
import { sha256 } from '../export/ownership';
import { readIncludeFile, type ReadRefusal } from '../includes/reader';
import { isWithin } from '../includes/resolver';
import { pathKey } from '../includes/tracking';
import { pastAnalysisLimits } from './macros';
import {
  compileExclude,
  fileSymbols,
  matchesQuery,
  walkRoots,
  type EntryKind,
  type ExcludeProblem,
  type FileSymbol,
  type Shortfall,
  type WalkRoot,
} from './workspace-symbols';

/**
 * Go to Symbol in Workspace (`Ctrl+T`) for the diagrams and declarations of
 * the Markdown and PlantUML files of the workspace folders, as
 * src/language/workspace-symbols.ts finds them.
 *
 * Nothing is read until a query is typed: the first one walks the trusted
 * workspace folders on disk and reads their files, once, and the queries
 * after it are answered from what was found. An empty query reads nothing,
 * and gets what was found, if anything. Only what was found in each file
 * is kept, with a hash of its text, not the text; an open document is
 * searched as it is in the editor. A file created, deleted or changed on
 * disk is seen through a watcher: the next query searches again, or reads
 * the changed file again. In Restricted Mode nothing is read or listed.
 *
 * A symbol is given without its place in the file: it is found again only
 * when it is picked, in the text as it is then. If the file has changed
 * since, the one declaration of the same name, kind and diagram is gone to;
 * if there is none, or more than one, a warning asks to search again and
 * nothing is opened. VS Code opens the file at the symbol given at first if
 * it gets no answer then, so the failure is an error, not an empty answer.
 *
 * What a search left out, other than what it never reads, is said in the
 * status bar and written to the output: a folder not on disk or with a
 * setting it cannot read, a file it cannot read, a limit it stopped at.
 */

/** How long a message of the search stays in the status bar, in milliseconds. */
const STATUS_MS = 10_000;

export interface WorkspaceSymbolDeps {
  l10n: MessageLocalizer;
  /** Writes to the extension's output. */
  log(message: string): void;
  /** Shows a warning with buttons; resolves to the place of the one chosen. */
  warn(message: string, buttons: readonly string[]): Promise<number | undefined>;
  /** Opens the Settings editor at plantumlLocal.workspaceSymbols.exclude. */
  openExcludeSetting(): Promise<unknown>;
  /** plantumlLocal.workspaceSymbols.enabled for a workspace folder. */
  enabled(folder: vscode.Uri): boolean;
  /** plantumlLocal.workspaceSymbols.exclude for a workspace folder, as written. */
  exclude(folder: vscode.Uri): unknown;
}

/** What a version of a file's text declares. */
interface Parsed {
  /** The SHA-256 of the text. */
  hash: string;
  symbols: readonly FileSymbol[];
}

/** Where a file is: what to read it again by, and what VS Code knows it by. */
interface Located {
  /** As VS Code knows it: under its workspace folder as that was opened. */
  uri: vscode.Uri;
  /** {@link keyOf} its URI. */
  key: string;
  /** The real path of its workspace folder, and its own path under that, as read. */
  root: string;
  path: string;
  markdown: boolean;
}

interface IndexedFile extends Located {
  /** Its workspace folder, by its place in the order searched. */
  folder: number;
  /** Its path from its workspace folder, `/` between the segments, for the order of the answer. */
  relative: string;
  parsed: Parsed;
  /** Changed on disk since it was read. */
  changed: boolean;
}

/** What a search left out that it would have read. */
type Note =
  | { kind: 'virtual'; folder: string }
  | { kind: 'exclude'; folder: string; problem: ExcludeProblem }
  | { kind: 'unreachable'; folder: string }
  | { kind: 'limit'; limit: Exclude<Shortfall, 'unlisted'> }
  | { kind: 'unlisted'; path: string }
  | { kind: 'unread'; path: string; why: ReadRefusal | 'too-long' }
  | { kind: 'failed'; error: string };

interface Scan {
  /** The real paths of the workspace folders searched, in order. */
  roots: string[];
  /** By {@link keyOf} their URIs. */
  files: Map<string, IndexedFile>;
  notes: Note[];
  /** Settles when the files are read. */
  done: Promise<void>;
  finished: boolean;
}

/** What a symbol given to VS Code was found as. */
interface Found extends Located {
  hash: string;
  symbol: FileSymbol;
}

/** How a path is compared, as the watchers of includes compare one. */
function keyOf(uri: vscode.Uri): string {
  return pathKey(uri.fsPath);
}

function parse(text: string, markdown: boolean): Parsed {
  return { hash: sha256(Buffer.from(text, 'utf8')), symbols: fileSymbols(text, markdown) };
}

/** Reads a file under `root` as an include is read, links refused, within the limits of the background reading. */
async function readText(
  root: string,
  path: string
): Promise<{ kind: 'text'; text: string } | { kind: 'missing' } | { kind: 'refused'; why: ReadRefusal | 'too-long' }> {
  const read = await readIncludeFile(root, path, { openText: () => undefined, maxBytes: ANALYSIS_LIMITS.fileBytes });
  if (read.kind === 'missing') {
    return read;
  }
  if (read.kind === 'refused') {
    return { kind: 'refused', why: read.refusal };
  }
  if (splitLines(read.text).length > ANALYSIS_LIMITS.fileLines) {
    return { kind: 'refused', why: 'too-long' };
  }
  return { kind: 'text', text: read.text };
}

/** The entries of a directory one at a time, as the system lists them, links not followed. */
async function* listDirectory(path: string): AsyncIterable<{ name: string; kind: EntryKind }> {
  const directory = await opendir(path);
  for await (const entry of directory) {
    const kind: EntryKind = entry.isSymbolicLink()
      ? 'link'
      : entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : 'other';
    yield { name: entry.name, kind };
  }
}

/** Settles when `promise` does or `token` is cancelled. */
async function until(promise: Promise<unknown>, token: vscode.CancellationToken): Promise<void> {
  let listener: vscode.Disposable | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        listener = token.onCancellationRequested(() => resolve());
        if (token.isCancellationRequested) {
          resolve();
        }
      }),
    ]);
  } finally {
    listener?.dispose();
  }
}

export class WorkspaceSymbolSearch implements vscode.WorkspaceSymbolProvider<vscode.SymbolInformation>, vscode.Disposable {
  private scan: Scan | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private status: vscode.Disposable | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  /** The settings warned about, by folder and value: each is warned about once. */
  private readonly warned = new Set<string>();
  /** What each symbol given to VS Code was found as. */
  private readonly found = new WeakMap<vscode.SymbolInformation, Found>();
  /** What each open document declares, for the version it was read at; null past the limits. */
  private readonly opened = new Map<string, { version: number; parsed: Parsed | null }>();
  private readonly kinds: Readonly<Record<string, vscode.SymbolKind>> = {
    diagram: vscode.SymbolKind.Module,
    package: vscode.SymbolKind.Package,
    namespace: vscode.SymbolKind.Namespace,
    class: vscode.SymbolKind.Class,
    abstract: vscode.SymbolKind.Class,
    interface: vscode.SymbolKind.Interface,
    annotation: vscode.SymbolKind.Interface,
    enum: vscode.SymbolKind.Enum,
    procedure: vscode.SymbolKind.Method,
    function: vscode.SymbolKind.Function,
    define: vscode.SymbolKind.Function,
    definelong: vscode.SymbolKind.Function,
    constant: vscode.SymbolKind.Constant,
  };

  constructor(private readonly deps: WorkspaceSymbolDeps) {
    this.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.opened.delete(keyOf(document.uri));
      })
    );
  }

  /** Forgets what was found: the folders, the settings or the trust have changed. A search under way stops. */
  reset(): void {
    this.scan = undefined;
  }

  async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
    const { l10n } = this.deps;
    if (!(vscode.workspace.workspaceFolders ?? []).some((folder) => this.deps.enabled(folder.uri))) {
      return [];
    }
    if (!vscode.workspace.isTrusted) {
      this.say(l10n.t('PlantUML Local does not search the Markdown and PlantUML files of the workspace in Restricted Mode.'));
      return [];
    }
    if (query.length > WORKSPACE_SYMBOL_LIMITS.query) {
      this.say(
        l10n.t(
          'PlantUML Local does not search for text longer than {0} characters.',
          String(WORKSPACE_SYMBOL_LIMITS.query)
        )
      );
      return [];
    }
    let scan = this.scan;
    if (query === '') {
      if (scan?.finished !== true) {
        this.say(l10n.t('Type to search the diagrams and declarations of the Markdown and PlantUML files.'));
        return [];
      }
    } else {
      scan = this.started();
      await until(scan.done, token);
      if (token.isCancellationRequested || scan !== this.scan) {
        return [];
      }
      await this.readChanged(scan, token);
      if (token.isCancellationRequested || scan !== this.scan) {
        return [];
      }
    }
    return this.answer(scan, query);
  }

  async resolveWorkspaceSymbol(symbol: vscode.SymbolInformation, token: vscode.CancellationToken): Promise<vscode.SymbolInformation> {
    const found = this.found.get(symbol);
    const now = found === undefined || token.isCancellationRequested ? null : await this.current(found);
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const same =
      found === undefined || now === null
        ? []
        : now.hash === found.hash
          ? [found.symbol]
          : now.symbols.filter(
              ({ name, kind, diagram }) =>
                name === found.symbol.name && kind === found.symbol.kind && diagram === found.symbol.diagram
            );
    const [at] = same;
    if (at === undefined || same.length > 1) {
      void this.deps.warn(
        this.deps.l10n.t(
          '{0} in {1} has changed or is gone since the search. Search for it again.',
          symbol.name,
          vscode.workspace.asRelativePath(symbol.location.uri)
        ),
        []
      );
      // Not an empty answer, which VS Code takes for the symbol as it was given.
      throw new vscode.CancellationError();
    }
    return new vscode.SymbolInformation(
      symbol.name,
      symbol.kind,
      symbol.containerName,
      new vscode.Location(symbol.location.uri, new vscode.Range(at.line, at.start, at.line, at.end))
    );
  }

  dispose(): void {
    this.scan = undefined;
    this.status?.dispose();
    this.watcher?.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** The search of the files as they are, started if there is none. */
  private started(): Scan {
    if (this.scan !== undefined) {
      return this.scan;
    }
    this.watch();
    const scan: Scan = { roots: [], files: new Map(), notes: [], done: Promise.resolve(), finished: false };
    this.scan = scan;
    scan.done = this.run(scan).catch((error: unknown) => {
      scan.notes.push({ kind: 'failed', error: String(error) });
      scan.finished = true;
      this.log(scan.notes);
    });
    return scan;
  }

  /** Watches the workspace, from the first search on, for what makes what was found out of date. */
  private watch(): void {
    if (this.watcher !== undefined) {
      return;
    }
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidCreate((uri) => this.changedOnDisk(uri, false));
    this.watcher.onDidChange((uri) => this.changedOnDisk(uri, true));
    this.watcher.onDidDelete((uri) => this.changedOnDisk(uri, false));
  }

  /** A file or a folder created, changed or deleted on disk: `changed` for a change of a file. */
  private changedOnDisk(uri: vscode.Uri, changed: boolean): void {
    const scan = this.scan;
    const folder = scan === undefined || uri.scheme !== 'file' ? undefined : vscode.workspace.getWorkspaceFolder(uri);
    if (scan === undefined || folder === undefined) {
      return;
    }
    const file = scan.files.get(keyOf(uri));
    if (changed && file !== undefined) {
      file.changed = true;
      return;
    }
    const name = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    if (changed && !MARKDOWN.test(name) && !PLANTUML.test(name)) {
      return;
    }
    // Reported under the folder as it was opened (createFileSystemWatcher), so its path starts as the folder's does.
    if (uri.path.slice(folder.uri.path.length).split('/').some((segment) => SKIPPED.has(segment))) {
      return;
    }
    // A file to read, or a folder that may hold some: search again.
    this.reset();
  }

  private async run(scan: Scan): Promise<void> {
    const started = Date.now();
    const stopped = (): boolean => this.scan !== scan;
    const folders = vscode.workspace.workspaceFolders ?? [];
    // Real paths, to find a folder inside another.
    const reals = await Promise.all(
      folders.map((folder) =>
        folder.uri.scheme === 'file' ? realpath(folder.uri.fsPath).catch(() => undefined) : Promise.resolve(undefined)
      )
    );
    const roots: WalkRoot[] = [];
    const opened: vscode.WorkspaceFolder[] = [];
    for (const [index, folder] of folders.entries()) {
      const real = reals[index];
      if (!this.deps.enabled(folder.uri)) {
        continue;
      }
      if (folder.uri.scheme !== 'file') {
        this.note(scan, { kind: 'virtual', folder: folder.name });
        continue;
      }
      if (real === undefined) {
        this.note(scan, { kind: 'unreachable', folder: folder.name });
        continue;
      }
      // A folder opened twice, by two paths.
      if (reals.slice(0, index).some((other) => other !== undefined && pathKey(other) === pathKey(real))) {
        continue;
      }
      const exclude = compileExclude(this.deps.exclude(folder.uri));
      if (typeof exclude !== 'function') {
        this.note(scan, { kind: 'exclude', folder: folder.name, problem: exclude });
        this.warnAbout(folder, exclude);
        continue;
      }
      const inner = new Set(
        reals
          .filter((other): other is string => other !== undefined && pathKey(other) !== pathKey(real) && isWithin(real, other))
          .map((other) => pathKey(relative(real, other).split(sep).join('/')))
      );
      scan.roots.push(real);
      opened.push(folder);
      roots.push({ path: real, exclude, inner: (segments) => inner.has(pathKey(segments.join('/'))) });
    }

    const walk = await walkRoots(roots, { list: listDirectory, join, now: Date.now, stopped }, started);
    for (const path of walk.unlisted) {
      this.note(scan, { kind: 'unlisted', path: this.shown(scan.roots, opened, path) });
    }
    for (const shortfall of walk.shortfalls) {
      if (shortfall !== 'unlisted') {
        this.note(scan, { kind: 'limit', limit: shortfall });
      }
    }
    for (const found of walk.files) {
      if (stopped()) {
        return;
      }
      if (Date.now() - started > WORKSPACE_SYMBOL_LIMITS.milliseconds) {
        if (!walk.shortfalls.has('time')) {
          this.note(scan, { kind: 'limit', limit: 'time' });
        }
        break;
      }
      const root = scan.roots[found.root] ?? '';
      const folder = opened[found.root] as vscode.WorkspaceFolder;
      const uri = vscode.Uri.file(join(folder.uri.fsPath, ...found.segments));
      const read = await readText(root, found.path);
      if (read.kind === 'refused') {
        this.note(scan, { kind: 'unread', path: vscode.workspace.asRelativePath(uri), why: read.why });
      }
      if (read.kind !== 'text') {
        continue;
      }
      const key = keyOf(uri);
      scan.files.set(key, {
        uri,
        key,
        root,
        path: found.path,
        markdown: found.markdown,
        folder: found.root,
        relative: found.segments.join('/'),
        parsed: parse(read.text, found.markdown),
        changed: false,
      });
    }
    if (stopped()) {
      return;
    }
    scan.finished = true;
    this.log(scan.notes);
  }

  /** A path read under one of `roots`, shown as VS Code shows the file at it. */
  private shown(roots: readonly string[], opened: readonly vscode.WorkspaceFolder[], path: string): string {
    const at = roots.findIndex((root) => isWithin(root, path));
    const folder = opened[at];
    return folder === undefined
      ? path
      : vscode.workspace.asRelativePath(vscode.Uri.file(join(folder.uri.fsPath, relative(roots[at] ?? '', path))));
  }

  /** Reads again the files changed on disk since they were read. */
  private async readChanged(scan: Scan, token: vscode.CancellationToken): Promise<void> {
    for (const [key, file] of scan.files) {
      if (!file.changed) {
        continue;
      }
      if (token.isCancellationRequested || this.scan !== scan) {
        return;
      }
      file.changed = false;
      const read = await readText(file.root, file.path);
      if (read.kind === 'text') {
        file.parsed = parse(read.text, file.markdown);
        continue;
      }
      scan.files.delete(key);
      if (read.kind === 'refused') {
        this.note(scan, { kind: 'unread', path: vscode.workspace.asRelativePath(file.uri), why: read.why });
      }
    }
  }

  /** What an open document declares as it is in the editor, read once for each version; null past the limits. */
  private parsedOpen(key: string, document: vscode.TextDocument, markdown: boolean): Parsed | null {
    const known = this.opened.get(key);
    if (known?.version === document.version) {
      return known.parsed;
    }
    const text = document.getText();
    const parsed = pastAnalysisLimits(text) ? null : parse(text, markdown);
    this.opened.set(key, { version: document.version, parsed });
    return parsed;
  }

  /** What the file of `found` declares now: as open in the editor, or as on disk. Null when it cannot be read. */
  private async current(found: Found): Promise<Parsed | null> {
    const document = vscode.workspace.textDocuments.find(
      (open) => open.uri.scheme === 'file' && keyOf(open.uri) === found.key
    );
    if (document !== undefined) {
      return this.parsedOpen(found.key, document, found.markdown);
    }
    const read = await readText(found.root, found.path);
    return read.kind === 'text' ? parse(read.text, found.markdown) : null;
  }

  /** The symbols that match `query`, in the order of the folders, the paths and the lines, cut at the limit. */
  private answer(scan: Scan, query: string): vscode.SymbolInformation[] {
    const open = new Map<string, vscode.TextDocument>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === 'file') {
        open.set(keyOf(document.uri), document);
      }
    }
    const matched: { file: IndexedFile; hash: string; symbol: FileSymbol }[] = [];
    for (const [key, file] of scan.files) {
      const document = open.get(key);
      const parsed = document === undefined ? file.parsed : this.parsedOpen(key, document, file.markdown);
      for (const symbol of parsed?.symbols ?? []) {
        if (matchesQuery(symbol.name, query)) {
          matched.push({ file, hash: parsed?.hash ?? '', symbol });
        }
      }
    }
    matched.sort(
      (a, b) =>
        a.file.folder - b.file.folder ||
        (a.file.relative < b.file.relative ? -1 : a.file.relative > b.file.relative ? 1 : 0) ||
        a.symbol.line - b.symbol.line ||
        a.symbol.start - b.symbol.start
    );
    const cut = matched.length > ANALYSIS_LIMITS.results;
    this.report(scan, cut);
    return matched.slice(0, ANALYSIS_LIMITS.results).map(({ file, hash, symbol }) => {
      // No range: it is found again when picked (resolveWorkspaceSymbol).
      const location = new vscode.Location(file.uri, undefined as unknown as vscode.Range);
      const information = new vscode.SymbolInformation(
        symbol.name,
        this.kinds[symbol.kind] ?? vscode.SymbolKind.Object,
        this.containerOf(symbol),
        location
      );
      const { uri, key, root, path, markdown } = file;
      this.found.set(information, { uri, key, root, path, markdown, hash, symbol });
      return information;
    });
  }

  /**
   * What VS Code shows beside a symbol, before the file's path: the diagram
   * it is in, what declares it, its line, and whether running the text may
   * leave it out or its diagram, block or body has no end line. The line
   * also keeps two declarations of one name in one file apart: VS Code
   * merges symbols alike in all of these and their place.
   */
  private containerOf(symbol: FileSymbol): string {
    const { l10n } = this.deps;
    return [
      symbol.kind === 'diagram' ? '' : symbol.diagram,
      symbol.label,
      l10n.t('line {0}', String(symbol.line + 1)),
      symbol.conditional ? l10n.t('conditional') : '',
      symbol.unclosed ? l10n.t('unclosed') : '',
    ]
      .filter((part) => part !== '')
      .join(' · ');
  }

  /** Says in the status bar whether the answer is cut, and whether the search left something out. */
  private report(scan: Scan, cut: boolean): void {
    const { l10n } = this.deps;
    const limit = String(ANALYSIS_LIMITS.results);
    const partial = scan.notes.length > 0;
    this.say(
      cut && partial
        ? l10n.t(
            'PlantUML Local: only the first {0} diagrams and declarations are listed, and not every Markdown and PlantUML file was searched. See the Output panel for why.',
            limit
          )
        : cut
          ? l10n.t('PlantUML Local: only the first {0} diagrams and declarations are listed.', limit)
          : partial
            ? l10n.t('PlantUML Local: not every Markdown and PlantUML file was searched. See the Output panel for why.')
            : undefined
    );
  }

  private say(text: string | undefined): void {
    this.status?.dispose();
    this.status = text === undefined ? undefined : vscode.window.setStatusBarMessage(text, STATUS_MS);
  }

  /** Keeps what a search left out; logs it at once when the search has already been logged. */
  private note(scan: Scan, note: Note): void {
    scan.notes.push(note);
    if (scan.finished && this.scan === scan) {
      this.log([note]);
    }
  }

  private log(notes: readonly Note[]): void {
    if (notes.length === 0) {
      return;
    }
    const { l10n } = this.deps;
    this.deps.log(
      [
        l10n.t('Go to Symbol in Workspace did not search every Markdown and PlantUML file:'),
        ...notes.map((note) => this.describe(note)),
      ].join('\n')
    );
  }

  private describe(note: Note): string {
    const { l10n } = this.deps;
    const limits = WORKSPACE_SYMBOL_LIMITS;
    switch (note.kind) {
      case 'virtual':
        return l10n.t('{0}: the folder is not on disk, and is not searched.', note.folder);
      case 'exclude':
        return l10n.t(
          '{0}: plantumlLocal.workspaceSymbols.exclude is not valid, and the folder is not searched. {1}',
          note.folder,
          this.problemText(note.problem)
        );
      case 'unreachable':
        return l10n.t('{0}: the folder cannot be read.', note.folder);
      case 'unlisted':
        return l10n.t('{0}: the folder cannot be listed.', note.path);
      case 'unread':
        return note.why === 'too-large' || note.why === 'too-long'
          ? l10n.t(
              '{0}: larger than {1} MiB or longer than {2} lines, and not read.',
              note.path,
              String(ANALYSIS_LIMITS.fileBytes / (1024 * 1024)),
              String(ANALYSIS_LIMITS.fileLines)
            )
          : note.why === 'encoding' || note.why === 'nul'
            ? l10n.t('{0}: not UTF-8 text, and not read.', note.path)
            : l10n.t('{0}: cannot be read.', note.path);
      case 'limit':
        switch (note.limit) {
          case 'files':
            return l10n.t('The search stopped at {0} files.', String(limits.files));
          case 'directories':
            return l10n.t('The search stopped at {0} folders.', String(limits.directories));
          case 'entries':
            return l10n.t('The search stopped at {0} entries of folders.', String(limits.entries));
          case 'depth':
            return l10n.t('Folders more than {0} levels deep were not searched.', String(limits.depth));
          case 'time':
            return l10n.t('The search stopped after {0} seconds.', String(limits.milliseconds / 1000));
        }
        return '';
      case 'failed':
        return l10n.t('The search failed: {0}', note.error);
    }
  }

  /** Warns, once for each folder and value, that its setting is refused and the folder not searched. */
  private warnAbout(folder: vscode.WorkspaceFolder, problem: ExcludeProblem): void {
    const key = `${folder.uri.toString()}\n${JSON.stringify(this.deps.exclude(folder.uri)) ?? ''}`;
    if (this.warned.has(key)) {
      return;
    }
    this.warned.add(key);
    const { l10n } = this.deps;
    void this.deps
      .warn(
        l10n.t(
          'Go to Symbol in Workspace does not search the folder {0} until plantumlLocal.workspaceSymbols.exclude is fixed. {1}',
          folder.name,
          this.problemText(problem)
        ),
        [l10n.t('Open Settings')]
      )
      .then((chosen) => (chosen === 0 ? this.deps.openExcludeSetting() : undefined));
  }

  private problemText(problem: ExcludeProblem): string {
    const { l10n } = this.deps;
    if (problem.kind === 'not-a-list') {
      return l10n.t('It is not a list of patterns.');
    }
    if (problem.kind === 'too-many') {
      return l10n.t(
        'It has {0} patterns; it can have {1}.',
        String(problem.count),
        String(WORKSPACE_SYMBOL_LIMITS.patterns)
      );
    }
    const at = String(problem.index + 1);
    const written = JSON.stringify(problem.pattern) ?? String(problem.pattern);
    const pattern = written.length > 64 ? `${written.slice(0, 63)}…` : written;
    switch (problem.problem) {
      case 'not-text':
        return l10n.t('Pattern {0}, {1}, is not text.', at, pattern);
      case 'too-long':
        return l10n.t(
          'Pattern {0}, {1}, is longer than {2} characters.',
          at,
          pattern,
          String(WORKSPACE_SYMBOL_LIMITS.patternLength)
        );
      case 'empty':
        return l10n.t('Pattern {0} is empty.', at);
      case 'negation':
        return l10n.t('Pattern {0}, {1}, starts with !, which cannot bring paths back.', at, pattern);
      case 'backslash':
        return l10n.t('Pattern {0}, {1}, has a \\. Separate the folders with /.', at, pattern);
      case 'colon':
        return l10n.t('Pattern {0}, {1}, has a colon, as a drive or a URL has. Write a path from the workspace folder.', at, pattern);
      case 'brackets':
        return l10n.t('Pattern {0}, {1}, has braces or brackets, which this setting does not read.', at, pattern);
      case 'absolute':
        return l10n.t('Pattern {0}, {1}, starts with /. Write a path from the workspace folder.', at, pattern);
      case 'trailing-slash':
        return l10n.t('Pattern {0}, {1}, ends with /. For a folder and what it holds, write folder/**.', at, pattern);
      case 'empty-segment':
        return l10n.t('Pattern {0}, {1}, has // in it.', at, pattern);
      case 'dot-segment':
        return l10n.t('Pattern {0}, {1}, has . or .. as a folder.', at, pattern);
      case 'double-star':
        return l10n.t('Pattern {0}, {1}, has ** with other characters between two /.', at, pattern);
    }
  }
}
