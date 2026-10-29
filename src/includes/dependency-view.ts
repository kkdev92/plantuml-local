import * as vscode from 'vscode';

import { COMMANDS, DEPENDENCIES_VIEW } from '../core/constants';
import type { MessageLocalizer } from '../core/messages';
import type { DrawnRequest, LibraryRead } from '../core/types';
import { LIBRARY_SCHEME, libraryPath } from '../language/library-view';
import { dependencyTree, type DependencyNode, type LineNode, type RequestNode } from './dependency-tree';
import { includeDirectives } from './directives';
import { requestKey, type DrawingRecord, type DrawingRecords } from './drawings';
import { accessFor, asOpened, type IncludeHost } from './host';
import { locateIncludeFile } from './reader';
import { isWithin } from './resolver';
import { pathKey } from './tracking';

/**
 * The Diagram Dependencies view, in the Explorer: for each diagram of the
 * active editor, what its last drawing asked for, as
 * src/includes/dependency-tree.ts lays it out; and for a file such
 * drawings read, the diagrams of open documents that read it.
 *
 * While the view is visible, it draws a diagram it has no drawing of, or
 * whose drawing is out of date, as the Problems panel would, unless that
 * draws it first. Its commands act on its own items and on nothing else. A
 * file opens only once it is found again where a drawing would read it,
 * and a line of a document only while the document is as it was when the
 * item was made.
 */

/** How long the view waits for a diagram to be drawn by others before it draws it itself, in milliseconds. */
const DRAW_AFTER_MS = 1000;
/** How long changes are gathered before the view is laid out again, in milliseconds. */
const REFRESH_MS = 100;

/**
 * The tooltip of an item: its label and its description, then `lines`.
 * VS Code reads an item's tooltip out, when it is a string, in place of its
 * label and its description.
 */
function tooltipOf(label: string, description: string | undefined, ...lines: string[]): string {
  return [label, description ?? '', ...lines].filter((line) => line !== '').join('\n');
}

/** A diagram of a document, as the view lists it. */
export interface ViewDiagram {
  /** Its name, or null for a block without one. */
  name: string | null;
  /** Its text as written, which begins on document line `sourceLine`. */
  text: string;
  sourceLine: number;
  /** The document lines it spans, from its first line to its last. */
  openLine: number;
  closeLine: number;
  /** The document line it starts on, where the view goes to it. */
  startLine: number;
  /** The text drawn, or why it is not drawn. */
  render: string | { notDrawn: string };
}

export interface DependencyViewHost extends Pick<IncludeHost, 'includePaths'> {
  records: DrawingRecords;
  /** The diagrams of `document`, as the Problems panel finds them; none for a document that holds none. */
  diagrams(document: vscode.TextDocument): ViewDiagram[];
  /** Draws `source` for `document` as the Problems panel does, so that its drawing is kept in `records`. */
  draw(source: string, document: vscode.Uri): Promise<unknown>;
  l10n: MessageLocalizer;
}

/** A document, at the version an item was made from, and the line the text of its diagram begins on. */
interface Place {
  document: vscode.Uri;
  version: number;
  sourceLine: number;
}

interface DiagramItem {
  type: 'diagram';
  parent?: undefined;
  place: Place;
  diagram: ViewDiagram;
  /** The id of its row, as the view lists it. */
  id?: string;
  record?: DrawingRecord;
  children: Item[];
}

/** The row of a diagram as last listed: its id, and whether VS Code took it as closed. */
interface ListedRow {
  id: string;
  closed: boolean;
}

interface RequestItem {
  type: 'request';
  parent: Item;
  /** The diagram it was asked for. */
  diagram: DiagramItem;
  node: RequestNode;
  children: Item[];
}

interface GroupItem {
  type: 'lines' | 'libraries' | 'readers';
  parent?: Item;
  children: Item[];
}

type Item =
  | DiagramItem
  | RequestItem
  | GroupItem
  | { type: 'line'; parent: Item; diagram: DiagramItem; node: LineNode }
  | { type: 'library'; parent: Item; read: LibraryRead }
  | { type: 'more'; parent: Item; count: number }
  | { type: 'reader'; parent: Item; record: DrawingRecord; name: string };

