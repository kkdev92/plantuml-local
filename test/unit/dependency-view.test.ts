import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type * as vscode from 'vscode';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagramRender, DrawingLog, DrawnRequest } from '../../src/core/types';
import { DependencyView, type ViewDiagram } from '../../src/includes/dependency-view';
import { DrawingRecords } from '../../src/includes/drawings';

/** As much of the `vscode` module as src/includes/dependency-view.ts and host.ts use. */
const fake = vi.hoisted(() => {
  class EventEmitter<T> {
    private readonly listeners = new Set<(event: T) => void>();
    readonly event = (listener: (event: T) => void): { dispose(): void } => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(event: T): void {
      for (const listener of [...this.listeners]) {
        listener(event);
      }
    }
    dispose(): void {
      this.listeners.clear();
    }
  }
  class TreeItem {
    description?: string;
    tooltip?: string;
    iconPath?: { id: string };
    resourceUri?: unknown;
    command?: { command: string; title: string; arguments: unknown[] };
    contextValue?: string;
    constructor(
      public label: string,
      public collapsibleState: number
    ) {}
  }
  class ThemeIcon {
    static readonly File = new ThemeIcon('file');
    constructor(readonly id: string) {}
  }
  class Range {
    readonly start: { line: number };
    constructor(line: number) {
      this.start = { line };
    }
  }
  const uri = (scheme: string, path: string): { scheme: string; path: string; fsPath: string; toString(): string } => ({
    scheme,
    path,
    fsPath: path,
    toString: () => `${scheme}:${path}`,
  });
  const state = {
    trusted: true,
    folder: '',
    editor: undefined as { document: unknown; selection: { active: { line: number } } } | undefined,
    documents: [] as unknown[],
    visible: false,
    pick: undefined as string | undefined,
  };
  const editors = new EventEmitter<unknown>();
  const edits = new EventEmitter<{ document: unknown; contentChanges: unknown[] }>();
  const visibility = new EventEmitter<{ visible: boolean }>();
  const calls = {
    executed: [] as { id: string; args: unknown[] }[],
    shown: [] as { document: unknown; line: number }[],
    opened: [] as unknown[],
    picks: [] as { labels: string[]; placeHolder: string | undefined }[],
    revealed: [] as { item: unknown; options: unknown }[],
  };
  const view = {
    get visible(): boolean {
      return state.visible;
    },
    description: undefined as string | undefined,
    onDidChangeVisibility: visibility.event,
    reveal: async (item: unknown, options: unknown): Promise<void> => {
      calls.revealed.push({ item, options });
    },
    dispose: (): void => undefined,
  };
  return { EventEmitter, TreeItem, ThemeIcon, Range, uri, state, editors, edits, visibility, calls, view };
});

vi.mock('vscode', () => ({
  EventEmitter: fake.EventEmitter,
  TreeItem: fake.TreeItem,
  ThemeIcon: fake.ThemeIcon,
  Range: fake.Range,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    file: (path: string) => fake.uri('file', path),
    from: ({ scheme, path }: { scheme: string; path: string }) => fake.uri(scheme, path),
    parse: (value: string) => fake.uri(value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)),
  },
  window: {
    get activeTextEditor(): unknown {
      return fake.state.editor;
    },
    createTreeView: () => fake.view,
    onDidChangeActiveTextEditor: fake.editors.event,
    showTextDocument: async (document: unknown, options: { selection: { start: { line: number } } }) => {
      fake.calls.shown.push({ document, line: options.selection.start.line });
    },
    showQuickPick: async (items: { label: string }[], options: { placeHolder?: string }) => {
      fake.calls.picks.push({ labels: items.map((item) => item.label), placeHolder: options.placeHolder });
      return items.find((item) => item.label === fake.state.pick);
    },
  },
  workspace: {
    get isTrusted(): boolean {
      return fake.state.trusted;
    },
    get textDocuments(): unknown[] {
      return fake.state.documents;
    },
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      uri.fsPath.startsWith(`${fake.state.folder}${sep}`) ? { uri: fake.uri('file', fake.state.folder) } : undefined,
    onDidChangeTextDocument: fake.edits.event,
    asRelativePath: (uri: { fsPath: string }) => uri.fsPath.slice(fake.state.folder.length + 1),
    openTextDocument: async (uri: { toString(): string; fsPath: string }) => {
      const open = (fake.state.documents as { uri: { toString(): string } }[]).find(
        (document) => document.uri.toString() === uri.toString()
      );
      if (open !== undefined) {
        return open;
      }
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(uri.fsPath, 'utf8');
      fake.calls.opened.push(uri.fsPath);
      return { uri, version: 1, getText: () => text };
    },
  },
  commands: {
    executeCommand: async (id: string, ...args: unknown[]) => {
      fake.calls.executed.push({ id, args });
    },
  },
}));

