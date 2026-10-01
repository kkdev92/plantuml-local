/**
 * Minimal `vscode` module stub for loading dist/extension.js outside VS Code.
 *
 * Only what the extension and @kkdev92/vscode-ext-kit actually touch. Some of it
 * is here for the framework rather than for this extension: runtime preflight
 * reads `env.uiKind`, `workspace.isTrusted` and the folder list at activation,
 * and the enum objects exist because capability adapters are constructed then
 * too. The editor, Uri and file-system surfaces exist for the export commands,
 * which resolve paths against the document and write through `workspace.fs`.
 */

/**
 * Shape of `vscode.LogOutputChannel`. The kit's logger defaults to
 * `channelMode: 'log'`, so it creates the channel with `{ log: true }` and
 * calls the per-level methods instead of `appendLine`.
 */
export interface LogOutputChannelStub {
  trace: (message: string) => void;
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  appendLine: (message: string) => void;
  show: (preserveFocus?: boolean) => void;
  dispose: () => void;
}

/** The slice of `vscode.TextEditor` the export commands read and edit. */
export interface TextEditorStub {
  document: {
    languageId: string;
    version: number;
    isUntitled: boolean;
    uri: { toString(): string; scheme: string; path: string };
    getText(): string;
    lineAt(line: number): { text: string };
    /** Applied by the stub's `workspace.applyEdit`. */
    setText(text: string): void;
  };
  selection: { active: { line: number } };
}

interface PositionStub {
  line: number;
  character: number;
}

/** Enough of `vscode.InputBox` for the kit's quick-input capability. */
export interface InputBoxStub {
  value: string;
  title: string | undefined;
  prompt: string | undefined;
  placeholder: string | undefined;
  password: boolean;
  ignoreFocusOut: boolean;
  busy: boolean;
  enabled: boolean;
  step: number | undefined;
  totalSteps: number | undefined;
  buttons: readonly unknown[];
  validationMessage: string | undefined;
  onDidAccept: (listener: () => void) => { dispose(): void };
  onDidHide: (listener: () => void) => { dispose(): void };
  onDidChangeValue: (listener: (value: string) => void) => { dispose(): void };
  onDidTriggerButton: (listener: (button: unknown) => void) => { dispose(): void };
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

/** Enough of `vscode.QuickPick` for the kit's quick-input capability. */
export interface QuickPickStub {
  items: readonly { label: string }[];
  selectedItems: readonly { label: string }[];
  activeItems: readonly { label: string }[];
  title: string | undefined;
  placeholder: string | undefined;
  prompt: string | undefined;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  canSelectMany: boolean;
  busy: boolean;
  enabled: boolean;
  buttons: readonly unknown[];
  onDidAccept: (listener: () => void) => { dispose(): void };
  onDidHide: (listener: () => void) => { dispose(): void };
  onDidTriggerButton: (listener: (button: unknown) => void) => { dispose(): void };
  onDidTriggerItemButton: (listener: (event: unknown) => void) => { dispose(): void };
  onDidChangeActive: (listener: (items: readonly unknown[]) => void) => { dispose(): void };
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

type EditOp =
  | { type: 'insert'; uri: string; at: PositionStub; text: string }
  | { type: 'replace'; uri: string; start: PositionStub; end: PositionStub; text: string };

/** Collects insert/replace calls; `workspace.applyEdit` executes them. */
class WorkspaceEditStub {
  readonly ops: EditOp[] = [];

  insert(uri: { toString(): string }, at: PositionStub, text: string): void {
    this.ops.push({ type: 'insert', uri: uri.toString(), at, text });
  }

