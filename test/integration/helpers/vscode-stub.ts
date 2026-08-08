/**
 * Minimal `vscode` module stub for loading dist/extension.js outside VS Code.
 *
 * Only what the extension and @kkdev92/vscode-ext-kit actually touch. Some of it
 * is here for the framework rather than for this extension: runtime preflight
 * reads `env.uiKind`, `workspace.isTrusted` and the folder list at activation,
 * and the enum objects exist because capability adapters are constructed then
 * too. None of them is called — an extension that renders diagrams opens no
 * quick pick and creates no tree view.
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

export interface VscodeStub {
  ColorThemeKind: Record<'Light' | 'Dark' | 'HighContrast' | 'HighContrastLight', number>;
  UIKind: Record<'Desktop' | 'Web', number>;
  ProgressLocation: Record<'SourceControl' | 'Window' | 'Notification', number>;
  StatusBarAlignment: Record<'Left' | 'Right', number>;
  LanguageStatusSeverity: Record<'Information' | 'Warning' | 'Error', number>;
  TreeItemCheckboxState: Record<'Unchecked' | 'Checked', number>;
  ViewColumn: Record<'Active' | 'Beside' | 'One', number>;
  Uri: { joinPath: (base: unknown, ...parts: string[]) => unknown; file: (p: string) => unknown };
  env: { uiKind: number; language: string };
  window: {
    activeColorTheme: { kind: number };
    createOutputChannel: (name: string, options?: { log?: boolean }) => LogOutputChannelStub;
    showInformationMessage: (...args: unknown[]) => Promise<undefined>;
    showWarningMessage: (...args: unknown[]) => Promise<undefined>;
    showErrorMessage: (...args: unknown[]) => Promise<undefined>;
    onDidChangeActiveColorTheme: (listener: () => void) => { dispose(): void };
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
  };
}

export function createVscodeStub(): VscodeStub {
  const executedCommands: string[] = [];
  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  const themeListeners: (() => void)[] = [];
  const theme = { kind: 1 };

  return {
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    UIKind: { Desktop: 1, Web: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    Uri: {
      joinPath: (base: unknown, ...parts: string[]) => ({ base, parts }),
      file: (p: string) => ({ scheme: 'file', fsPath: p, toString: () => `file://${p}` }),
    },
    env: { uiKind: 1, language: 'en' },
    window: {
      get activeColorTheme() {
        return theme;
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
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      onDidChangeActiveColorTheme: (listener) => {
        themeListeners.push(listener);
        return { dispose: () => undefined };
      },
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(_key: string, fallback?: T) => fallback,
        update: async () => undefined,
      }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
      isTrusted: true,
      workspaceFolders: undefined,
    },
    commands: {
      registerCommand: (id, handler) => {
        registeredCommands.set(id, handler);
        return { dispose: () => undefined };
      },
      executeCommand: async (id) => {
        executedCommands.push(id);
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
    },
  };
}
