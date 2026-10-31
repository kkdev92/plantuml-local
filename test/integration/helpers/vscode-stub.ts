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
    uri: { toString(): string; scheme: string; path: string; fsPath: string };
    getText(): string;
    lineAt(line: number): {
      text: string;
      range: { start: PositionStub; end: PositionStub };
      firstNonWhitespaceCharacterIndex: number;
    };
    /** Applied by the stub's `workspace.applyEdit`. */
    setText(text: string): void;
  };
  selection: { active: { line: number } };
  /** Records each snippet inserted, where and how, in `inserted`. */
  insertSnippet?(snippet: { value: string }, location: PositionStub, options?: unknown): Promise<boolean>;
  inserted?: { value: string; line: number; character: number; options: unknown }[];
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

/** A `vscode.FoldingRange` as the extension builds it. */
export interface FoldingRangeStub {
  start: number;
  end: number;
  kind?: number;
}

/** A folding range provider as registered, with what it was registered for. */
export interface FoldingRegistrationStub {
  selector: unknown;
  provider: { provideFoldingRanges(document: TextEditorStub['document']): FoldingRangeStub[] | undefined };
}

/** A `vscode.DocumentSymbol` as the extension builds it. */
export interface DocumentSymbolStub {
  name: string;
  detail: string;
  kind: number;
  range: { start: PositionStub; end: PositionStub };
  selectionRange: { start: PositionStub; end: PositionStub };
  children: DocumentSymbolStub[];
}

/** A document symbol provider as registered, with what it was registered for. */
export interface SymbolRegistrationStub {
  selector: unknown;
  provider: { provideDocumentSymbols(document: TextEditorStub['document']): DocumentSymbolStub[] };
}

/** A `vscode.SymbolInformation` as the extension builds it: a workspace symbol, its range given when it is resolved. */
export interface SymbolInformationStub {
  name: string;
  kind: number;
  containerName: string;
  location: { uri: UriStub; range: { start: PositionStub; end: PositionStub } | undefined };
}