export class DependencyView implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Item>;
  private readonly subscriptions: vscode.Disposable[] = [];
  /** The items at the top, until what they show changes. */
  private roots: Item[] | undefined;
  /** The items made since the view was last laid out: the only ones its commands act on. */
  private issued = new WeakSet<object>();
  private refreshTimer: NodeJS.Timeout | undefined;
  /** Diagrams waited for, or being drawn (null), by document and text. */
  private readonly drawing = new Map<string, NodeJS.Timeout | null>();
  /** The rows of the diagrams last listed, by document and place among its diagrams. */
  private listed = new Map<string, ListedRow>();
  /** The rows made so far, which numbers the id of the next. */
  private made = 0;

  constructor(private readonly host: DependencyViewHost) {
    this.view = vscode.window.createTreeView(DEPENDENCIES_VIEW, { treeDataProvider: this, showCollapseAll: true });
    this.subscriptions.push(
      this.view,
      this.changed,
      this.view.onDidChangeVisibility(() => {
        this.refresh();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0 && event.document === vscode.window.activeTextEditor?.document) {
          this.refresh();
        }
      }),
      host.records.onDidChange(() => {
        this.refresh();
      })
    );
  }

  /**
   * Shows the view with the keyboard on the diagram at the cursor, selected
   * and opened up, or else on its first item.
   */
  async show(): Promise<void> {
    const line = vscode.window.activeTextEditor?.selection.active.line;
    await vscode.commands.executeCommand(`${DEPENDENCIES_VIEW}.focus`);
    const roots = this.rootItems();
    const at = roots.find(
      (item) => item.type === 'diagram' && line !== undefined && item.diagram.openLine <= line && line <= item.diagram.closeLine
    );
    // Focusing the view alone may leave the keyboard on none of its items.
    const shown =
      at !== undefined
        ? this.view.reveal(at, { select: true, focus: true, expand: true })
        : roots[0] !== undefined
          ? this.view.reveal(roots[0], { select: false, focus: true })
          : undefined;
    // The view may have been laid out again meanwhile, without the item.
    await Promise.resolve(shown).catch(() => undefined);
  }

  /**
   * Opens what `item` stands for: the file a request read, else the line
   * that asked for it; an include line; a bundled library's file; or a
   * diagram. Returns why it did not, when it did not.
   */
  async open(item: unknown): Promise<string | undefined> {
    if (!this.isIssued(item)) {
      return undefined;
    }
    const { l10n } = this.host;
    switch (item.type) {
      case 'diagram':
        return this.goTo(item.place, item.diagram.startLine);
      case 'line':
        return this.goTo(item.diagram.place, item.diagram.place.sourceLine + item.node.directive.line);
      case 'request': {
        const { request } = item.node;
        if (request.state !== 'read' || request.id === undefined) {
          return this.goToInclude(item);
        }
        const found = await this.findAgain(item.diagram.place.document, request.id, request.path);
        if ('refused' in found) {
          return found.refused;
        }
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(found.path));
        return undefined;
      }
      case 'library':
        if (!item.read.found) {
          return undefined;
        }
        await vscode.commands.executeCommand(
          'vscode.open',
          vscode.Uri.from({ scheme: LIBRARY_SCHEME, path: libraryPath(item.read.library, item.read.key) })
        );
        return undefined;
      case 'reader': {
        const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === item.record.document);
        const diagram = open === undefined ? undefined : this.diagramOf(open, item.record.source);
        if (open === undefined || diagram === undefined) {
          this.refresh();
          return l10n.t('The diagram has changed. The list has been updated; choose the item again.');
        }
        await vscode.window.showTextDocument(open, { selection: new vscode.Range(diagram.startLine, 0, diagram.startLine, 0) });
        return undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * Goes to the line that asked for what the request `item` stands for: a
   * line of the diagram, or of the file it was asked from, written as it
   * asked. With several, the user picks one; with none, the diagram or the
   * file opens at its start, and the line is said not to be known.
   */
  async goToInclude(item: unknown): Promise<string | undefined> {
    if (!this.isIssued(item) || item.type !== 'request') {
      return undefined;
    }
    const { l10n } = this.host;
    const { request } = item.node;
    const unknown = l10n.t('The line that asked for {0} is not known.', request.path);
    const { place } = item.diagram;
    if (request.from === null) {
      if (item.node.lines.length === 0) {
        return (await this.goTo(place, item.diagram.diagram.startLine)) ?? unknown;
      }
      const line = await this.pickLine(item.node.lines.map((index) => place.sourceLine + index), request.path);
      return line === undefined ? undefined : this.goTo(place, line);
    }
    const asker = item.parent.type === 'request' ? item.parent.node.request.file : undefined;
    if (asker === undefined) {
      return unknown;
    }
    const found = await this.findAgain(place.document, request.from, asker);
    if ('refused' in found) {
      return found.refused;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(found.path));
    const lines = [
      ...new Set(
        includeDirectives(document.getText())
          .filter(
            (directive) =>
              directive.literal && directive.path === request.path && (request.kind ?? directive.kind) === directive.kind
          )
          .map((directive) => directive.line)
      ),
    ];
    const line = lines.length === 0 ? 0 : await this.pickLine(lines, request.path);
    if (line === undefined) {
      return undefined;
    }
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(line, 0, line, 0) });
    return lines.length === 0 ? unknown : undefined;
  }

  getChildren(item?: Item): Item[] {
    return item === undefined ? this.rootItems() : 'children' in item ? item.children : [];
  }

  getParent(item: Item): Item | undefined {
    return item.parent;
  }

  getTreeItem(item: Item): vscode.TreeItem {
    const { l10n } = this.host;
    const open = (title: string): vscode.Command => ({ command: COMMANDS.OPEN_DEPENDENCY, title, arguments: [item] });
    const group = (label: string, collapsed: boolean, icon: string, description: string, about: string): vscode.TreeItem => {
      const tree = new vscode.TreeItem(
        label,
        collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      );
      tree.iconPath = new vscode.ThemeIcon(icon);
      tree.description = description;
      tree.tooltip = tooltipOf(label, description, about);
      return tree;
    };
    switch (item.type) {
      case 'diagram': {
        const name = this.diagramName(item.diagram);
        const tree = new vscode.TreeItem(
          name,
          item.children.length === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded
        );
        tree.id = item.id;
        const { description, icon, note } = this.diagramState(item);
        tree.description = description;
        tree.iconPath = new vscode.ThemeIcon(icon);
        tree.tooltip = tooltipOf(
          name,
          description,
          note,
          l10n.t(
            'What its last drawing asked for, and its include lines that no request matches. A file read was given to the engine, which may skip it or use only part of it.'
          )
        );
        tree.command = open(l10n.t('Go to Diagram'));
        tree.contextValue = 'diagram';
        return tree;
      }
      case 'request':
        return this.requestItem(item, open);
      case 'lines':
        return group(
          l10n.t('Other include lines'),
          true,
          'file-code',
          String(item.children.length),
          l10n.t(
            'Include lines of the diagram that no request above matches. A line whose path uses a variable or a function matches none, as its path is worked out when the diagram is drawn.'
          )
        );
      case 'line': {
        const { directive, why } = item.node;
        const said =
          why === 'not-asked'
            ? l10n.t('not asked for when drawn')
            : why === 'in-body'
              ? l10n.t('read when its procedure or function runs')
              : l10n.t('path worked out when drawn');
        const tree = new vscode.TreeItem(directive.path, vscode.TreeItemCollapsibleState.None);
        const line = item.diagram.place.sourceLine + directive.line + 1;
        tree.description = [`!${directive.kind}`, said, l10n.t('line {0}', String(line))].join(' · ');
        tree.iconPath = new vscode.ThemeIcon('circle-outline');
        tree.tooltip = tooltipOf(directive.path, tree.description);
        tree.command = open(l10n.t('Go to Include Line'));
        tree.contextValue = 'line';
        return tree;
      }
      case 'libraries':
        return group(
          l10n.t('Bundled libraries'),
          true,
          'library',
          String(item.children.length),
          l10n.t('The files of the bundled libraries the drawing read, in the order first read. Which file read which is not shown.')
        );
      case 'library': {
        const path = libraryPath(item.read.library, item.read.key);
        const tree = new vscode.TreeItem(path.slice(1), vscode.TreeItemCollapsibleState.None);
        if (item.read.found) {
          tree.resourceUri = vscode.Uri.from({ scheme: LIBRARY_SCHEME, path });
          tree.iconPath = vscode.ThemeIcon.File;
          tree.command = open(l10n.t('Open File'));
        } else {
          tree.description = l10n.t('not in the library');
          tree.iconPath = new vscode.ThemeIcon('question');
        }
        tree.contextValue = 'library';
        return tree;
      }
      case 'more': {
        const tree = new vscode.TreeItem(l10n.t('{0} more not listed', String(item.count)), vscode.TreeItemCollapsibleState.None);
        tree.iconPath = new vscode.ThemeIcon('ellipsis');
        return tree;
      }
      case 'readers':
        return group(
          l10n.t('Diagrams that read this file'),
          false,
          'references',
          l10n.t('in open documents'),
          l10n.t('Diagrams of open documents whose last drawing read this file. Documents that are not open are not looked at.')
        );
      case 'reader': {
        const tree = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.None);
        tree.description = [
          vscode.workspace.asRelativePath(vscode.Uri.parse(item.record.document)),
          ...(item.record.stale ? [l10n.t('changed since drawn')] : []),
        ].join(' · ');
        tree.iconPath = new vscode.ThemeIcon('type-hierarchy');
        tree.command = open(l10n.t('Go to Diagram'));
        tree.contextValue = 'reader';
        return tree;
      }
    }
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const timer of this.drawing.values()) {
      clearTimeout(timer ?? undefined);
    }
    this.drawing.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Lays the view out again soon if it is visible, else once it is. */
  private refresh(): void {
    if (!this.view.visible) {
      this.roots = undefined;
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.roots = undefined;
      this.changed.fire(undefined);
    }, REFRESH_MS);
  }

  private isIssued(item: unknown): item is Item {
    return typeof item === 'object' && item !== null && this.issued.has(item);
  }

  private issue<T extends Item>(item: T): T {
    this.issued.add(item);
    return item;
  }

  private rootItems(): Item[] {
    if (this.roots !== undefined) {
      return this.roots;
    }
    this.issued = new WeakSet();
    const roots: Item[] = [];
    const document = vscode.window.activeTextEditor?.document;
    this.view.description = document === undefined ? undefined : vscode.workspace.asRelativePath(document.uri);
    const listed = new Map<string, ListedRow>();
    if (document !== undefined) {
      for (const [index, diagram] of this.host.diagrams(document).entries()) {
        const item = this.diagramItem(document, diagram);
        item.id = this.rowId(`${document.uri.toString()}#${index}`, item.children.length === 0, listed);
        roots.push(item);
      }
      const readers = this.readerItems(document);
      if (readers !== undefined) {
        roots.push(readers);
      }
    }
    this.listed = listed;
    this.roots = roots;
    return roots;
  }

  /**
   * The id of the row of the diagram `key`, which lists nothing when
   * `empty`, noted in `listed`. VS Code keeps whether a row is open by the
   * row's id, and takes a row that cannot open, as one that lists nothing,
   * as closed when it makes it: such a row gets a new id once it lists
   * something, so that it opens up. A row not listed the time before is new
   * to VS Code.
   */
  private rowId(key: string, empty: boolean, listed: Map<string, ListedRow>): string {
    const before = this.listed.get(key);
    const row = before === undefined || (before.closed && !empty) ? { id: `${key}#${++this.made}`, closed: empty } : before;
    listed.set(key, row);
    return row.id;
  }

  private diagramItem(document: vscode.TextDocument, diagram: ViewDiagram): DiagramItem {
    const place: Place = { document: document.uri, version: document.version, sourceLine: diagram.sourceLine };
    const item = this.issue<DiagramItem>({ type: 'diagram', place, diagram, children: [] });
    if (typeof diagram.render !== 'string') {
      return item;
    }
    const record = this.host.records.get(document.uri.toString(), diagram.render);
    if (record === undefined || record.stale) {
      this.drawSoon(document.uri, diagram.render);
    }
    if (record === undefined) {
      return item;
    }
    item.record = record;
    const nodes = dependencyTree(record.log, includeDirectives(diagram.text), (request) =>
      record.readBefore.get(requestKey(request))
    );
    item.children = nodes.map((node) => this.itemOf(node, item, item));
    return item;
  }

  private itemOf(node: DependencyNode, parent: Item, diagram: DiagramItem): Item {
    switch (node.type) {
      case 'request': {
        const item = this.issue<RequestItem>({ type: 'request', parent, diagram, node, children: [] });
        item.children = node.children.map((child) => this.itemOf(child, item, diagram));
        return item;
      }
      case 'lines': {
        const item = this.issue<GroupItem>({ type: 'lines', parent, children: [] });
        item.children = node.lines.map((line) => this.issue({ type: 'line', parent: item, diagram, node: line }));
        return item;
      }
      case 'libraries': {
        const item = this.issue<GroupItem>({ type: 'libraries', parent, children: [] });
        item.children = node.libraries.map((read) => this.issue({ type: 'library', parent: item, read }));
        return item;
      }
      case 'more':
        return this.issue({ type: 'more', parent, count: node.count });
    }
  }

  /** The diagrams of open documents whose kept drawings read `document`, a file. */
  private readerItems(document: vscode.TextDocument): GroupItem | undefined {
    if (document.uri.scheme !== 'file') {
      return undefined;
    }
    const item = this.issue<GroupItem>({ type: 'readers', children: [] });
    for (const record of this.host.records.readers(pathKey(document.uri.fsPath), pathKey)) {
      const open = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === record.document);
      const diagram = open === undefined ? undefined : this.diagramOf(open, record.source);
      if (diagram !== undefined) {
        item.children.push(this.issue({ type: 'reader', parent: item, record, name: this.diagramName(diagram) }));
      }
    }
    return item.children.length === 0 ? undefined : item;
  }

  private diagramOf(document: vscode.TextDocument, source: string): ViewDiagram | undefined {
    return this.host.diagrams(document).find((diagram) => diagram.render === source);
  }

  private diagramName(diagram: ViewDiagram): string {
    return diagram.name ?? this.host.l10n.t('Diagram at line {0}', String(diagram.startLine + 1));
  }

  /** What the item of a diagram says of its drawing: a word, an icon, and a sentence for its tooltip. */
  private diagramState(item: DiagramItem): { description: string; icon: string; note: string } {
    const { l10n } = this.host;
    const { record } = item;
    if (typeof item.diagram.render !== 'string') {
      return { description: l10n.t('not drawn'), icon: 'circle-slash', note: item.diagram.render.notDrawn };
    }
    if (record === undefined) {
      return { description: l10n.t('drawing…'), icon: 'type-hierarchy', note: '' };
    }
    if (record.stale) {
      return {
        description: l10n.t('changed since drawn'),
        icon: 'warning',
        note: l10n.t('A file it read or looked for, or a setting that decides where it looks, changed after it was drawn. It will be drawn again.'),
      };
    }
    if (record.error !== undefined) {
      return { description: l10n.t('could not draw'), icon: 'error', note: record.error };
    }
    return { description: item.children.length === 0 ? l10n.t('reads no files') : '', icon: 'type-hierarchy', note: '' };
  }

  private requestItem(item: RequestItem, open: (title: string) => vscode.Command): vscode.TreeItem {
    const { l10n } = this.host;
    const { node } = item;
    const { request } = node;
    const tree = new vscode.TreeItem(
      request.path,
      item.children.length === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );
    const state = this.stateOf(request);
    const repeat =
      node.repeat === 'cycle' ? l10n.t('in a cycle') : node.repeat === 'again' ? l10n.t('listed above') : undefined;
    const first = node.lines[0];
    const where =
      node.lines.length > 1
        ? l10n.t('{0} lines', String(node.lines.length))
        : first === undefined
          ? undefined
          : l10n.t('line {0}', String(item.diagram.place.sourceLine + first + 1));
    tree.description = [
      ...(request.kind === undefined ? [] : [`!${request.kind}`]),
      state,
      ...(node.readBefore === undefined ? [] : [l10n.t('read before')]),
      ...(repeat === undefined ? [] : [repeat]),
      ...(where === undefined ? [] : [where]),
    ].join(' · ');
    const read = request.state === 'read' ? request.file : undefined;
    if (read !== undefined) {
      tree.resourceUri = vscode.Uri.file(read);
      tree.iconPath = vscode.ThemeIcon.File;
      tree.command = open(l10n.t('Open File'));
    } else {
      tree.iconPath = new vscode.ThemeIcon(
        request.state === 'missing' ? 'question' : request.state === 'refused' ? 'circle-slash' : 'error'
      );
      tree.command = open(l10n.t('Go to Include Line'));
    }
    const asker = item.parent.type === 'request' ? item.parent.node.request.file : undefined;
    tree.tooltip = tooltipOf(
      request.path,
      tree.description,
      asker === undefined ? l10n.t('Asked for by the diagram.') : l10n.t('Asked for by {0}.', asker),
      read === undefined ? `${state}: ${request.reason ?? ''}` : l10n.t('Read {0}.', read),
      ...request.looked.map((path) => l10n.t('Looked at: {0}', path)),
      ...(node.readBefore === undefined ? [] : [l10n.t('A drawing before read {0}.', node.readBefore)]),
      node.repeat === 'cycle'
        ? l10n.t('This file is one of those above it: what it asks for is not listed again.')
        : node.repeat === 'again'
          ? l10n.t('What this file asks for is listed under the first request for it.')
          : '',
      request.from === null && node.lines.length === 0
        ? l10n.t('No line of the diagram asks for it as written, so the line that asked is not known.')
        : ''
    );
    tree.contextValue = 'request';
    return tree;
  }

  private stateOf(request: DrawnRequest): string {
    const { l10n } = this.host;
    switch (request.state) {
      case 'read':
        return l10n.t('read');
      case 'missing':
        return l10n.t('not found');
      case 'refused':
        return l10n.t('refused');
      case 'unavailable':
        return l10n.t('not read');
      case 'outside':
        return l10n.t('outside the folder');
      case 'path':
        return l10n.t('path refused');
      case 'limit':
        return l10n.t('over a limit');
    }
  }

  /** Draws `source` for `document` while the view is visible, unless it is drawn meanwhile. */
  private drawSoon(document: vscode.Uri, source: string): void {
    const key = `${document.toString()}\n${source}`;
    if (!this.view.visible || this.drawing.has(key)) {
      return;
    }
    const timer = setTimeout(() => {
      const record = this.host.records.get(document.toString(), source);
      if (!this.view.visible || (record !== undefined && !record.stale)) {
        this.drawing.delete(key);
        return;
      }
      this.drawing.set(key, null);
      this.host
        .draw(source, document)
        .catch(() => undefined)
        .finally(() => {
          this.drawing.delete(key);
        });
    }, DRAW_AFTER_MS);
    this.drawing.set(key, timer);
  }

  /**
   * The path, as the editor knows it, of the file `id` that a drawing for
   * `document` read, once found again where a drawing would read it; else
   * why not, in words that name it `name`.
   */
  private async findAgain(document: vscode.Uri, id: string, name: string): Promise<{ path: string } | { refused: string }> {
    const { l10n } = this.host;
    const { access, folder } = await accessFor(document, this.host);
    if (!access.available) {
      return { refused: l10n.t('{0} was not opened: files are not read for this document now.', name) };
    }
    const located = isWithin(access.scope.root, id) ? await locateIncludeFile(access.scope.root, id) : undefined;
    if (located?.kind === 'missing') {
      return { refused: l10n.t('{0} was not opened: it is no longer there.', name) };
    }
    if (located?.kind !== 'file' || pathKey(located.id) !== pathKey(id)) {
      return { refused: l10n.t('{0} was not opened: a drawing would not read it now.', name) };
    }
    return { path: asOpened(access, folder, id) };
  }

  /** Goes to document line `line` of the item's document at `place`, while the document is as it was. */
  private async goTo(place: Place, line: number): Promise<string | undefined> {
    const document = await vscode.workspace.openTextDocument(place.document);
    if (document.version !== place.version) {
      this.refresh();
      return this.host.l10n.t('The document has changed. The list has been updated; choose the item again.');
    }
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(line, 0, line, 0) });
    return undefined;
  }

  /** One of `lines`, document lines, picked by the user when there are several. */
  private async pickLine(lines: readonly number[], path: string): Promise<number | undefined> {
    if (lines.length === 1) {
      return lines[0];
    }
    const picked = await vscode.window.showQuickPick(
      lines.map((line) => ({ label: this.host.l10n.t('line {0}', String(line + 1)), line })),
      { placeHolder: this.host.l10n.t('Lines that ask for {0}', path) }
    );
    return picked?.line;
  }
}
