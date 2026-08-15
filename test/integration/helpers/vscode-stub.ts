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
    uri: { toString(): string };
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
  fsPath: string;
  toString(): string;
}

export interface VscodeStub {
  ColorThemeKind: Record<'Light' | 'Dark' | 'HighContrast' | 'HighContrastLight', number>;
  UIKind: Record<'Desktop' | 'Web', number>;
  ProgressLocation: Record<'SourceControl' | 'Window' | 'Notification', number>;
  StatusBarAlignment: Record<'Left' | 'Right', number>;
  LanguageStatusSeverity: Record<'Information' | 'Warning' | 'Error', number>;
  TreeItemCheckboxState: Record<'Unchecked' | 'Checked', number>;
  ViewColumn: Record<'Active' | 'Beside' | 'One', number>;
  EndOfLine: Record<'LF' | 'CRLF', number>;
  Position: new (line: number, character: number) => PositionStub;
  Range: new (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ) => { start: PositionStub; end: PositionStub };
  WorkspaceEdit: new () => WorkspaceEditStub;
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
    showInformationMessage: (...args: unknown[]) => Promise<undefined>;
    showWarningMessage: (...args: unknown[]) => Promise<undefined>;
    showErrorMessage: (...args: unknown[]) => Promise<undefined>;
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
    /** Both read by the framework's runtime preflight, at activation. */
    isTrusted: boolean;
    workspaceFolders: unknown[] | undefined;
    fs: {
      createDirectory: (uri: UriStub) => Promise<void>;
      writeFile: (uri: UriStub, content: Uint8Array) => Promise<void>;
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
    /**
     * Sets (or, with undefined, clears) a configuration value and fires
     * the change event — the kit caches an unscoped settings snapshot and
     * only rebuilds it on that event, exactly like real VS Code.
     */
    setConfiguration(key: string, value: unknown): void;
    /**
     * What the next input box answers with: a string accepts, `null`
     * dismisses. Defaults to dismissal, so a test that did not expect a
     * prompt fails rather than hangs.
     */
    inputBoxReply: string | null;
    /** Prompts shown, for asserting that one was (or was not) raised. */
    inputBoxPrompts: string[];
    /** Sets `window.activeTextEditor` and fires the active-editor listeners. */
    setActiveEditor(editor: TextEditorStub | undefined): void;
    /** Fires the selection listeners for `editor`. */
    fireSelection(editor: TextEditorStub): void;
  };
}

/** file:///a/b.md style URIs with enough of the real resolution rules. */
function makeUri(full: string): UriStub {
  return {
    scheme: full.split(':')[0] ?? '',
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
  const configuration = new Map<string, unknown>();
  const configurationListeners: ((event: unknown) => void)[] = [];
  const theme = { kind: 1 };
  let activeEditor: TextEditorStub | undefined;
  /** Mutable test knobs the window stubs read at call time. */
  const hooks = { inputBoxReply: null as string | null, inputBoxPrompts: [] as string[] };

  class Position implements PositionStub {
    constructor(
      public line: number,
      public character: number
    ) {}
  }

  class Range {
    start: PositionStub;
    end: PositionStub;
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = new Position(startLine, startCharacter);
      this.end = new Position(endLine, endCharacter);
    }
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
    EndOfLine: { LF: 1, CRLF: 2 },
    Position,
    Range,
    WorkspaceEdit: WorkspaceEditStub,
    UIKind: { Desktop: 1, Web: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    Uri: {
      parse: makeUri,
      joinPath: (base, ...parts) => joinUri(base, parts),
      file: (path: string) => makeUri(`file://${path}`),
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
        return activeEditor === undefined ? [] : [activeEditor];
      },
      createOutputChannel: () => ({
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        appendLine: () => undefined,
        show: () => undefined,
        dispose: () => undefined,
      }),
      showInformationMessage: async (...args) => {
        notifications.info.push(String(args[0]));
        return undefined;
      },
      showWarningMessage: async (...args) => {
        notifications.warn.push(String(args[0]));
        return undefined;
      },
      showErrorMessage: async (...args) => {
        notifications.error.push(String(args[0]));
        return undefined;
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
      getConfiguration: () => ({
        get: <T>(key: string, fallback?: T) =>
          configuration.has(key) ? (configuration.get(key) as T) : fallback,
        update: async () => undefined,
      }),
      onDidChangeConfiguration: (listener) => {
        configurationListeners.push(listener);
        return { dispose: () => undefined };
      },
      isTrusted: true,
      workspaceFolders: undefined,
      fs: {
        createDirectory: async () => undefined,
        writeFile: async (uri, content) => {
          writtenFiles.set(uri.toString(), Buffer.from(content).toString('utf8'));
        },
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
      // Pass-through: tests assert against the English defaults.
      t: (message) => message,
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
      get inputBoxReply() {
        return hooks.inputBoxReply;
      },
      set inputBoxReply(value: string | null) {
        hooks.inputBoxReply = value;
      },
      inputBoxPrompts: hooks.inputBoxPrompts,
      setConfiguration: (key, value) => {
        if (value === undefined) {
          configuration.delete(key);
        } else {
          configuration.set(key, value);
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
    },
  };
}