let temp: string;
let root: string;

beforeAll(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-dependencies-')));
  root = join(temp, 'ws');
  await mkdir(join(root, 'parts'), { recursive: true });
  await writeFile(join(root, 'common.puml'), '!include parts/inner.iuml\n!include parts/inner.iuml\n');
  await writeFile(join(root, 'parts', 'inner.iuml'), 'A -> B\n');
  fake.state.folder = root;
});

afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

const english = { t: (message: string, ...args: string[]): string => message.replace(/\{(\d+)\}/g, (_, i: string) => args[Number(i)] ?? '') };

interface FakeDocument {
  uri: ReturnType<typeof fake.uri>;
  version: number;
  getText(): string;
}

function documentAt(name: string, text: string): FakeDocument {
  return { uri: fake.uri('file', join(root, name)), version: 1, getText: () => text };
}

/** The diagram of `text`, a whole document: one diagram from its first line. */
function diagramOf(text: string, render: ViewDiagram['render'] = text): ViewDiagram {
  const lines = text.split('\n').length;
  return { name: null, text, sourceLine: 0, openLine: 0, closeLine: lines - 1, startLine: 0, render };
}

const read = (path: string, from: string | null, file: string): DrawnRequest => ({
  path,
  from,
  kind: 'include',
  state: 'read',
  id: file,
  file,
  looked: [],
});

let records: DrawingRecords;
let diagrams: Map<string, ViewDiagram[]>;
let draw: ReturnType<typeof vi.fn<(source: string, document: vscode.Uri) => Promise<unknown>>>;
/** The paths upstream gives the files of the bundled libraries read so far, by `<library>/<key>`. */
let names: Map<string, string>;
let readLibrary: ReturnType<typeof vi.fn<(library: string) => Promise<unknown>>>;
let view: DependencyView;

/** Keeps `log` as the drawing of `source` for `document`, as the shared renders would. */
async function drawn(document: FakeDocument, source: string, log: DrawingLog, error?: string): Promise<void> {
  const render = records.around(async (): Promise<DiagramRender> => {
    if (error !== undefined) {
      throw new Error(error);
    }
    return { svg: '<svg/>', failedIncludes: new Map(), dependencies: [], log };
  });
  await render(source, false, document.uri.toString()).catch(() => undefined);
}

/** Makes `document` the active editor's, with the cursor on `line`. */
function activate(document: FakeDocument, line = 0): void {
  fake.state.editor = { document, selection: { active: { line } } };
  if (!fake.state.documents.includes(document)) {
    fake.state.documents.push(document);
  }
}

type Item = ReturnType<DependencyView['getChildren']>[number];
const tree = (item: Item): ReturnType<DependencyView['getTreeItem']> & { iconPath?: { id: string } } =>
  view.getTreeItem(item) as ReturnType<DependencyView['getTreeItem']> & { iconPath?: { id: string } };

/** The items as label · description, nested. */
function laidOut(items: readonly Item[] = view.getChildren()): unknown[] {
  return items.map((item) => {
    const shown = tree(item);
    const said = `${String(shown.label)}${shown.description ? ` · ${String(shown.description)}` : ''}`;
    const children = view.getChildren(item);
    return children.length === 0 ? said : [said, laidOut(children)];
  });
}