  replace(
    uri: { toString(): string },
    range: { start: PositionStub; end: PositionStub },
    text: string
  ): void {
    this.ops.push({ type: 'replace', uri: uri.toString(), start: range.start, end: range.end, text });
  }
}

/** The slice of `vscode.Uri` the export commands read. */
export interface UriStub {
  scheme: string;
  path: string;
  fsPath: string;
  toString(): string;
}

/** A `vscode.CompletionItem` as the extension builds it. */
export interface CompletionItemStub {
  label: string | { label: string; description?: string };
  kind?: number;
  insertText?: string | { value: string };
  keepWhitespace?: boolean;
  range?: { inserting: { start: PositionStub; end: PositionStub }; replacing: { start: PositionStub; end: PositionStub } };
  sortText?: string;
}

/** A completion provider as registered, with what it was registered for. */
export interface CompletionRegistrationStub {
  selector: unknown;
  triggers: string[];
  provider: {
    provideCompletionItems(
      document: TextEditorStub['document'],
      position: PositionStub
    ): CompletionItemStub[] | undefined;
  };
}

/** A `vscode.WebviewPanel` as the stub creates it, with what it was sent. */
export interface WebviewPanelStub {
  viewType: string;
  title: string;
  column: unknown;
  options: {
    enableScripts?: boolean;
    enableForms?: boolean;
    localResourceRoots?: readonly { toString(): string }[];
  };
  visible: boolean;
  /** How many times `reveal` was called. */
  revealed: number;
  webview: {
    html: string;
    /** As set after creation, which a restored panel needs. */
    options: WebviewPanelStub['options'];
    readonly cspSource: string;
    /** Every message posted to the page, in order. */
    posted: unknown[];
    asWebviewUri(uri: { toString(): string }): { toString(): string };
    postMessage(message: unknown): Promise<boolean>;
    onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
  };
  reveal(column?: unknown): void;
  onDidDispose(listener: () => void): { dispose(): void };
  onDidChangeViewState(listener: () => void): { dispose(): void };
  dispose(): void;
  /** Delivers `message` as the page would send it. */
  receive(message: unknown): void;
}

/** A modal message as shown: its text, detail and the buttons offered. */
export interface ModalStub {
  message: string;
  detail: string | undefined;
  buttons: string[];
}

/** A `vscode.Diagnostic` as the extension builds it. */
export interface DiagnosticStub {
  range: { start: PositionStub; end: PositionStub };
  message: string;
  severity: number;
  code?: unknown;
  source?: string;
}

export interface VscodeStub {
  ColorThemeKind: Record<'Light' | 'Dark' | 'HighContrast' | 'HighContrastLight', number>;
  DiagnosticSeverity: Record<'Error' | 'Warning' | 'Information' | 'Hint', number>;
  Diagnostic: new (
    range: { start: PositionStub; end: PositionStub },
    message: string,
    severity?: number
  ) => DiagnosticStub;
  languages: {
    createDiagnosticCollection: (name?: string) => {
      set: (uri: { toString(): string }, diagnostics: readonly DiagnosticStub[] | undefined) => void;
      delete: (uri: { toString(): string }) => void;
      dispose: () => void;
    };
    registerCompletionItemProvider: (
      selector: unknown,
      provider: CompletionRegistrationStub['provider'],
      ...triggers: string[]
    ) => { dispose(): void };
  };
  CompletionItem: new (label: CompletionItemStub['label'], kind?: number) => CompletionItemStub;
  CompletionItemKind: Record<'Keyword' | 'Value' | 'Snippet', number>;
  SnippetString: new (value: string) => { value: string };
  UIKind: Record<'Desktop' | 'Web', number>;
  ProgressLocation: Record<'SourceControl' | 'Window' | 'Notification', number>;
  StatusBarAlignment: Record<'Left' | 'Right', number>;
  LanguageStatusSeverity: Record<'Information' | 'Warning' | 'Error', number>;
  TreeItemCheckboxState: Record<'Unchecked' | 'Checked', number>;
  ViewColumn: Record<'Active' | 'Beside' | 'One', number>;
  EndOfLine: Record<'LF' | 'CRLF', number>;
  Position: new (line: number, character: number) => PositionStub;
  /** Both overloads: two positions, or four numbers. */
  Range: new (
    startLine: number | PositionStub,
    startCharacter: number | PositionStub,
    endLine?: number,
    endCharacter?: number
  ) => { start: PositionStub; end: PositionStub };
  WorkspaceEdit: new () => WorkspaceEditStub;
  FileType: Record<'Unknown' | 'File' | 'Directory' | 'SymbolicLink', number>;
  FileSystemError: new (message: string, code: string) => Error & { code: string };
  Uri: {
    parse: (value: string) => UriStub;
    joinPath: (base: UriStub | { toString(): string }, ...parts: string[]) => UriStub;
    file: (path: string) => UriStub;
  };
  env: { uiKind: number; language: string };
  window: {
    activeColorTheme: { kind: number };
    activeTextEditor: TextEditorStub | undefined;
    visibleTextEditors: TextEditorStub[];
    createOutputChannel: (name: string, options?: { log?: boolean }) => LogOutputChannelStub;
    createWebviewPanel: (
      viewType: string,
      title: string,
      column: unknown,
      options?: WebviewPanelStub['options']
    ) => WebviewPanelStub;
    registerWebviewPanelSerializer: (
      viewType: string,
      serializer: { deserializeWebviewPanel(panel: WebviewPanelStub, state: unknown): Promise<void> }
    ) => { dispose(): void };
    /** A modal one answers with `_test.messageReply`; the others are dismissed. */
    showInformationMessage: (...args: unknown[]) => Promise<unknown>;
    showWarningMessage: (...args: unknown[]) => Promise<unknown>;
    showErrorMessage: (...args: unknown[]) => Promise<unknown>;
    onDidChangeActiveColorTheme: (listener: () => void) => { dispose(): void };
    onDidChangeActiveTextEditor: (
      listener: (editor: TextEditorStub | undefined) => void
    ) => { dispose(): void };
    onDidChangeTextEditorSelection: (
      listener: (event: { textEditor: TextEditorStub }) => void
    ) => { dispose(): void };
    withProgress: <T>(
      options: unknown,
      task: (
        progress: { report: (value: unknown) => void },
        token: { isCancellationRequested: boolean; onCancellationRequested: () => { dispose(): void } }
      ) => Promise<T> | T
    ) => Promise<T>;
    /**
     * The prompt the extension shows for an unnamed (or unusable) block.
     * Answers with `_test.inputBoxReply`, defaulting to a dismissal.
     */
    createInputBox: () => InputBoxStub;
    /**
     * The picker the extension shows to choose a document. Answers with
     * `_test.quickPickReply`, defaulting to a dismissal.
     */
    createQuickPick: () => QuickPickStub;
  };
  workspace: {
    getConfiguration: (
      section?: string,
      scope?: unknown
    ) => {
      get: <T>(key: string, fallback?: T) => T | undefined;
      update: () => Promise<void>;
    };
    onDidChangeConfiguration: (listener: (e: unknown) => void) => { dispose(): void };
    onDidOpenTextDocument: (listener: (document: TextEditorStub['document']) => void) => { dispose(): void };
    onDidChangeTextDocument: (
      listener: (event: { document: TextEditorStub['document']; contentChanges: unknown[] }) => void
    ) => { dispose(): void };
    onDidCloseTextDocument: (listener: (document: TextEditorStub['document']) => void) => { dispose(): void };
    /** Both read by the framework's runtime preflight, at activation. */
    isTrusted: boolean;
    workspaceFolders: unknown[] | undefined;
    /** `_test.openDocuments`, which is empty unless a test fills it. */
    textDocuments: TextEditorStub['document'][];
    /** One of `_test.openDocuments`, or a FileNotFound error. */
    openTextDocument: (uri: { toString(): string }) => Promise<TextEditorStub['document']>;
    asRelativePath: (uri: { toString(): string }) => string;
    /**
     * Backed by `_test.writtenFiles`. A path with files below it is a folder,
     * and anything else not in the map does not exist.
     */
    fs: {
      createDirectory: (uri: UriStub) => Promise<void>;
      writeFile: (uri: UriStub, content: Uint8Array) => Promise<void>;
      stat: (uri: UriStub) => Promise<{ type: number; ctime: number; mtime: number; size: number }>;
      readFile: (uri: UriStub) => Promise<Uint8Array>;
      rename: (source: UriStub, target: UriStub, options?: { overwrite?: boolean }) => Promise<void>;
      delete: (uri: UriStub) => Promise<void>;
      isWritableFileSystem: (scheme: string) => boolean | undefined;
    };
    applyEdit: (edit: WorkspaceEditStub) => Promise<boolean>;
  };
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => { dispose(): void };
    executeCommand: (id: string, ...args: unknown[]) => Promise<undefined>;
  };
  l10n: {
    t: (message: string, ...args: unknown[]) => string;
  };
  /** Test hooks. */
  _test: {
    executedCommands: string[];
    registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    themeListeners: (() => void)[];
    setThemeKind(kind: number): void;
    /** Latest values passed to the `setContext` command, by key. */
    contextKeys: Map<string, unknown>;
    /** Files written through `workspace.fs`, uri string → UTF-8 content. */
    writtenFiles: Map<string, string>;
    /** First argument of each show*Message call. */
    notifications: { info: string[]; warn: string[]; error: string[] };
    /** Lines written to any log output channel, as `level: message`. */
    logs: string[];
    /**
     * Sets (or, with undefined, clears) a configuration value and fires
     * the change event — the kit caches an unscoped settings snapshot and
     * only rebuilds it on that event, exactly like real VS Code. With
     * `folder`, the value applies only to resources under that URI, as a
     * folder's own settings do.
     */
    setConfiguration(key: string, value: unknown, folder?: string): void;
    /**
     * The button title a modal message answers with; `null`, or a title not
     * offered, dismisses it. Defaults to dismissal.
     */
    messageReply: string | null;
    /** Modal messages shown, in order. */
    modals: ModalStub[];
    /** Makes `workspace.fs.rename` fail, as a write that cannot complete would. */
    failRename: boolean;
    /** URIs passed to `workspace.fs.writeFile`, in order. */
    fileWrites: string[];
    /** Completion providers registered, in order. */
    completionProviders: CompletionRegistrationStub[];
    /** Webview panels created, in order. */
    webviewPanels: WebviewPanelStub[];
    /** Panel serializers registered, by view type. */
    webviewSerializers: Map<string, { deserializeWebviewPanel(panel: WebviewPanelStub, state: unknown): Promise<void> }>;
    /** A panel as VS Code hands one back after a restart, before anything set it up. */
    restoredPanel(viewType: string, title: string): WebviewPanelStub;
    /**
     * What the next input box answers with: a string accepts, `null`
     * dismisses. Defaults to dismissal, so a test that did not expect a
     * prompt fails rather than hangs.
     */
    inputBoxReply: string | null;
    /** Prompts shown, for asserting that one was (or was not) raised. */
    inputBoxPrompts: string[];
    /**
     * What the next quick pick answers with: the label to accept, `null`
     * dismisses. Defaults to dismissal, like the input box.
     */
    quickPickReply: string | null;
    /** Quick picks shown, with their titles and item labels. */
    quickPicksShown: { title: string | undefined; labels: string[] }[];
    /** What `workspace.textDocuments` returns; empty unless a test fills it. */
    openDocuments: TextEditorStub['document'][];
    /** Editors reported visible besides the active one. */
    visibleEditors: TextEditorStub[];
    /** Sets `window.activeTextEditor` and fires the active-editor listeners. */
    setActiveEditor(editor: TextEditorStub | undefined): void;
    /** Fires the selection listeners for `editor`. */
    fireSelection(editor: TextEditorStub): void;
    /** What each diagnostic collection last set, by document URI. */
    diagnostics: Map<string, readonly DiagnosticStub[]>;
    /** Opens `document`: adds it to `textDocuments` and fires the open listeners. */
    openDocument(document: TextEditorStub['document']): void;
    /** Fires the change listeners for `document`, as an edit would. */
    changeDocument(document: TextEditorStub['document']): void;
    /** Closes `document`: removes it from `textDocuments` and fires the close listeners. */
    closeDocument(document: TextEditorStub['document']): void;
  };
}

/** file:///a/b.md style URIs with enough of the real resolution rules. */
function makeUri(full: string): UriStub {
  return {
    scheme: full.split(':')[0] ?? '',
    path: full.replace(/^[a-z][\w+.-]*:(\/\/[^/]*)?/i, ''),
    fsPath: full.replace(/^[a-z][\w+.-]*:\/\//i, ''),
    toString: () => full,
  };
}

function joinUri(base: { toString(): string }, parts: string[]): UriStub {
  const text = base.toString();
  const match = /^([a-z][\w+.-]*:\/\/[^/]*)(\/.*)?$/i.exec(text);
  const root = match?.[1] ?? '';
  const segments = (match?.[2] ?? '/').split('/').filter((segment) => segment !== '');

  for (const part of parts) {
    for (const segment of String(part).split('/')) {
      if (segment === '' || segment === '.') {
        continue;
      }
      if (segment === '..') {
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
  }
  return makeUri(`${root}/${segments.join('/')}`);
}

export function createVscodeStub(): VscodeStub {
  const executedCommands: string[] = [];
  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  const themeListeners: (() => void)[] = [];
  const editorListeners: ((editor: TextEditorStub | undefined) => void)[] = [];
  const selectionListeners: ((event: { textEditor: TextEditorStub }) => void)[] = [];
  const contextKeys = new Map<string, unknown>();
  const writtenFiles = new Map<string, string>();
  const notifications = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const logs: string[] = [];
  const configuration = new Map<string, unknown>();
  /** Folder URI → that folder's own values. */
  const folderConfiguration = new Map<string, Map<string, unknown>>();
  const configurationListeners: ((event: unknown) => void)[] = [];
  const fileWrites: string[] = [];
  const diagnostics = new Map<string, readonly DiagnosticStub[]>();
  type DocumentStub = TextEditorStub['document'];
  const openListeners: ((document: DocumentStub) => void)[] = [];
  const changeListeners: ((event: { document: DocumentStub; contentChanges: unknown[] }) => void)[] = [];
  const closeListeners: ((document: DocumentStub) => void)[] = [];
  const subscribe = <T>(listeners: T[], listener: T): { dispose(): void } => {
    listeners.push(listener);
    return {
      dispose: () => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    };
  };

  class Diagnostic implements DiagnosticStub {
    code?: unknown;
    source?: string;
    constructor(
      public range: { start: PositionStub; end: PositionStub },
      public message: string,
      public severity = 0
    ) {}
  }
  const theme = { kind: 1 };
  let activeEditor: TextEditorStub | undefined;
  /** Mutable test knobs the window stubs read at call time. */
  const hooks = {
    inputBoxReply: null as string | null,
    inputBoxPrompts: [] as string[],
    quickPickReply: null as string | null,
    quickPicksShown: [] as { title: string | undefined; labels: string[] }[],
    openDocuments: [] as TextEditorStub['document'][],
    visibleEditors: [] as TextEditorStub[],
    messageReply: null as string | null,
    modals: [] as ModalStub[],
    failRename: false,
  };

  class FileSystemError extends Error {
    constructor(
      message: string,
      readonly code: string
    ) {
      super(message);
    }
  }
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

  /** What a message call resolves to: the item a modal is answered with. */
  function answer(args: unknown[]): unknown {
    const options = args[1] as { modal?: boolean; detail?: string } | undefined;
    if (options?.modal !== true) {
      return undefined;
    }
    const items = args.slice(2) as { title: string }[];
    hooks.modals.push({
      message: String(args[0]),
      detail: options.detail,
      buttons: items.map((item) => item.title),
    });
    return items.find((item) => item.title === hooks.messageReply);
  }

  class Position implements PositionStub {
    constructor(
      public line: number,
      public character: number
    ) {}
  }

  class Range {
    start: PositionStub;
    end: PositionStub;
    constructor(
      startLine: number | PositionStub,
      startCharacter: number | PositionStub,
      endLine = 0,
      endCharacter = 0
    ) {
      if (typeof startLine === 'number' && typeof startCharacter === 'number') {
        this.start = new Position(startLine, startCharacter);
        this.end = new Position(endLine, endCharacter);
      } else {
        this.start = startLine as PositionStub;
        this.end = startCharacter as PositionStub;
      }
    }
  }

  class CompletionItem implements CompletionItemStub {
    constructor(
      public label: CompletionItemStub['label'],
      public kind?: number
    ) {}
  }

  class SnippetString {
    constructor(public value: string) {}
  }
  const completionProviders: CompletionRegistrationStub[] = [];

  const webviewPanels: WebviewPanelStub[] = [];
  const webviewSerializers = new Map<
    string,
    { deserializeWebviewPanel(panel: WebviewPanelStub, state: unknown): Promise<void> }
  >();
  function createWebviewPanel(
    viewType: string,
    title: string,
    column: unknown,
    options: WebviewPanelStub['options'] = {}
  ): WebviewPanelStub {
    const received: ((message: unknown) => void)[] = [];
    const disposed: (() => void)[] = [];
    const panel: WebviewPanelStub = {
      viewType,
      title,
      column,
      options,
      visible: true,
      revealed: 0,
      webview: {
        html: '',
        options,
        cspSource: 'https://*.vscode-cdn.net',
        posted: [],
        asWebviewUri: (uri) => ({ toString: () => `https://file+.vscode-resource.vscode-cdn.net${String(uri).replace(/^file:\/\//, '')}` }),
        postMessage: (message) => {
          panel.webview.posted.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener) => subscribe(received, listener),
      },
      reveal: () => {
        panel.revealed += 1;
      },
      onDidDispose: (listener) => subscribe(disposed, listener),
      onDidChangeViewState: () => ({ dispose: () => undefined }),
      dispose: () => {
        for (const listener of [...disposed]) listener();
      },
      receive: (message) => {
        for (const listener of [...received]) listener(message);
      },
    };
    webviewPanels.push(panel);
    return panel;
  }

  /** Executes collected ops against the active editor's document. */
  async function applyEdit(edit: WorkspaceEditStub): Promise<boolean> {
    const editor = activeEditor;
    if (editor === undefined) {
      return false;
    }
    const target = editor.document.uri.toString();
    if (edit.ops.some((op) => op.uri !== target)) {
      return false;
    }

    const text = editor.document.getText();
    const lines = text.split('\n');
    const offsetOf = (at: PositionStub): number =>
      lines.slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0) + at.character;

    // Applied back to front so earlier offsets stay valid.
    const resolved = edit.ops
      .map((op) =>
        op.type === 'insert'
          ? { start: offsetOf(op.at), end: offsetOf(op.at), text: op.text }
          : { start: offsetOf(op.start), end: offsetOf(op.end), text: op.text }
      )
      .sort((a, b) => b.start - a.start);

    let updated = text;
    for (const op of resolved) {
      updated = updated.slice(0, op.start) + op.text + updated.slice(op.end);
    }
    editor.document.setText(updated);
    return true;
  }

  return {
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Diagnostic,
    CompletionItem,
    CompletionItemKind: { Keyword: 13, Value: 11, Snippet: 14 },
    SnippetString,
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, items) => {
          diagnostics.set(uri.toString(), items ?? []);
        },
        delete: (uri) => {
          diagnostics.delete(uri.toString());
        },
        dispose: () => undefined,
      }),
      registerCompletionItemProvider: (selector, provider, ...triggers) => {
        completionProviders.push({ selector, provider, triggers });
        return { dispose: () => undefined };
      },
    },
    EndOfLine: { LF: 1, CRLF: 2 },
    Position,
    Range,
    WorkspaceEdit: WorkspaceEditStub,
    FileType,
    FileSystemError,
    UIKind: { Desktop: 1, Web: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    Uri: {
      parse: makeUri,
      joinPath: (base, ...parts) => joinUri(base, parts),
      // As VS Code builds one: forward slashes, and a leading slash before a drive.
      file: (path: string) => makeUri(`file://${path.replace(/\\/g, '/').replace(/^(?!\/)/, '/')}`),
    },
    env: { uiKind: 1, language: 'en' },
    window: {
      get activeColorTheme() {
        return theme;
      },
      get activeTextEditor() {
        return activeEditor;
      },
      get visibleTextEditors() {
        return activeEditor === undefined
          ? [...hooks.visibleEditors]
          : [activeEditor, ...hooks.visibleEditors];
      },
      createOutputChannel: () => ({
        trace: (message) => void logs.push(`trace: ${message}`),
        debug: (message) => void logs.push(`debug: ${message}`),
        info: (message) => void logs.push(`info: ${message}`),
        warn: (message) => void logs.push(`warn: ${message}`),
        error: (message) => void logs.push(`error: ${message}`),
        appendLine: (message) => void logs.push(message),
        show: () => undefined,
        dispose: () => undefined,
      }),
      createWebviewPanel,
      registerWebviewPanelSerializer: (viewType, serializer) => {
        webviewSerializers.set(viewType, serializer);
        return { dispose: () => webviewSerializers.delete(viewType) };
      },
      showInformationMessage: async (...args) => {
        notifications.info.push(String(args[0]));
        return answer(args);
      },
      showWarningMessage: async (...args) => {
        notifications.warn.push(String(args[0]));
        return answer(args);
      },
      showErrorMessage: async (...args) => {
        notifications.error.push(String(args[0]));
        return answer(args);
      },
      onDidChangeActiveColorTheme: (listener) => {
        themeListeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidChangeActiveTextEditor: (listener) => {
        editorListeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidChangeTextEditorSelection: (listener) => {
        selectionListeners.push(listener);
        return { dispose: () => undefined };
      },
      withProgress: async (_options, task) =>
        task(
          { report: () => undefined },
          { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }
        ),
      createQuickPick: () => {
        const accept: (() => void)[] = [];
        const hide: (() => void)[] = [];
        const pick: QuickPickStub = {
          items: [],
          selectedItems: [],
          activeItems: [],
          title: undefined,
          placeholder: undefined,
          prompt: undefined,
          matchOnDescription: false,
          matchOnDetail: false,
          ignoreFocusOut: false,
          canSelectMany: false,
          busy: false,
          enabled: true,
          buttons: [],
          onDidAccept: (listener) => {
            accept.push(listener);
            return { dispose: () => undefined };
          },
          onDidHide: (listener) => {
            hide.push(listener);
            return { dispose: () => undefined };
          },
          onDidTriggerButton: () => ({ dispose: () => undefined }),
          onDidTriggerItemButton: () => ({ dispose: () => undefined }),
          onDidChangeActive: () => ({ dispose: () => undefined }),
          show: () => {
            hooks.quickPicksShown.push({
              title: pick.title,
              labels: pick.items.map((item) => item.label),
            });
            // Answer asynchronously, as the real widget does.
            setTimeout(() => {
              const chosen = pick.items.find((item) => item.label === hooks.quickPickReply);
              if (chosen === undefined) {
                for (const listener of hide) listener();
                return;
              }
              pick.selectedItems = [chosen];
              for (const listener of accept) listener();
            }, 0);
          },
          hide: () => {
            for (const listener of hide) listener();
          },
          dispose: () => undefined,
        };
        return pick;
      },
      createInputBox: () => {
        const accept: (() => void)[] = [];
        const hide: (() => void)[] = [];
        const box: InputBoxStub = {
          value: '',
          title: undefined,
          prompt: undefined,
          placeholder: undefined,
          password: false,
          ignoreFocusOut: false,
          busy: false,
          enabled: true,
          step: undefined,
          totalSteps: undefined,
          buttons: [],
          validationMessage: undefined,
          onDidAccept: (listener) => {
            accept.push(listener);
            return { dispose: () => undefined };
          },
          onDidHide: (listener) => {
            hide.push(listener);
            return { dispose: () => undefined };
          },
          onDidChangeValue: () => ({ dispose: () => undefined }),
          onDidTriggerButton: () => ({ dispose: () => undefined }),
          show: () => {
            hooks.inputBoxPrompts.push(box.prompt ?? box.title ?? '');
            // Answer asynchronously, as the real widget does.
            setTimeout(() => {
              if (hooks.inputBoxReply === null) {
                for (const listener of hide) listener();
                return;
              }
              box.value = hooks.inputBoxReply;
              for (const listener of accept) listener();
            }, 0);
          },
          hide: () => {
            for (const listener of hide) listener();
          },
          dispose: () => undefined,
        };
        return box;
      },
    },
    workspace: {
      getConfiguration: (_section, scope) => ({
        get: <T>(key: string, fallback?: T) => {
          const resource = scope === undefined ? undefined : String(scope);
          for (const [folder, values] of folderConfiguration) {
            if (resource?.startsWith(`${folder}/`) === true && values.has(key)) {
              return values.get(key) as T;
            }
          }
          return configuration.has(key) ? (configuration.get(key) as T) : fallback;
        },
        update: async () => undefined,
      }),
      onDidChangeConfiguration: (listener) => {
        configurationListeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidOpenTextDocument: (listener) => subscribe(openListeners, listener),
      onDidChangeTextDocument: (listener) => subscribe(changeListeners, listener),
      onDidCloseTextDocument: (listener) => subscribe(closeListeners, listener),
      isTrusted: true,
      workspaceFolders: undefined,
      get textDocuments() {
        return [...hooks.openDocuments];
      },
      openTextDocument: async (uri) => {
        const document = hooks.openDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
        if (document === undefined) {
          throw new FileSystemError(`${uri.toString()} not found`, 'FileNotFound');
        }
        return document;
      },
      // Enough of the real rule for labels: the workspace is taken to be /c.
      asRelativePath: (uri) => uri.toString().replace(/^file:\/\/\/c\//, ''),
      fs: {
        createDirectory: async () => undefined,
        writeFile: async (uri, content) => {
          fileWrites.push(uri.toString());
          writtenFiles.set(uri.toString(), Buffer.from(content).toString('utf8'));
        },
        stat: async (uri) => {
          const key = uri.toString();
          const content = writtenFiles.get(key);
          if (content !== undefined) {
            return { type: FileType.File, ctime: 0, mtime: 0, size: content.length };
          }
          if ([...writtenFiles.keys()].some((file) => file.startsWith(`${key}/`))) {
            return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
          }
          throw new FileSystemError(`${key} not found`, 'FileNotFound');
        },
        readFile: async (uri) => {
          const content = writtenFiles.get(uri.toString());
          if (content === undefined) {
            throw new FileSystemError(`${uri.toString()} not found`, 'FileNotFound');
          }
          return Buffer.from(content, 'utf8');
        },
        rename: async (source, target, options) => {
          const content = writtenFiles.get(source.toString());
          if (hooks.failRename || content === undefined) {
            throw new FileSystemError(`cannot rename ${source.toString()}`, 'Unavailable');
          }
          if (writtenFiles.has(target.toString()) && options?.overwrite !== true) {
            throw new FileSystemError(`${target.toString()} already exists`, 'FileExists');
          }
          writtenFiles.delete(source.toString());
          writtenFiles.set(target.toString(), content);
        },
        delete: async (uri) => {
          if (!writtenFiles.delete(uri.toString())) {
            throw new FileSystemError(`${uri.toString()} not found`, 'FileNotFound');
          }
        },
        // As VS Code answers: files are writable, git's documents are not, and
        // a scheme with no file system behind it (a notebook cell) is unknown.
        isWritableFileSystem: (scheme) => (scheme === 'file' ? true : scheme === 'git' ? false : undefined),
      },
      applyEdit,
    },
    commands: {
      registerCommand: (id, handler) => {
        registeredCommands.set(id, handler);
        return { dispose: () => undefined };
      },
      executeCommand: async (id, ...args) => {
        executedCommands.push(id);
        if (id === 'setContext') {
          contextKeys.set(String(args[0]), args[1]);
        }
        return undefined;
      },
    },
    l10n: {
      // No bundle, so tests assert against the English defaults; `{0}`-style
      // placeholders are filled in from the arguments, as vscode.l10n.t does.
      t: (message, ...args) =>
        message.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
          Number(index) < args.length ? String(args[Number(index)]) : placeholder
        ),
    },
    _test: {
      executedCommands,
      registeredCommands,
      themeListeners,
      setThemeKind: (kind) => {
        theme.kind = kind;
        for (const listener of themeListeners) {
          listener();
        }
      },
      contextKeys,
      writtenFiles,
      notifications,
      logs,
      get inputBoxReply() {
        return hooks.inputBoxReply;
      },
      set inputBoxReply(value: string | null) {
        hooks.inputBoxReply = value;
      },
      inputBoxPrompts: hooks.inputBoxPrompts,
      get quickPickReply() {
        return hooks.quickPickReply;
      },
      set quickPickReply(value: string | null) {
        hooks.quickPickReply = value;
      },
      quickPicksShown: hooks.quickPicksShown,
      get messageReply() {
        return hooks.messageReply;
      },
      set messageReply(value: string | null) {
        hooks.messageReply = value;
      },
      modals: hooks.modals,
      get failRename() {
        return hooks.failRename;
      },
      set failRename(value: boolean) {
        hooks.failRename = value;
      },
      fileWrites,
      completionProviders,
      webviewPanels,
      webviewSerializers,
      // Restored panels come with whatever options were saved: none here.
      restoredPanel: (viewType, title) => createWebviewPanel(viewType, title, 1, {}),
      openDocuments: hooks.openDocuments,
      visibleEditors: hooks.visibleEditors,
      setConfiguration: (key, value, folder) => {
        let values = configuration;
        if (folder !== undefined) {
          values = folderConfiguration.get(folder) ?? new Map<string, unknown>();
          folderConfiguration.set(folder, values);
        }
        if (value === undefined) {
          values.delete(key);
        } else {
          values.set(key, value);
        }
        for (const listener of configurationListeners) {
          listener({ affectsConfiguration: () => true });
        }
      },
      setActiveEditor: (editor) => {
        activeEditor = editor;
        for (const listener of editorListeners) {
          listener(editor);
        }
      },
      fireSelection: (editor) => {
        for (const listener of selectionListeners) {
          listener({ textEditor: editor });
        }
      },
      diagnostics,
      openDocument: (document) => {
        hooks.openDocuments.push(document);
        for (const listener of openListeners) {
          listener(document);
        }
      },
      changeDocument: (document) => {
        for (const listener of changeListeners) {
          listener({ document, contentChanges: [{}] });
        }
      },
      closeDocument: (document) => {
        hooks.openDocuments.splice(hooks.openDocuments.indexOf(document), 1);
        for (const listener of closeListeners) {
          listener(document);
        }
      },
    },
  };
}