/** A token as VS Code passes one: cancelled when the test says so. */
export interface CancellationTokenStub {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** A rename provider as registered, with what it was registered for. */
export interface RenameRegistrationStub {
  selector: unknown;
  provider: {
    prepareRename(
      document: TextEditorStub['document'],
      position: PositionStub,
      token: CancellationTokenStub
    ): { range: { start: PositionStub; end: PositionStub }; placeholder: string } | undefined;
    provideRenameEdits(
      document: TextEditorStub['document'],
      position: PositionStub,
      newName: string,
      token: CancellationTokenStub
    ): WorkspaceEditStub | undefined;
  };
}

/** A workspace symbol provider as registered. */
export interface WorkspaceSymbolRegistrationStub {
  provideWorkspaceSymbols(query: string, token: CancellationTokenStub): Promise<SymbolInformationStub[]>;
  resolveWorkspaceSymbol(symbol: SymbolInformationStub, token: CancellationTokenStub): Promise<SymbolInformationStub>;
}

/** A `vscode.CodeAction` as the extension builds it. */
export interface CodeActionStub {
  title: string;
  kind: string;
  command?: { title: string; command: string; arguments?: unknown[] };
  diagnostics?: DiagnosticStub[];
  isPreferred?: boolean;
}

/** A code action provider as registered, with what it was registered for. */
export interface ActionRegistrationStub {
  selector: unknown;
  provider: {
    provideCodeActions(
      document: TextEditorStub['document'],
      range: { start: PositionStub; end: PositionStub },
      context: { diagnostics: readonly DiagnosticStub[] }
    ): CodeActionStub[] | undefined;
  };
  metadata: unknown;
}

/** A `vscode.CodeLens` as the extension builds it. */
export interface CodeLensStub {
  range: { start: PositionStub; end: PositionStub };
  command?: { title: string; command: string; arguments?: unknown[] };
  readonly isResolved: boolean;
}

/** A code lens provider as registered, with what it was registered for. */
export interface CodeLensRegistrationStub {
  selector: unknown;
  provider: {
    onDidChangeCodeLenses?: (listener: () => void) => { dispose(): void };
    provideCodeLenses(
      document: TextEditorStub['document'],
      token: { isCancellationRequested: boolean }
    ): CodeLensStub[] | undefined;
  };
}

/** A `vscode.Color`: components in `[0, 1]`. */
export interface ColorStub {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** A `vscode.ColorInformation` as the extension builds it. */
export interface ColorInformationStub {
  range: { start: PositionStub; end: PositionStub };
  color: ColorStub;
}

/** A `vscode.ColorPresentation` as the extension builds it. */
export interface ColorPresentationStub {
  label: string;
  textEdit?: unknown;
}

/** A colour provider as registered, with what it was registered for. */
export interface ColorRegistrationStub {
  selector: unknown;
  provider: {
    provideDocumentColors(document: TextEditorStub['document'], token: { isCancellationRequested: boolean }): ColorInformationStub[] | undefined;
    provideColorPresentations(
      color: ColorStub,
      context: { document: TextEditorStub['document']; range: { start: PositionStub; end: PositionStub } },
      token: { isCancellationRequested: boolean }
    ): ColorPresentationStub[] | undefined;
  };
}

/** A definition provider as registered, with what it was registered for. */
export interface DefinitionRegistrationStub {
  selector: unknown;
  provider: {
    provideDefinition(
      document: TextEditorStub['document'],
      position: PositionStub,
      token?: { isCancellationRequested: boolean }
    ): Promise<unknown>;
  };
}

/** A `vscode.Location` as the extension builds it. */
export interface LocationStub {
  uri: UriStub;
  range: { start: PositionStub; end: PositionStub };
}

/** A reference provider as registered, with what it was registered for. */
export interface ReferenceRegistrationStub {
  selector: unknown;
  provider: {
    provideReferences(
      document: TextEditorStub['document'],
      position: PositionStub,
      context: { includeDeclaration: boolean },
      token: { isCancellationRequested: boolean }
    ): Promise<LocationStub[] | undefined>;
  };
}

/** A `vscode.Hover` as the extension builds it. */
export interface HoverStub {
  contents: MarkdownStringStub[];
  range?: { start: PositionStub; end: PositionStub };
}

/** A hover provider as registered, with what it was registered for. */
export interface HoverRegistrationStub {
  selector: unknown;
  provider: {
    provideHover(
      document: TextEditorStub['document'],
      position: PositionStub,
      token: { isCancellationRequested: boolean }
    ): Promise<HoverStub | undefined>;
  };
}

/** A text document content provider as registered, with the scheme it was registered for. */
export interface ContentRegistrationStub {
  scheme: string;
  provider: {
    provideTextDocumentContent(uri: UriStub): Promise<string | undefined> | string | undefined;
  };
}

/**
 * A `vscode.MarkdownString`: its value as VS Code builds it
 * (src/vs/base/common/htmlContent.ts), and each part appended, as given.
 */
export interface MarkdownStringStub {
  value: string;
  parts: { kind: 'text' | 'markdown' | 'code'; value: string; language?: string }[];
  /** As the extension sets them; VS Code takes unset as false. */
  isTrusted?: boolean | { readonly enabledCommands: readonly string[] };
  supportHtml?: boolean;
  appendText(value: string): MarkdownStringStub;
  appendMarkdown(value: string): MarkdownStringStub;
  appendCodeblock(value: string, language?: string): MarkdownStringStub;
}

/** A `vscode.CompletionItem` as the extension builds it. */
export interface CompletionItemStub {
  label: string | { label: string; detail?: string; description?: string };
  kind?: number;
  detail?: string;
  documentation?: string | MarkdownStringStub;
  insertText?: string | { value: string };
  keepWhitespace?: boolean;
  range?: { inserting: { start: PositionStub; end: PositionStub }; replacing: { start: PositionStub; end: PositionStub } };
  sortText?: string;
  command?: { title: string; command: string; arguments?: unknown[] };
}

/** A completion provider as registered, with what it was registered for. */
export interface CompletionRegistrationStub {
  selector: unknown;
  triggers: string[];
  provider: {
    provideCompletionItems(
      document: TextEditorStub['document'],
      position: PositionStub,
      token?: { isCancellationRequested: boolean },
      context?: { triggerKind: number; triggerCharacter?: string }
    ): Promise<CompletionItemStub[] | undefined>;
  };
}

/** A `vscode.ParameterInformation` as the extension builds it. */
export interface ParameterInformationStub {
  label: string | [number, number];
  documentation?: string | MarkdownStringStub;
}

/** A `vscode.SignatureInformation` as the extension builds it. */
export interface SignatureInformationStub {
  label: string;
  documentation?: string | MarkdownStringStub;
  parameters: ParameterInformationStub[];
  activeParameter?: number;
}

/** A `vscode.SignatureHelp` as the extension builds it. */
export interface SignatureHelpStub {
  signatures: SignatureInformationStub[];
  activeSignature: number;
  activeParameter: number;
}

/** A signature help provider as registered, with what it was registered for. */
export interface SignatureRegistrationStub {
  selector: unknown;
  metadata: { triggerCharacters: readonly string[]; retriggerCharacters: readonly string[] };
  provider: {
    provideSignatureHelp(
      document: TextEditorStub['document'],
      position: PositionStub,
      token: { isCancellationRequested: boolean },
      context: {
        triggerKind: number;
        triggerCharacter: string | undefined;
        isRetrigger: boolean;
        activeSignatureHelp: SignatureHelpStub | undefined;
      }
    ): Promise<SignatureHelpStub | undefined>;
  };
}

/** A `vscode.LanguageStatusItem` as created, with what the extension set on it. */
export interface LanguageStatusItemStub {
  readonly id: string;
  selector: unknown;
  name: string | undefined;
  text: string;
  detail: string | undefined;
  severity: number;
  busy: boolean;
  command: unknown;
  /** Whether `dispose` was called. */
  disposed: boolean;
  dispose(): void;
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
  /** Whether `dispose` was called. */
  disposed: boolean;
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

/** A file system watcher as created, with a way to report an event to it. */
export interface FileWatcherStub {
  pattern: { base: unknown; pattern: string };
  onDidCreate: (listener: (uri: UriStub) => void) => { dispose(): void };
  onDidChange: (listener: (uri: UriStub) => void) => { dispose(): void };
  onDidDelete: (listener: (uri: UriStub) => void) => { dispose(): void };
  /** Reports an event, as the file system would. */
  fire(kind: 'create' | 'change' | 'delete', uri: UriStub): void;
  dispose(): void;
}

/** A tree item as the extension makes it. */
export interface TreeItemStub {
  label: string;
  collapsibleState?: number;
  description?: string;
  tooltip?: unknown;
  iconPath?: { id: string };
  resourceUri?: UriStub;
  command?: { command: string; title: string; arguments?: unknown[] };
  contextValue?: string;
}

/** The data of a tree view, as the extension provides it. */
export interface TreeDataProviderStub {
  getChildren(element?: unknown): unknown[] | Promise<unknown[]>;
  getTreeItem(element: unknown): TreeItemStub | Promise<TreeItemStub>;
  getParent?(element: unknown): unknown;
  onDidChangeTreeData?: (listener: () => void) => { dispose(): void };
}

/** A tree view as created. */
export interface TreeViewStub {
  readonly visible: boolean;
  description: string | undefined;
  reveal(element: unknown, options?: unknown): Promise<void>;
  onDidChangeVisibility: (listener: (event: { visible: boolean }) => void) => { dispose(): void };
  dispose(): void;
}

/** A tree view as a test sees it: its data, and a way to show or hide it. */
export interface TreeViewHandle {
  provider: TreeDataProviderStub;
  view: TreeViewStub;
  /** What `reveal` was given, in order. */
  revealed: unknown[];
  /** Shows or hides the view, firing its visibility listeners. */
  setVisible(visible: boolean): void;
}

export interface VscodeStub {
  ColorThemeKind: Record<'Light' | 'Dark' | 'HighContrast' | 'HighContrastLight', number>;
  DiagnosticSeverity: Record<'Error' | 'Warning' | 'Information' | 'Hint', number>;
  EventEmitter: new <T>() => {
    event: (listener: (value: T) => void) => { dispose(): void };
    fire(value: T): void;
    dispose(): void;
  };
  RelativePattern: new (base: unknown, pattern: string) => { base: unknown; pattern: string };
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
    registerFoldingRangeProvider: (
      selector: unknown,
      provider: FoldingRegistrationStub['provider']
    ) => { dispose(): void };
    registerDocumentSymbolProvider: (
      selector: unknown,
      provider: SymbolRegistrationStub['provider']
    ) => { dispose(): void };
    registerCodeActionsProvider: (
      selector: unknown,
      provider: ActionRegistrationStub['provider'],
      metadata?: unknown
    ) => { dispose(): void };
    registerDefinitionProvider: (
      selector: unknown,
      provider: DefinitionRegistrationStub['provider']
    ) => { dispose(): void };
    registerReferenceProvider: (
      selector: unknown,
      provider: ReferenceRegistrationStub['provider']
    ) => { dispose(): void };
    registerHoverProvider: (selector: unknown, provider: HoverRegistrationStub['provider']) => { dispose(): void };
    registerCodeLensProvider: (
      selector: unknown,
      provider: CodeLensRegistrationStub['provider']
    ) => { dispose(): void };
    registerColorProvider: (selector: unknown, provider: ColorRegistrationStub['provider']) => { dispose(): void };
    registerSignatureHelpProvider: (
      selector: unknown,
      provider: SignatureRegistrationStub['provider'],
      metadata: SignatureRegistrationStub['metadata']
    ) => { dispose(): void };
    /** Throws for an id already in use, as VS Code does. */
    createLanguageStatusItem: (id: string, selector: unknown) => LanguageStatusItemStub;
    registerWorkspaceSymbolProvider: (provider: WorkspaceSymbolRegistrationStub) => { dispose(): void };
    registerRenameProvider: (selector: unknown, provider: RenameRegistrationStub['provider']) => { dispose(): void };
  };
  Color: new (red: number, green: number, blue: number, alpha: number) => ColorStub;
  ColorInformation: new (range: ColorInformationStub['range'], color: ColorStub) => ColorInformationStub;
  ColorPresentation: new (label: string) => ColorPresentationStub;
  CodeAction: new (title: string, kind: string) => CodeActionStub;
  CodeLens: new (range: CodeLensStub['range'], command?: CodeLensStub['command']) => CodeLensStub;
  CodeActionKind: Record<'QuickFix', string>;
  DocumentSymbol: new (
    name: string,
    detail: string,
    kind: number,
    range: DocumentSymbolStub['range'],
    selectionRange: DocumentSymbolStub['selectionRange']
  ) => DocumentSymbolStub;
  SymbolKind: Record<
    'Module' | 'Namespace' | 'Package' | 'Class' | 'Method' | 'Enum' | 'Interface' | 'Function' | 'Constant' | 'Object',
    number
  >;
  SymbolInformation: new (
    name: string,
    kind: number,
    containerName: string,
    location: SymbolInformationStub['location']
  ) => SymbolInformationStub;
  /** What a provider throws to give no answer, as VS Code's is: its message and name are `Canceled`. */
  CancellationError: new () => Error;
  FoldingRange: new (start: number, end: number, kind?: number) => FoldingRangeStub;
  FoldingRangeKind: Record<'Comment' | 'Imports' | 'Region', number>;
  CompletionItem: new (label: CompletionItemStub['label'], kind?: number) => CompletionItemStub;
  CompletionItemKind: Record<
    | 'Text'
    | 'Method'
    | 'Function'
    | 'Variable'
    | 'Property'
    | 'Keyword'
    | 'Value'
    | 'Snippet'
    | 'Color'
    | 'File'
    | 'Folder'
    | 'Constant',
    number
  >;
  CompletionTriggerKind: Record<'Invoke' | 'TriggerCharacter' | 'TriggerForIncompleteCompletions', number>;
  SnippetString: new (value: string) => { value: string };
  MarkdownString: new (value?: string) => MarkdownStringStub;
  SignatureHelp: new () => SignatureHelpStub;
  SignatureInformation: new (label: string, documentation?: string | MarkdownStringStub) => SignatureInformationStub;
  ParameterInformation: new (
    label: string | [number, number],
    documentation?: string | MarkdownStringStub
  ) => ParameterInformationStub;
  SignatureHelpTriggerKind: Record<'Invoke' | 'TriggerCharacter' | 'ContentChange', number>;
  UIKind: Record<'Desktop' | 'Web', number>;
  ProgressLocation: Record<'SourceControl' | 'Window' | 'Notification', number>;
  StatusBarAlignment: Record<'Left' | 'Right', number>;
  LanguageStatusSeverity: Record<'Information' | 'Warning' | 'Error', number>;
  TreeItemCheckboxState: Record<'Unchecked' | 'Checked', number>;
  TreeItemCollapsibleState: Record<'None' | 'Collapsed' | 'Expanded', number>;
  TreeItem: new (label: string, collapsibleState?: number) => TreeItemStub;
  ThemeIcon: (new (id: string) => { id: string }) & { File: { id: string } };
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
  Location: new (uri: UriStub, range: { start: PositionStub; end: PositionStub }) => LocationStub;
  Hover: new (contents: MarkdownStringStub[], range?: { start: PositionStub; end: PositionStub }) => HoverStub;
  WorkspaceEdit: new () => WorkspaceEditStub;
  FileType: Record<'Unknown' | 'File' | 'Directory' | 'SymbolicLink', number>;
  FileSystemError: new (message: string, code: string) => Error & { code: string };
  Uri: {
    parse: (value: string) => UriStub;
    joinPath: (base: UriStub | { toString(): string }, ...parts: string[]) => UriStub;
    file: (path: string) => UriStub;
    /** Of a scheme and a path, without an authority. */
    from: (components: { scheme: string; path: string }) => UriStub;
  };
  env: {
    uiKind: number;
    language: string;
    /** Records what is written (see `_test.clipboardWrites`); fails while `_test.failClipboard` is set. */
    clipboard: { writeText(value: string): Promise<void>; readText(): Promise<string> };
  };
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
    /** Records the text (see `_test.statusBarMessages`); disposing it clears nothing recorded. */
    setStatusBarMessage: (text: string, hideAfterTimeout?: number) => { dispose(): void };
    /** Records the document shown and the line selected (see `_test.shownDocuments`). */
    showTextDocument: (
      document: TextEditorStub['document'],
      options?: { selection?: { start: PositionStub } }
    ) => Promise<undefined>;
    /** Picks nothing, as when the dialog is dismissed. */
    showOpenDialog: (options: unknown) => Promise<UriStub[] | undefined>;
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
    /** The short form of a picker; answers with `_test.quickPickReply` too. */
    showQuickPick: <T extends { label: string }>(
      items: readonly T[],
      options?: { placeHolder?: string }
    ) => Promise<T | undefined>;
    /** A tree view; `_test.treeViews` has it by its id. */
    createTreeView: (
      viewId: string,
      options: { treeDataProvider: TreeDataProviderStub; showCollapseAll?: boolean }
    ) => TreeViewStub;
  };
  workspace: {
    getConfiguration: (
      section?: string,
      scope?: unknown
    ) => {
      get: <T>(key: string, fallback?: T) => T | undefined;
      /** The folder's value as the folder tier, the rest as the user's. */
      inspect: <T>(key: string) => { key: string; globalValue?: T; workspaceFolderValue?: T } | undefined;
      update: () => Promise<void>;
    };
    onDidChangeConfiguration: (listener: (e: unknown) => void) => { dispose(): void };
    onDidOpenTextDocument: (listener: (document: TextEditorStub['document']) => void) => { dispose(): void };
    onDidChangeTextDocument: (
      listener: (event: { document: TextEditorStub['document']; contentChanges: unknown[] }) => void
    ) => { dispose(): void };
    onDidCloseTextDocument: (listener: (document: TextEditorStub['document']) => void) => { dispose(): void };
    onDidSaveTextDocument: (listener: (document: TextEditorStub['document']) => void) => { dispose(): void };
    /** Fires on `_test.grantTrust`: the workspace starts trusted. */
    onDidGrantWorkspaceTrust: (listener: () => void) => { dispose(): void };
    /** Fires on `_test.changeWorkspaceFolders`. */
    onDidChangeWorkspaceFolders: (listener: () => void) => { dispose(): void };
    /** Kept in `_test.fileWatchers` until disposed. */
    createFileSystemWatcher: (pattern: unknown) => FileWatcherStub;
    /** Both read by the framework's runtime preflight, at activation. */
    isTrusted: boolean;
    workspaceFolders: unknown[] | undefined;
    /** `_test.openDocuments`, which is empty unless a test fills it. */
    textDocuments: TextEditorStub['document'][];
    /** One of `_test.openDocuments`, or a FileNotFound error. */
    openTextDocument: (uri: { toString(): string }) => Promise<TextEditorStub['document']>;
    asRelativePath: (uri: { toString(): string }) => string;
    /** The workspace is taken to be /c, as `asRelativePath` takes it. */
    getWorkspaceFolder: (uri: { toString(): string }) => { uri: UriStub; name: string; index: number } | undefined;
    /**
     * Backed by `_test.writtenFiles`. A path with files below it is a folder,
     * and anything else not in the map does not exist.
     */
    fs: {
      createDirectory: (uri: UriStub) => Promise<void>;
      writeFile: (uri: UriStub, content: Uint8Array) => Promise<void>;
      stat: (uri: UriStub) => Promise<{ type: number; ctime: number; mtime: number; size: number }>;
      readFile: (uri: UriStub) => Promise<Uint8Array>;
      readDirectory: (uri: UriStub) => Promise<[string, number][]>;
      rename: (source: UriStub, target: UriStub, options?: { overwrite?: boolean }) => Promise<void>;
      delete: (uri: UriStub) => Promise<void>;
      isWritableFileSystem: (scheme: string) => boolean | undefined;
    };
    applyEdit: (edit: WorkspaceEditStub) => Promise<boolean>;
    registerTextDocumentContentProvider: (
      scheme: string,
      provider: ContentRegistrationStub['provider']
    ) => { dispose(): void };
  };
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => { dispose(): void };
    executeCommand: (id: string, ...args: unknown[]) => Promise<undefined>;
  };
  extensions: {
    /** Knows VS Code's Markdown extension alone, as `_test.setMarkdownExtension` says. */
    getExtension: (id: string) => { id: string; isActive: boolean } | undefined;
  };
  l10n: {
    t: (message: string, ...args: unknown[]) => string;
  };
  /** Test hooks. */
  _test: {
    executedCommands: string[];
    /** Commands executed, with their arguments, in order. */
    commandCalls: { id: string; args: unknown[] }[];
    registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    themeListeners: (() => void)[];
    setThemeKind(kind: number): void;
    /**
     * What `extensions.getExtension` tells of VS Code's Markdown extension:
     * started (the default), not started, or not in this extension host.
     */
    setMarkdownExtension(state: 'active' | 'inactive' | 'absent'): void;
    /** Latest values passed to the `setContext` command, by key. */
    contextKeys: Map<string, unknown>;
    /** Files written through `workspace.fs`, uri string → UTF-8 content. */
    writtenFiles: Map<string, string>;
    /** The same files' bytes as written, for binary content such as a PNG. */
    writtenBytes: Map<string, Uint8Array>;
    /** First argument of each show*Message call. */
    notifications: { info: string[]; warn: string[]; error: string[] };
    /** Lines written to any log output channel, as `level: message`. */
    logs: string[];
    /**
     * Sets (or, with undefined, clears) a configuration value and fires
     * the change event — the kit caches an unscoped settings snapshot and
     * only rebuilds it on that event, exactly like real VS Code. With
     * `folder`, the value applies only to that URI and the resources under
     * it, as a folder's own settings do.
     */
    setConfiguration(key: string, value: unknown, folder?: string): void;
    /**
     * Sets (or, with undefined, clears) a value of a language's settings,
     * as `"[plantuml]": { "editor.wordBasedSuggestions": "off" }` does: the
     * key with its section. A read scoped to that language (a scope with a
     * `languageId`) gets it ahead of the other values.
     */
    setLanguageConfiguration(language: string, key: string, value: unknown): void;
    /**
     * The button title a modal message answers with; `null`, or a title not
     * offered, dismisses it. Defaults to dismissal.
     */
    messageReply: string | null;
    /**
     * The button title a message that is not modal answers with; `null`, or
     * a title not offered, dismisses it. Defaults to dismissal.
     */
    notificationReply: string | null;
    /** Modal messages shown, in order. */
    modals: ModalStub[];
    /** Makes `workspace.fs.rename` fail, as a write that cannot complete would. */
    failRename: boolean;
    /** Texts `env.clipboard.writeText` was given, in order. */
    clipboardWrites: string[];
    /** Makes `env.clipboard.writeText` reject, as a clipboard another application holds would. */
    failClipboard: boolean;
    /** URIs passed to `workspace.fs.writeFile`, in order. */
    fileWrites: string[];
    /** Completion providers registered, in order. */
    completionProviders: CompletionRegistrationStub[];
    /** Folding range providers registered, in order. */
    foldingProviders: FoldingRegistrationStub[];
    /** Document symbol providers registered, in order. */
    symbolProviders: SymbolRegistrationStub[];
    /** Code action providers registered, in order. */
    actionProviders: ActionRegistrationStub[];
    /** Definition providers registered, in order. */
    definitionProviders: DefinitionRegistrationStub[];
    /** Reference providers registered, in order. */
    referenceProviders: ReferenceRegistrationStub[];
    /** Hover providers registered, in order. */
    hoverProviders: HoverRegistrationStub[];
    /** Code lens providers registered, in order. */
    codeLensProviders: CodeLensRegistrationStub[];
    /** Colour providers registered, in order. */
    colorProviders: ColorRegistrationStub[];
    /** Workspace symbol providers registered, in order. */
    workspaceSymbolProviders: WorkspaceSymbolRegistrationStub[];
    /** Rename providers registered, in order. */
    renameProviders: RenameRegistrationStub[];
    /** Texts shown in the status bar with `window.setStatusBarMessage`, in order. */
    statusBarMessages: string[];
    /** Signature help providers registered, in order. */
    signatureProviders: SignatureRegistrationStub[];
    /** Text document content providers registered, in order. */
    contentProviders: ContentRegistrationStub[];
    /** Language status items created, in order, disposed ones too. */
    languageStatusItems: LanguageStatusItemStub[];
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
    /** The tree views created, by id. */
    treeViews: Map<string, TreeViewHandle>;
    /** Documents `window.showTextDocument` showed, with the line selected. */
    shownDocuments: { uri: string; line: number | undefined }[];
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
    /** Fires the save listeners for `document`, as a save would. */
    saveDocument(document: TextEditorStub['document']): void;
    /** Trusts the workspace and fires the listeners, as granting trust would. */
    grantTrust(): void;
    /** Sets `workspace.workspaceFolders` and fires the listeners, as adding or removing a folder would. */
    changeWorkspaceFolders(folders: unknown[] | undefined): void;
    /**
     * Registrations not yet disposed, counted by API: event listeners,
     * providers, diagnostic collections, panel serializers and commands.
     * Counts of zero are left out, so `{}` means all of them were released.
     */
    live(): Record<string, number>;
    /** File system watchers created and not yet disposed. */
    fileWatchers: FileWatcherStub[];
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
  const commandCalls: { id: string; args: unknown[] }[] = [];
  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  const themeListeners: (() => void)[] = [];
  let markdownExtension: 'active' | 'inactive' | 'absent' = 'active';
  const editorListeners: ((editor: TextEditorStub | undefined) => void)[] = [];
  const selectionListeners: ((event: { textEditor: TextEditorStub }) => void)[] = [];
  const contextKeys = new Map<string, unknown>();
  const writtenFiles = new Map<string, string>();
  const writtenBytes = new Map<string, Uint8Array>();
  const notifications = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const logs: string[] = [];
  const configuration = new Map<string, unknown>();
  /** Folder URI → that folder's own values. */
  const folderConfiguration = new Map<string, Map<string, unknown>>();
  /** Language ID → its values, by their keys with the section. */
  const languageConfiguration = new Map<string, Map<string, unknown>>();
  /** The resource and the language a configuration scope stands for. */
  const scopeOf = (scope: unknown): { resource?: string; language?: string } => {
    if (typeof scope === 'object' && scope !== null && 'languageId' in scope) {
      const { uri, languageId } = scope as { uri?: unknown; languageId: string };
      return { resource: uri === undefined ? undefined : String(uri), language: languageId };
    }
    return { resource: scope === undefined ? undefined : String(scope) };
  };
  const configurationListeners: ((event: unknown) => void)[] = [];
  const fileWrites: string[] = [];
  const diagnostics = new Map<string, readonly DiagnosticStub[]>();
  type DocumentStub = TextEditorStub['document'];
  const openListeners: ((document: DocumentStub) => void)[] = [];
  const changeListeners: ((event: { document: DocumentStub; contentChanges: unknown[] }) => void)[] = [];
  const closeListeners: ((document: DocumentStub) => void)[] = [];
  const saveListeners: ((document: DocumentStub) => void)[] = [];
  const trustListeners: (() => void)[] = [];
  const folderListeners: ((event: { added: unknown[]; removed: unknown[] }) => void)[] = [];
  const subscribe = <T>(listeners: T[], listener: T): { dispose(): void } => {
    listeners.push(listener);
    return {
      dispose: () => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    };
  };

  /** Registrations not yet disposed, by API. */
  const live = new Map<string, number>();
  /** Counts `kind` as live until the registration returned is disposed, once. */
  const track = (
    kind: string,
    registration: { dispose(): unknown } = { dispose: () => undefined }
  ): { dispose(): void } => {
    live.set(kind, (live.get(kind) ?? 0) + 1);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        live.set(kind, (live.get(kind) ?? 0) - 1);
        registration.dispose();
      },
    };
  };

  /** Enough of vscode.EventEmitter: listeners in order, none after dispose. */
  class EventEmitter<T> {
    private listeners: ((value: T) => void)[] = [];
    readonly event = (listener: (value: T) => void): { dispose(): void } => subscribe(this.listeners, listener);
    fire(value: T): void {
      for (const listener of [...this.listeners]) {
        listener(value);
      }
    }
    dispose(): void {
      this.listeners = [];
    }
  }

  class RelativePattern {
    constructor(
      readonly base: unknown,
      readonly pattern: string
    ) {}
  }

  /** The file system watchers created and not yet disposed, with a way to report an event. */
  const fileWatchers: FileWatcherStub[] = [];

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
    shownDocuments: [] as { uri: string; line: number | undefined }[],
    openDocuments: [] as TextEditorStub['document'][],
    visibleEditors: [] as TextEditorStub[],
    messageReply: null as string | null,
    notificationReply: null as string | null,
    modals: [] as ModalStub[],
    failRename: false,
    failClipboard: false,
  };
  const clipboardWrites: string[] = [];

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
      const offered = args.slice(1).filter(
        (item): item is { title: string } => typeof item === 'object' && item !== null && 'title' in item
      );
      return offered.find((item) => item.title === hooks.notificationReply);
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

  class TreeItem implements TreeItemStub {
    description?: string;
    tooltip?: unknown;
    iconPath?: { id: string };
    resourceUri?: UriStub;
    command?: { command: string; title: string; arguments?: unknown[] };
    contextValue?: string;
    constructor(
      public label: string,
      public collapsibleState?: number
    ) {}
  }

  class ThemeIcon {
    static readonly File = new ThemeIcon('file');
    constructor(readonly id: string) {}
  }

  /** The tree views created, by id. */
  const treeViews = new Map<string, TreeViewHandle>();

  function createTreeView(
    viewId: string,
    options: { treeDataProvider: TreeDataProviderStub; showCollapseAll?: boolean }
  ): TreeViewStub {
    const listeners: ((event: { visible: boolean }) => void)[] = [];
    const revealed: unknown[] = [];
    let visible = false;
    const tracked = track('window.createTreeView', { dispose: () => treeViews.delete(viewId) });
    const view: TreeViewStub = {
      get visible() {
        return visible;
      },
      description: undefined,
      reveal: async (element) => {
        revealed.push(element);
      },
      onDidChangeVisibility: (listener) => {
        listeners.push(listener);
        return { dispose: () => void listeners.splice(listeners.indexOf(listener), 1) };
      },
      dispose: () => {
        tracked.dispose();
      },
    };
    treeViews.set(viewId, {
      provider: options.treeDataProvider,
      view,
      revealed,
      setVisible: (shown) => {
        visible = shown;
        for (const listener of [...listeners]) {
          listener({ visible: shown });
        }
      },
    });
    return view;
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

  /** Builds its value as VS Code 1.144.0 does (src/vs/base/common/htmlContent.ts). */
  class MarkdownString implements MarkdownStringStub {
    parts: MarkdownStringStub['parts'] = [];
    constructor(public value = '') {}
    appendText(value: string): MarkdownString {
      this.parts.push({ kind: 'text', value });
      this.value += value
        .replace(/[\\`*_{}[\]()#+!~]/g, '\\$&')
        .replace(/^([ \t]*)-/gm, '$1\\-')
        .replace(/([ \t]+)/g, (_match, spaces: string) => '&nbsp;'.repeat(spaces.length))
        .replace(/>/gm, '\\>')
        .replace(/\n/g, '\n\n');
      return this;
    }
    appendMarkdown(value: string): MarkdownString {
      this.parts.push({ kind: 'markdown', value });
      this.value += value;
      return this;
    }
    appendCodeblock(value: string, language = ''): MarkdownString {
      this.parts.push({ kind: 'code', value, language });
      const longest = Math.max(0, ...(value.match(/^`+/gm) ?? []).map((run) => run.length));
      const fence = '`'.repeat(longest >= 3 ? longest + 1 : 3);
      this.value += `\n${fence}${language}\n${value}\n${fence}\n`;
      return this;
    }
  }

  class ParameterInformation implements ParameterInformationStub {
    constructor(
      public label: string | [number, number],
      public documentation?: string | MarkdownStringStub
    ) {}
  }
  class SignatureInformation implements SignatureInformationStub {
    parameters: ParameterInformationStub[] = [];
    activeParameter?: number;
    constructor(
      public label: string,
      public documentation?: string | MarkdownStringStub
    ) {}
  }
  class SignatureHelp implements SignatureHelpStub {
    signatures: SignatureInformationStub[] = [];
    activeSignature = 0;
    activeParameter = 0;
  }
  const signatureProviders: SignatureRegistrationStub[] = [];
  const contentProviders: ContentRegistrationStub[] = [];

  const languageStatusItems: LanguageStatusItemStub[] = [];
  /** As VS Code 1.144.0 makes one (src/vs/workbench/api/common/extHostLanguages.ts), less its name, which is the extension's there. */
  const createLanguageStatusItem = (id: string, selector: unknown): LanguageStatusItemStub => {
    if (languageStatusItems.some((item) => item.id === id && !item.disposed)) {
      throw new Error(`LanguageStatusItem with id '${id}' ALREADY exists`);
    }
    const registration = track('languages.createLanguageStatusItem');
    const item: LanguageStatusItemStub = {
      id,
      selector,
      name: undefined,
      text: '',
      detail: '',
      severity: 0,
      busy: false,
      command: undefined,
      disposed: false,
      dispose: () => {
        item.disposed = true;
        registration.dispose();
      },
    };
    languageStatusItems.push(item);
    return item;
  };

  class FoldingRange implements FoldingRangeStub {
    constructor(
      public start: number,
      public end: number,
      public kind?: number
    ) {}
  }
  const foldingProviders: FoldingRegistrationStub[] = [];

  class DocumentSymbol implements DocumentSymbolStub {
    children: DocumentSymbolStub[] = [];
    constructor(
      public name: string,
      public detail: string,
      public kind: number,
      public range: DocumentSymbolStub['range'],
      public selectionRange: DocumentSymbolStub['selectionRange']
    ) {}
  }
  const symbolProviders: SymbolRegistrationStub[] = [];

  class CodeAction implements CodeActionStub {
    command?: CodeActionStub['command'];
    constructor(
      public title: string,
      public kind: string
    ) {}
  }
  const actionProviders: ActionRegistrationStub[] = [];
  const definitionProviders: DefinitionRegistrationStub[] = [];
  const referenceProviders: ReferenceRegistrationStub[] = [];
  class Location implements LocationStub {
    constructor(
      public uri: UriStub,
      public range: LocationStub['range']
    ) {}
  }
  class SymbolInformation implements SymbolInformationStub {
    constructor(
      public name: string,
      public kind: number,
      public containerName: string,
      public location: SymbolInformationStub['location']
    ) {}
  }
  class CancellationError extends Error {
    constructor() {
      super('Canceled');
      this.name = 'Canceled';
    }
  }
  const workspaceSymbolProviders: WorkspaceSymbolRegistrationStub[] = [];
  const renameProviders: RenameRegistrationStub[] = [];
  const statusBarMessages: string[] = [];
  const hoverProviders: HoverRegistrationStub[] = [];
  class Hover implements HoverStub {
    constructor(
      public contents: MarkdownStringStub[],
      public range?: HoverStub['range']
    ) {}
  }
  class CodeLens implements CodeLensStub {
    constructor(
      public range: CodeLensStub['range'],
      public command?: CodeLensStub['command']
    ) {}
    get isResolved(): boolean {
      return this.command !== undefined;
    }
  }
  const codeLensProviders: CodeLensRegistrationStub[] = [];
  class Color implements ColorStub {
    constructor(
      public red: number,
      public green: number,
      public blue: number,
      public alpha: number
    ) {}
  }
  class ColorInformation implements ColorInformationStub {
    constructor(
      public range: ColorInformationStub['range'],
      public color: ColorStub
    ) {}
  }
  class ColorPresentation implements ColorPresentationStub {
    textEdit?: unknown;
    constructor(public label: string) {}
  }
  const colorProviders: ColorRegistrationStub[] = [];

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
      disposed: false,
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
        if (panel.disposed) {
          return;
        }
        panel.disposed = true;
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

  const stub: VscodeStub = {
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    EventEmitter,
    RelativePattern,
    Diagnostic,
    CompletionItem,
    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Variable: 5,
      Property: 9,
      Keyword: 13,
      Value: 11,
      Snippet: 14,
      Color: 15,
      File: 16,
      Folder: 18,
      Constant: 20,
    },
    CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 },
    SnippetString,
    MarkdownString,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    SignatureHelpTriggerKind: { Invoke: 1, TriggerCharacter: 2, ContentChange: 3 },
    FoldingRange,
    FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
    DocumentSymbol,
    CodeAction,
    CodeLens,
    Color,
    ColorInformation,
    ColorPresentation,
    // A string here, where VS Code has a CodeActionKind; tests compare it as one.
    CodeActionKind: { QuickFix: 'quickfix' },
    SymbolKind: {
      Module: 1,
      Namespace: 2,
      Package: 3,
      Class: 4,
      Method: 5,
      Enum: 9,
      Interface: 10,
      Function: 11,
      Constant: 13,
      Object: 18,
    },
    SymbolInformation,
    CancellationError,
    languages: {
      createDiagnosticCollection: () => {
        const registration = track('languages.createDiagnosticCollection');
        return {
          set: (uri, items) => {
            diagnostics.set(uri.toString(), items ?? []);
          },
          delete: (uri) => {
            diagnostics.delete(uri.toString());
          },
          dispose: () => {
            registration.dispose();
          },
        };
      },
      registerCompletionItemProvider: (selector, provider, ...triggers) => {
        completionProviders.push({ selector, provider, triggers });
        return track('languages.registerCompletionItemProvider');
      },
      registerFoldingRangeProvider: (selector, provider) => {
        foldingProviders.push({ selector, provider });
        return track('languages.registerFoldingRangeProvider');
      },
      registerDocumentSymbolProvider: (selector, provider) => {
        symbolProviders.push({ selector, provider });
        return track('languages.registerDocumentSymbolProvider');
      },
      registerCodeActionsProvider: (selector, provider, metadata) => {
        actionProviders.push({ selector, provider, metadata });
        return track('languages.registerCodeActionsProvider');
      },
      registerDefinitionProvider: (selector, provider) => {
        definitionProviders.push({ selector, provider });
        return track('languages.registerDefinitionProvider');
      },
      registerReferenceProvider: (selector, provider) => {
        referenceProviders.push({ selector, provider });
        return track('languages.registerReferenceProvider');
      },
      registerHoverProvider: (selector, provider) => {
        hoverProviders.push({ selector, provider });
        return track('languages.registerHoverProvider');
      },
      registerCodeLensProvider: (selector, provider) => {
        codeLensProviders.push({ selector, provider });
        return track('languages.registerCodeLensProvider');
      },
      registerColorProvider: (selector, provider) => {
        colorProviders.push({ selector, provider });
        return track('languages.registerColorProvider');
      },
      registerSignatureHelpProvider: (selector, provider, metadata) => {
        signatureProviders.push({ selector, provider, metadata });
        return track('languages.registerSignatureHelpProvider');
      },
      createLanguageStatusItem,
      registerWorkspaceSymbolProvider: (provider) => {
        workspaceSymbolProviders.push(provider);
        return track('languages.registerWorkspaceSymbolProvider', {
          dispose: () => {
            workspaceSymbolProviders.splice(workspaceSymbolProviders.indexOf(provider), 1);
          },
        });
      },
      registerRenameProvider: (selector, provider) => {
        renameProviders.push({ selector, provider });
        return track('languages.registerRenameProvider');
      },
    },
    EndOfLine: { LF: 1, CRLF: 2 },
    Position,
    Range,
    Location,
    Hover,
    WorkspaceEdit: WorkspaceEditStub,
    FileType,
    FileSystemError,
    UIKind: { Desktop: 1, Web: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
    TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItem,
    ThemeIcon,
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    Uri: {
      parse: makeUri,
      joinPath: (base, ...parts) => joinUri(base, parts),
      // As VS Code builds one: forward slashes, and a leading slash before a drive.
      file: (path: string) => makeUri(`file://${path.replace(/\\/g, '/').replace(/^(?!\/)/, '/')}`),
      // As VS Code writes one without an authority (src/vs/base/common/uri.ts): no `//` after the scheme.
      from: ({ scheme, path }) => ({ scheme, path, fsPath: path, toString: () => `${scheme}:${path}` }),
    },
    env: {
      uiKind: 1,
      language: 'en',
      clipboard: {
        writeText: async (value) => {
          if (hooks.failClipboard) {
            throw new Error('The clipboard is held by another application.');
          }
          clipboardWrites.push(value);
        },
        readText: async () => clipboardWrites.at(-1) ?? '',
      },
    },
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
        return track('window.registerWebviewPanelSerializer', { dispose: () => webviewSerializers.delete(viewType) });
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
      setStatusBarMessage: (text) => {
        statusBarMessages.push(text);
        return track('window.setStatusBarMessage');
      },
      showTextDocument: async (document, options) => {
        hooks.shownDocuments.push({ uri: document.uri.toString(), line: options?.selection?.start.line });
        return undefined;
      },
      showOpenDialog: async () => undefined,
      onDidChangeActiveColorTheme: (listener) => {
        themeListeners.push(listener);
        return track('window.onDidChangeActiveColorTheme');
      },
      onDidChangeActiveTextEditor: (listener) => {
        editorListeners.push(listener);
        return track('window.onDidChangeActiveTextEditor');
      },
      onDidChangeTextEditorSelection: (listener) => {
        selectionListeners.push(listener);
        return track('window.onDidChangeTextEditorSelection');
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
      showQuickPick: async (items, options) => {
        hooks.quickPicksShown.push({ title: options?.placeHolder, labels: items.map((item) => item.label) });
        return items.find((item) => item.label === hooks.quickPickReply);
      },
      createTreeView,
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
      getConfiguration: (section, scope) => ({
        get: <T>(key: string, fallback?: T) => {
          const { resource, language } = scopeOf(scope);
          const languageValues = language === undefined ? undefined : languageConfiguration.get(language);
          const sectioned = section === undefined ? key : `${section}.${key}`;
          if (languageValues?.has(sectioned) === true) {
            return languageValues.get(sectioned) as T;
          }
          for (const [folder, values] of folderConfiguration) {
            if ((resource === folder || resource?.startsWith(`${folder}/`) === true) && values.has(key)) {
              return values.get(key) as T;
            }
          }
          return configuration.has(key) ? (configuration.get(key) as T) : fallback;
        },
        inspect: <T>(key: string) => {
          const { resource } = scopeOf(scope);
          let workspaceFolderValue: T | undefined;
          for (const [folder, values] of folderConfiguration) {
            if ((resource === folder || resource?.startsWith(`${folder}/`) === true) && values.has(key)) {
              workspaceFolderValue = values.get(key) as T;
            }
          }
          const globalValue = configuration.has(key) ? (configuration.get(key) as T) : undefined;
          return { key, globalValue, workspaceFolderValue };
        },
        update: async () => undefined,
      }),
      onDidChangeConfiguration: (listener) => {
        configurationListeners.push(listener);
        return track('workspace.onDidChangeConfiguration');
      },
      onDidOpenTextDocument: (listener) => track('workspace.onDidOpenTextDocument', subscribe(openListeners, listener)),
      onDidChangeTextDocument: (listener) =>
        track('workspace.onDidChangeTextDocument', subscribe(changeListeners, listener)),
      onDidCloseTextDocument: (listener) => track('workspace.onDidCloseTextDocument', subscribe(closeListeners, listener)),
      onDidSaveTextDocument: (listener) => track('workspace.onDidSaveTextDocument', subscribe(saveListeners, listener)),
      onDidGrantWorkspaceTrust: (listener) => track('workspace.onDidGrantWorkspaceTrust', subscribe(trustListeners, listener)),
      onDidChangeWorkspaceFolders: (listener) =>
        track('workspace.onDidChangeWorkspaceFolders', subscribe(folderListeners, listener)),
      createFileSystemWatcher: (pattern) => {
        const listeners = { create: [] as Listener[], change: [] as Listener[], delete: [] as Listener[] };
        type Listener = (uri: UriStub) => void;
        const watcher: FileWatcherStub = {
          pattern: pattern as FileWatcherStub['pattern'],
          onDidCreate: (listener) => subscribe(listeners.create, listener),
          onDidChange: (listener) => subscribe(listeners.change, listener),
          onDidDelete: (listener) => subscribe(listeners.delete, listener),
          fire: (kind, uri) => {
            for (const listener of [...listeners[kind]]) {
              listener(uri);
            }
          },
          dispose: () => undefined,
        };
        const tracked = track('workspace.createFileSystemWatcher', {
          dispose: () => {
            fileWatchers.splice(fileWatchers.indexOf(watcher), 1);
          },
        });
        watcher.dispose = (): void => {
          tracked.dispose();
        };
        fileWatchers.push(watcher);
        return watcher;
      },
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
      getWorkspaceFolder: (uri) =>
        uri.toString().startsWith('file:///c/') ? { uri: makeUri('file:///c'), name: 'c', index: 0 } : undefined,
      fs: {
        createDirectory: async () => undefined,
        writeFile: async (uri, content) => {
          fileWrites.push(uri.toString());
          writtenFiles.set(uri.toString(), Buffer.from(content).toString('utf8'));
          writtenBytes.set(uri.toString(), Uint8Array.from(content));
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
        readDirectory: async (uri) => {
          const prefix = `${uri.toString()}/`;
          const entries = new Map<string, number>();
          for (const file of writtenFiles.keys()) {
            if (file.startsWith(prefix)) {
              const [name = '', ...below] = file.slice(prefix.length).split('/');
              entries.set(name, below.length === 0 ? FileType.File : FileType.Directory);
            }
          }
          return [...entries];
        },
        readFile: async (uri) => {
          const content = writtenFiles.get(uri.toString());
          if (content === undefined) {
            throw new FileSystemError(`${uri.toString()} not found`, 'FileNotFound');
          }
          // A file a test put there as text has no bytes of its own.
          return writtenBytes.get(uri.toString()) ?? Buffer.from(content, 'utf8');
        },
        rename: async (source, target, options) => {
          const content = writtenFiles.get(source.toString());
          if (hooks.failRename || content === undefined) {
            throw new FileSystemError(`cannot rename ${source.toString()}`, 'Unavailable');
          }
          if (writtenFiles.has(target.toString()) && options?.overwrite !== true) {
            throw new FileSystemError(`${target.toString()} already exists`, 'FileExists');
          }
          const bytes = writtenBytes.get(source.toString());
          writtenFiles.delete(source.toString());
          writtenBytes.delete(source.toString());
          writtenFiles.set(target.toString(), content);
          writtenBytes.delete(target.toString());
          if (bytes !== undefined) {
            writtenBytes.set(target.toString(), bytes);
          }
        },
        delete: async (uri) => {
          writtenBytes.delete(uri.toString());
          if (!writtenFiles.delete(uri.toString())) {
            throw new FileSystemError(`${uri.toString()} not found`, 'FileNotFound');
          }
        },
        // As VS Code answers: files are writable, git's documents are not, and
        // a scheme with no file system behind it (a notebook cell) is unknown.
        isWritableFileSystem: (scheme) => (scheme === 'file' ? true : scheme === 'git' ? false : undefined),
      },
      applyEdit,
      registerTextDocumentContentProvider: (scheme, provider) => {
        contentProviders.push({ scheme, provider });
        return track('workspace.registerTextDocumentContentProvider');
      },
    },
    commands: {
      registerCommand: (id, handler) => {
        registeredCommands.set(id, handler);
        return track('commands.registerCommand');
      },
      executeCommand: async (id, ...args) => {
        executedCommands.push(id);
        commandCalls.push({ id, args });
        if (id === 'setContext') {
          contextKeys.set(String(args[0]), args[1]);
        }
        return undefined;
      },
    },
    extensions: {
      getExtension: (id) =>
        id === 'vscode.markdown-language-features' && markdownExtension !== 'absent'
          ? { id, isActive: markdownExtension === 'active' }
          : undefined,
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
      commandCalls,
      registeredCommands,
      themeListeners,
      setThemeKind: (kind) => {
        theme.kind = kind;
        for (const listener of themeListeners) {
          listener();
        }
      },
      setMarkdownExtension: (state) => {
        markdownExtension = state;
      },
      contextKeys,
      writtenFiles,
      writtenBytes,
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
      treeViews,
      shownDocuments: hooks.shownDocuments,
      get messageReply() {
        return hooks.messageReply;
      },
      set messageReply(value: string | null) {
        hooks.messageReply = value;
      },
      get notificationReply() {
        return hooks.notificationReply;
      },
      set notificationReply(value: string | null) {
        hooks.notificationReply = value;
      },
      modals: hooks.modals,
      get failRename() {
        return hooks.failRename;
      },
      set failRename(value: boolean) {
        hooks.failRename = value;
      },
      clipboardWrites,
      get failClipboard() {
        return hooks.failClipboard;
      },
      set failClipboard(value: boolean) {
        hooks.failClipboard = value;
      },
      fileWrites,
      completionProviders,
      foldingProviders,
      symbolProviders,
      actionProviders,
      definitionProviders,
      referenceProviders,
      hoverProviders,
      codeLensProviders,
      colorProviders,
      workspaceSymbolProviders,
      renameProviders,
      statusBarMessages,
      signatureProviders,
      contentProviders,
      languageStatusItems,
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
      setLanguageConfiguration: (language, key, value) => {
        const values = languageConfiguration.get(language) ?? new Map<string, unknown>();
        languageConfiguration.set(language, values);
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
      saveDocument: (document) => {
        for (const listener of saveListeners) {
          listener(document);
        }
      },
      grantTrust: () => {
        stub.workspace.isTrusted = true;
        for (const listener of [...trustListeners]) {
          listener();
        }
      },
      changeWorkspaceFolders: (folders) => {
        stub.workspace.workspaceFolders = folders;
        for (const listener of [...folderListeners]) {
          listener({ added: [], removed: [] });
        }
      },
      live: () => Object.fromEntries([...live].filter(([, count]) => count !== 0)),
      fileWatchers,
    },
  };
  return stub;
}