beforeEach(() => {
  fake.state.trusted = true;
  fake.state.visible = false;
  fake.state.editor = undefined;
  fake.state.documents = [];
  fake.state.pick = undefined;
  fake.calls.executed.length = 0;
  fake.calls.shown.length = 0;
  fake.calls.opened.length = 0;
  fake.calls.picks.length = 0;
  fake.calls.revealed.length = 0;
  records = new DrawingRecords();
  diagrams = new Map();
  draw = vi.fn(async () => undefined);
  names = new Map();
  readLibrary = vi.fn(async () => undefined);
  view = new DependencyView({
    records,
    includePaths: () => [],
    diagrams: (document) => diagrams.get(document.uri.toString()) ?? [],
    draw,
    libraryFile: (library, key) => names.get(`${library}/${key}`),
    readLibrary,
    l10n: english,
  });
});

afterEach(() => {
  view.dispose();
  vi.useRealTimers();
});

describe('DependencyView', () => {
  it('lists what the last drawing of each diagram of the active editor asked for, nested by the file that asked', async () => {
    const text = '@startuml\n!include common.puml\n!include gone.puml\n!include unasked.puml\n@enduml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    const common = join(root, 'common.puml');
    const inner = join(root, 'parts', 'inner.iuml');
    await drawn(document, text, {
      requests: [
        read('common.puml', null, common),
        read('parts/inner.iuml', common, inner),
        read('parts/inner.iuml', common, inner),
        { path: 'gone.puml', from: null, kind: 'include', state: 'missing', looked: [join(root, 'gone.puml')], reason: 'File not found.' },
      ],
      libraries: [
        { library: 'c4', key: 'c4_container', found: true },
        { library: 'c4', key: 'nope', found: false },
      ],
    });
    expect(laidOut()).toEqual([
      [
        'Diagram at line 1',
        [
          ['common.puml · !include · read · line 2', ['parts/inner.iuml · !include · read', 'parts/inner.iuml · !include · read · listed above']],
          'gone.puml · !include · not found · line 3',
          ['Other include lines · 1', ['unasked.puml · !include · not asked for when drawn · line 4']],
          ['Bundled libraries · 2', ['C4/C4_Container.puml', 'C4/nope.puml · not in the library']],
        ],
      ],
    ]);
    expect(fake.view.description).toBe('doc.puml');
    const [diagram] = view.getChildren();
    const [request, missing] = view.getChildren(diagram);
    expect(tree(request as Item)).toMatchObject({ iconPath: { id: 'file' }, contextValue: 'request' });
    expect(String(tree(missing as Item).tooltip)).toContain('Looked at: ');
    expect(tree(missing as Item).iconPath).toEqual({ id: 'question' });
    expect(view.getParent(request as Item)).toBe(diagram);
  });

  it('says how a diagram stands: not drawn, being drawn, out of date, failed, or reading nothing', async () => {
    const texts = ['@startuml\nA\n@enduml', '@startuml\nB\n@enduml', '@startuml\nC\n@enduml', '@startuml\nD\n@enduml'];
    const document = documentAt('doc.md', texts.join('\n'));
    diagrams.set(document.uri.toString(), [
      { ...diagramOf(texts[0] ?? '', { notDrawn: 'Each block can contain only one diagram.' }), name: 'refused' },
      { ...diagramOf(texts[1] ?? ''), name: 'waiting' },
      { ...diagramOf(texts[2] ?? ''), name: 'failed' },
      { ...diagramOf(texts[3] ?? ''), name: 'plain' },
    ]);
    activate(document);
    await drawn(document, texts[2] ?? '', { requests: [], libraries: [] }, 'timed out');
    await drawn(document, texts[3] ?? '', { requests: [], libraries: [] });
    expect(laidOut()).toEqual([
      'refused · not drawn',
      'waiting · drawing…',
      'failed · could not draw',
      'plain · reads no files',
    ]);
    expect(String(tree(view.getChildren()[0] as Item).tooltip)).toContain('Each block can contain only one diagram.');

    records.outdateAll();
    expect(laidOut()).toEqual(['refused · not drawn', 'waiting · drawing…', 'failed · changed since drawn', 'plain · changed since drawn']);
  });

  it('gives a row that VS Code took as closed, as it lists nothing, a new id once it lists something, so that it opens up', async () => {
    const text = '@startuml\n!include common.puml\n@enduml';
    const other = '@startuml\nB\n@enduml';
    const document = documentAt('doc.md', `${text}\n${other}`);
    const write = (first: string): void => {
      diagrams.set(document.uri.toString(), [
        { ...diagramOf(first), name: 'first' },
        { ...diagramOf(other), name: 'second' },
      ]);
    };
    write(text);
    activate(document);
    const rows = (): { state: number; id: string | undefined }[] =>
      view.getChildren().map((item) => {
        const shown = tree(item) as { collapsibleState: number; id?: string };
        return { state: shown.collapsibleState, id: shown.id };
      });
    const common = { requests: [read('common.puml', null, join(root, 'common.puml'))], libraries: [] };

    // Neither drawn yet: rows that cannot open, each with an id of its own.
    const [waiting, second] = rows();
    expect([waiting?.state, second?.state]).toEqual([0, 0]);
    expect(waiting?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(second?.id).not.toBe(waiting?.id);

    // Drawn, listing what it read: a row that can open, with a new id; the
    // other row as it was.
    await drawn(document, text, common);
    const [listed, still] = rows();
    expect(listed?.state).toBe(2);
    expect(listed?.id).not.toBe(waiting?.id);
    expect(still?.id).toBe(second?.id);

    // Edited, so not drawn while the edit is new, then drawn: the same row
    // throughout, which VS Code keeps as the user left it.
    const edited = '@startuml\n!include common.puml\nA\n@enduml';
    write(edited);
    fake.edits.fire({ document, contentChanges: [{}] });
    const [editing] = rows();
    expect(editing).toEqual({ state: 0, id: listed?.id });
    await drawn(document, edited, common);
    expect(rows()[0]).toEqual({ state: 2, id: listed?.id });

    // Another document listed meanwhile: new rows, as VS Code drops the rows
    // it no longer lists.
    activate(documentAt('other.md', ''));
    fake.editors.fire(undefined);
    expect(rows()).toEqual([]);
    activate(document);
    fake.editors.fire(undefined);
    const [back, secondBack] = rows();
    expect(back?.state).toBe(2);
    expect([back?.id, secondBack?.id]).not.toContain(listed?.id);
    expect([back?.id, secondBack?.id]).not.toContain(second?.id);
  });

  it('begins the tooltip of an item with its label and its description, which VS Code reads out in their place', async () => {
    const text = '@startuml\n!include common.puml\n!include gone.puml\n!include unasked.puml\n@enduml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    const looked = join(root, 'gone.puml');
    await drawn(document, text, {
      requests: [
        read('common.puml', null, join(root, 'common.puml')),
        { path: 'gone.puml', from: null, kind: 'include', state: 'missing', looked: [looked], reason: 'File not found.' },
      ],
      libraries: [{ library: 'c4', key: 'c4_container', found: true }],
    });
    const every = (items: readonly Item[]): Item[] => items.flatMap((item) => [item, ...every(view.getChildren(item))]);
    const said = every(view.getChildren())
      .map((item) => tree(item))
      .filter((item) => item.tooltip !== undefined);
    // The diagram, the two requests, the include line and the two groups.
    expect(said).toHaveLength(6);
    for (const { label, description, tooltip } of said) {
      const shown = description === undefined || description === '' ? [label] : [label, description];
      expect(String(tooltip).split('\n').slice(0, shown.length)).toEqual(shown);
    }
    const [diagram] = view.getChildren();
    expect(tree(view.getChildren(diagram)[1] as Item).tooltip).toBe(
      ['gone.puml', '!include · not found · line 3', 'Asked for by the diagram.', 'not found: File not found.', `Looked at: ${looked}`].join('\n')
    );
  });

  it('draws, while visible, a diagram it has no drawing of or an out-of-date one, unless it is drawn meanwhile', async () => {
    vi.useFakeTimers();
    const text = '@startuml\nA\n@enduml';
    const other = '@startuml\nB\n@enduml';
    const document = documentAt('doc.md', `${text}\n${other}`);
    diagrams.set(document.uri.toString(), [diagramOf(text), diagramOf(other)]);
    activate(document);

    view.getChildren();
    await vi.advanceTimersByTimeAsync(2000);
    expect(draw).not.toHaveBeenCalled();

    fake.state.visible = true;
    fake.visibility.fire({ visible: true });
    await vi.advanceTimersByTimeAsync(150);
    view.getChildren();
    await drawn(document, other, { requests: [], libraries: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(draw.mock.calls.map(([source]) => source)).toEqual([text]);

    // Out of date: drawn again.
    await drawn(document, text, { requests: [], libraries: [] });
    records.outdateAll();
    await vi.advanceTimersByTimeAsync(150);
    view.getChildren();
    await vi.advanceTimersByTimeAsync(1000);
    expect(draw.mock.calls.map(([source]) => source)).toEqual([text, text, other]);
  });

  it('lays itself out again when a drawing is kept, the editor changes or its document is edited', async () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    view.onDidChangeTreeData(fired);
    const document = documentAt('doc.md', '');
    activate(document);
    fake.state.visible = true;

    await drawn(document, 'x', { requests: [], libraries: [] });
    fake.editors.fire(undefined);
    fake.edits.fire({ document, contentChanges: [{}] });
    fake.edits.fire({ document: documentAt('other.md', ''), contentChanges: [{}] });
    expect(fired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toHaveBeenCalledTimes(1);

    fake.state.visible = false;
    fake.editors.fire(undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('lists, for a file the active editor shows, the diagrams of open documents that read it', async () => {
    const text = '@startuml\n!include common.puml\n@enduml';
    const document = documentAt('doc.md', text);
    diagrams.set(document.uri.toString(), [{ ...diagramOf(text), name: 'flows', startLine: 0 }]);
    fake.state.documents.push(document);
    await drawn(document, text, { requests: [read('common.puml', null, join(root, 'common.puml'))], libraries: [] });
    // A drawing of a text the document no longer holds is left out.
    await drawn(document, 'old', { requests: [read('common.puml', null, join(root, 'common.puml'))], libraries: [] });
    const common = documentAt('common.puml', '!include parts/inner.iuml');
    activate(common);
    expect(laidOut()).toEqual([['Diagrams that read this file · in open documents', ['flows · doc.md']]]);

    const [readers] = view.getChildren();
    const [reader] = view.getChildren(readers);
    await expect(view.open(reader)).resolves.toBeUndefined();
    expect(fake.calls.shown).toEqual([{ document, line: 0 }]);
  });

  it('opens the file a request read only once found again where a drawing would read it', async () => {
    const text = '!include common.puml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    await drawn(document, text, {
      requests: [read('common.puml', null, join(root, 'common.puml')), read('gone.puml', null, join(root, 'gone.puml'))],
      libraries: [],
    });
    const [diagram] = view.getChildren();
    const [common, gone] = view.getChildren(diagram);

    await expect(view.open(common)).resolves.toBeUndefined();
    expect(fake.calls.executed).toEqual([{ id: 'vscode.open', args: [expect.objectContaining({ fsPath: join(root, 'common.puml') })] }]);

    await expect(view.open(gone)).resolves.toBe('gone.puml was not opened: it is no longer there.');
    fake.state.trusted = false;
    await expect(view.open(common)).resolves.toBe('common.puml was not opened: files are not read for this document now.');
    expect(fake.calls.executed).toHaveLength(1);
  });

  it('acts on its own items only', async () => {
    await expect(view.open({ type: 'request', node: { request: read('x', null, join(root, 'common.puml')) } })).resolves.toBeUndefined();
    await expect(view.goToInclude('file:///etc/passwd')).resolves.toBeUndefined();
    await expect(view.open(null)).resolves.toBeUndefined();
    expect(fake.calls.executed).toEqual([]);
    expect(fake.calls.shown).toEqual([]);
  });

  it('goes to the line of the diagram that asked, picking among several, and says when none is known', async () => {
    const text = '@startuml\n!include common.puml\n!include common.puml\n@enduml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [{ ...diagramOf(text), sourceLine: 10, startLine: 10 }]);
    activate(document);
    await drawn(document, text, {
      requests: [
        read('common.puml', null, join(root, 'common.puml')),
        { path: 'from-theme.puml', from: null, kind: 'include', state: 'missing', looked: [] },
      ],
      libraries: [],
    });
    const [diagram] = view.getChildren();
    const [common, theme] = view.getChildren(diagram);
    expect(tree(common as Item).description).toBe('!include · read · 2 lines');

    fake.state.pick = 'line 13';
    await expect(view.goToInclude(common)).resolves.toBeUndefined();
    expect(fake.calls.picks).toEqual([{ labels: ['line 12', 'line 13'], placeHolder: 'Lines that ask for common.puml' }]);
    expect(fake.calls.shown).toEqual([{ document, line: 12 }]);

    fake.state.pick = undefined;
    await expect(view.goToInclude(common)).resolves.toBeUndefined();
    expect(fake.calls.shown).toHaveLength(1);

    // A request that read nothing goes there when clicked.
    await expect(view.open(theme)).resolves.toBe('The line that asked for from-theme.puml is not known.');
    expect(fake.calls.shown.at(-1)).toEqual({ document, line: 10 });
  });

  it('goes to the line of the included file that asked, read again where a drawing would read it', async () => {
    const text = '!include common.puml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    const common = join(root, 'common.puml');
    await drawn(document, text, {
      requests: [
        read('common.puml', null, common),
        read('parts/inner.iuml', common, join(root, 'parts', 'inner.iuml')),
        { path: 'nowhere.puml', from: common, kind: 'include', state: 'missing', looked: [] },
      ],
      libraries: [],
    });
    const [diagram] = view.getChildren();
    const [first] = view.getChildren(diagram);
    const [inner, nowhere] = view.getChildren(first);

    fake.state.pick = 'line 2';
    await expect(view.goToInclude(inner)).resolves.toBeUndefined();
    expect(fake.calls.picks.at(-1)?.labels).toEqual(['line 1', 'line 2']);
    expect(fake.calls.shown.at(-1)).toMatchObject({ line: 1 });
    expect(fake.calls.opened).toEqual([common]);

    await expect(view.goToInclude(nowhere)).resolves.toBe('The line that asked for nowhere.puml is not known.');
    expect(fake.calls.shown.at(-1)).toMatchObject({ line: 0 });

    fake.state.trusted = false;
    await expect(view.goToInclude(inner)).resolves.toBe(
      `${common} was not opened: files are not read for this document now.`
    );
  });

  it('goes to a line only while the document is as it was when the list was made', async () => {
    vi.useFakeTimers();
    const text = '!include unasked.puml';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    await drawn(document, text, { requests: [], libraries: [] });
    const [diagram] = view.getChildren();
    const [lines] = view.getChildren(diagram);
    const [line] = view.getChildren(lines);

    await expect(view.open(line)).resolves.toBeUndefined();
    await expect(view.open(diagram)).resolves.toBeUndefined();
    expect(fake.calls.shown).toEqual([
      { document, line: 0 },
      { document, line: 0 },
    ]);

    document.version = 2;
    fake.state.visible = true;
    const fired = vi.fn();
    view.onDidChangeTreeData(fired);
    await expect(view.open(line)).resolves.toBe('The document has changed. The list has been updated; choose the item again.');
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toHaveBeenCalled();
    expect(fake.calls.shown).toHaveLength(2);
  });

  it('opens a file of a bundled library it read, and nothing for one the library lacks', async () => {
    const text = '!include <C4/C4_Container>';
    const document = documentAt('doc.puml', text);
    diagrams.set(document.uri.toString(), [diagramOf(text)]);
    activate(document);
    await drawn(document, text, {
      requests: [],
      libraries: [
        { library: 'c4', key: 'c4_container', found: true },
        { library: 'c4', key: 'nope', found: false },
      ],
    });
    const [diagram] = view.getChildren();
    const [libraries] = view.getChildren(diagram);
    const [found, lacking] = view.getChildren(libraries);
    await expect(view.open(found)).resolves.toBeUndefined();
    await expect(view.open(lacking)).resolves.toBeUndefined();
    expect(fake.calls.executed).toEqual([
      { id: 'vscode.open', args: [expect.objectContaining({ scheme: 'plantuml-local-library', path: '/C4/C4_Container.puml' })] },
    ]);
  });

  describe('with a file of a bundled library read', () => {
    const text = '!include <azure/Networking/AzureApplicationGateway>';
    const byKey = [
      ['Diagram at line 1', [['Bundled libraries · 2', ['azure/networking/azureapplicationgateway.puml', 'azure/nope.puml · not in the library']]]],
    ];
    let document: FakeDocument;
    let fired: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.useFakeTimers();
      fake.state.visible = true;
      document = documentAt('doc.puml', text);
      diagrams.set(document.uri.toString(), [diagramOf(text)]);
      activate(document);
      await drawn(document, text, {
        requests: [],
        libraries: [
          { library: 'azure', key: 'networking/azureapplicationgateway', found: true },
          { library: 'azure', key: 'nope', found: false },
        ],
      });
      // Laid out again for the drawing kept, before what follows.
      await vi.advanceTimersByTimeAsync(100);
      fired = vi.fn();
      view.onDidChangeTreeData(fired);
    });

    /** Lays the view out again, as an edit of its document does. */
    const edited = async (): Promise<void> => {
      fake.edits.fire({ document, contentChanges: [{}] });
      await vi.advanceTimersByTimeAsync(100);
    };

    it('names the file as upstream writes it once its library is read, and opens it so', async () => {
      let read = (): void => undefined;
      readLibrary.mockImplementation(
        (library) =>
          new Promise<void>((resolve) => {
            read = (): void => {
              names.set(`${library}/networking/azureapplicationgateway`, 'Networking/AzureApplicationGateway');
              resolve();
            };
          })
      );

      // Until then, a file goes by its key, as the engine looks it up.
      expect(laidOut()).toEqual(byKey);
      expect(readLibrary.mock.calls).toEqual([['azure']]);
      // Laid out again meanwhile, the view does not read the library again.
      await edited();
      expect(laidOut()).toEqual(byKey);
      expect(readLibrary).toHaveBeenCalledTimes(1);

      fired.mockClear();
      read();
      await vi.advanceTimersByTimeAsync(100);
      expect(fired).toHaveBeenCalledTimes(1);
      expect(laidOut()).toEqual([
        ['Diagram at line 1', [['Bundled libraries · 2', ['azure/Networking/AzureApplicationGateway.puml', 'azure/nope.puml · not in the library']]]],
      ]);
      // As Go to Definition opens it, so that both show one view of the file.
      const [diagram] = view.getChildren();
      const [libraries] = view.getChildren(diagram);
      const [file] = view.getChildren(libraries);
      await expect(view.open(file)).resolves.toBeUndefined();
      expect(fake.calls.executed).toEqual([
        {
          id: 'vscode.open',
          args: [expect.objectContaining({ scheme: 'plantuml-local-library', path: '/azure/Networking/AzureApplicationGateway.puml' })],
        },
      ]);
      expect(readLibrary).toHaveBeenCalledTimes(1);
    });

    it('names the file by its key while its library cannot be read, and reads it again when next laid out', async () => {
      readLibrary.mockRejectedValueOnce(new Error('unreadable'));

      expect(laidOut()).toEqual(byKey);
      await vi.advanceTimersByTimeAsync(100);
      expect(fired).not.toHaveBeenCalled();
      expect(laidOut()).toEqual(byKey);

      await edited();
      expect(laidOut()).toEqual(byKey);
      expect(readLibrary.mock.calls).toEqual([['azure'], ['azure']]);
    });
  });

  it('shows itself with the keyboard on the diagram at the cursor, selected, else on its first item', async () => {
    const first = '@startuml\nA\n@enduml';
    const second = '@startuml\nB\n@enduml';
    const document = documentAt('doc.md', `${first}\n${second}\n\nprose`);
    diagrams.set(document.uri.toString(), [
      { ...diagramOf(first), name: 'one' },
      { ...diagramOf(second), name: 'two', sourceLine: 3, openLine: 3, closeLine: 5, startLine: 3 },
    ]);
    const revealed = (): unknown[] => fake.calls.revealed.map(({ item, options }) => [tree(item as Item).label, options]);
    activate(document, 4);
    await view.show();
    expect(fake.calls.executed).toEqual([{ id: 'plantumlLocal.dependencies.focus', args: [] }]);
    // Focusing the view alone may leave the keyboard on none of its items.
    expect(revealed()).toEqual([['two', { select: true, focus: true, expand: true }]]);

    // The cursor in no diagram: the keyboard on the first item, nothing selected.
    activate(document, 7);
    await view.show();
    expect(revealed().slice(1)).toEqual([['one', { select: false, focus: true }]]);

    fake.state.editor = undefined;
    fake.editors.fire(undefined);
    await view.show();
    expect(fake.calls.revealed).toHaveLength(2);
    expect(view.getChildren()).toEqual([]);
    expect(fake.view.description).toBeUndefined();
  });
});
