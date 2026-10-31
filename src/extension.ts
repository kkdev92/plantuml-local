import {
  Commands,
  Localization,
  Log,
  Notifications,
  Workspace,
  checkRelativePath,
  createWebviewHtml,
  debounce,
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  defineStorage,
  escapeHtml,
  filterLogger,
  generateCSP,
  generateNonce,
  serviceToken,
  setting,
  type OperationContext,
  type ServiceToken,
  type TypedStorage,
  type WorkspaceService,
} from '@kkdev92/vscode-ext-kit';
import type MarkdownIt from 'markdown-it';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';

import {
  ANALYSIS_LIMITS,
  COMMANDS,
  CONFIG,
  CONTEXT_KEYS,
  DEFAULT_EXPORT_DIRECTORY,
  DIAGNOSTICS_DEBOUNCE_MS,
  EXTENSION_ID,
  EXTENSION_NAME,
  INCLUDE_LIMITS,
  MARKDOWN_EXTENSION,
  PACKAGE_ID,
  PNG_PANEL_TYPE,
  REFRESH_DEBOUNCE_MS,
  SAVE_REFRESH_DELAY_MS,
  VIEWER_DEBOUNCE_MS,
  VIEWER_TYPE,
  VIEWER_URI_CONTEXT,
  remoteReferenceIn,
} from './core/constants';
import {
  blockAtLine,
  findFileDiagrams,
  findPlantUmlBlocks,
  isProseLine,
  isValidBlockName,
  type PlantUmlBlock,
} from './export/blocks';
import {
  PNG_SCALES,
  drawDocument,
  exportAll,
  exportOne,
  preparePng,
  prepareSvg,
  writeDocuments,
  type DrawingDeps,
  type DrawnDocument,
  type ExportFormat,
  type ExporterDeps,
  type ExportOutcome,
  type ExportResult,
} from './export/exporter';
import { MAX_DOCUMENTS, findDocuments } from './export/folder';
import { isLastExport, withExport, type ExportRecords } from './export/ownership';
import { findColors, hexOf, rgbOf } from './core/colors';
import { splitLines } from './core/lines';
import { documentColumnOf, documentLineOf } from './core/positions';
import { hasStartLine } from './core/shape';
import { errorMessage, libraryNotBundled } from './core/messages';
import { lineAfterEdits, planReferenceEdits, type ReferenceEdit } from './export/references';
import {
  diagramAt,
  expandSnippet,
  lineContext,
  mightSuggest,
  readCompletionData,
  suggest,
  suggestNames,
  suggestTemplates,
  TEMPLATES,
  type CompletionData,
  type Suggestions,
} from './language/completion';
import { callAt } from './language/calls';
import {
  definitionsOf,
  describeEntry,
  diagramLinesAt,
  libraryFile,
  macroPlace,
  macroSuggestions,
  readDiagram,
  signaturesFor,
  type MacroDefinition,
  type MacroLabels,
  type MacroPlace,
} from './language/macro-help';
import { LibraryDeclarations, macroSources } from './language/macro-sources';
import {
  diagramReading,
  macrosAt,
  pastAnalysisLimits,
  readingOf,
  sameMacro,
  type DiagramLines,
  type Macro,
  type MacroKind,
  type Macros,
  type MacroSources,
  type Origin,
  type Shortfall,
} from './language/macros';
import {
  declaredAt,
  definitionsOfName,
  elementDeclaredAt,
  elementsNamed,
  libraryIncludeAt,
  nameAt,
  nameIn,
  occurrencesIn,
  parameterAt,
  type Occurrence,
} from './language/definitions';
import {
  builtinAt,
  codeBlock,
  definitionSections,
  escapeLines,
  escapeMarkdown,
  helpFor,
  helpMarkdown,
  inlineCode,
} from './language/hover';
import { LIBRARY_SCHEME, libraryOfPath, libraryPath, libraryText } from './language/library-view';
import { settingAt, settingHelp, settingSuggestions, type StyleNames } from './language/style';
import { templatePlace } from './language/templates';
import { missingEndAt, namesDiagram, unnamedAt, withName } from './language/code-actions';
import { diagramLenses, diagramTarget, targetBlock, type DiagramAction, type DiagramTarget } from './language/code-lens';
import { listDiagrams } from './language/diagram-list';
import { foldingRanges } from './language/folding';
import { declarations, type Declaration } from './language/symbols';
import { WorkspaceSymbolSearch } from './language/workspace-symbol-provider';
import { AliasRename } from './language/alias-rename-provider';
import {
  checkSource,
  PROBLEM_CODES,
  renderProblems,
  type BlockProblem,
  type ProblemLabels,
  type RenderOutcome,
} from './diagnostics/problems';
import { DependencyView, type ViewDiagram } from './includes/dependency-view';
import { describeIncludeFailure, type IncludeLabels } from './includes/describe';
import { asWritten, definedWords, includeDirectives } from './includes/directives';
import { DrawingRecords } from './includes/drawings';
import { includeCompletions, includeDefinitions } from './includes/editor';
import { drawInDocuments, openSession, type DrawDiagram } from './includes/host';
import { INCLUDE_EXTENSIONS } from './includes/path-policy';
import type { IncludeFailure } from './includes/session';
import { changeTo } from './includes/tracking';
import { IncludeWatcher } from './includes/watch';
import { createPlantUmlPlugin, type PlantUmlPlugin, type UpdateMode } from './preview/plugin';
import { RendererClient, defaultWorkerPath } from './render/client';
import { shareRenders, type SharedRender } from './render/memo';
import { ThemePalettes } from './render/palette';
import { DiagramViewer, viewerBody, type ToolbarLabels, type ViewAction, type ViewerDeps } from './viewer/viewer';

/**
 * Extension entry point: wires VS Code, the markdown-it plugin and the render
 * worker together. All behaviour lives in src/preview and src/worker; this file
 * declares what the extension contributes and lets the framework run it.
 */

/**
 * Typed mirror of `contributes.configuration`. Every read is validated against
 * the declaration, so a hand-edited or stale `settings.json` falls back to the
 * documented default instead of reaching the renderer as garbage.
 */
export const Settings = defineSettings({
  section: EXTENSION_ID,
  values: {
    [CONFIG.THEME]: setting.enum({ values: ['auto', 'light', 'dark'], default: 'auto' }),
    [CONFIG.LOG_LEVEL]: setting.enum({
      values: ['trace', 'debug', 'info', 'warn', 'error'],
      default: 'info',
    }),
    // Resource-scoped, so a folder can set its own: read for the document.
    [CONFIG.EXPORT_DIRECTORY]: setting.string({
      default: DEFAULT_EXPORT_DIRECTORY,
      scope: 'resource',
    }),
    [CONFIG.EXPORT_THEME]: setting.enum({
      values: ['light', 'dark', 'preview'],
      default: 'light',
      scope: 'resource',
    }),
    // 1, 2 or 4 in the manifest; anything else read is taken as 2.
    [CONFIG.EXPORT_PNG_SCALE]: setting.integer({ default: 2, minimum: 1, maximum: 4, scope: 'resource' }),
    [CONFIG.HIDE_EXPORTED_IMAGES]: setting.boolean({ default: true }),
    [CONFIG.PREVIEW_UPDATE_MODE]: setting.enum({
      values: ['onChange', 'onSave', 'manual'],
      default: 'onChange',
      scope: 'resource',
    }),
    // Resource-scoped, so a folder can turn the checks off: read per document.
    [CONFIG.DIAGNOSTICS_ENABLED]: setting.boolean({ default: true, scope: 'resource' }),
    // Read as written for the document (includePathsOf), so that a value of
    // the wrong type is reported rather than taken as no folders.
    [CONFIG.INCLUDE_PATHS]: setting.stringArray({ default: [], scope: 'resource' }),
    // Resource-scoped, so a folder can do without the lenses: read per document.
    [CONFIG.CODE_LENS_ENABLED]: setting.boolean({ default: true, scope: 'resource' }),
    // Resource-scoped, so a folder can do without the help on style items: read per document.
    [CONFIG.STYLE_HELP_ENABLED]: setting.boolean({ default: true, scope: 'resource' }),
    // Resource-scoped, so a folder can be left out of Go to Symbol in Workspace: read per folder.
    [CONFIG.WORKSPACE_SYMBOLS_ENABLED]: setting.boolean({ default: true, scope: 'resource' }),
    // Read as written for each folder (workspaceSymbolsExcludeOf), so that a
    // value the search cannot read stops the search of the folder rather than
    // widening it.
    [CONFIG.WORKSPACE_SYMBOLS_EXCLUDE]: setting.stringArray({ default: [], scope: 'resource' }),
    // Resource-scoped, so a folder can leave F2 to the Markdown rename: read per document.
    [CONFIG.RENAME_ENABLED]: setting.boolean({ default: true, scope: 'resource' }),
  },
});

/**
 * What the export commands wrote, kept in the workspace's state on this
 * machine (src/export/ownership.ts).
 */
const ExportedFiles = defineStorage<ExportRecords>({
  key: 'exportedFiles',
  scope: 'workspace',
  defaultValue: {},
});

/** Clears the render cache so every diagram on the page is drawn again. */
export const ClearCache = defineCommandContract<readonly [], void>({
  id: COMMANDS.CLEAR_CACHE,
});

/** Writes the diagram under the cursor to an SVG file. */
export const ExportSvg = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.EXPORT_SVG,
});

/** Writes the diagram under the cursor to a PNG file, at plantumlLocal.exportPngScale. */
export const ExportPng = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.EXPORT_PNG,
});

/**
 * Puts the SVG of the diagram under the cursor on the clipboard as text, as
 * Export Diagram as SVG would write it, without writing a file. The `.puml`
 * preview names its file and the line of the diagram it shows.
 */
export const CopySvgText = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.COPY_SVG_TEXT,
});

/** Writes every named diagram in the active document to SVG files. */
export const ExportAllSvg = defineCommandContract<readonly [], void>({
  id: COMMANDS.EXPORT_ALL_SVG,
});

/**
 * Writes every named diagram of the Markdown and PlantUML files in a folder
 * to SVG files: the folder the Explorer passes, or one picked.
 */
export const ExportFolderSvg = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.EXPORT_FOLDER_SVG,
});

/** Writes the named diagrams of the documents under a folder to PNG files. */
export const ExportFolderPng = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.EXPORT_FOLDER_PNG,
});

/**
 * Writes a name for the diagram starting on a line of a document, asked for:
 * the code action's command, given the document's URI, the line and the
 * version the action was offered on.
 */
export const AssignDiagramName = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.ASSIGN_DIAGRAM_NAME,
});

/**
 * Adds the end line a diagram lacks, after its last line: the quick fix's
 * command, given the document's URI, the diagram's start line and the
 * version the fix was offered on.
 */
export const AddMissingEnd = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.ADD_MISSING_END,
});

/**
 * Runs a lens's action on its diagram: shows it, or writes it as SVG or PNG.
 * Given the target the lens was made with (src/language/code-lens.ts), which
 * names a diagram of an open document, and acts on nothing else.
 */
export const RunDiagramAction = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.DIAGRAM_ACTION,
});

/**
 * Lists the diagram blocks of the Markdown document in the active editor
 * and moves to the one picked (src/language/diagram-list.ts).
 */
export const GoToDiagram = defineCommandContract<readonly [], void>({
  id: COMMANDS.GO_TO_DIAGRAM,
});

/**
 * Shows the Diagram Dependencies view, at the diagram under the cursor
 * (src/includes/dependency-view.ts).
 */
export const ShowDependencies = defineCommandContract<readonly [], void>({
  id: COMMANDS.SHOW_DEPENDENCIES,
});

/** Opens what an item of the Diagram Dependencies view stands for. It is given the item. */
export const OpenDependency = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.OPEN_DEPENDENCY,
});

/** Goes to the line that asked for a file listed in the Diagram Dependencies view. It is given the item. */
export const GoToIncludeLine = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.GO_TO_INCLUDE_LINE,
});

/** Inserts a diagram template where a diagram can start (src/language/templates.ts). */
export const InsertTemplate = defineCommandContract<readonly [], void>({
  id: COMMANDS.INSERT_TEMPLATE,
});

/** What each kind of template is shown as, in the display language. */
function templateNames(l10n: { t(message: string): string }): Record<string, string> {
  return {
    sequence: l10n.t('Sequence diagram'),
    class: l10n.t('Class diagram'),
    activity: l10n.t('Activity diagram'),
    state: l10n.t('State diagram'),
    component: l10n.t('Component diagram'),
    usecase: l10n.t('Use case diagram'),
    object: l10n.t('Object diagram'),
    er: l10n.t('Entity relationship diagram'),
    deployment: l10n.t('Deployment diagram'),
    timing: l10n.t('Timing diagram'),
    gantt: l10n.t('Gantt chart'),
    mindmap: l10n.t('Mind map'),
    wbs: l10n.t('Work breakdown structure'),
    salt: l10n.t('Salt wireframe'),
    json: l10n.t('JSON data'),
    yaml: l10n.t('YAML data'),
  };
}

/** What each snippet of syntax is shown as, in the display language. */
function snippetNames(l10n: { t(message: string): string }): Record<string, string> {
  return {
    alt: l10n.t('Alternative paths'),
    opt: l10n.t('Optional path'),
    loop: l10n.t('Loop'),
    par: l10n.t('Parallel paths'),
    ref: l10n.t('Reference to another diagram'),
    note: l10n.t('Note'),
    if: l10n.t('Branch on a condition'),
    while: l10n.t('Loop that tests its condition first'),
    repeat: l10n.t('Loop that tests its condition last'),
    fork: l10n.t('Parallel actions'),
  };
}

/** What each snippet of syntax draws, in the display language, for the details of the list. */
function snippetTexts(l10n: { t(message: string): string }): Record<string, string> {
  return {
    alt: l10n.t('A box of messages for each case: those sent when the condition holds, then, after else, the others.'),
    opt: l10n.t('A box of messages that are sent only when the condition holds.'),
    loop: l10n.t('A box of messages that are sent again while the condition holds.'),
    par: l10n.t('A box of messages sent at the same time, each group after else.'),
    ref: l10n.t('A box over participants that stands for another diagram, named in it.'),
    note: l10n.t('A note of several lines over a participant, or on its left or right.'),
    if: l10n.t('The actions taken when the condition holds, then, after else, the others.'),
    while: l10n.t('Actions repeated while the condition holds, which is tested before each time.'),
    repeat: l10n.t('Actions repeated while the condition holds, which is tested after each time.'),
    fork: l10n.t('Actions that run at the same time, each group after fork again.'),
  };
}

/**
 * Exports every named diagram, then inserts or updates the marked image
 * reference after each block. The only command that edits the document.
 */
export const ExportAllAndUpdateRefs = defineCommandContract<readonly [], void>({
  id: COMMANDS.EXPORT_ALL_UPDATE_REFS,
});

/** Shows the diagram under the cursor of a PlantUML file in a viewer, in the editor's group. */
export const OpenPreview = defineCommandContract<readonly [], void>({
  id: COMMANDS.OPEN_PREVIEW,
});

/** The same, in the group beside the editor. */
export const OpenPreviewToSide = defineCommandContract<readonly [], void>({
  id: COMMANDS.OPEN_PREVIEW_TO_SIDE,
});

/*
 * The viewer's context menu: take the next drag as marking an area to zoom
 * to, or move the view to an edge of the diagram or to its centre. Each is
 * given what the page set where the menu was opened (VIEWER_URI_CONTEXT),
 * which names the viewer, and acts on nothing else.
 */
export const ZoomToArea = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.ZOOM_TO_AREA,
});
export const ScrollToTop = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.SCROLL_TO_TOP,
});
export const ScrollToBottom = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.SCROLL_TO_BOTTOM,
});
export const ScrollToLeftEdge = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.SCROLL_TO_LEFT_EDGE,
});
export const ScrollToRightEdge = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.SCROLL_TO_RIGHT_EDGE,
});
export const ScrollToCentre = defineCommandContract<readonly unknown[], void>({
  id: COMMANDS.SCROLL_TO_CENTRE,
});

/** The worker client. An object with `dispose`, so the container shuts it down. */
const Renderer: ServiceToken<RendererClient> = serviceToken<RendererClient>('plantuml.renderer');

/**
 * Which palette a themed diagram can be read in, measured once per set of
 * `!theme` lines and shared by the preview and the export commands.
 */
const Palettes: ServiceToken<ThemePalettes> = serviceToken<ThemePalettes>('plantuml.palettes');

/** Renders shared by the preview and the diagnostics, so a diagram both need is drawn once. */
const Renders: ServiceToken<SharedRender> = serviceToken<SharedRender>('plantuml.renders');

/** The last drawing of each diagram the shared renders drew for a document, with what it asked for. */
const Drawings: ServiceToken<DrawingRecords> = serviceToken<DrawingRecords>('plantuml.drawings');

/** The Diagram Dependencies view. An object with `dispose`, so the container removes it. */
const Dependencies: ServiceToken<DependencyView> = serviceToken<DependencyView>('plantuml.dependencies');

/**
 * What the files of the bundled libraries declare, and the paths upstream
 * gives them, shared by the completion and the Diagram Dependencies view.
 */
const Declarations: ServiceToken<LibraryDeclarations> = serviceToken<LibraryDeclarations>('plantuml.declarations');

/**
 * Watches the files that diagrams with local includes depend on. An object
 * with `dispose`, so the container stops the watchers.
 */
const IncludeWatch: ServiceToken<IncludeWatcher> = serviceToken<IncludeWatcher>('plantuml.includeWatch');

/**
 * Coalesces a burst of finished renders into one preview refresh.
 *
 * A function rather than an object, so the container cannot dispose it — the
 * preview's registration below cancels it instead.
 */
type Refresh = (() => void) & { cancel(): void };
const RequestRefresh: ServiceToken<Refresh> = serviceToken<Refresh>('plantuml.requestRefresh');

/**
 * The markdown-it plugin.
 *
 * A service rather than a local because three things need the same instance:
 * the clear-cache command, the theme watcher, and the `extendMarkdownIt` value
 * VS Code reads off `activate`.
 */
const Plugin: ServiceToken<PlantUmlPlugin> = serviceToken<PlantUmlPlugin>('plantuml.plugin');

/** The open diagram viewers, one per PlantUML file. */
interface ViewerSet {
  /** Shows the diagram at `line` of `document`, reusing the file's viewer if it has one. */
  open(document: vscode.TextDocument, line: number | null, column: number): void;
  /** Takes over a panel VS Code brought back after a restart, with what its page kept. */
  restore(panel: vscode.WebviewPanel, state: unknown): Promise<void>;
  /** Draws again what a viewer of `document` shows, after the file changed. */
  update(document: vscode.TextDocument): void;
  /** Says with `note`, in a viewer of `document`, that the file changed since it was drawn. */
  stale(document: vscode.TextDocument, note: string): void;
  /** Draws every viewer again, after the palette changed. */
  updateAll(): void;
  /**
   * Files changed (path key → saved or changed on disk): a viewer whose diagram
   * includes one of them is drawn again under its file's update mode, or marked
   * as not updated.
   */
  filesChanged(changes: ReadonlyMap<string, boolean>): void;
  /**
   * Has the page of the viewer that `context` names do `action`: the
   * context its page set where its context menu was opened.
   */
  act(context: unknown, action: ViewAction): void;
  /** Whether a viewer of the document at `uri` is open. */
  shows(uri: vscode.Uri): boolean;
  /** Fires with the document's URI when a viewer of it opens or closes. */
  readonly onDidChangeShown: vscode.Event<vscode.Uri>;
  /** Releases the event. */
  dispose(): void;
}
const Viewers: ServiceToken<ViewerSet> = serviceToken<ViewerSet>('plantuml.viewers');

/**
 * Whether to draw with the dark palette.
 *
 * `auto` follows the editor; the other two pin it. Read per diagram rather than
 * captured, so changing either the theme or the setting affects the next render.
 */
function isDark(theme: 'auto' | 'light' | 'dark'): boolean {
  if (theme === 'light') {
    return false;
  }
  if (theme === 'dark') {
    return true;
  }
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

/** The document to export from: its text, path and cursor line. */
interface ActiveDocument {
  text: string;
  path: string;
  /** The cursor line in the document's editor, or null when none is visible. */
  line: number | null;
  /** Kept for the reference updater, which edits the buffer. */
  textDocument: vscode.TextDocument;
  /** The document's version when `text` was read. */
  version: number;
}

/**
 * A problem as the Problems panel shows it. The engine names lines, not
 * columns, so the whole line is underlined, from its first character past
 * the quote markers and indentation of the block's container.
 */
function toDiagnostic(problem: BlockProblem, lines: readonly string[], container: string): vscode.Diagnostic {
  const text = lines[problem.line] ?? '';
  const inside = documentColumnOf(text, container, 0);
  const rest = text.slice(inside);
  const start = inside + rest.length - rest.trimStart().length;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(problem.line, start, problem.line, Math.max(start, text.length)),
    problem.message,
    problem.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
  );
  diagnostic.code = problem.code;
  diagnostic.source = EXTENSION_NAME;
  return diagnostic;
}

/**
 * The diagrams of `document`: the diagrams of a PlantUML file, named after
 * the file when there is one, or the diagram blocks of a Markdown document.
 */
function diagramsOf(document: vscode.TextDocument, text: string): PlantUmlBlock[] {
  return document.languageId === 'plantuml'
    ? findFileDiagrams(text, withoutExtension(fileNameOf(document)))
    : findPlantUmlBlocks(text);
}

/** The last segment of a document's path: `flows.puml`. */
function fileNameOf(document: vscode.TextDocument): string {
  return document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1);
}

/** A file name without its extension, which names the only diagram of a PlantUML file. */
function withoutExtension(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * A Markdown or PlantUML document that is a file, or will be one once saved:
 * one whose diagrams are checked for the Problems panel. A notebook's
 * Markdown cells and the read-only side of a diff are documents of these
 * languages too, but there is nowhere to export beside them, and their
 * problems are not the user's to fix there.
 */
function isDiagramFile(document: vscode.TextDocument): boolean {
  return (
    (document.languageId === 'markdown' || document.languageId === 'plantuml') &&
    (document.isUntitled || vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === true)
  );
}

/** A Markdown document that is a file, or will be one once saved. */
function isMarkdownFile(document: vscode.TextDocument): boolean {
  return document.languageId === 'markdown' && isDiagramFile(document);
}

/**
 * The Markdown document to export from, or null when there is none or
 * the user declined to choose one.
 *
 * The active editor's document when that is Markdown. Otherwise — the
 * obvious moment to export is while looking at the preview, and a
 * focused webview leaves no active text editor at all — the previewed
 * document cannot be read from the API, so the choice is put to the user
 * rather than guessed from whichever Markdown editor happens to be
 * visible: that one may well be another document. A single open Markdown
 * document is taken without asking.
 */
async function chooseMarkdownDocument(
  context: OperationContext,
  workspace: WorkspaceService
): Promise<vscode.TextDocument | null> {
  const active = vscode.window.activeTextEditor;
  if (active?.document.languageId === 'markdown') {
    return active.document;
  }

  const open = vscode.workspace.textDocuments.filter(isMarkdownFile);
  if (open.length === 0) {
    void context.notify.warn(context.l10n.t('Open a Markdown file to export its diagrams.'));
    return null;
  }
  if (open.length === 1) {
    return open[0] ?? null;
  }

  // Visible documents first: the previewed one is usually among them.
  const visible = new Set(
    vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString())
  );
  const items = [
    ...open.filter((document) => visible.has(document.uri.toString())),
    ...open.filter((document) => !visible.has(document.uri.toString())),
  ].map((document) => ({ label: workspace.relativePath(document.uri), document }));
  const picked = await context.ask.one(items, {
    title: context.l10n.t('Select the Markdown file to export diagrams from'),
  });
  return picked?.document ?? null;
}

/** A button on a notification, and what it does. */
interface NoticeAction {
  title: string;
  run(): Promise<unknown>;
}

/**
 * Shows a notification with buttons. VS Code shows a notification without
 * buttons on a single line, so a message longer than that comes with one: a
 * way on from what it says.
 */
async function notifyWith(
  context: OperationContext,
  severity: 'info' | 'warn' | 'error',
  message: string,
  actions: readonly NoticeAction[]
): Promise<void> {
  const choice = await context.notify[severity](message, {
    actions: actions.map((action, index) => ({ title: action.title, value: index })),
  });
  if (choice !== undefined) {
    await actions[choice]?.run();
  }
}

/** A button that opens the Settings editor at this extension's setting `key`. */
function settingsButton(context: OperationContext, key: string): NoticeAction {
  return {
    title: context.l10n.t('Open Settings'),
    run: () => context.commands.execute('workbench.action.openSettings', `@id:${EXTENSION_ID}.${key}`),
  };
}

/**
 * A button that selects `uri` in the Explorer view. With `orFolder`, a file
 * that may not be there: the folder it would be in is selected instead.
 */
function explorerButton(context: OperationContext, uri: vscode.Uri, orFolder = false): NoticeAction {
  return {
    title: context.l10n.t('Show in Explorer'),
    run: async (): Promise<void> => {
      const there =
        !orFolder ||
        (await Promise.resolve(vscode.workspace.fs.stat(uri)).then(
          () => true,
          () => false
        ));
      await context.commands.execute('revealInExplorer', there ? uri : vscode.Uri.joinPath(uri, '..'));
    },
  };
}

/** A button that shows the Problems panel, where the diagnostics say what is wrong in a diagram. */
function problemsButton(context: OperationContext): NoticeAction {
  return {
    title: context.l10n.t('Show Problems'),
    run: () => context.commands.execute('workbench.actions.view.problems'),
  };
}

/** A button that shows the extension's output channel. */
function outputButton(context: OperationContext): NoticeAction {
  return { title: context.l10n.t('Show Output'), run: () => showOutput(context) };
}

/**
 * Says that exporting needs a trusted workspace, with VS Code's own way of
 * granting it.
 */
async function refuseUntrusted(context: OperationContext): Promise<void> {
  await notifyWith(
    context,
    'warn',
    context.l10n.t('Export is unavailable in Restricted Mode. Trust this workspace to export diagrams. You can still use the preview.'),
    [{ title: context.l10n.t('Manage Workspace Trust'), run: (): Promise<unknown> => context.commands.execute('workbench.trust.manage') }]
  );
}

/**
 * The document to export from, or null after explaining why there is
 * none: the document {@link pickDocument} finds, in a trusted workspace
 * and saved, so that there is a folder to write beside.
 */
async function activeDocument(
  context: OperationContext,
  workspace: WorkspaceService,
  plantUml: boolean,
  target: ExportTarget | null = null
): Promise<ActiveDocument | null> {
  // Writing files is the one thing this extension promises not to do in
  // an untrusted workspace. Checked here rather than through a command
  // `enablement` clause: that only hides the command, leaving someone who
  // went looking for it with no idea why it is missing.
  if (!vscode.workspace.isTrusted) {
    void refuseUntrusted(context);
    return null;
  }
  const document = await pickDocument(context, workspace, plantUml, target);
  if (document === null) {
    return null;
  }
  if (document.textDocument.isUntitled) {
    // There is no folder to write beside.
    void context.notify.warn(context.l10n.t('Save the file before exporting.'));
    return null;
  }
  return document;
}

/**
 * The document a command acts on, or null after explaining why there is
 * none: the document `target` names, else a Markdown document, or with
 * `plantUml`, the PlantUML file in the active editor.
 *
 * `vscode.window` rather than the kit's editor service because export
 * needs the document's own URI to resolve a relative directory against,
 * and the cursor's line number rather than its text.
 */
async function pickDocument(
  context: OperationContext,
  workspace: WorkspaceService,
  plantUml: boolean,
  target: ExportTarget | null
): Promise<ActiveDocument | null> {
  const active = vscode.window.activeTextEditor?.document;
  const document =
    target !== null
      ? await vscode.workspace.openTextDocument(target.uri).then(
          (opened) => opened,
          () => null
        )
      : plantUml && active?.languageId === 'plantuml'
        ? active
        : await chooseMarkdownDocument(context, workspace);
  if (document === null) {
    return null;
  }
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === document.uri.toString()
  );
  return {
    text: document.getText(),
    path: document.uri.toString(),
    line: target?.line ?? editor?.selection.active.line ?? null,
    textDocument: document,
    version: document.version,
  };
}

/** A file and the line of a diagram in it, as the `.puml` preview names what it shows. */
interface ExportTarget {
  uri: vscode.Uri;
  line: number;
}

/** The {@link ExportTarget} an export command was given, checked; null for anything else. */
function exportTarget(value: unknown): ExportTarget | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { uri, line } = value as { uri?: unknown; line?: unknown };
  return typeof uri === 'string' && typeof line === 'number' && Number.isInteger(line) && line >= 0
    ? { uri: vscode.Uri.parse(uri), line }
    : null;
}

/**
 * The diagram a command acts on in `document`: the block under the cursor,
 * or the only block when there is nothing to choose between — a document
 * picked from a list has no cursor. Null after saying where to put the
 * cursor.
 */
async function diagramAtCursor(context: OperationContext, document: ActiveDocument): Promise<PlantUmlBlock | null> {
  const blocks = diagramsOf(document.textDocument, document.text);
  const atCursor = document.line === null ? null : blockAtLine(blocks, document.line);
  const block = atCursor ?? (blocks.length === 1 ? (blocks[0] ?? null) : null);
  if (block === null) {
    await context.notify.warn(
      document.textDocument.languageId === 'plantuml'
        ? context.l10n.t('Place the cursor in the source code of the diagram you want to export.')
        : context.l10n.t('Place the cursor inside the PlantUML code block you want to export.')
    );
  }
  return block;
}

/** How the settings accessor is seen by the helpers below. */
type SettingsReader = {
  read(scope?: { resource: vscode.Uri }): { values: Record<string, unknown> };
  inspect(
    key: typeof CONFIG.INCLUDE_PATHS | typeof CONFIG.WORKSPACE_SYMBOLS_EXCLUDE,
    scope?: { resource: vscode.Uri }
  ): { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined;
};

/** How the localisation service is seen by the helpers below. */
type L10n = { t(message: string, ...args: string[]): string };

/**
 * `plantumlLocal.includePaths` for `document` as written, the folder's value
 * first: a value of the wrong type is reported as such, where the validated
 * read would take it as no folders.
 */
function includePathsOf(settings: SettingsReader, document: vscode.Uri): unknown {
  const tiers = settings.inspect(CONFIG.INCLUDE_PATHS, { resource: document });
  return tiers?.workspaceFolderValue ?? tiers?.workspaceValue ?? tiers?.globalValue ?? [];
}

/** `plantumlLocal.workspaceSymbols.exclude` for a workspace folder as written, read as {@link includePathsOf} reads. */
function workspaceSymbolsExcludeOf(settings: SettingsReader, folder: vscode.Uri): unknown {
  const tiers = settings.inspect(CONFIG.WORKSPACE_SYMBOLS_EXCLUDE, { resource: folder });
  return tiers?.workspaceFolderValue ?? tiers?.workspaceValue ?? tiers?.globalValue ?? [];
}

/** Why a local include failed, in the user's language. */
function includeLabels(l10n: L10n): IncludeLabels {
  return {
    untrusted: l10n.t('Local includes are unavailable in Restricted Mode. Trust this workspace to include files.'),
    untitled: l10n.t('Save this document before including local files so their paths can be resolved.'),
    notOnDisk: l10n.t('Local includes require a document saved on disk. Virtual documents are not supported.'),
    outsideWorkspace: l10n.t(
      "Open the folder containing this document as a workspace. Included files must be within that workspace folder."
    ),
    settingNotAList: l10n.t('Set plantumlLocal.includePaths to an array of folder paths, for example: ["includes", "styles"].'),
    settingTooMany: (count, most) =>
      l10n.t('plantumlLocal.includePaths has {0} entries. Reduce the list to {1} folders or fewer.', String(count), String(most)),
    settingRefused: (folder) =>
      l10n.t('Invalid include folder: {0}. In plantumlLocal.includePaths, use paths relative to the workspace folder that stay within it.', folder),
    notRelative: l10n.t(
      'Use a path relative to the file containing this directive. Absolute paths, drive letters, network shares, URLs, and ~ are not supported.'
    ),
    badName: l10n.t(
      'Invalid file name. Use a non-empty name without reserved device names, colons, control characters, or a trailing dot or space.'
    ),
    versionControl: l10n.t('Files inside .git, .hg, or .svn folders cannot be included.'),
    extension: (extensions) => l10n.t('Only files with these extensions can be included: {0}.', extensions),
    outside: l10n.t('The path is outside the document\'s workspace folder. Move the file into that folder or correct the path.'),
    missing: l10n.t('File not found. Check the path relative to the file containing this directive.'),
    missingAnywhere: l10n.t(
      'File not found relative to the file containing this directive or in the plantumlLocal.includePaths folders.'
    ),
    link: l10n.t('Files accessed through symbolic links or junctions cannot be included. Use a path within the workspace folder that does not pass through either.'),
    notAFile: l10n.t('The path does not point to a regular file.'),
    encoding: l10n.t('The file is not UTF-8 text. Save it with UTF-8 encoding.'),
    nul: l10n.t('The file contains a NUL character and cannot be included as text.'),
    unreadable: l10n.t('Could not read the file. Check that it exists and that you have permission to read it.'),
    tooDeep: (most) => l10n.t('Includes are nested more than {0} levels deep. Reduce the nesting or check for files that include each other.', String(most)),
    tooMany: (most) => l10n.t('This diagram includes more than {0} files. Reduce the number of included files.', String(most)),
    tooLarge: (mebibytes) => l10n.t('The included files exceed the {0} MiB total size limit. Reduce their size or include fewer files.', String(mebibytes)),
  };
}

/**
 * The words the completion and the parameter hints describe definitions in,
 * a local file shown from `root`, and a library's file by the name upstream
 * gives it, as `libraries` has read it.
 */
function macroLabels(l10n: L10n, root: string | undefined, libraries: LibraryDeclarations): MacroLabels {
  return {
    kinds: {
      procedure: l10n.t('procedure'),
      function: l10n.t('function'),
      define: l10n.t('macro'),
      definelong: l10n.t('multi-line macro'),
      constant: l10n.t('constant'),
      variable: l10n.t('variable'),
      parameter: l10n.t('parameter'),
    },
    diagram: l10n.t('this diagram'),
    file: (id) => (root === undefined ? basename(id) : relative(root, id).split(sep).join('/')),
    library: (library, key) => libraryFile(library, key, libraries.fileName(library, key)),
    conditional: l10n.t('conditional'),
    ambiguous: l10n.t('ambiguous'),
    unresolved: l10n.t('unresolved'),
    definitions: (count) => l10n.t('{0} definitions', String(count)),
    line: (place, line) => l10n.t('{0}, line {1}', place, String(line)),
  };
}

/**
 * Why what an include names was not read for the completion and the
 * parameter hints, for the output: for a local file the include session
 * could not deliver, its reason (`failures`), as the preview gives it.
 */
function shortfallReason(shortfall: Shortfall, failures: readonly IncludeFailure[], l10n: L10n): string {
  switch (shortfall.reason) {
    case 'dynamic':
      return l10n.t('Its path is put together when the diagram is drawn.');
    case 'pattern':
      return l10n.t('It picks a diagram of the file by a pattern, which is not followed.');
    case 'too-large':
      return l10n.t(
        'The file is larger than {0} MiB or longer than {1} lines, or the files read would hold more than {2} MiB.',
        String(ANALYSIS_LIMITS.fileBytes / (1024 * 1024)),
        String(ANALYSIS_LIMITS.fileLines),
        String(ANALYSIS_LIMITS.totalBytes / (1024 * 1024))
      );
    case 'index':
      return l10n.t('What the bundled library declares could not be read.');
    case 'unreadable': {
      const failure = failures.find(({ path }) => shortfall.path === path || shortfall.path.startsWith(`${path}!`));
      return failure === undefined
        ? l10n.t('A file of a bundled library cannot include a local file, and !includesub cannot read a bundled library.')
        : describeIncludeFailure(failure.reason, includeLabels(l10n), INCLUDE_EXTENSIONS, INCLUDE_LIMITS);
    }
    case 'not-bundled':
      return l10n.t('No bundled library has this file.');
    case 'no-part':
      return l10n.t('The file has no diagram or section of that number or name.');
    case 'once':
      return l10n.t('!include_once has read this file before.');
    case 'in-body':
      return l10n.t('It is read when the procedure or function it is written in runs.');
    case 'depth':
      return includeLabels(l10n).tooDeep(INCLUDE_LIMITS.depth);
  }
}

/** What the Problems panel says of the problems of a diagram, in the user's language. */
function problemLabels(l10n: L10n): ProblemLabels {
  return {
    errorMessage: (message) => errorMessage(message, l10n),
    remoteReference: l10n.t('Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'),
    severalDiagrams: l10n.t(
      'Each PlantUML code block can contain only one diagram. Move each diagram into a separate code block.'
    ),
    pages: l10n.t(
      'Multi-page diagrams (newpage) are not supported. Split the pages into separate diagrams, each in its own code block.'
    ),
    missingEnd: (end) =>
      l10n.t('The closing {0} line is missing. It has been added for rendering; the source is unchanged.', end),
    beforeStart: (start) => l10n.t('Lines before {0} are ignored when rendering this diagram.', start),
    formula: (tag) => l10n.t('The bundled engine does not draw {0} formulas; the formula is left out of the diagram.', tag),
    embeddedDiagram: l10n.t('The bundled engine does not draw a diagram embedded with {{ … }}; it is left out of the diagram.'),
    image: l10n.t('The bundled engine draws only images written inline as PNG (data:image/png;base64,…); any other image is drawn as placeholder text.'),
    themeFrom: l10n.t('Use a bundled theme or a theme file in your workspace.'),
    libraryNotBundled: (library) => libraryNotBundled(library, l10n),
    emojiUnavailable: l10n.t('Emoji syntax (<:name:>) is not supported because emoji images are not included with this extension.'),
  };
}

/**
 * The diagrams of `document` as the Problems panel checks them, for the
 * Diagram Dependencies view: none in a document it does not check, and in a
 * PlantUML file none without a start line unless `viewers` shows the file.
 */
function viewDiagrams(document: vscode.TextDocument, labels: ProblemLabels, viewers: ViewerSet, l10n: L10n): ViewDiagram[] {
  if (!isDiagramFile(document)) {
    return [];
  }
  return diagramsOf(document, document.getText())
    .filter((block) => document.languageId !== 'plantuml' || viewers.shows(document.uri) || hasStartLine(block.source))
    .map((block): ViewDiagram => {
      const check = checkSource(block, labels);
      const refused = check.problems.find((problem) => problem.severity === 'error')?.message;
      return {
        name: block.name,
        text: block.source,
        sourceLine: block.sourceLine,
        openLine: block.openLine,
        closeLine: block.closeLine,
        startLine: check.startLine,
        render: check.render ?? { notDrawn: refused ?? l10n.t('There is no PlantUML code to render.') },
      };
    });
}

/**
 * Draws diagrams with their local includes, the setting and the words for
 * failures read through `settings` and `l10n`; `watch`, when given, follows
 * the files they include.
 */
function drawWith(renderer: RendererClient, settings: SettingsReader, l10n: L10n, watch?: IncludeWatcher): DrawDiagram {
  return drawInDocuments(renderer, {
    includePaths: (document) => includePathsOf(settings, document),
    labels: includeLabels(l10n),
    remember:
      watch === undefined
        ? undefined
        : (key, paths): void => {
            watch.remember(key, paths);
          },
  });
}

/**
 * The export directory configured for `document`, or null after rejecting
 * a bad one.
 */
function exportDirectory(
  context: OperationContext,
  settings: SettingsReader,
  document: vscode.Uri
): string | null {
  const directory = String(settings.read({ resource: document }).values[CONFIG.EXPORT_DIRECTORY]);
  // A mistyped value, not hostile input -- but `../..` or an absolute path
  // would scatter files outside the document's folder, where no Markdown link
  // could reach them.
  const problem = checkRelativePath(directory);
  if (problem !== undefined) {
    void notifyWith(
      context,
      'error',
      problem === 'empty'
        ? context.l10n.t('No folder is set for exported images. Enter one in Settings, for example images.')
        : context.l10n.t(
            'The folder for exported images, {0}, cannot be used. In Settings, enter a folder inside the file\'s folder, for example images.',
            directory
          ),
      [settingsButton(context, CONFIG.EXPORT_DIRECTORY)]
    );
    return null;
  }
  return directory;
}

/** When the changed diagrams of the document at `uri` are drawn again. */
function updateModeOf(settings: SettingsReader, uri: vscode.Uri): UpdateMode {
  const mode = settings.read({ resource: uri }).values[CONFIG.PREVIEW_UPDATE_MODE];
  return mode === 'onSave' || mode === 'manual' ? mode : 'onChange';
}

/** The note on a diagram not drawn again since its file changed. */
function notUpdatedNote(
  l10n: { t(message: string, ...args: string[]): string },
  mode: Exclude<UpdateMode, 'onChange'>
): string {
  return mode === 'onSave'
    ? l10n.t('Preview is out of date. Save the file to refresh it.')
    : l10n.t('Preview is out of date. Run "PlantUML Local: Clear Render Cache and Re-render" to refresh it.');
}

/** Prompts for a file name for a block that does not carry one. */
async function askForName(context: OperationContext, format: ExportFormat): Promise<string | null> {
  const name = await context.ask.text({
    prompt:
      format === 'svg'
        ? context.l10n.t('File name for the exported SVG (without .svg)')
        : context.l10n.t('File name for the exported PNG (without .png)'),
    placeHolder: 'my-diagram',
    validate: (value: string) =>
      isValidBlockName(value)
        ? undefined
        : context.l10n.t(
            'Use 1–128 letters (A–Z, a–z), digits, hyphens, or underscores. Reserved file names such as CON are not allowed.'
          ),
  });
  return name ?? null;
}

/** The reason given for a diagram the engine drew as an error. */
function engineErrorMessage(
  l10n: L10n,
  message: string,
  line: number | null
): string {
  return line === null
    ? l10n.t('PlantUML error: {0}', errorMessage(message, l10n))
    : l10n.t('PlantUML error on line {0}: {1}', String(line), errorMessage(message, l10n));
}

/**
 * Restates each engine error at the line it occupies once `edits` are
 * applied: references inserted above a failed block push it down, and a
 * reason naming the line the export read would point at the wrong one.
 */
function relocateEngineErrors(
  context: OperationContext,
  outcome: ExportOutcome,
  edits: readonly ReferenceEdit[]
): ExportOutcome {
  const failed = outcome.failed.map((failure) => {
    const blamed = failure.engineError;
    if (blamed === undefined || blamed.line === null) {
      return failure;
    }
    const line = lineAfterEdits(edits, blamed.line);
    return { ...failure, error: engineErrorMessage(context.l10n, blamed.message, line) };
  });
  return { ...outcome, failed };
}

/** A panel that draws SVGs into PNGs, one at a time, until it is disposed. */
interface PngPanel {
  draw(svg: string, width: number, height: number, background: string): Promise<Uint8Array>;
  dispose(): void;
}

/**
 * Opens a panel that draws PNGs in a webview: the extension host has no
 * canvas, and a converter shipped instead would bring its own licence and
 * fonts. The panel opens beside the editor without taking the focus, and
 * says `body` meanwhile. It keeps its page while hidden behind another tab,
 * so switching tabs does not stop it.
 */
function openPngPanel(l10n: { t(message: string, ...args: string[]): string }, body: string): PngPanel {
  const media = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'png');
  const panel = vscode.window.createWebviewPanel(
    PNG_PANEL_TYPE,
    l10n.t('Exporting PNG…'),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, enableForms: false, retainContextWhenHidden: true, localResourceRoots: [media] }
  );
  const nonce = generateNonce();
  panel.webview.html = createWebviewHtml({
    title: 'PNG',
    // The SVG is read as an image from a Blob URL.
    csp: generateCSP(panel.webview, { nonce, imgSrc: ['blob:'] }),
    scripts: [panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'png.js')).toString()],
    nonce,
    body: `<p>${escapeHtml(body)}</p>`,
  });

  // The drawing under way, whose request waits here until the page is
  // ready for it: the page answers one at a time, in order.
  let pending: ((result: Uint8Array | Error) => void) | null = null;
  let request: unknown = null;
  let ready = false;
  let closed = false;
  const closedError = (): Error => new Error(l10n.t('PNG export stopped because its panel was closed.'));
  // The page is untrusted: only these three answers are acted on.
  panel.webview.onDidReceiveMessage((message: unknown) => {
    const { type, data, error } = (message ?? {}) as { type?: unknown; data?: unknown; error?: unknown };
    if (type === 'ready') {
      ready = true;
      if (request !== null) {
        void panel.webview.postMessage(request);
        request = null;
      }
    } else if (type === 'png' && data instanceof Uint8Array) {
      pending?.(data);
    } else if (type === 'error') {
      // A failure the page names (see media/png/png.js) has an explanation of
      // its own; anything else is passed on as it came.
      const detail = String(error);
      const explained = errorMessage(detail, l10n);
      pending?.(new Error(explained !== detail ? explained : l10n.t('PNG creation failed: {0}', detail)));
    }
  });
  panel.onDidDispose(() => {
    closed = true;
    pending?.(closedError());
  });

  return {
    draw: (svg, width, height, background): Promise<Uint8Array> =>
      new Promise((resolve, reject) => {
        if (closed) {
          reject(closedError());
          return;
        }
        const finish = (result: Uint8Array | Error): void => {
          pending = null;
          clearTimeout(timer);
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result);
          }
        };
        pending = finish;
        const timer = setTimeout(() => {
          finish(new Error(l10n.t('Creating the PNG took longer than 30 seconds, so it was stopped. Try exporting as SVG.')));
          // An answer coming later would be taken for the next drawing's.
          panel.dispose();
        }, 30_000);
        const drawing = { type: 'draw', svg, width, height, background };
        if (ready) {
          void panel.webview.postMessage(drawing);
        } else {
          request = drawing;
        }
      }),
    dispose: (): void => {
      panel.dispose();
    },
  };
}

/** A {@link PngPanel} opened at the first drawing, so a run that draws none opens none. */
function lazyPngPanel(l10n: { t(message: string, ...args: string[]): string }, body: string): PngPanel {
  let panel: PngPanel | null = null;
  return {
    draw: (svg, width, height, background): Promise<Uint8Array> => {
      panel ??= openPngPanel(l10n, body);
      return panel.draw(svg, width, height, background);
    },
    dispose: (): void => {
      panel?.dispose();
    },
  };
}

/** Draws `svg` into a PNG of `width`×`height` pixels, in a panel that closes once it is back. */
async function drawPng(
  l10n: { t(message: string, ...args: string[]): string },
  svg: string,
  width: number,
  height: number,
  background: string
): Promise<Uint8Array> {
  const panel = openPngPanel(l10n, l10n.t('Creating a {0} × {1} pixel PNG…', String(width), String(height)));
  try {
    return await panel.draw(svg, width, height, background);
  } finally {
    panel.dispose();
  }
}

/**
 * What drawing a diagram of `document` as it is exported needs, with
 * `render` to draw it: the palette and PNG scale set for the document, and
 * the reasons given for a diagram that cannot be drawn.
 */
function drawingDeps(
  l10n: L10n,
  render: DrawingDeps['render'],
  palettes: ThemePalettes,
  settings: SettingsReader,
  document: vscode.Uri
): DrawingDeps {
  return {
    errorMessage: (message) => errorMessage(message, l10n),
    render,
    resolvePalette: (source, dark, included) => palettes.resolve(source, dark, included),
    remoteReferenceMessage: l10n.t(
      'Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'
    ),
    emojiUnavailableMessage: l10n.t(
      'Emoji syntax (<:name:>) is not supported because emoji images are not included with this extension.'
    ),
    severalDiagramsMessage: l10n.t(
      'Each PlantUML code block can contain only one diagram. Move each diagram into a separate code block.'
    ),
    pagesMessage: l10n.t(
      'Multi-page diagrams (newpage) are not supported. Split the pages into separate diagrams.'
    ),
    formulaMessage: (tag) => l10n.t('The bundled engine does not draw {0} formulas; the formula is left out of the diagram.', tag),
    embeddedDiagramMessage: l10n.t('The bundled engine does not draw a diagram embedded with {{ … }}; it is left out of the diagram.'),
    imageMessage: l10n.t('The bundled engine draws only images written inline as PNG (data:image/png;base64,…); any other image is drawn as placeholder text.'),
    engineErrorMessage: (message, line) => engineErrorMessage(l10n, message, line),
    pngTooLargeMessage: (width, height, fits) =>
      fits === null
        ? l10n.t(
            'The PNG would be {0} × {1} pixels even at the smallest scale, over the size limit for PNG images. Export as SVG instead.',
            String(width),
            String(height)
          )
        : l10n.t(
            'The PNG would be {0} × {1} pixels, over the size limit for PNG images. Set the PNG scale to {2} in Settings, or export as SVG.',
            String(width),
            String(height),
            String(fits)
          ),
    pngFailedMessage: l10n.t('The PNG was not created correctly. Try exporting as SVG.'),
    svgTooLargeMessage: (bytes) =>
      l10n.t(
        'The SVG text is {0} MiB, over the 32 MiB that can be copied. Export the diagram as an SVG file instead.',
        String(Math.ceil(bytes / (1024 * 1024)))
      ),
    pngScale: (): number => {
      const scale = settings.read({ resource: document }).values[CONFIG.EXPORT_PNG_SCALE];
      return PNG_SCALES.includes(scale as 1 | 2 | 4) ? Number(scale) : 2;
    },
    // Exports default to the light palette regardless of the editor theme:
    // the files face hosts like GitHub, whose background this extension
    // does not control, and a dark diagram on a white page reads as broken.
    // `preview` restores the old follow-the-editor behaviour.
    isDark: (): boolean => {
      const mode = settings.read({ resource: document }).values[CONFIG.EXPORT_THEME] as
        | 'light'
        | 'dark'
        | 'preview';
      if (mode === 'dark') {
        return true;
      }
      if (mode === 'preview') {
        return isDark(settings.read().values[CONFIG.THEME] as 'auto' | 'light' | 'dark');
      }
      return false;
    },
  };
}

/**
 * Resolves a path against the document's own folder and writes through
 * `vscode.workspace.fs`, so exporting works on remote and virtual file
 * systems rather than only on local disk.
 */
function exporterDeps(
  context: OperationContext,
  renderer: RendererClient,
  palettes: ThemePalettes,
  settings: SettingsReader,
  exportRecords: TypedStorage<ExportRecords>,
  workspace: WorkspaceService,
  document: vscode.Uri
): ExporterDeps {
  const draw = drawWith(renderer, settings, context.l10n);
  return {
    ...drawingDeps(context.l10n, (source, dark) => draw(source, dark, document.toString()), palettes, settings, document),
    invalidNameMessage: context.l10n.t(
      'Use 1–128 letters (A–Z, a–z), digits, hyphens, or underscores. Reserved file names such as CON are not allowed.'
    ),
    sameFileMessage: context.l10n.t('Multiple diagrams would be saved to the same file. Give each diagram a unique name or use separate export folders.'),
    changedMessage: context.l10n.t('The image file changed during export, so it was not overwritten. Check it, then export again.'),
    toPng: (svg, width, height, background) => drawPng(context.l10n, svg, width, height, background),
    resolve: (documentPath, relative) =>
      vscode.Uri.joinPath(vscode.Uri.parse(documentPath), '..', relative).toString(),
    readExisting: async (path): Promise<Uint8Array | null> => {
      const uri = vscode.Uri.parse(path);
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch (error: unknown) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
          return null;
        }
        throw error;
      }
      // Renaming a file over a folder deletes the folder and all it holds.
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        throw new Error(
          context.l10n.t('Cannot save to {0} because a folder with that name already exists.', workspace.relativePath(uri))
        );
      }
      return vscode.workspace.fs.readFile(uri);
    },
    // Open with unsaved edits, it is someone's work, whoever wrote it last.
    wroteLast: (path, source, existing): boolean =>
      !vscode.workspace.textDocuments.some((open) => open.isDirty && open.uri.toString() === path) &&
      isLastExport(exportRecords.get(), path, source, existing),
    noteWritten: async (path, source, content): Promise<void> => {
      const records = exportRecords.get();
      const next = withExport(records, path, source, content);
      if (next !== records) {
        await exportRecords.set(next).catch((error: unknown) => {
          context.logger.warn(context.l10n.t(
            'Could not save export history for {0}. You may be asked before overwriting this file next time. Details: {1}',
            path,
            error instanceof Error ? error.message : String(error)
          ));
        });
      }
    },
    confirmReplace: (paths, canKeep): Promise<'replace' | 'keep' | undefined> => {
      const files = paths.map((path) => workspace.relativePath(vscode.Uri.parse(path)));
      const replace = { title: context.l10n.t('Overwrite'), value: 'replace' as const };
      const keep = { title: context.l10n.t('Keep Existing Files'), value: 'keep' as const };
      const actions = canKeep ? [replace, keep] : [replace];
      // VS Code adds a Cancel button to a modal, which answers undefined.
      if (files.length === 1) {
        return context.notify.warn(
          context.l10n.t('{0} already exists and has different contents. Overwrite it?', files[0] ?? ''),
          { modal: true, actions }
        );
      }
      return context.notify.warn(
        context.l10n.t(
          '{0} files already exist and have different contents. Overwrite them?',
          String(files.length)
        ),
        { modal: true, detail: files.join('\n'), actions }
      );
    },
    // Written beside the target first and renamed over it, so a write that
    // fails part way leaves the old file in place, not half an image.
    writeFile: async (path, content, replace): Promise<void> => {
      const target = vscode.Uri.parse(path);
      const folder = vscode.Uri.joinPath(target, '..');
      const name = target.path.slice(target.path.lastIndexOf('/') + 1);
      const random = randomBytes(4).toString('hex');
      const temporary = vscode.Uri.joinPath(folder, `.${name}.${random}.tmp`);
      await vscode.workspace.fs.createDirectory(folder);
      try {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        await vscode.workspace.fs.writeFile(temporary, bytes);
        await vscode.workspace.fs.rename(temporary, target, { overwrite: replace });
      } catch (error: unknown) {
        await Promise.resolve(vscode.workspace.fs.delete(temporary)).catch(() => undefined);
        throw error;
      }
    },
  };
}

/**
 * The bulk export with progress, shared by both Export All commands. Null
 * when replacing existing files is declined.
 */
function runBulkExport(
  context: OperationContext,
  renderer: RendererClient,
  palettes: ThemePalettes,
  settings: SettingsReader,
  exportRecords: TypedStorage<ExportRecords>,
  workspace: WorkspaceService,
  document: ActiveDocument,
  directory: string
): Promise<ExportOutcome | null> {
  return context.progress.run({ title: context.l10n.t('Exporting diagrams…') }, (report) =>
    exportAll(
      exporterDeps(context, renderer, palettes, settings, exportRecords, workspace, document.textDocument.uri),
      document.path,
      directory,
      diagramsOf(document.textDocument, document.text),
      (done, total, name) => {
        report.report({
          message: `${name} (${String(done + 1)}/${String(total)})`,
          increment: total === 0 ? 0 : 100 / total,
        });
      }
    )
  );
}

/**
 * A button that asks for a name for the first diagram without one in the
 * document at `uri`, as its light bulb does, with the document open at the
 * line the name goes on. The diagram is looked for when the button is
 * pressed, in the text as it is then.
 */
function nameButton(context: OperationContext, uri: vscode.Uri): NoticeAction {
  return {
    title: context.l10n.t('Name Diagram…'),
    run: async (): Promise<void> => {
      const document = await vscode.workspace.openTextDocument(uri);
      const block = diagramsOf(document, document.getText()).find((candidate) => candidate.name === null);
      const start = new vscode.Position(block?.openLine ?? 0, 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(start, start) });
      if (block !== undefined) {
        await context.commands.execute(COMMANDS.ASSIGN_DIAGRAM_NAME, document.uri.toString(), block.openLine, document.version);
      }
    },
  };
}

/**
 * One summary notification for a bulk export, warnings when warranted.
 * `unnamedDiagrams` says how many of the unnamed are diagrams of PlantUML
 * files, which are named differently; `unnamedIn` is a document with one
 * of the unnamed.
 */
async function reportOutcome(
  context: OperationContext,
  outcome: ExportOutcome,
  extra: readonly string[],
  forceWarn: boolean,
  unnamedDiagrams = 0,
  unnamedIn?: vscode.Uri
): Promise<void> {
  const messages: string[] = [];
  if (outcome.written.length > 0) {
    messages.push(context.l10n.t('Diagrams exported: {0}', String(outcome.written.length)));
  }
  // Diagrams written without a formula, an embedded diagram or an image the
  // engine does not draw: counted here, named in the output.
  const leftOut = outcome.written.filter((result) => (result.notes?.length ?? 0) > 0);
  if (leftOut.length > 0) {
    messages.push(
      context.l10n.t(
        'Diagrams exported with notation the bundled engine does not draw: {0}. See the Output panel for which.',
        String(leftOut.length)
      )
    );
    for (const result of leftOut) {
      context.logger.warn(context.l10n.t('Exported {0}: {1}', result.name, (result.notes ?? []).join(' ')));
    }
  }
  messages.push(...extra);
  if (outcome.kept > 0) {
    messages.push(context.l10n.t('Existing files kept: {0}', String(outcome.kept)));
  }
  if (outcome.failed.length > 0) {
    messages.push(context.l10n.t('Diagrams that could not be exported: {0}. See the Output panel for the reasons.', String(outcome.failed.length)));
    for (const failure of outcome.failed) {
      context.logger.warn(context.l10n.t('Could not export {0}: {1}', failure.name, String(failure.error)));
    }
  }
  // Naming is what keeps a file tied to its block across edits; a
  // positional name would move the moment a block is inserted above.
  const unnamedBlocks = outcome.unnamed - unnamedDiagrams;
  if (unnamedBlocks > 0) {
    messages.push(
      context.l10n.t(
        'Unnamed code blocks were not exported: {0}. Add a name after ```plantuml, for example: "```plantuml my-diagram".',
        String(unnamedBlocks)
      )
    );
  }
  if (unnamedDiagrams > 0) {
    messages.push(
      context.l10n.t(
        'Unnamed diagrams were not exported: {0}. Add a name to the start line, for example: "@startuml(id=my-diagram)".',
        String(unnamedDiagrams)
      )
    );
  }
  if (messages.length === 0) {
    await context.notify.info(context.l10n.t('No diagrams to export.'));
    return;
  }

  const summary = messages.join(' · ');
  context.logger.info(summary);
  await announceExport(
    context,
    summary,
    forceWarn || outcome.failed.length > 0 || outcome.unnamed > 0 || leftOut.length > 0,
    outcome.written[0]?.path ?? undefined,
    outcome.failed.length > 0 || leftOut.length > 0,
    outcome.unnamed > 0 ? unnamedIn : undefined
  );
}

/**
 * Shows how an export went, with a button that selects `written`, a file
 * it wrote, in the Explorer view; with `failed`, one that shows the output
 * channel the failures were written to; and with `unnamed`, a document
 * when nothing was written, one that names a diagram skipped for want of a
 * name.
 */
async function announceExport(
  context: OperationContext,
  message: string,
  warn: boolean,
  written: string | undefined,
  failed = false,
  unnamed?: vscode.Uri
): Promise<void> {
  const actions: NoticeAction[] = [];
  if (written !== undefined) {
    actions.push(explorerButton(context, vscode.Uri.parse(written)));
  }
  if (failed) {
    actions.push(outputButton(context));
  }
  // A written file's button already shows the message in full; a third
  // button would crowd the notification.
  if (unnamed !== undefined && written === undefined) {
    actions.push(nameButton(context, unnamed));
  }
  await notifyWith(context, warn ? 'warn' : 'info', message, actions);
}

/**
 * Shows the PlantUML Local output channel. The kit owns the channel, so it
 * is shown through the command VS Code gives each channel, named after the
 * channel's id: the extension's id and the name of the channel's log file.
 * That id is an internal detail of VS Code, so the list of channels stands in
 * if it ever changes.
 */
async function showOutput(context: OperationContext): Promise<void> {
  try {
    await context.commands.execute(`workbench.action.output.show.${PACKAGE_ID}.${EXTENSION_NAME}.log`);
  } catch {
    await context.commands.execute('workbench.action.showOutputChannels');
  }
}

/** The most named diagrams exported from one folder. */
const MAX_FOLDER_DIAGRAMS = 2000;

/** A document of a folder export, and its diagrams. */
interface FolderSource {
  uri: vscode.Uri;
  blocks: PlantUmlBlock[];
  /** A PlantUML file rather than a Markdown document. */
  plantUml: boolean;
}

/** How many diagrams of the PlantUML files among `sources` have no name. */
function unnamedDiagrams(sources: readonly FolderSource[]): number {
  return sources
    .filter((source) => source.plantUml)
    .reduce((sum, source) => sum + source.blocks.filter((block) => block.name === null).length, 0);
}

/**
 * The folder to export: the one the Explorer passes, or one picked. Null
 * after saying why there is none.
 */
async function folderToExport(
  context: OperationContext,
  workspace: WorkspaceService,
  target: unknown
): Promise<vscode.Uri | null> {
  // Anyone can run the command with anything, so only a URI is taken; one
  // that is not in the workspace is refused below.
  const passed =
    typeof target === 'object' && target !== null && typeof (target as { scheme?: unknown }).scheme === 'string'
      ? vscode.Uri.parse((target as vscode.Uri).toString())
      : undefined;
  const folder =
    passed ??
    (
      await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: workspace.folders()[0]?.uri as vscode.Uri | undefined,
        openLabel: context.l10n.t('Export Diagrams'),
      })
    )?.[0];
  if (folder === undefined) {
    return null;
  }
  if (workspace.folderOf(folder) === undefined) {
    void context.notify.warn(context.l10n.t('Select a folder within the current workspace.'));
    return null;
  }
  return folder;
}

/**
 * The documents under `folder` that hold diagrams, with their unsaved
 * edits; null when there are too many, undefined once cancelled.
 */
async function folderSources(folder: vscode.Uri, signal: AbortSignal): Promise<FolderSource[] | null | undefined> {
  const documents = await findDocuments(
    {
      readDirectory: async (path) => vscode.workspace.fs.readDirectory(vscode.Uri.parse(path)),
      join: (path, name) => vscode.Uri.joinPath(vscode.Uri.parse(path), name).toString(),
    },
    folder.toString(),
    () => signal.aborted
  );
  if (documents === null) {
    return null;
  }
  const sources: FolderSource[] = [];
  for (const document of documents) {
    if (signal.aborted) {
      return undefined;
    }
    const uri = vscode.Uri.parse(document.path);
    const open = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
    const text = open?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const name = withoutExtension(uri.path.slice(uri.path.lastIndexOf('/') + 1));
    const blocks = !document.plantUml ? findPlantUmlBlocks(text) : hasStartLine(text) ? findFileDiagrams(text, name) : [];
    if (blocks.length > 0) {
      sources.push({ uri, blocks, plantUml: document.plantUml });
    }
  }
  return signal.aborted ? undefined : sources;
}

/**
 * Applies planned reference edits as one WorkspaceEdit, so a single Undo
 * reverts every line the command touched.
 */
function applyReferenceEdits(
  document: vscode.TextDocument,
  edits: readonly ReferenceEdit[]
): Thenable<boolean> {
  // Inserted text is planned with bare newlines; match the document so a
  // CRLF file does not end up with mixed endings.
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    const lineEnd = document.lineAt(edit.line).text.length;
    if (edit.kind === 'insert-after') {
      workspaceEdit.insert(
        document.uri,
        new vscode.Position(edit.line, lineEnd),
        edit.text.replace(/\n/g, eol)
      );
    } else {
      workspaceEdit.replace(
        document.uri,
        new vscode.Range(edit.line, 0, edit.line, lineEnd),
        edit.text
      );
    }
  }
  return vscode.workspace.applyEdit(workspaceEdit);
}

export const plantuml = defineModule('plantuml', (module): undefined => {
  module.settings.add(Settings);
  module.storage.add(ExportedFiles);

  module.services.singleton(Renderer, {
    inject: { logger: Log, settings: Settings.token, l10n: Localization },
    create: ({ logger, settings, l10n }) =>
      new RendererClient(
        defaultWorkerPath(),
        // plantumlLocal.logLevel can only make the channel quieter: VS Code
        // owns the channel's level, and an extension cannot raise it. Read on
        // every entry, so a change applies without a reload.
        filterLogger(logger, () => settings.read().values[CONFIG.LOG_LEVEL]),
        undefined,
        undefined,
        l10n
      ),
  });

  module.services.singleton(Palettes, {
    inject: { renderer: Renderer },
    create: ({ renderer }) => new ThemePalettes((source, dark) => renderer.render(source, dark)),
  });

  module.services.singleton(IncludeWatch, () => new IncludeWatcher());

  module.services.singleton(Drawings, () => new DrawingRecords());

  // Read from the package, each library when it is first asked for.
  module.services.singleton(Declarations, () => new LibraryDeclarations(join(__dirname, 'declarations')));

  module.services.singleton(Renders, {
    inject: { renderer: Renderer, settings: Settings.token, l10n: Localization, watch: IncludeWatch, drawings: Drawings },
    create: ({ renderer, settings, l10n, watch, drawings }) => {
      const shared = shareRenders(drawWith(renderer, settings, l10n, watch));
      // Cleared when what a drawing reads may have changed: the search
      // folders, the workspace folders or trust; or by the user.
      return Object.assign(drawings.around(shared), {
        clear(): void {
          shared.clear();
          drawings.outdateAll();
        },
      });
    },
  });

  module.services.singleton(RequestRefresh, {
    inject: { commands: Commands },
    create: ({ commands }) =>
      debounce(() => {
        // The Markdown previews are VS Code's Markdown extension's. Not
        // started, it shows none to refresh, and running its command would
        // start it; in another extension host it is not known here, and is
        // asked.
        if (vscode.extensions.getExtension(MARKDOWN_EXTENSION)?.isActive === false) {
          return;
        }
        void commands.execute('markdown.preview.refresh');
      }, REFRESH_DEBOUNCE_MS),
  });

  module.services.singleton(Plugin, {
    inject: {
      renders: Renders,
      palettes: Palettes,
      requestRefresh: RequestRefresh,
      logger: Log,
      l10n: Localization,
      settings: Settings.token,
    },
    create: ({ renders, palettes, requestRefresh, logger, l10n, settings }) =>
      createPlantUmlPlugin({
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        render: renders,
        resolvePalette: (source, dark, included) => palettes.resolve(source, dark, included),
        requestRefresh,
        escapeHtml,
        hideExportedImages: () => settings.read().values[CONFIG.HIDE_EXPORTED_IMAGES],
        updateMode: (document) => updateModeOf(settings, vscode.Uri.parse(document)),
        log: filterLogger(logger, () => settings.read().values[CONFIG.LOG_LEVEL]),
        labels: {
          errorMessage: (message) => errorMessage(message, l10n),
          rendered: (bytes) => l10n.t('Diagram rendered (SVG size: {0} bytes).', String(bytes)),
          renderFailed: (message) => l10n.t('Could not render the diagram: {0}', message),
          loading: l10n.t('Rendering diagram…'),
          failedTitle: l10n.t('Could not render the diagram'),
          emptySource: l10n.t('There is no PlantUML code to render.'),
          remoteReference: l10n.t(
            'Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'
          ),
          emojiUnavailable: l10n.t(
            'Emoji syntax (<:name:>) is not supported because emoji images are not included with this extension.'
          ),
          severalDiagrams: l10n.t(
            'Each PlantUML code block can contain only one diagram. Move each diagram into a separate code block.'
          ),
          pages: l10n.t(
            'Multi-page diagrams (newpage) are not supported. Split the pages into separate diagrams, each in its own code block.'
          ),
          missingEnd: (end) =>
            l10n.t('The closing {0} line is missing. It has been added for rendering; the source is unchanged.', end),
          beforeStart: (start) => l10n.t('Lines before {0} are ignored when rendering this diagram.', start),
          formula: (tag) => l10n.t('The bundled engine does not draw {0} formulas; the formula is left out of the diagram.', tag),
          embeddedDiagram: l10n.t('The bundled engine does not draw a diagram embedded with {{ … }}; it is left out of the diagram.'),
          image: l10n.t('The bundled engine draws only images written inline as PNG (data:image/png;base64,…); any other image is drawn as placeholder text.'),
          notUpdated: (mode) => notUpdatedNote(l10n, mode),
          includeFailed: (path, reason) => l10n.t('Could not include {0}: {1}', path, reason),
        },
      }),
  });

  module.services.singleton(Viewers, {
    inject: {
      renders: Renders,
      palettes: Palettes,
      l10n: Localization,
      settings: Settings.token,
      commands: Commands,
    },
    create: ({ renders, palettes, l10n, settings, commands }): ViewerSet => {
      const deps: ViewerDeps = {
        render: renders,
        resolvePalette: (source, dark, included) => palettes.resolve(source, dark, included),
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        exportPng: async (uri, line): Promise<void> => {
          await commands.invoke(ExportPng, { uri, line });
        },
        copySvgText: async (uri, line): Promise<void> => {
          await commands.invoke(CopySvgText, { uri, line });
        },
        // As the PNG button exports it, but with the previews' renders: the
        // diagram shown is often drawn in that palette already.
        copyPng: async (uri, diagram) => {
          const drawing = drawingDeps(l10n, (source, dark) => renders(source, dark, uri), palettes, settings, vscode.Uri.parse(uri));
          const source = await preparePng(drawing, diagram);
          return 'svg' in source ? source : { error: source.error ?? drawing.pngFailedMessage };
        },
        labels: {
          errorMessage: (message) => errorMessage(message, l10n),
          diagram: (position) => l10n.t('Diagram {0}', String(position)),
          unnamed: (position, file) => l10n.t('Diagram {0} of {1}', String(position), file),
          entry: (name, line) => l10n.t('{0} (line {1})', name, String(line)),
          rendering: l10n.t('Rendering diagram…'),
          rendered: (name) => l10n.t('Rendered {0}.', name),
          gone: l10n.t('The selected diagram is no longer in this file. Select another diagram from the list.'),
          choose: l10n.t('Select a diagram from the list.'),
          empty: l10n.t('No diagrams found in this file.'),
          remoteReference: l10n.t(
            'Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'
          ),
          emojiUnavailable: l10n.t(
            'Emoji syntax (<:name:>) is not supported because emoji images are not included with this extension.'
          ),
          pages: l10n.t(
            'Multi-page diagrams (newpage) are not supported. Split the pages into separate diagrams, each with its own start and end lines.'
          ),
          formula: (tag) => l10n.t('The bundled engine does not draw {0} formulas; the formula is left out of the diagram.', tag),
          embeddedDiagram: l10n.t('The bundled engine does not draw a diagram embedded with {{ … }}; it is left out of the diagram.'),
          image: l10n.t('The bundled engine draws only images written inline as PNG (data:image/png;base64,…); any other image is drawn as placeholder text.'),
          engineError: (message, line) =>
            line === null
              ? l10n.t('PlantUML error: {0}', errorMessage(message, l10n))
              : l10n.t('PlantUML error on line {0}: {1}', String(line), errorMessage(message, l10n)),
          otherPalette: (dark) =>
            dark
              ? l10n.t('Using a dark background to keep this diagram readable.')
              : l10n.t('Using a light background to keep this diagram readable.'),
        },
      };
      const open = new Map<string, { viewer: DiagramViewer; document: vscode.TextDocument; reveal(): void }>();
      // Which files have a viewer changes what the diagnostics check.
      const shown = new vscode.EventEmitter<vscode.Uri>();
      const media = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'viewer');
      const toolbar: ToolbarLabels = {
        selectDiagram: l10n.t('Select a diagram'),
        toolbar: l10n.t('Diagram zoom'),
        zoomOut: l10n.t('Zoom Out'),
        zoomIn: l10n.t('Zoom In'),
        fit: l10n.t('Fit to Window'),
        actualSize: l10n.t('Actual Size'),
        zoomToArea: l10n.t('Zoom to Area'),
        // The page puts the percentage in place of {0}.
        zoomLevel: l10n.t('Zoom {0}', '{0}'),
        exportPng: l10n.t('Export Diagram as PNG'),
        copySvgText: l10n.t('Copy Diagram as SVG Text'),
        copySvgButton: l10n.t('Copy SVG'),
        copy: {
          text: l10n.t('Copy'),
          label: l10n.t('Copy Diagram as PNG'),
          copying: l10n.t('Copying the diagram…'),
          copied: l10n.t('Copied the diagram to the clipboard.'),
          // The page puts the reason in place of {0}.
          failed: l10n.t('Could not copy the diagram: {0}', '{0}'),
          unmade: l10n.t('The PNG was not created correctly. Try exporting as SVG.'),
          unwritten: l10n.t('The clipboard did not take the image. Try again, or save it with the PNG button.'),
        },
      };

      /** Takes over `panel` for `document`: its options, its page and its messages. */
      const attach = (panel: vscode.WebviewPanel, document: vscode.TextDocument): DiagramViewer => {
        const key = document.uri.toString();
        const name = fileNameOf(document);
        // Set on a restored panel too: it comes back with the options of the
        // session that saved it, naming the folder that version was installed in.
        panel.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: [media] };
        const nonce = generateNonce();
        panel.webview.html = createWebviewHtml({
          title: name,
          // Blob URLs are how the page shows the SVG, as an image.
          csp: generateCSP(panel.webview, { nonce, imgSrc: ['blob:'] }),
          styles: [panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString()],
          // zoom.js first: the page takes its zoom from it.
          scripts: ['zoom.js', 'viewer.js'].map((file) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString()),
          nonce,
          body: viewerBody(toolbar, escapeHtml),
        });
        const viewer = new DiagramViewer(
          { post: (message): Promise<boolean> => Promise.resolve(panel.webview.postMessage(message)) },
          deps,
          withoutExtension(name),
          key
        );
        const entry = {
          viewer,
          document,
          reveal: (): void => {
            panel.reveal();
          },
        };
        open.set(key, entry);
        shown.fire(document.uri);
        panel.webview.onDidReceiveMessage((message: unknown) => {
          void viewer.receive(message, entry.document.getText());
        });
        panel.onDidDispose(() => {
          open.delete(key);
          shown.fire(document.uri);
        });
        return viewer;
      };

      return {
        open: (document, line, column): void => {
          const existing = open.get(document.uri.toString());
          if (existing !== undefined) {
            existing.document = document;
            existing.reveal();
            void existing.viewer.show(document.getText(), line);
            return;
          }
          const panel = vscode.window.createWebviewPanel(
            VIEWER_TYPE,
            l10n.t('Preview: {0}', fileNameOf(document)),
            column
          );
          // Drawn once the page asks, as it does each time it is created.
          attach(panel, document).select(document.getText(), line);
        },
        restore: async (panel, state): Promise<void> => {
          // What the page kept, which is no more trusted than the page.
          const kept = (typeof state === 'object' && state !== null ? state : {}) as {
            uri?: unknown;
            name?: unknown;
          };
          const name = typeof kept.name === 'string' ? kept.name : null;
          let document: vscode.TextDocument | undefined;
          if (typeof kept.uri === 'string') {
            try {
              document = await vscode.workspace.openTextDocument(vscode.Uri.parse(kept.uri));
            } catch {
              document = undefined;
            }
          }
          // A file that is gone, or already has its panel, gets none back.
          if (document === undefined || open.has(document.uri.toString())) {
            panel.dispose();
            return;
          }
          attach(panel, document).restore(name);
        },
        update: (document): void => {
          const entry = open.get(document.uri.toString());
          if (entry !== undefined) {
            entry.document = document;
            void entry.viewer.update(document.getText());
          }
        },
        stale: (document, note): void => {
          const entry = open.get(document.uri.toString());
          if (entry !== undefined) {
            entry.document = document;
            void entry.viewer.stale(note);
          }
        },
        updateAll: (): void => {
          for (const entry of open.values()) {
            void entry.viewer.update(entry.document.getText());
          }
        },
        filesChanged: (changes): void => {
          for (const entry of open.values()) {
            const change = entry.viewer.dependsOn(changes);
            if (change === 'none') {
              continue;
            }
            const mode = updateModeOf(settings, entry.document.uri);
            if (mode === 'onChange' || (mode === 'onSave' && change === 'saved')) {
              void entry.viewer.update(entry.document.getText());
            } else {
              void entry.viewer.stale(notUpdatedNote(l10n, mode));
            }
          }
        },
        act: (context, action): void => {
          // What the page set, which is no more trusted than the page.
          const uri = typeof context === 'object' && context !== null ? (context as Record<string, unknown>)[VIEWER_URI_CONTEXT] : undefined;
          const entry = typeof uri === 'string' ? open.get(uri) : undefined;
          if (entry !== undefined) {
            void entry.viewer.act(action);
          }
        },
        shows: (uri): boolean => open.has(uri.toString()),
        onDidChangeShown: shown.event,
        dispose: (): void => {
          shown.dispose();
        },
      };
    },
  });
  module.commands.handle(ClearCache, {
    inject: { plugin: Plugin, renders: Renders, viewers: Viewers },
    execute: async (context: OperationContext, _args, { plugin, renders, viewers }): Promise<void> => {
      // The shared renders first, or the preview would get them back.
      renders.clear();
      plugin.clearCache();
      viewers.updateAll();
      context.logger.info(context.l10n.t('PlantUML render cache cleared.'));
      await context.notify.info(context.l10n.t('PlantUML render cache cleared.'));
    },
  });

  module.raw.register({
    id: 'plantuml.includeAccess',
    inject: { plugin: Plugin, renders: Renders, viewers: Viewers, watch: IncludeWatch },
    bind: ({ registrations }, { plugin, renders, viewers, watch }): undefined => {
      // A diagram with a local include reads other files, or some at last,
      // once the search folders or the workspace folders change, or the
      // workspace is trusted.
      const redraw = (): void => {
        renders.clear();
        plugin.clearCache();
        viewers.updateAll();
      };
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.INCLUDE_PATHS}`)) {
            redraw();
          }
        })
      );
      registrations.own(vscode.workspace.onDidGrantWorkspaceTrust(redraw));
      registrations.own(vscode.workspace.onDidChangeWorkspaceFolders(redraw));
      // And it is drawn again when a file it includes changes.
      registrations.own(
        watch.onDidChange((changes) => {
          plugin.filesChanged(changes);
          viewers.filesChanged(changes);
        })
      );
      return undefined;
    },
  });

  /** Opens the viewer for the PlantUML file in the editor, in `column`. */
  const openPreview =
    (column: number) =>
    async (context: OperationContext, _args: readonly [], { viewers }: { viewers: ViewerSet }): Promise<void> => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId !== 'plantuml') {
        await context.notify.warn(context.l10n.t('Open a PlantUML file to preview its diagrams.'));
        return;
      }
      viewers.open(editor.document, editor.selection.active.line, column);
    };
  module.commands.handle(OpenPreview, {
    inject: { viewers: Viewers },
    execute: openPreview(vscode.ViewColumn.Active),
  });
  module.commands.handle(OpenPreviewToSide, {
    inject: { viewers: Viewers },
    execute: openPreview(vscode.ViewColumn.Beside),
  });

  const viewActions = [
    [ZoomToArea, 'zoomToArea'],
    [ScrollToTop, 'top'],
    [ScrollToBottom, 'bottom'],
    [ScrollToLeftEdge, 'left'],
    [ScrollToRightEdge, 'right'],
    [ScrollToCentre, 'centre'],
  ] as const;
  for (const [contract, action] of viewActions) {
    module.commands.handle(contract, {
      inject: { viewers: Viewers },
      execute: (_context: OperationContext, args, { viewers }): void => {
        viewers.act(args[0], action);
      },
    });
  }

  module.raw.register({
    id: 'plantuml.viewerUpdates',
    inject: { viewers: Viewers, settings: Settings.token, l10n: Localization },
    bind: ({ registrations }, { viewers, settings, l10n }): undefined => {
      // Draws a viewer again once its file has stopped changing, or with
      // onSave once it is saved, and every viewer when the palette may have
      // changed with the theme or setting. With onSave or manual, a change
      // only marks the diagram shown as not updated.
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      registrations.own(
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document.languageId !== 'plantuml' || event.contentChanges.length === 0) {
            return;
          }
          const mode = updateModeOf(settings, event.document.uri);
          if (mode !== 'onChange') {
            viewers.stale(event.document, notUpdatedNote(l10n, mode));
            return;
          }
          const key = event.document.uri.toString();
          clearTimeout(timers.get(key));
          timers.set(
            key,
            setTimeout(() => {
              timers.delete(key);
              viewers.update(event.document);
            }, VIEWER_DEBOUNCE_MS)
          );
        })
      );
      registrations.own(
        vscode.workspace.onDidSaveTextDocument((document) => {
          if (document.languageId === 'plantuml' && updateModeOf(settings, document.uri) === 'onSave') {
            viewers.update(document);
          }
        })
      );
      registrations.own(
        vscode.window.onDidChangeActiveColorTheme(() => {
          viewers.updateAll();
        })
      );
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (
            event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.THEME}`) ||
            event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.PREVIEW_UPDATE_MODE}`)
          ) {
            viewers.updateAll();
          }
        })
      );
      // Registered during activation, as VS Code requires, so the panels open
      // when the window closed come back with it.
      registrations.own(
        vscode.window.registerWebviewPanelSerializer(VIEWER_TYPE, {
          deserializeWebviewPanel: (panel, state: unknown) => viewers.restore(panel, state),
        })
      );
      registrations.defer(() => {
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
      });
      return undefined;
    },
  });

  /** Exports the diagram under the cursor, or the only one, as `format`. */
  const exportAtCursor =
    (format: ExportFormat) =>
    async (
      context: OperationContext,
      args: readonly unknown[],
      {
        renderer,
        palettes,
        settings,
        exportRecords,
        workspace,
      }: {
        renderer: RendererClient;
        palettes: ThemePalettes;
        settings: SettingsReader;
        exportRecords: TypedStorage<ExportRecords>;
        workspace: WorkspaceService;
      }
    ): Promise<void> => {
      // The `.puml` preview names its file and the line of the diagram it shows.
      const document = await activeDocument(context, workspace, true, exportTarget(args[0]));
      if (document === null) {
        return;
      }

      const block = await diagramAtCursor(context, document);
      if (block === null) {
        return;
      }

      // A name that cannot be a file name is treated as no name at all:
      // the block says `../evil` or `my diagram`, and the prompt — which
      // validates — is where a usable one comes from. The exporter
      // refuses it regardless; this is what makes the refusal actionable.
      const declared = block.name !== null && isValidBlockName(block.name) ? block.name : null;
      const name = declared ?? (await askForName(context, format));
      if (name === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const deps = exporterDeps(context, renderer, palettes, settings, exportRecords, workspace, document.textDocument.uri);
      // How the export went; a failure comes with the way on that suits it.
      const report = async (result: ExportResult | null, as: ExportFormat): Promise<void> => {
        if (result === null) {
          return;
        }
        if (result.error === null) {
          // What the drawing was written without, if anything, is said with it.
          const notes = result.notes ?? [];
          context.logger.info([context.l10n.t('Exported to {0}', String(result.path)), ...notes].join(' '));
          // The file as the Explorer names it, rather than its encoded URI.
          const written = workspace.relativePath(vscode.Uri.parse(String(result.path)));
          await announceExport(
            context,
            [context.l10n.t('Exported to {0}', written), ...notes].join(' '),
            notes.length > 0,
            result.path ?? undefined
          );
          return;
        }
        const message = context.l10n.t('Could not export the diagram: {0}', result.error);
        context.logger.warn(message);
        const actions: NoticeAction[] = [];
        if (result.cause === 'source') {
          actions.push(problemsOrOutput(context, settings, document));
        } else if (result.cause === 'png') {
          if (result.fitsAt !== undefined) {
            actions.push(settingsButton(context, CONFIG.EXPORT_PNG_SCALE));
          }
          actions.push({
            title: context.l10n.t('Export as SVG'),
            run: async () => report(await exportOne(deps, document.path, directory, block, name), 'svg'),
          });
        } else if (result.cause === 'file') {
          actions.push(explorerButton(context, vscode.Uri.parse(deps.resolve(document.path, `${directory}/${name}.${as}`)), true));
        } else {
          actions.push(outputButton(context));
        }
        await notifyWith(context, 'error', message, actions);
      };
      await report(
        format === 'svg'
          ? await exportOne(deps, document.path, directory, block, name)
          : await context.progress.run({ title: context.l10n.t('Exporting PNG…') }, () =>
              exportOne(deps, document.path, directory, block, name, 'png')
            ),
        format
      );
    };

  module.commands.handle(ExportSvg, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: exportAtCursor('svg'),
  });

  module.commands.handle(ExportPng, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: exportAtCursor('png'),
  });

  /**
   * The way on for a diagram with a problem: the Problems panel, where the
   * diagnostics list it for a Markdown or PlantUML file unless they are
   * turned off — they check no other file — else the Output panel, which
   * has it for any file.
   */
  const problemsOrOutput = (context: OperationContext, settings: SettingsReader, document: ActiveDocument): NoticeAction => {
    const listed =
      isDiagramFile(document.textDocument) &&
      settings.read({ resource: document.textDocument.uri }).values[CONFIG.DIAGNOSTICS_ENABLED] !== false;
    return listed ? problemsButton(context) : outputButton(context);
  };

  module.commands.handle(CopySvgText, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: async (
      context: OperationContext,
      args,
      { renderer, palettes, settings, exportRecords, workspace }
    ): Promise<void> => {
      // No file is written, so neither an untitled document nor a restricted
      // workspace is refused: the diagram is drawn as far as it can be there,
      // as the previews draw it.
      const document = await pickDocument(context, workspace, true, exportTarget(args[0]));
      if (document === null) {
        return;
      }
      const block = await diagramAtCursor(context, document);
      if (block === null) {
        return;
      }
      const deps = exporterDeps(context, renderer, palettes, settings, exportRecords, workspace, document.textDocument.uri);
      const prepared = await prepareSvg(deps, block);
      // The file the clipboard cannot take: the same diagram, the same drawing.
      const exportInstead: NoticeAction = {
        title: context.l10n.t('Export as SVG'),
        run: (): Promise<unknown> => context.commands.execute(COMMANDS.EXPORT_SVG, { uri: document.path, line: block.openLine }),
      };
      if (!('svg' in prepared)) {
        const message = context.l10n.t('Could not copy the diagram: {0}', prepared.error ?? '');
        context.logger.warn(message);
        await notifyWith(context, 'error', message, [prepared.cause === 'source' ? problemsOrOutput(context, settings, document) : exportInstead]);
        return;
      }
      try {
        await vscode.env.clipboard.writeText(prepared.svg);
      } catch (error: unknown) {
        const message = context.l10n.t(
          'Could not copy the diagram: {0}',
          context.l10n.t('The clipboard did not take the text. Try again, or export the diagram as SVG.')
        );
        const detail = `${message} ${error instanceof Error ? error.message : String(error)}`;
        context.logger.warn(detail);
        await notifyWith(context, 'error', message, [exportInstead]);
        return;
      }
      // What the diagram was drawn without, if anything, is said with it.
      const message = [context.l10n.t('Copied the diagram as SVG text.'), ...prepared.notes].join(' ');
      context.logger.info(message);
      await (prepared.notes.length > 0 ? context.notify.warn(message) : context.notify.info(message));
    },
  });

  /**
   * A lens's action on its diagram. The target names a document open here
   * and a diagram in it as the document was when the lens was made; the
   * diagram is found again before anything is done (src/language/code-lens.ts),
   * so a lens left from before an edit does not act on another diagram, and
   * an argument made up elsewhere opens no file. An export goes the way of
   * the export commands, with their checks.
   */
  module.commands.handle(RunDiagramAction, {
    inject: {
      viewers: Viewers,
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: async (context: OperationContext, args, { viewers, ...deps }): Promise<void> => {
      const target = diagramTarget(args[0]);
      if (target === null) {
        return;
      }
      const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === target.uri);
      const block =
        document !== undefined && isDiagramFile(document)
          ? targetBlock(diagramsOf(document, document.getText()), target, document.version)
          : null;
      if (document === undefined || block === null) {
        void context.notify.warn(context.l10n.t('The file has changed. Check the diagram again.'));
        return;
      }
      if (target.action !== 'preview') {
        await exportAtCursor(target.action)(context, [{ uri: document.uri.toString(), line: block.openLine }], deps);
      } else if (document.languageId === 'plantuml') {
        // The file's viewer, on this diagram; the cursor stays where it is.
        viewers.open(document, block.openLine, vscode.ViewColumn.Beside);
      } else {
        // VS Code's Markdown preview takes no block to show: the block's
        // source is selected, and the preview opened beside it follows the
        // editor as far as its scrolling does.
        await vscode.window.showTextDocument(document, { selection: new vscode.Range(block.openLine, 0, block.openLine, 0) });
        await context.commands.execute('markdown.showPreviewToSide', document.uri);
      }
    },
  });

  module.raw.register({
    id: 'plantuml.colors',
    bind: ({ registrations }): undefined => {
      // A swatch beside each colour a diagram sets where the picker can edit
      // it (src/core/colors.ts), and VS Code's colour picker on it. The
      // swatch shows the colour as written, not as the palette draws it.
      // `editor.colorDecorators` turns the swatches off; a pick writes
      // `#RRGGBB`, and a pick with an alpha, which the source cannot carry
      // without losing it, is offered nothing.
      registrations.own(
        vscode.languages.registerColorProvider([{ language: 'markdown' }, { language: 'plantuml' }], {
          provideDocumentColors: (document) => {
            const text = document.getText();
            const lines = splitLines(text);
            return diagramsOf(document, text).flatMap((block) =>
              findColors(block.source).map((use) => {
                const line = documentLineOf(block.sourceLine, use.line);
                const documentLine = lines[line] ?? '';
                const { red, green, blue } = rgbOf(use.hex);
                return new vscode.ColorInformation(
                  new vscode.Range(
                    line,
                    documentColumnOf(documentLine, block.container, use.start),
                    line,
                    documentColumnOf(documentLine, block.container, use.end)
                  ),
                  new vscode.Color(red, green, blue, 1)
                );
              })
            );
          },
          provideColorPresentations: (color) => (color.alpha === 1 ? [new vscode.ColorPresentation(hexOf(color))] : []),
        })
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.codeLens',
    inject: { settings: Settings.token, l10n: Localization },
    bind: ({ registrations }, { settings, l10n }): undefined => {
      // Preview, Export SVG and Export PNG above the first line of each
      // diagram (src/language/code-lens.ts). VS Code asks no provider while
      // `editor.codeLens` is off; `plantumlLocal.codeLens.enabled` is the
      // extension's own switch, read for the document.
      const titles: Record<DiagramAction, string> = {
        preview: l10n.t('Preview'),
        svg: l10n.t('Export SVG'),
        png: l10n.t('Export PNG'),
      };
      const changed = registrations.own(new vscode.EventEmitter<void>());
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.CODE_LENS_ENABLED}`)) {
            changed.fire();
          }
        })
      );
      registrations.own(
        vscode.languages.registerCodeLensProvider([{ language: 'markdown' }, { language: 'plantuml' }], {
          onDidChangeCodeLenses: changed.event,
          provideCodeLenses: (document) => {
            if (!isDiagramFile(document) || settings.read({ resource: document.uri }).values[CONFIG.CODE_LENS_ENABLED] === false) {
              return [];
            }
            const plantUml = document.languageId === 'plantuml';
            return diagramLenses(diagramsOf(document, document.getText()), plantUml).flatMap(({ block, actions }) =>
              actions.map((action) => {
                const target: DiagramTarget = {
                  action,
                  uri: document.uri.toString(),
                  version: document.version,
                  line: block.openLine,
                  name: block.name,
                };
                return new vscode.CodeLens(new vscode.Range(block.openLine, 0, block.openLine, 0), {
                  title: titles[action],
                  command: COMMANDS.DIAGRAM_ACTION,
                  arguments: [target],
                });
              })
            );
          },
        })
      );
      return undefined;
    },
  });

  module.commands.handle(ExportAllSvg, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings, exportRecords, workspace }
    ): Promise<void> => {
      const document = await activeDocument(context, workspace, true);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, exportRecords, workspace, document, directory);
      if (outcome === null) {
        return;
      }
      await reportOutcome(
        context,
        outcome,
        [],
        false,
        document.textDocument.languageId === 'plantuml' ? outcome.unnamed : 0,
        document.textDocument.uri
      );
    },
  });

  module.commands.handle(ExportAllAndUpdateRefs, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings, exportRecords, workspace }
    ): Promise<void> => {
      const document = await activeDocument(context, workspace, false);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, exportRecords, workspace, document, directory);
      if (outcome === null) {
        return;
      }

      // The exports take time. If the document changed meanwhile, the files
      // no longer match its blocks and every line a reference would be
      // anchored to may have moved, so the references are left alone.
      if (document.textDocument.version !== document.version) {
        await reportOutcome(
          context,
          outcome,
          [context.l10n.t('Image links were not updated because the Markdown file changed during export. Export again to update them.')],
          true,
          0,
          document.textDocument.uri
        );
        return;
      }

      // Only successfully exported names get a reference — a failed block
      // must not gain a link to a file that is stale or absent. A change
      // between this plan and the edit makes VS Code refuse the edit.
      const exported = new Set(outcome.written.map((result) => result.name));
      const edits = planReferenceEdits(document.text, exported, directory);

      const extra: string[] = [];
      let applyFailed = false;
      let reported = outcome;
      if (edits.length === 0) {
        if (outcome.written.length > 0) {
          extra.push(context.l10n.t('Image links are up to date'));
        }
      } else if (await applyReferenceEdits(document.textDocument, edits)) {
        const inserted = edits.filter((edit) => edit.kind === 'insert-after').length;
        const updated = edits.length - inserted;
        if (inserted > 0) {
          extra.push(context.l10n.t('Image links added: {0}', String(inserted)));
        }
        if (updated > 0) {
          extra.push(context.l10n.t('Image links updated: {0}', String(updated)));
        }
        reported = relocateEngineErrors(context, outcome, edits);
      } else {
        applyFailed = true;
        extra.push(context.l10n.t('Could not update the image links'));
      }

      await reportOutcome(context, reported, extra, applyFailed, 0, document.textDocument.uri);
    },
  });

  /** Exports the named diagrams of the documents under a folder, as `format`. */
  const exportFolder =
    (format: ExportFormat) =>
    async (
      context: OperationContext,
      args: readonly unknown[],
      {
        renderer,
        palettes,
        settings,
        exportRecords,
        workspace,
      }: {
        renderer: RendererClient;
        palettes: ThemePalettes;
        settings: SettingsReader;
        exportRecords: TypedStorage<ExportRecords>;
        workspace: WorkspaceService;
      }
    ): Promise<void> => {
      // It reads files and writes them, so like the other exports it does
      // not run in an untrusted workspace.
      if (!vscode.workspace.isTrusted) {
        void refuseUntrusted(context);
        return;
      }
      const folder = await folderToExport(context, workspace, args[0]);
      if (folder === null) {
        return;
      }
      const where = workspace.relativePath(folder);

      const sources = await context.progress.run(
        { title: context.l10n.t('Looking for diagrams…'), cancellable: true },
        (_report, signal) => folderSources(folder, signal)
      );
      if (sources === undefined) {
        return;
      }
      // Part of a folder is never exported as if it were the whole. Without a
      // folder, the command asks for one.
      const chooseFolder: NoticeAction = {
        title: context.l10n.t('Choose Folder…'),
        run: () => context.commands.execute(format === 'png' ? COMMANDS.EXPORT_FOLDER_PNG : COMMANDS.EXPORT_FOLDER_SVG),
      };
      if (sources === null) {
        void notifyWith(
          context,
          'warn',
          context.l10n.t(
            '{0} has more than {1} Markdown and PlantUML files, too many to export at once. Choose a smaller folder.',
            where,
            String(MAX_DOCUMENTS)
          ),
          [chooseFolder]
        );
        return;
      }
      const named = sources.reduce((sum, source) => sum + source.blocks.filter((block) => block.name !== null).length, 0);
      if (named > MAX_FOLDER_DIAGRAMS) {
        void notifyWith(
          context,
          'warn',
          context.l10n.t(
            '{0} has more than {1} named diagrams, too many to export at once. Choose a smaller folder.',
            where,
            String(MAX_FOLDER_DIAGRAMS)
          ),
          [chooseFolder]
        );
        return;
      }
      const unnamedIn = sources.find((source) => source.blocks.some((block) => block.name === null))?.uri;
      if (named === 0) {
        const unnamed = sources.reduce((sum, source) => sum + source.blocks.length, 0);
        await reportOutcome(context, { written: [], failed: [], unnamed, kept: 0 }, [], false, unnamedDiagrams(sources), unnamedIn);
        return;
      }

      const planned: (FolderSource & { directory: string })[] = [];
      for (const source of sources) {
        const directory = exportDirectory(context, settings, source.uri);
        if (directory === null) {
          return;
        }
        planned.push({ ...source, directory });
      }

      // Asked before anything is drawn, with the documents it would write from.
      const documents = planned.map((source) => workspace.relativePath(source.uri));
      const listed = documents.slice(0, 20);
      if (documents.length > listed.length) {
        listed.push(context.l10n.t('…and {0} more', String(documents.length - listed.length)));
      }
      const answer = await context.notify.info(
        named === 1
          ? context.l10n.t('Export the named diagram in {0}?', where)
          : context.l10n.t('Export {0} named diagrams in {1}?', String(named), where),
        {
          modal: true,
          detail: [context.l10n.t('Source files: {0}', String(documents.length)), ...listed].join('\n'),
          actions: [{ title: context.l10n.t('Export'), value: 'export' as const }],
        }
      );
      if (answer !== 'export') {
        return;
      }

      const outcome = await context.progress.run(
        { title: context.l10n.t('Exporting diagrams…'), cancellable: true },
        async (report, signal) => {
          const drawn: DrawnDocument[] = [];
          // One panel draws every PNG: opened at the first, closed after the last.
          const pngs = lazyPngPanel(context.l10n, context.l10n.t('Creating PNG images…'));
          try {
            for (const [index, source] of planned.entries()) {
              if (signal.aborted) {
                return undefined;
              }
              const document = workspace.relativePath(source.uri);
              report.report({
                message: `${document} (${String(index + 1)}/${String(planned.length)})`,
                increment: 100 / planned.length,
              });
              const deps = exporterDeps(context, renderer, palettes, settings, exportRecords, workspace, source.uri);
              const result = await drawDocument(
                { ...deps, toPng: (svg, width, height, background) => pngs.draw(svg, width, height, background) },
                source.uri.toString(),
                source.directory,
                source.blocks,
                undefined,
                format
              );
              // Several documents are exported, so each failure names its own.
              drawn.push({
                ...result,
                failed: result.failed.map((failure) => ({ ...failure, name: `${document}: ${failure.name}` })),
              });
            }
          } finally {
            pngs.dispose();
          }
          // Nothing is written once cancelled.
          if (signal.aborted) {
            return undefined;
          }
          return writeDocuments(exporterDeps(context, renderer, palettes, settings, exportRecords, workspace, folder), drawn);
        }
      );
      if (outcome === undefined || outcome === null) {
        return;
      }
      await reportOutcome(context, outcome, [], false, unnamedDiagrams(sources), unnamedIn);
    };

  module.commands.handle(ExportFolderSvg, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: exportFolder('svg'),
  });

  module.commands.handle(ExportFolderPng, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      settings: Settings.token,
      exportRecords: ExportedFiles.token,
      workspace: Workspace,
    },
    execute: exportFolder('png'),
  });

  module.raw.register({
    id: 'plantuml.preview',
    inject: { plugin: Plugin, requestRefresh: RequestRefresh, settings: Settings.token, l10n: Localization },
    bind: ({ registrations, logger }, { plugin, requestRefresh, settings, l10n }): undefined => {
      // A colour-theme flip and a `theme` change both invalidate every cached
      // SVG: the palette is baked into the rendered output rather than applied
      // by CSS afterwards.
      registrations.own(
        vscode.window.onDidChangeActiveColorTheme(() => {
          logger.debug(l10n.t('VS Code colour theme changed. Refreshing diagram previews.'));
          plugin.clearCache();
        })
      );
      registrations.own(
        settings.watch(CONFIG.THEME, undefined, () => {
          plugin.clearCache();
        })
      );
      // VS Code's preview does not render again on a save, so with onSave the
      // saved blocks are taken for the ones to draw and the preview refreshed,
      // once the update the save itself scheduled there has passed.
      let afterSave: ReturnType<typeof setTimeout> | undefined;
      registrations.own(
        vscode.workspace.onDidSaveTextDocument((document) => {
          if (document.languageId === 'markdown' && updateModeOf(settings, document.uri) === 'onSave') {
            const sources = findPlantUmlBlocks(document.getText()).map((block) => block.source);
            plugin.accept(document.uri.toString(), sources);
            clearTimeout(afterSave);
            afterSave = setTimeout(() => {
              requestRefresh();
            }, SAVE_REFRESH_DELAY_MS);
          }
        })
      );
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.PREVIEW_UPDATE_MODE}`)) {
            requestRefresh();
          }
        })
      );

      registrations.defer(() => {
        clearTimeout(afterSave);
        // A pending refresh would fire into a preview that is going away.
        requestRefresh.cancel();
      });
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.diagnostics',
    inject: {
      renders: Renders,
      palettes: Palettes,
      settings: Settings.token,
      l10n: Localization,
      watch: IncludeWatch,
      viewers: Viewers,
    },
    bind: ({ registrations, logger }, { renders, palettes, settings, l10n, watch, viewers }): undefined => {
      // Puts the problems of the diagrams in open Markdown and PlantUML
      // documents in the Problems panel, whether or not a preview is open.
      // Renders are shared with the previews, so a document shown in one is
      // drawn once, unless it includes local files: those renders are not
      // kept, as the files may change.
      const collection = registrations.own(vscode.languages.createDiagnosticCollection(EXTENSION_ID));
      const labels = problemLabels(l10n);
      const timers = new Map<string, NodeJS.Timeout>();
      // Bumped on every change, so a check that finishes after the text moved
      // on does not bring back what it found in the old text.
      const generations = new Map<string, number>();

      const enabled = (document: vscode.TextDocument): boolean =>
        settings.read({ resource: document.uri }).values[CONFIG.DIAGNOSTICS_ENABLED] !== false;

      /** Document → what the local includes of its diagrams looked at, when last checked. */
      const dependencies = new Map<string, readonly string[]>();

      const outcomeOf = async (
        source: string,
        document: vscode.Uri
      ): Promise<{ outcome: RenderOutcome; read: readonly string[] }> => {
        try {
          const dark = await palettes.resolve(source, isDark(settings.read().values[CONFIG.THEME]));
          const { svg, failedIncludes, dependencies: read } = await renders(source, dark, document.toString());
          return { outcome: { svg, failedIncludes }, read };
        } catch (error: unknown) {
          return { outcome: { error: error instanceof Error ? error.message : String(error) }, read: [] };
        }
      };

      const diagnose = async (document: vscode.TextDocument, generation: number): Promise<void> => {
        const key = document.uri.toString();
        const text = document.getText();
        const lines = splitLines(text);
        const found: vscode.Diagnostic[] = [];
        const reads: string[] = [];
        // A PlantUML file with no start line is lines to include, not a
        // diagram, unless its viewer is open: that draws it as one.
        const diagrams = diagramsOf(document, text).filter(
          (block) => document.languageId !== 'plantuml' || viewers.shows(document.uri) || hasStartLine(block.source)
        );
        for (const block of diagrams) {
          const check = checkSource(block, labels);
          const problems = [...check.problems];
          if (check.render !== null) {
            const { outcome, read } = await outcomeOf(check.render, document.uri);
            if (generations.get(key) !== generation) {
              return;
            }
            reads.push(...read);
            problems.push(...renderProblems(block, check, outcome, labels));
          }
          found.push(...problems.map((problem) => toDiagnostic(problem, lines, block.container)));
        }
        if (generations.get(key) === generation) {
          collection.set(document.uri, found);
          if (reads.length > 0) {
            dependencies.set(key, reads);
          } else {
            dependencies.delete(key);
          }
        }
      };

      const schedule = (document: vscode.TextDocument, delay: number): void => {
        if (!isDiagramFile(document)) {
          return;
        }
        const key = document.uri.toString();
        clearTimeout(timers.get(key));
        const generation = (generations.get(key) ?? 0) + 1;
        generations.set(key, generation);
        if (!enabled(document)) {
          timers.delete(key);
          collection.delete(document.uri);
          return;
        }
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            diagnose(document, generation).catch((error: unknown) => {
              logger.warn(l10n.t('Could not check the diagrams in {0}: {1}', key, errorMessage(error instanceof Error ? error.message : String(error), l10n)));
            });
          }, delay)
        );
      };

      const forget = (document: vscode.TextDocument): void => {
        const key = document.uri.toString();
        clearTimeout(timers.get(key));
        timers.delete(key);
        generations.delete(key);
        collection.delete(document.uri);
        dependencies.delete(key);
      };

      registrations.own(
        vscode.workspace.onDidOpenTextDocument((document) => {
          schedule(document, 0);
        })
      );
      // A document whose diagrams include a file that changed is checked again.
      registrations.own(
        watch.onDidChange((changes) => {
          for (const [key, read] of dependencies) {
            if (changeTo(read, changes) === 'none') {
              continue;
            }
            const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === key);
            if (document !== undefined) {
              schedule(document, 0);
            }
          }
        })
      );
      registrations.own(
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.contentChanges.length === 0 || !isDiagramFile(event.document)) {
            return;
          }
          // What was found describes text that is gone; it must not stay up
          // until the next check finishes.
          collection.delete(event.document.uri);
          schedule(event.document, DIAGNOSTICS_DEBOUNCE_MS);
        })
      );
      registrations.own(vscode.workspace.onDidCloseTextDocument(forget));
      // A PlantUML file with no start line is checked while its viewer is open.
      registrations.own(
        viewers.onDidChangeShown((uri) => {
          const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === uri.toString());
          if (document !== undefined) {
            schedule(document, 0);
          }
        })
      );
      const checkAll = (): void => {
        for (const document of vscode.workspace.textDocuments) {
          schedule(document, 0);
        }
      };
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          // The search folders decide which files local includes read.
          if (
            event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.DIAGNOSTICS_ENABLED}`) ||
            event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.INCLUDE_PATHS}`)
          ) {
            checkAll();
          }
        })
      );
      // Local includes are read from now on, or from other folders.
      registrations.own(vscode.workspace.onDidGrantWorkspaceTrust(checkAll));
      registrations.own(vscode.workspace.onDidChangeWorkspaceFolders(checkAll));
      checkAll();

      registrations.defer(() => {
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
      });
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.exportMenu',
    inject: { commands: Commands },
    bind: ({ registrations }, { commands }): undefined => {
      // Keeps the context keys behind the editor context-menu entries
      // current: "Export Diagram" shows only with the cursor inside a
      // ```plantuml block or a diagram of a PlantUML file, "Export All"
      // only when the document has one. Blocks are rescanned only when the
      // document itself changes; a plain cursor move reuses the previous scan.
      let scanned = '';
      let blocks: readonly PlantUmlBlock[] = [];
      const state = { hasDiagrams: false, inDiagram: false };

      const update = (editor: vscode.TextEditor | undefined): void => {
        let hasDiagrams = false;
        let inDiagram = false;

        const language = editor?.document.languageId;
        if (editor !== undefined && (language === 'markdown' || language === 'plantuml')) {
          const stamp = `${editor.document.uri.toString()}#${String(editor.document.version)}`;
          if (stamp !== scanned) {
            blocks = diagramsOf(editor.document, editor.document.getText());
            scanned = stamp;
          }
          hasDiagrams = blocks.length > 0;
          inDiagram = blockAtLine(blocks, editor.selection.active.line) !== null;
        }

        // setContext is a command round-trip; skip it when nothing moved.
        if (hasDiagrams !== state.hasDiagrams) {
          state.hasDiagrams = hasDiagrams;
          void commands.execute('setContext', CONTEXT_KEYS.HAS_DIAGRAMS, hasDiagrams);
        }
        if (inDiagram !== state.inDiagram) {
          state.inDiagram = inDiagram;
          void commands.execute('setContext', CONTEXT_KEYS.CURSOR_IN_DIAGRAM, inDiagram);
        }
      };

      registrations.own(
        vscode.window.onDidChangeTextEditorSelection((event) => {
          update(event.textEditor);
        })
      );
      registrations.own(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          update(editor);
        })
      );
      update(vscode.window.activeTextEditor);
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.completion',
    inject: { l10n: Localization, settings: Settings.token, libraries: Declarations },
    bind: ({ registrations, logger }, { l10n, settings, libraries }): undefined => {
      // Suggestions in the diagrams of Markdown documents and PlantUML files
      // (src/language/completion.ts). Markdown turns quick suggestions off,
      // so there they open on the characters a suggestion starts after, and
      // on Ctrl+Space.
      let data: CompletionData | undefined;
      let scanned = '';
      let blocks: readonly PlantUmlBlock[] = [];
      const names = templateNames(l10n);
      const snippets = snippetNames(l10n);
      const snippetHelp = snippetTexts(l10n);

      /** The PlantUML block of a Markdown document that `position` lies in. */
      const blockAt = (document: vscode.TextDocument, position: vscode.Position): PlantUmlBlock | undefined => {
        const stamp = `${document.uri.toString()}#${String(document.version)}`;
        if (stamp !== scanned) {
          blocks = findPlantUmlBlocks(document.getText());
          scanned = stamp;
        }
        return blocks.find(
          (candidate) =>
            position.line > candidate.openLine &&
            (position.line < candidate.closeLine ||
              (!candidate.closed && position.line === candidate.closeLine))
        );
      };

      /** What the list offers at `position`, from where on its line. */
      const find = (
        document: vscode.TextDocument,
        position: vscode.Position,
        text: string
      ): { found: Suggestions | null; offset: number } => {
        const after = text.slice(position.character);
        if (document.languageId === 'plantuml') {
          const where = lineContext(document.getText(), position.line);
          const before = text.slice(0, position.character);
          return { found: where === null ? null : inDiagram(before, after, where.open), offset: 0 };
        }

        const block = blockAt(document, position);
        if (block === undefined) {
          // The text of the document: a whole diagram block can start here.
          const fits = isProseLine(document.getText(), position.line);
          const before = text.slice(0, position.character);
          return { found: fits ? suggestTemplates(before, after, true, names) : null, offset: 0 };
        }

        // The block's lines up to the cursor, without its quote markers.
        const container = block.container;
        const lines: string[] = [];
        for (let at = block.openLine + 1; at <= position.line; at++) {
          const body = document.lineAt(at).text;
          lines.push(body.startsWith(container) ? body.slice(container.length) : body);
        }
        const where = lineContext(lines.join('\n'), lines.length - 1);
        const offset = text.startsWith(container) ? container.length : 0;
        const before = text.slice(offset, position.character);
        return { found: where === null ? null : inDiagram(before, after, where.open), offset };
      };

      /** The themes and icons the bundled engine ships, read when first asked for. */
      const completionData = (): CompletionData =>
        (data ??= readCompletionData(
          readFileSync(join(__dirname, 'engine', 'themes.cjs'), 'utf8'),
          readFileSync(join(__dirname, 'engine', 'openiconic.cjs'), 'utf8')
        ));

      let styleNames: StyleNames | undefined;
      /** The names of the style properties and selectors the bundled engine knows, as the build reads them, read when first asked for. */
      const styleNamesOf = (): StyleNames =>
        (styleNames ??= JSON.parse(readFileSync(join(__dirname, 'engine', 'style-names.json'), 'utf8')) as StyleNames);
      /** Whether the style items and skinparams are offered and explained in `document`: plantumlLocal.styleHelp.enabled. */
      const styleHelpIn = (document: vscode.TextDocument): boolean =>
        settings.read({ resource: document.uri }).values[CONFIG.STYLE_HELP_ENABLED] !== false;

      /** Suggestions on a diagram line: templates only where a diagram can start. */
      const inDiagram = (before: string, after: string, open: string | null): Suggestions | null =>
        suggest(before, after, open, completionData()) ??
        (open === null ? suggestTemplates(before, after, false, names) : null);

      /**
       * The diagram source the line at `position` is read in: the PlantUML
       * file, or the Markdown block the line lies in without its quote
       * markers, with the line's index in it and the width of the markers on
       * the line. Null in the text of a Markdown document. Either, with no
       * start line, is one diagram, as the preview draws it: a file that is
       * only included is read whole.
       */
      const sourceAt = (
        document: vscode.TextDocument,
        position: vscode.Position,
        text: string
      ): { source: string; line: number; offset: number; bare: boolean } | null => {
        if (document.languageId === 'plantuml') {
          return { source: document.getText(), line: position.line, offset: 0, bare: true };
        }
        const block = blockAt(document, position);
        if (block === undefined) {
          return null;
        }
        const container = block.container;
        const lines: string[] = [];
        for (let at = block.openLine + 1; at <= (block.closed ? block.closeLine - 1 : block.closeLine); at++) {
          const body = document.lineAt(at).text;
          lines.push(body.startsWith(container) ? body.slice(container.length) : body);
        }
        const offset = text.startsWith(container) ? container.length : 0;
        return { source: lines.join('\n'), line: position.line - block.openLine - 1, offset, bare: true };
      };

      // What the diagram and the files it includes define where the cursor is
      // (src/language/macros.ts), which the completion and the parameter hints
      // offer and Go to Definition goes to: read for each request from the
      // documents as they are then, and never by running anything. What the
      // bundled libraries declare is read once, when an include first names
      // one; the text of their files, each time one is opened.
      const stdlib = join(__dirname, 'stdlib');
      const kinds: Readonly<Record<MacroKind, vscode.CompletionItemKind>> = {
        procedure: vscode.CompletionItemKind.Method,
        function: vscode.CompletionItemKind.Function,
        define: vscode.CompletionItemKind.Function,
        definelong: vscode.CompletionItemKind.Function,
        constant: vscode.CompletionItemKind.Constant,
        variable: vscode.CompletionItemKind.Variable,
        parameter: vscode.CompletionItemKind.Variable,
      };

      // What was read, in the Language Status of the document in the editor,
      // and why something was not, in the output: once for each change, never
      // in a notification.
      const status = vscode.languages.createLanguageStatusItem('plantumlLocal.definitions', [
        { language: 'markdown' },
        { language: 'plantuml' },
      ]);
      registrations.own(status);
      status.name = l10n.t('PlantUML Definitions');
      /** What was last read for each document: nothing, as it is past the limits, or what was not read, as logged. */
      const reads = new Map<
        string,
        { tooLarge: true } | { partial: boolean; logged: string; cut: false | 'definitions' | 'references' }
      >();
      const showStatus = (document: vscode.TextDocument | undefined): void => {
        const read = document === undefined ? undefined : reads.get(document.uri.toString());
        if (read !== undefined && 'tooLarge' in read) {
          status.text = l10n.t('Definitions: not read');
          status.severity = vscode.LanguageStatusSeverity.Warning;
          status.detail = l10n.t(
            'The document is larger than {0} MiB or longer than {1} lines, so completion, parameter hints, hovers, Go to Definition and Find All References do not read its definitions.',
            String(ANALYSIS_LIMITS.fileBytes / (1024 * 1024)),
            String(ANALYSIS_LIMITS.fileLines)
          );
        } else if (read?.partial === true) {
          status.text = l10n.t('Definitions: diagram and includes (partial)');
          status.severity = vscode.LanguageStatusSeverity.Warning;
          status.detail =
            read.logged === '' && read.cut === 'references'
              ? l10n.t('Only the first {0} references are listed.', String(ANALYSIS_LIMITS.results))
              : l10n.t('Some definitions are missing. See the Output panel for the reasons.');
        } else {
          status.text = l10n.t('Definitions: diagram and includes');
          status.severity = vscode.LanguageStatusSeverity.Information;
          status.detail = l10n.t(
            'Completion, parameter hints, hovers, Go to Definition and Find All References read what this diagram and the files it includes define.'
          );
        }
      };
      showStatus(vscode.window.activeTextEditor?.document);
      registrations.own(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          showStatus(editor?.document);
        })
      );
      registrations.own(
        vscode.workspace.onDidCloseTextDocument((document) => {
          reads.delete(document.uri.toString());
        })
      );

      /**
       * Keeps what was read for `document` and shows it; logs why something
       * was not, and which list stopped at the limit, when that changes.
       */
      const report = (
        document: vscode.TextDocument,
        read: { tooLarge: true } | { reasons: readonly string[]; cut: false | 'definitions' | 'references' }
      ): void => {
        const key = document.uri.toString();
        const before = reads.get(key);
        if ('tooLarge' in read) {
          reads.set(key, read);
        } else {
          const logged = read.reasons.join('\n');
          reads.set(key, { partial: read.reasons.length > 0 || read.cut !== false, logged, cut: read.cut });
          const known = before !== undefined && !('tooLarge' in before) && before.logged === logged;
          if ((logged !== '' && !known) || (read.cut !== false && (!known || before.cut !== read.cut))) {
            const limit = String(ANALYSIS_LIMITS.results);
            const cut =
              read.cut === 'definitions'
                ? [l10n.t('Only the first {0} definitions are offered.', limit)]
                : read.cut === 'references'
                  ? [l10n.t('Only the first {0} references are listed.', limit)]
                  : [];
            logger.info(
              [
                l10n.t(
                  'Completion, parameter hints, hovers, Go to Definition and Find All References in {0} did not read:',
                  vscode.workspace.asRelativePath(document.uri)
                ),
                ...read.reasons,
                ...cut,
              ].join('\n')
            );
          }
        }
        if (vscode.window.activeTextEditor?.document.uri.toString() === key) {
          showStatus(document);
        }
      };

      /**
       * What is defined at line `cursor` of `document`, in the diagram
       * `diagram`, read as the documents are now: undefined once the request
       * is cancelled or the document changes, null for a document larger than
       * what the background reads. With it, the path VS Code has each local
       * file it read under, by the id the include session gave it, and the
       * text read of each.
       */
      const definitionsAt = async (
        document: vscode.TextDocument,
        diagram: DiagramLines,
        cursor: number,
        token: vscode.CancellationToken | undefined
      ): Promise<
        | {
            macros: Macros;
            labels: MacroLabels;
            reasons: string[];
            opened: (id: string) => string;
            texts: ReadonlyMap<string, string>;
          }
        | null
        | undefined
      > => {
        const version = document.version;
        const stale = (): boolean => token?.isCancellationRequested === true || document.version !== version;
        if (pastAnalysisLimits(document.getText())) {
          report(document, { tooLarge: true });
          return null;
        }
        const reading = await readingFor(document, stale);
        const macros = await macrosAt(diagram, cursor, reading.sources);
        if (stale() || macros.status === 'cancelled') {
          return undefined;
        }
        const { labels, opened, texts } = reading;
        return { macros, labels, reasons: reading.reasonsOf(macros), opened, texts };
      };

      /**
       * Where the definitions of `document` are read from for one request:
       * its include session, as the documents are now, with each local file
       * asked of it once whatever reads it again, the text read of each and
       * the path VS Code has it under, by the id the session gives it; and
       * why each include was not read, as the output lists it.
       */
      const readingFor = async (
        document: vscode.TextDocument,
        stale: () => boolean
      ): Promise<{
        sources: MacroSources;
        labels: MacroLabels;
        opened: (id: string) => string;
        texts: ReadonlyMap<string, string>;
        reasonsOf: (macros: Macros) => string[];
      }> => {
        const { session, root, opened } = await openSession(document.uri, {
          includePaths: (uri) => includePathsOf(settings, uri),
        });
        const sources = macroSources(session, libraries, stale);
        const texts = new Map<string, string>();
        const asked = new Map<string, Promise<{ id: string; text: string } | null>>();
        const labels = macroLabels(l10n, root, libraries);
        const writtenIn = (at: Origin): string =>
          labels.line(
            at.source === 'document'
              ? vscode.workspace.asRelativePath(document.uri)
              : at.source === 'file'
                ? labels.file(at.id)
                : labels.library(at.library, at.key),
            at.line + 1
          );
        return {
          sources: {
            ...sources,
            // The session counts each file it gives, read before or not.
            file: (path, from, kind): Promise<{ id: string; text: string } | null> => {
              const key = `${from ?? ''}\n${kind}\n${path}`;
              let file = asked.get(key);
              if (file === undefined) {
                file = sources.file(path, from, kind).then((read) => {
                  if (read !== null) {
                    texts.set(read.id, read.text);
                  }
                  return read;
                });
                asked.set(key, file);
              }
              return file;
            },
          },
          labels,
          opened,
          texts,
          reasonsOf: (macros) =>
            macros.shortfalls.map((shortfall) =>
              l10n.t(
                '{0}: {1} was not read. {2}',
                writtenIn(shortfall.at),
                shortfall.path,
                shortfallReason(shortfall, session.failures, l10n)
              )
            ),
        };
      };

      /**
       * Markdown for a hover, the details of a completion item or the
       * parameter hints: untrusted and without HTML, so that nothing in it
       * runs a command or loads anything.
       */
      const untrusted = (value: string): vscode.MarkdownString => {
        const markdown = new vscode.MarkdownString(value);
        markdown.isTrusted = false;
        markdown.supportHtml = false;
        return markdown;
      };

      /**
       * How each definition is declared, where, and the comment above it, as
       * written and wrapped to the details: VS Code 1.144.0 cuts a line of a
       * code block there that does not fit, and through appendText shows the
       * URLs in a comment as links and named character references such as
       * `&lt;` as the characters they stand for.
       */
      const documentationOf = (definitions: readonly MacroDefinition[]): vscode.MarkdownString =>
        untrusted(
          definitions
            .map((definition) =>
              [
                inlineCode(definition.declaration),
                escapeMarkdown(definition.where),
                ...(definition.comment === undefined ? [] : [escapeLines(definition.comment)]),
              ].join('\n\n')
            )
            .join('\n\n')
        );

      /** The definitions the completion offers at `place`, replacing the name there; undefined once the request is stale. */
      const definitionItems = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        offset: number,
        place: MacroPlace,
        token: vscode.CancellationToken | undefined
      ): Promise<vscode.CompletionItem[] | undefined> => {
        const read = await definitionsAt(document, place.diagram, place.cursor, token);
        if (read === null || read === undefined) {
          return read === null ? [] : undefined;
        }
        const { items, cut } = macroSuggestions(read.macros, place, read.labels);
        report(document, { reasons: read.reasons, cut: cut ? 'definitions' : false });
        const start = new vscode.Position(position.line, offset + place.start);
        const range = {
          inserting: new vscode.Range(start, position),
          replacing: new vscode.Range(start, new vscode.Position(position.line, offset + place.end)),
        };
        return items.map((suggestion) => {
          const item = new vscode.CompletionItem(
            {
              label: suggestion.name,
              ...(suggestion.parameters === undefined ? {} : { detail: suggestion.parameters }),
              description: suggestion.description,
            },
            kinds[suggestion.kind]
          );
          item.range = range;
          item.sortText = suggestion.sortText;
          item.insertText = new vscode.SnippetString(suggestion.snippet);
          item.documentation = documentationOf(suggestion.definitions);
          if (suggestion.call && !place.callOpen && suggestion.parameters !== '()') {
            // The parameter hints, in the brackets just inserted.
            item.command = { title: '', command: 'editor.action.triggerParameterHints' };
          }
          return item;
        });
      };

      /**
       * The aliases, words and snippets of the diagram at `position`, and what
       * the diagram and its includes define there. They take the place of VS
       * Code's word suggestions, which come from every open document, and
       * follow its setting for them: no words with `off`. By default VS Code
       * lists no words in a PlantUML file while inline suggestions are on
       * there, which an extension cannot tell; so a list of words alone is
       * left to VS Code in one. In a Markdown document it lists words by
       * default, and the list opens only when asked for. In a Markdown block,
       * VS Code reads the setting for PlantUML too. A name typed after `$`,
       * and `$` typed, ask for the names that start with `$` only.
       */
      const namesAt = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        text: string,
        token: vscode.CancellationToken | undefined
      ): Promise<vscode.CompletionItem[] | undefined> => {
        const where = sourceAt(document, position, text);
        if (where === null) {
          return undefined;
        }
        const column = position.character - where.offset;
        const place = macroPlace(where.source, where.line, column, {
          bare: where.bare,
          first: position.line - where.line,
        });
        const dollar = place !== null && text.charAt(where.offset + place.start) === '$';
        const defined =
          place === null
            ? []
            : await definitionItems(
                document,
                position,
                where.offset,
                { ...place, dollarOnly: place.dollarOnly || dollar },
                token
              );
        if (defined === undefined || dollar) {
          return defined === undefined || defined.length === 0 ? undefined : defined;
        }
        // The default of every VS Code the extension runs on.
        const setting =
          vscode.workspace
            .getConfiguration('editor', { uri: document.uri, languageId: 'plantuml' })
            .get<string>('wordBasedSuggestions') ?? 'offWithInlineSuggestions';
        const found = suggestNames(where.source, where.line, column, {
          bare: where.bare,
          words:
            setting === 'off'
              ? 'never'
              : setting === 'offWithInlineSuggestions' && document.languageId === 'plantuml' && defined.length === 0
                ? 'beside'
                : 'always',
        });
        if (found === null) {
          return defined.length === 0 ? undefined : defined;
        }

        const start = new vscode.Position(position.line, where.offset + found.start);
        const range = {
          inserting: new vscode.Range(start, position),
          replacing: new vscode.Range(start, new vscode.Position(position.line, where.offset + found.end)),
        };
        // The lines of a snippet after its first go on with the line's quote markers and indent.
        const lead = text.slice(0, where.offset) + found.lead;
        const item = (
          label: string | vscode.CompletionItemLabel,
          kind: vscode.CompletionItemKind,
          sortText: string
        ): vscode.CompletionItem => {
          const made = new vscode.CompletionItem(label, kind);
          made.range = range;
          made.sortText = sortText;
          return made;
        };
        // A word that names a definition is offered once, as the definition.
        const definedNames = new Set(defined.map(({ label }) => (typeof label === 'string' ? label : label.label)));
        // The aliases first, then the snippets, the definitions and the words.
        return [
          ...found.aliases.map(({ name, display }, index) => {
            const alias = item(
              { label: name, description: display },
              vscode.CompletionItemKind.Variable,
              `0${String(index).padStart(4, '0')}`
            );
            alias.detail = l10n.t('Alias in this diagram');
            return alias;
          }),
          ...found.snippets.map(({ label, body }, index) => {
            const snippet = item(
              { label, description: snippets[label] ?? label },
              vscode.CompletionItemKind.Snippet,
              `1${String(index).padStart(4, '0')}`
            );
            snippet.insertText = new vscode.SnippetString(body.replace(/\n/g, `\n${lead}`));
            snippet.keepWhitespace = true;
            const text = snippetHelp[label];
            if (text !== undefined) {
              snippet.documentation = untrusted(
                [escapeMarkdown(text), codeBlock(expandSnippet(body), 'plantuml')].join('\n\n')
              );
            }
            return snippet;
          }),
          ...defined,
          ...found.words
            .filter((word) => !definedNames.has(word))
            .map((word) => {
              const plain = item(word, vscode.CompletionItemKind.Text, `3${word}`);
              plain.detail = l10n.t('Word in this diagram');
              return plain;
            }),
        ];
      };

      /**
       * The properties a rule of a style sheet offers at `position`, or the
       * skinparams, or the values of one (src/language/style.ts), each
       * replacing the name or the value there only; undefined where none
       * is offered, or plantumlLocal.styleHelp.enabled is off.
       */
      const settingsAt = (
        document: vscode.TextDocument,
        position: vscode.Position,
        text: string
      ): vscode.CompletionItem[] | undefined => {
        const where = styleHelpIn(document) ? sourceAt(document, position, text) : null;
        if (where === null) {
          return undefined;
        }
        const column = position.character - where.offset;
        const place = settingAt(where.source, where.line, column, where.bare, styleNamesOf());
        if (place === null) {
          return undefined;
        }
        const start = new vscode.Position(position.line, where.offset + place.start);
        const range = {
          inserting: new vscode.Range(start, position),
          replacing: new vscode.Range(start, new vscode.Position(position.line, where.offset + place.end)),
        };
        const kinds = {
          property: vscode.CompletionItemKind.Property,
          skinparam: vscode.CompletionItemKind.Property,
          value: vscode.CompletionItemKind.Value,
          color: vscode.CompletionItemKind.Color,
        };
        const typed = text.slice(where.offset + place.start, position.character);
        return settingSuggestions(place, typed, styleNamesOf(), l10n).map((suggestion, index) => {
          const item = new vscode.CompletionItem(suggestion.label, kinds[suggestion.kind]);
          item.insertText = suggestion.insert;
          item.range = range;
          item.sortText = String(index).padStart(4, '0');
          if (suggestion.detail !== undefined) {
            // A colour's `#RRGGBB`, from which VS Code draws its swatch.
            item.detail = suggestion.detail;
          }
          if (suggestion.help !== undefined) {
            item.documentation = untrusted(helpMarkdown(suggestion.help, l10n));
          }
          return item;
        });
      };

      const provide = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
        context?: vscode.CompletionContext
      ): Promise<vscode.CompletionItem[] | undefined> => {
        const text = document.lineAt(position.line).text;
        const { found, offset } = mightSuggest(text.slice(0, position.character))
          ? find(document, position, text)
          : { found: null, offset: 0 };
        if (found === null) {
          // A trigger character asks for what follows it only: `$` for a name
          // that starts with it. A space opens no list of style items.
          const trigger =
            context?.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter ? context.triggerCharacter : undefined;
          const offered = trigger === undefined ? settingsAt(document, position, text) : undefined;
          if (offered !== undefined) {
            // A word of the diagram that is also a name or a value offered here is offered once, as that.
            const labelOf = ({ label }: vscode.CompletionItem): string =>
              (typeof label === 'string' ? label : label.label).toLowerCase();
            const taken = new Set(offered.map(labelOf));
            const names = (await namesAt(document, position, text, token)) ?? [];
            return [
              ...offered,
              ...names.filter((item) => item.kind !== vscode.CompletionItemKind.Text || !taken.has(labelOf(item))),
            ];
          }
          return trigger === undefined || trigger === '$'
            ? namesAt(document, position, text, token)
            : undefined;
        }

        const start = new vscode.Position(position.line, offset + found.start);
        const end = new vscode.Position(position.line, offset + found.end);
        const kind = {
          keyword: vscode.CompletionItemKind.Keyword,
          name: vscode.CompletionItemKind.Value,
          template: vscode.CompletionItemKind.Snippet,
        }[found.kind];
        return found.items.map((suggestion, index) => {
          const item = new vscode.CompletionItem(
            suggestion.detail === undefined
              ? suggestion.label
              : { label: suggestion.label, description: suggestion.detail },
            kind
          );
          if (found.kind === 'template') {
            // The template's lines carry their own quote markers and indent.
            item.insertText = new vscode.SnippetString(suggestion.insert);
            item.keepWhitespace = true;
          } else {
            item.insertText = suggestion.insert;
          }
          item.range = {
            inserting: new vscode.Range(start, position),
            replacing: new vscode.Range(start, end),
          };
          // In the order given: `@startuml` first, directives grouped.
          item.sortText = String(index).padStart(4, '0');
          return item;
        });
      };

      /**
       * The parameter hints for the call at `position`: each definition of the
       * name it calls, as declared, and the parameter the cursor is in. The
       * signature the user picked stays while it takes the arguments.
       */
      const hints = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
      ): Promise<vscode.SignatureHelp | undefined> => {
        const text = document.lineAt(position.line).text;
        const where = sourceAt(document, position, text);
        const found =
          where === null
            ? null
            : diagramLinesAt(where.source, where.line, { bare: where.bare, first: position.line - where.line });
        if (where === null || found === null) {
          return undefined;
        }
        const read = await definitionsAt(document, found.diagram, found.cursor, token);
        if (read === null || read === undefined) {
          return undefined;
        }
        report(document, { reasons: read.reasons, cut: false });
        const line = text.slice(where.offset);
        const call = callAt(line, position.character - where.offset, (name) => readingOf(read.macros, name));
        const chosen = context.isRetrigger ? context.activeSignatureHelp?.activeSignature : undefined;
        const shown = call === null ? null : signaturesFor(read.macros, call, line, read.labels, chosen);
        if (shown === null) {
          return undefined;
        }
        const help = new vscode.SignatureHelp();
        help.signatures = shown.signatures.map((signature) => {
          // Written as a hover writes them, so that the comment shows as written.
          const documentation = untrusted(
            [
              escapeMarkdown(signature.description),
              ...(signature.comment === undefined ? [] : [codeBlock(signature.comment, 'text')]),
            ].join('\n\n')
          );
          const information = new vscode.SignatureInformation(signature.label, documentation);
          information.parameters = signature.parameters.map(
            ([from, to]) => new vscode.ParameterInformation([from, to])
          );
          information.activeParameter = signature.activeParameter;
          return information;
        });
        help.activeSignature = shown.active;
        help.activeParameter = shown.signatures[shown.active]?.activeParameter ?? -1;
        return help;
      };

      /** The columns of line `at` of the document before the text of `diagram`: a Markdown block's quote markers. */
      const quoteWidth = (document: vscode.TextDocument, diagram: DiagramLines, at: number): number => {
        const written = document.lineAt(at).text;
        const index = diagram.numbers.indexOf(at);
        return written.length - (diagram.lines[index] ?? written).length;
      };

      /**
       * Where each definition is, as Go to Definition and Find All References
       * show it, for a request on `document` in `diagram`: the file, the
       * columns of its name on its line (of a parameter, in the line that
       * declares its procedure or function), and the last line of its body
       * with that line's length. Null for a file that cannot be read now.
       * The lines of each file of a bundled library are read once.
       */
      const placesIn = (
        document: vscode.TextDocument,
        diagram: DiagramLines,
        read: { texts: ReadonlyMap<string, string>; opened: (id: string) => string }
      ): ((
        macro: Macro
      ) => Promise<{ uri: vscode.Uri; line: number; start: number; end: number; last: number; length: number } | null>) => {
        const libraryLines = new Map<string, Promise<readonly string[] | null>>();
        const targetOf = async (
          at: Origin
        ): Promise<{ uri: vscode.Uri; lineOf: (line: number) => string; indent: number } | null> => {
          switch (at.source) {
            case 'document':
              return {
                uri: document.uri,
                lineOf: (index) => document.lineAt(index).text,
                indent: quoteWidth(document, diagram, at.line),
              };
            case 'file': {
              const written = read.texts.get(at.id);
              if (written === undefined) {
                return null;
              }
              const lines = splitLines(written);
              return { uri: vscode.Uri.file(read.opened(at.id)), lineOf: (index) => lines[index] ?? '', indent: 0 };
            }
            case 'library': {
              const key = `${at.library}/${at.key}`;
              let lines = libraryLines.get(key);
              if (lines === undefined) {
                lines = libraryText(stdlib, at.library, at.key).then(
                  (written) => (written === null ? null : splitLines(written)),
                  () => null
                );
                libraryLines.set(key, lines);
              }
              const known = await lines;
              return known === null
                ? null
                : { uri: libraryUri(at.library, at.key), lineOf: (index) => known[index] ?? '', indent: 0 };
            }
          }
        };
        return async (macro) => {
          const at = macro.origin;
          const target = await targetOf(at);
          if (target === null) {
            return null;
          }
          const { uri, lineOf, indent } = target;
          // A parameter is defined in the line that declares its procedure or function, after the name.
          const column = macro.kind === 'parameter' ? parameterAt(lineOf(at.line), indent + at.end, macro.name) : -1;
          const start = column === -1 ? indent + at.start : column;
          const end = column === -1 ? indent + at.end : column + macro.name.length;
          const last = macro.kind === 'parameter' ? at.line : at.last;
          return { uri, line: at.line, start, end, last, length: lineOf(last).length };
        };
      };

      /** The read-only view of file `key` of the bundled library `library` (src/language/library-view.ts). */
      const libraryUri = (library: string, key: string): vscode.Uri =>
        vscode.Uri.from({ scheme: LIBRARY_SCHEME, path: libraryPath(library, key, libraries.fileName(library, key)) });

      /**
       * Go to Definition and Peek at `position` (src/language/definitions.ts):
       * on the path of an include of a bundled library, the start of its file;
       * on a call or a variable, where what it stands for is defined, each
       * definition it may stand for from its line to the end of its body,
       * its name selected; on a name that a line of the diagram declares with
       * a keyword, each such line. Nothing where text that was not read may
       * define the name again.
       */
      const definitionLinks = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
      ): Promise<vscode.LocationLink[] | undefined> => {
        const version = document.version;
        const stale = (): boolean => token.isCancellationRequested || document.version !== version;
        const text = document.lineAt(position.line).text;
        const where = sourceAt(document, position, text);
        if (where === null) {
          return undefined;
        }
        const line = text.slice(where.offset);
        const column = position.character - where.offset;
        const here = (start: number, end: number): vscode.Range =>
          new vscode.Range(position.line, where.offset + start, position.line, where.offset + end);

        const included = libraryIncludeAt(line, column);
        if (included !== null) {
          // A file no bundled library has is one the engine cannot include either.
          const declared = await libraries.declared(included.library, included.key).catch(() => null);
          return declared === null || declared === undefined || stale()
            ? undefined
            : [
                {
                  originSelectionRange: here(included.start, included.end),
                  targetUri: libraryUri(included.library, included.key),
                  targetRange: new vscode.Range(0, 0, 0, 0),
                },
              ];
        }

        const found = nameAt(where.source, where.line, column, { bare: where.bare, first: position.line - where.line });
        if (found === null) {
          return undefined;
        }
        const read = await definitionsAt(document, found.diagram, found.cursor, token);
        if (read === null || read === undefined) {
          return undefined;
        }
        report(document, { reasons: read.reasons, cut: false });

        const indentOf = (at: number): number => quoteWidth(document, found.diagram, at);
        const entry = definitionsOfName(read.macros, found, line);
        if (entry === null) {
          // No procedure, function, macro or variable has the name: an element the diagram declares may.
          const element = found.call ? null : found.element;
          if (element === null) {
            return undefined;
          }
          const links = elementsNamed(found.diagram, element.name).map((declared): vscode.LocationLink => {
            const indent = indentOf(declared.line);
            return {
              originSelectionRange: here(element.start, element.end),
              targetUri: document.uri,
              targetRange: new vscode.Range(declared.line, 0, declared.last, document.lineAt(declared.last).text.length),
              targetSelectionRange: new vscode.Range(
                declared.line,
                indent + declared.start,
                declared.line,
                indent + declared.end
              ),
            };
          });
          return links.length === 0 ? undefined : links;
        }
        if (entry.certainty === 'unresolved') {
          return undefined;
        }

        const placeOf = placesIn(document, found.diagram, read);
        const linkTo = async (macro: Macro): Promise<{ key: string; link: vscode.LocationLink } | null> => {
          const place = await placeOf(macro);
          return place === null
            ? null
            : {
                key: `${place.uri.toString()}#${String(place.line)}:${String(place.start)}`,
                link: {
                  originSelectionRange: here(found.start, found.end),
                  targetUri: place.uri,
                  targetRange: new vscode.Range(place.line, 0, place.last, place.length),
                  targetSelectionRange: new vscode.Range(place.line, place.start, place.line, place.end),
                },
              };
        };
        const linked = await Promise.all(entry.candidates.map(({ macro }) => linkTo(macro)));
        if (stale()) {
          return undefined;
        }
        // A definition read twice, as a file included again, is gone to once.
        const links = new Map<string, vscode.LocationLink>();
        for (const each of linked) {
          if (each !== null && !links.has(each.key)) {
            links.set(each.key, each.link);
          }
        }
        return links.size === 0 ? undefined : [...links.values()];
      };

      /**
       * Find All References, Go to References and Peek References at
       * `position` (src/language/definitions.ts): each place where Go to
       * Definition would go to what the name at the cursor stands for, or to
       * the definition whose name the cursor is on; with `includeDeclaration`,
       * that definition too. A procedure, function, macro or variable is
       * looked for in the diagram and in the local files its includes read,
       * each line of a file as the diagram first reads it; an element, in the
       * diagram alone. Other diagrams and the files of the bundled libraries
       * are not searched. A place where text that was not read may stand for
       * the name is not counted, which the Language Status and the output
       * tell, as they tell when the list stops at its limit.
       */
      const referenceLocations = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
      ): Promise<vscode.Location[] | undefined> => {
        const version = document.version;
        const stale = (): boolean => token.isCancellationRequested || document.version !== version;
        const text = document.lineAt(position.line).text;
        const where = sourceAt(document, position, text);
        const found =
          where === null
            ? null
            : diagramLinesAt(where.source, where.line, { bare: where.bare, first: position.line - where.line });
        if (where === null || found === null) {
          return undefined;
        }
        if (pastAnalysisLimits(document.getText())) {
          report(document, { tooLarge: true });
          return undefined;
        }
        const { diagram } = found;
        const here = diagram.numbers.indexOf(found.cursor);
        const column = position.character - where.offset;
        const inDiagram = readDiagram(diagram);
        const declared = declaredAt(diagram, here, column, { source: 'document' });
        const declaredElement = declared === null ? elementDeclaredAt(diagram, here, column) : null;
        const at = declared === null && declaredElement === null ? nameIn(inDiagram, here, column) : null;
        if (declared === null && declaredElement === null && at === null) {
          return undefined;
        }
        const reading = await readingFor(document, stale);
        const whole = await diagramReading(diagram, reading.sources);
        if (stale() || whole.macros.status === 'cancelled') {
          return undefined;
        }

        // What the cursor names: the definition whose name it is on, or what Go to Definition goes to from it.
        let target: { macros: readonly Macro[] } | { element: string };
        if (declared !== null) {
          target = { macros: [declared] };
        } else if (declaredElement !== null) {
          target = { element: declaredElement };
        } else {
          const macros = await whole.at(found.cursor);
          if (stale() || macros.status === 'cancelled') {
            return undefined;
          }
          const entry = at === null ? null : definitionsOfName(macros, at, diagram.lines[here] ?? '');
          if (entry !== null && entry.certainty !== 'unresolved') {
            target = { macros: entry.candidates.map(({ macro }) => macro) };
          } else if (entry === null && at?.call === false && at.element !== null && elementsNamed(diagram, at.element.name).length > 0) {
            target = { element: at.element.name };
          } else {
            // Nothing to look for, maybe as text that was not read defines it: why, as Go to Definition says.
            report(document, { reasons: reading.reasonsOf(whole.macros), cut: false });
            return undefined;
          }
        }
        const goal = target;

        const locations = new Map<string, vscode.Location>();
        let cut = false;
        const add = (uri: vscode.Uri, line: number, start: number, end: number): void => {
          const key = `${uri.toString()}#${String(line)}:${String(start)}`;
          if (locations.has(key)) {
            return;
          }
          if (locations.size >= ANALYSIS_LIMITS.results) {
            cut = true;
            return;
          }
          locations.set(key, new vscode.Location(uri, new vscode.Range(line, start, line, end)));
        };
        const quote = (at: number): number => quoteWidth(document, diagram, at);
        const declarations =
          'element' in goal ? elementsNamed(diagram, goal.element).map(({ line, start, end }) => ({ line, start, end })) : [];
        // The definitions first, so that the limit leaves them in.
        if (context.includeDeclaration) {
          if ('element' in goal) {
            for (const { line, start, end } of declarations) {
              const indent = quote(line);
              add(document.uri, line, indent + start, indent + end);
            }
          } else {
            const placeOf = placesIn(document, diagram, reading);
            for (const macro of goal.macros) {
              const place = await placeOf(macro);
              if (place !== null) {
                add(place.uri, place.line, place.start, place.end);
              }
            }
          }
        }

        /** Whether Go to Definition from `at`, on line `written` where `macros` are defined, goes to the target. */
        const goesToTarget = (macros: Macros, at: Occurrence, written: string): boolean => {
          const entry = definitionsOfName(macros, at, written);
          if ('element' in goal) {
            return entry === null && !at.call && at.element?.name === goal.element;
          }
          return (
            entry !== null &&
            entry.certainty !== 'unresolved' &&
            entry.candidates.some(({ macro }) => goal.macros.some((one) => sameMacro(one, macro)))
          );
        };
        const name = 'element' in goal ? goal.element : (goal.macros[0]?.name ?? '');

        // In the diagram, with what is defined at each line.
        for (const occurrence of occurrencesIn(inDiagram, name)) {
          const line = diagram.numbers[occurrence.index] ?? 0;
          const { start, end } = 'element' in goal && occurrence.element !== null ? occurrence.element : occurrence;
          // A line that declares the element is a definition, not a reference to it.
          if (declarations.some((declared) => declared.line === line && declared.start === start)) {
            continue;
          }
          const read = await whole.at(line);
          if (stale() || read.status === 'cancelled') {
            return undefined;
          }
          if (goesToTarget(read, occurrence, diagram.lines[occurrence.index] ?? '')) {
            const indent = quote(line);
            add(document.uri, line, indent + start, indent + end);
          }
        }
        // In the local files the includes read, what is defined is what the diagram has defined where it first reads each line.
        if (!('element' in goal)) {
          for (const [id, numbers] of whole.files) {
            const written = reading.texts.get(id);
            if (written === undefined) {
              continue;
            }
            const all = splitLines(written);
            const lines = [...numbers].sort((one, other) => one - other);
            const inFile = readDiagram({ lines: lines.map((line) => all[line] ?? ''), numbers: lines });
            const uri = vscode.Uri.file(reading.opened(id));
            for (const occurrence of occurrencesIn(inFile, name)) {
              const line = lines[occurrence.index] ?? 0;
              const read = await whole.inFile(id, line);
              if (stale() || read?.status === 'cancelled') {
                return undefined;
              }
              if (read !== null && goesToTarget(read, occurrence, inFile.diagram.lines[occurrence.index] ?? '')) {
                add(uri, line, occurrence.start, occurrence.end);
              }
            }
          }
        }
        if (stale()) {
          return undefined;
        }
        report(document, { reasons: reading.reasonsOf(whole.macros), cut: cut ? 'references' : false });
        return locations.size === 0 ? undefined : [...locations.values()];
      };

      /**
       * The hover at `position` (src/language/hover.ts): on a preprocessor
       * directive, the kind of a diagram after `@start`, a bundled theme or an
       * OpenIconic icon, built-in help; on the path of an include, the file
       * it reads, found as a drawing finds it, or why it reads none; on a
       * call or a variable, each definition it may stand for, with how sure
       * that is, as the completion describes it; on a style item or a
       * skinparam the completion offers (src/language/style.ts), its help.
       * Nothing in a comment, on the keywords of a diagram or the other
       * skinparam and style names, nor on a name nothing defines.
       */
      const hoverAt = async (
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
      ): Promise<vscode.Hover | undefined> => {
        const version = document.version;
        const stale = (): boolean => token.isCancellationRequested || document.version !== version;
        const text = document.lineAt(position.line).text;
        const where = sourceAt(document, position, text);
        if (where === null || lineContext(where.source, where.line) === null) {
          return undefined;
        }
        const line = text.slice(where.offset);
        const column = position.character - where.offset;
        const hover = (sections: readonly string[], start: number, end: number): vscode.Hover =>
          new vscode.Hover(
            sections.map(untrusted),
            new vscode.Range(position.line, where.offset + start, position.line, where.offset + end)
          );

        // The diagram the line lies in, which the preview draws alone: what
        // another diagram of the file defines does not reach it.
        const diagram = diagramAt(where.source, where.line, where.bare);
        const diagramText = (): string =>
          diagram === null ? '' : splitLines(where.source).slice(diagram.from, diagram.to).join('\n');

        let defined: ReadonlySet<string> | undefined;
        const builtin = builtinAt(line, column, completionData(), (name) =>
          asWritten(name, (defined ??= definedWords(diagramText())))
        );
        if (builtin !== null) {
          const help = helpFor(builtin, l10n);
          return help === null ? undefined : hover([helpMarkdown(help, l10n)], builtin.start, builtin.end);
        }

        // A diagram that reads a URL is not drawn at all.
        const remote = remoteReferenceIn(line);
        if (remote !== null && column >= remote.start && column <= remote.end) {
          const reason = l10n.t(
            'Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'
          );
          return hover([escapeMarkdown(reason)], remote.start, remote.end);
        }

        const included = libraryIncludeAt(line, column);
        if (included !== null) {
          const declared = await libraries.declared(included.library, included.key).then(
            (read) => ({ read }),
            () => null
          );
          if (declared === null || stale()) {
            return undefined;
          }
          const written = line.slice(included.start, included.end);
          const said =
            declared.read === undefined
              ? l10n.t('{0} is not read. {1}', written, libraryNotBundled(written.slice(1, written.indexOf('/')), l10n))
              : declared.read === null
                ? l10n.t('{0} is not read. {1}', written, l10n.t('No bundled library has this file.'))
                : l10n.t(
                    'Reads {0}, bundled with this extension.',
                    libraryFile(included.library, included.key, libraries.fileName(included.library, included.key))
                  );
          return hover([escapeMarkdown(said)], included.start, included.end);
        }

        // A path taken as written is looked for as a drawing looks for it; any
        // other may hold a variable, whose definitions come first.
        const directive =
          diagram !== null && /^[ \t]*!(?:include|theme)/.test(line)
            ? includeDirectives(diagramText()).find(
                (found) => found.line === where.line - diagram.from && column >= found.start && column <= found.end
              )
            : undefined;
        if (directive?.literal === true) {
          const { session, root } = await openSession(document.uri, {
            includePaths: (uri) => includePathsOf(settings, uri),
          });
          const kind = /^[ \t]*!theme/.test(line) ? 'theme' : /^[ \t]*!includesub/.test(line) ? 'includesub' : 'include';
          const file = await session.load(directive.path, null, kind).catch(() => null);
          if (stale()) {
            return undefined;
          }
          const failure = session.failures.at(-1);
          const said =
            file !== null
              ? l10n.t('Reads {0}.', root === undefined ? basename(file.id) : relative(root, file.id).split(sep).join('/'))
              : l10n.t(
                  '{0} is not read. {1}',
                  directive.path,
                  failure === undefined
                    ? includeLabels(l10n).unreadable
                    : describeIncludeFailure(failure.reason, includeLabels(l10n), INCLUDE_EXTENSIONS, INCLUDE_LIMITS)
                );
          return hover([escapeMarkdown(said)], directive.start, directive.end);
        }

        const found = nameAt(where.source, where.line, column, { bare: where.bare, first: position.line - where.line });
        if (found !== null) {
          const read = await definitionsAt(document, found.diagram, found.cursor, token);
          if (read === undefined || stale()) {
            return undefined;
          }
          if (read !== null) {
            report(document, { reasons: read.reasons, cut: false });
            const entry = definitionsOfName(read.macros, found, line);
            if (entry !== null) {
              return hover(
                definitionSections(describeEntry(entry, read.labels), definitionsOf(entry, read.labels), l10n),
                found.start,
                found.end
              );
            }
          }
        }

        // A style item or a skinparam the completion offers, where no definition is.
        const setting =
          directive === undefined && styleHelpIn(document)
            ? settingAt(where.source, where.line, column, where.bare, styleNamesOf())
            : null;
        const help = setting === null ? null : settingHelp(setting, line, styleNamesOf(), l10n);
        if (setting !== null && help !== null) {
          return hover([helpMarkdown(help, l10n)], setting.start, setting.end);
        }

        if (directive === undefined) {
          return undefined;
        }
        const reason = directive.inBody
          ? l10n.t('It is read when the procedure or function it is written in runs.')
          : l10n.t('Its path is put together when the diagram is drawn.');
        return hover(
          [escapeMarkdown(l10n.t('{0} is not looked up here. {1}', directive.path, reason))],
          directive.start,
          directive.end
        );
      };

      registrations.own(
        vscode.languages.registerCompletionItemProvider(
          [{ language: 'markdown' }, { language: 'plantuml' }],
          { provideCompletionItems: provide },
          '@',
          '!',
          '&',
          ' ',
          '$'
        )
      );
      registrations.own(
        vscode.languages.registerSignatureHelpProvider(
          [{ language: 'markdown' }, { language: 'plantuml' }],
          { provideSignatureHelp: hints },
          { triggerCharacters: ['(', ','], retriggerCharacters: [')'] }
        )
      );
      registrations.own(
        vscode.languages.registerDefinitionProvider([{ language: 'markdown' }, { language: 'plantuml' }], {
          provideDefinition: definitionLinks,
        })
      );
      registrations.own(
        vscode.languages.registerReferenceProvider([{ language: 'markdown' }, { language: 'plantuml' }], {
          provideReferences: referenceLocations,
        })
      );
      registrations.own(
        vscode.languages.registerHoverProvider([{ language: 'markdown' }, { language: 'plantuml' }], {
          provideHover: hoverAt,
        })
      );
      // The files of the bundled libraries, as Go to Definition opens them:
      // read-only, as the extension bundles them.
      registrations.own(
        vscode.workspace.registerTextDocumentContentProvider(LIBRARY_SCHEME, {
          provideTextDocumentContent: async (uri) => {
            const file = libraryOfPath(uri.path);
            return file === null ? undefined : ((await libraryText(stdlib, file.library, file.key)) ?? undefined);
          },
        })
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.includePaths',
    inject: { settings: Settings.token },
    bind: ({ registrations }, { settings }): undefined => {
      // Going to the file a local include reads, and the names its path can
      // go on with (src/includes/editor.ts), for files on disk.
      const host = { includePaths: (document: vscode.Uri): unknown => includePathsOf(settings, document) };
      const selector = [
        { language: 'markdown', scheme: 'file' },
        { language: 'plantuml', scheme: 'file' },
      ];
      registrations.own(vscode.languages.registerDefinitionProvider(selector, includeDefinitions(host)));
      registrations.own(
        vscode.languages.registerCompletionItemProvider(selector, includeCompletions(host), ' ', '/', '\\')
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.folding',
    bind: ({ registrations }): undefined => {
      // Folding by syntax in PlantUML files (src/language/folding.ts). A
      // file in which none is found gets no list, which leaves it folding
      // by indentation. Markdown keeps its own folding.
      registrations.own(
        vscode.languages.registerFoldingRangeProvider(
          { language: 'plantuml' },
          {
            provideFoldingRanges: (document) => {
              const folds = foldingRanges(document.getText());
              if (folds.length === 0) {
                return undefined;
              }
              return folds.map(
                (fold) =>
                  new vscode.FoldingRange(
                    fold.start,
                    fold.end,
                    fold.comment ? vscode.FoldingRangeKind.Comment : undefined
                  )
              );
            },
          }
        )
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.symbols',
    bind: ({ registrations }): undefined => {
      // The diagrams of a PlantUML file and what they declare, for the
      // Outline, the breadcrumbs and Go to Symbol (src/language/symbols.ts).
      // Markdown keeps its own outline of headings.
      const kinds: Readonly<Record<string, vscode.SymbolKind>> = {
        diagram: vscode.SymbolKind.Module,
        package: vscode.SymbolKind.Package,
        namespace: vscode.SymbolKind.Namespace,
        class: vscode.SymbolKind.Class,
        abstract: vscode.SymbolKind.Class,
        interface: vscode.SymbolKind.Interface,
        annotation: vscode.SymbolKind.Interface,
        enum: vscode.SymbolKind.Enum,
      };
      const symbolOf = (document: vscode.TextDocument, declared: Declaration): vscode.DocumentSymbol => {
        const line = document.lineAt(declared.start);
        const symbol = new vscode.DocumentSymbol(
          declared.name,
          declared.detail,
          kinds[declared.keyword] ?? vscode.SymbolKind.Object,
          new vscode.Range(line.range.start, document.lineAt(declared.end).range.end),
          new vscode.Range(declared.start, line.firstNonWhitespaceCharacterIndex, declared.start, line.range.end.character)
        );
        symbol.children = declared.children.map((child) => symbolOf(document, child));
        return symbol;
      };
      registrations.own(
        vscode.languages.registerDocumentSymbolProvider(
          { language: 'plantuml' },
          {
            provideDocumentSymbols: (document) =>
              declarations(document.getText()).map((declared) => symbolOf(document, declared)),
          }
        )
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.workspaceSymbols',
    inject: { settings: Settings.token, l10n: Localization, notify: Notifications, commands: Commands },
    bind: ({ registrations, logger }, { settings, l10n, notify, commands }): undefined => {
      // Go to Symbol in Workspace over the diagrams and declarations of the
      // Markdown and PlantUML files in the workspace folders
      // (src/language/workspace-symbol-provider.ts): read when a query is
      // first typed, and again when the folders, the settings or the trust
      // change.
      const search = new WorkspaceSymbolSearch({
        l10n,
        log: (message: string): void => {
          logger.info(message);
        },
        warn: (message: string, buttons: readonly string[]): Promise<number | undefined> =>
          notify.warn(message, { actions: buttons.map((title, value) => ({ title, value })) }),
        openExcludeSetting: (): Promise<unknown> =>
          commands.execute('workbench.action.openSettings', `@id:${EXTENSION_ID}.${CONFIG.WORKSPACE_SYMBOLS_EXCLUDE}`),
        enabled: (folder: vscode.Uri): boolean =>
          settings.read({ resource: folder }).values[CONFIG.WORKSPACE_SYMBOLS_ENABLED] !== false,
        exclude: (folder: vscode.Uri): unknown => workspaceSymbolsExcludeOf(settings, folder),
      });
      registrations.own(search);
      registrations.own(vscode.languages.registerWorkspaceSymbolProvider(search));
      registrations.own(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          search.reset();
        })
      );
      registrations.own(
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
          search.reset();
        })
      );
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.workspaceSymbols`)) {
            search.reset();
          }
        })
      );
      return undefined;
    },
  });

  module.raw.register({
    id: 'plantuml.rename',
    inject: { settings: Settings.token, l10n: Localization },
    bind: ({ registrations }, { settings, l10n }): undefined => {
      // Rename Symbol on the alias of a sequence diagram's participant in a
      // Markdown block (src/language/alias-rename-provider.ts), on disk or
      // untitled. Registered by language as the Markdown rename is, so that
      // VS Code asks this one first. PlantUML files are left out: another
      // file can include one, and use its names.
      registrations.own(
        vscode.languages.registerRenameProvider(
          [
            { language: 'markdown', scheme: 'file' },
            { language: 'markdown', scheme: 'untitled' },
          ],
          new AliasRename({
            l10n,
            enabled: (document: vscode.Uri): boolean =>
              settings.read({ resource: document }).values[CONFIG.RENAME_ENABLED] !== false,
          })
        )
      );
      return undefined;
    },
  });

  module.commands.handle(InsertTemplate, async (context: OperationContext): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const languageId = editor?.document.languageId;
    if (editor === undefined || (languageId !== 'markdown' && languageId !== 'plantuml')) {
      void context.notify.warn(context.l10n.t('Open a Markdown or PlantUML file to insert a template.'));
      return;
    }
    const names = templateNames(context.l10n);
    const picked = await context.ask.one(
      TEMPLATES.map((template) => ({
        label: names[template.kind] ?? template.kind,
        description: `puml-${template.kind}`,
        template,
      })),
      { title: context.l10n.t('Insert Diagram Template') }
    );
    if (picked === undefined) {
      return;
    }
    const place = templatePlace(
      editor.document.getText(),
      editor.selection.active.line,
      languageId === 'plantuml',
      picked.template.kind,
      picked.template.diagram
    );
    if (place.kind === 'refused') {
      // Short enough for the one line a notification without a button shows.
      void context.notify.warn(
        place.reason === 'diagram'
          ? context.l10n.t('Templates cannot be inserted inside an existing diagram.')
          : context.l10n.t('Templates cannot be inserted in comments or other code blocks.')
      );
      return;
    }
    if (place.kind === 'after') {
      const answer = await context.notify.info(
        context.l10n.t('This code block already contains a diagram. Insert the template in a new code block below it?'),
        { modal: true, actions: [{ title: context.l10n.t('Insert Below'), value: 'after' as const }] }
      );
      if (answer !== 'after') {
        return;
      }
    }
    // One edit, which one Undo takes back, with the lines as they are.
    await editor.insertSnippet(new vscode.SnippetString(place.text), new vscode.Position(place.line, place.character), {
      undoStopBefore: true,
      undoStopAfter: true,
      keepWhitespace: true,
    });
  });

  module.services.singleton(Dependencies, {
    inject: {
      drawings: Drawings,
      renders: Renders,
      palettes: Palettes,
      settings: Settings.token,
      l10n: Localization,
      viewers: Viewers,
      libraries: Declarations,
    },
    create: ({ drawings, renders, palettes, settings, l10n, viewers, libraries }) => {
      const labels = problemLabels(l10n);
      return new DependencyView({
        records: drawings,
        includePaths: (document: vscode.Uri): unknown => includePathsOf(settings, document),
        diagrams: (document: vscode.TextDocument): ViewDiagram[] => viewDiagrams(document, labels, viewers, l10n),
        // As the Problems panel draws it, so that the drawing can be shared.
        draw: async (source: string, document: vscode.Uri): Promise<unknown> =>
          renders(source, await palettes.resolve(source, isDark(settings.read().values[CONFIG.THEME])), document.toString()),
        // Named as Go to Definition names the files it opens.
        libraryFile: (library: string, key: string): string | undefined => libraries.fileName(library, key),
        readLibrary: (library: string): Promise<unknown> => libraries.readNames(library),
        l10n,
      });
    },
  });

  module.raw.register({
    id: 'plantuml.dependencies',
    inject: { drawings: Drawings, watch: IncludeWatch, view: Dependencies },
    bind: ({ registrations }, { drawings, watch }): undefined => {
      // The view is made as the extension starts, so that VS Code finds it
      // whenever it is shown. What it lists goes out of date as the files
      // drawn change, and away as their documents close.
      registrations.own(
        watch.onDidChange((changes) => {
          drawings.changed(changes);
        })
      );
      registrations.own(
        vscode.workspace.onDidCloseTextDocument((document) => {
          drawings.forget(document.uri.toString());
        })
      );
      return undefined;
    },
  });

  module.commands.handle(ShowDependencies, {
    inject: { view: Dependencies },
    execute: async (_context: OperationContext, _args, { view }): Promise<void> => {
      await view.show();
    },
  });

  module.commands.handle(OpenDependency, {
    inject: { view: Dependencies },
    execute: async (context: OperationContext, args, { view }): Promise<void> => {
      const said = await view.open(args[0]);
      if (said !== undefined) {
        void context.notify.info(said);
      }
    },
  });

  module.commands.handle(GoToIncludeLine, {
    inject: { view: Dependencies },
    execute: async (context: OperationContext, args, { view }): Promise<void> => {
      const said = await view.goToInclude(args[0]);
      if (said !== undefined) {
        void context.notify.info(said);
      }
    },
  });

  module.commands.handle(GoToDiagram, async (context: OperationContext): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== 'markdown') {
      void context.notify.warn(context.l10n.t('Open a Markdown file to go to one of its diagrams.'));
      return;
    }
    const document = editor.document;
    const names = templateNames(context.l10n);
    // Each block as the list shows it: its name, its line and declared
    // kind, the heading above it and its title or first line, all of which
    // the filter reads. Nothing is drawn for it.
    const itemsOf = (): (vscode.QuickPickItem & { line: number })[] =>
      listDiagrams(document.getText()).map((entry) => ({
        label: entry.name ?? context.l10n.t('Diagram without a name'),
        description: [
          context.l10n.t('line {0}', String(entry.line + 1)),
          ...(entry.kind === null ? [] : [names[entry.kind] ?? entry.kind]),
        ].join(' · '),
        detail: [entry.heading, entry.title ?? entry.summary].filter((part): part is string => part !== null && part !== '').join(' › '),
        line: entry.line,
      }));
    let items = itemsOf();
    if (items.length === 0) {
      void context.notify.info(context.l10n.t('No diagrams found in this file.'));
      return;
    }

    const pick = vscode.window.createQuickPick<(typeof items)[number]>();
    pick.title = context.l10n.t('Go to Diagram in Document');
    pick.placeholder = context.l10n.t('Select a diagram to go to its source');
    pick.matchOnDescription = true;
    pick.matchOnDetail = true;
    pick.items = items;
    // The list is of the document as it was when it opened. Edited meanwhile,
    // the blocks may have moved: the list is read again, rather than a pick
    // from the old one taken to its old line.
    let version = document.version;
    const refresh = (): void => {
      items = itemsOf();
      version = document.version;
      pick.items = items;
    };
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        refresh();
      }
    });
    const chosen = await new Promise<{ line: number } | undefined>((resolve) => {
      pick.onDidAccept(() => {
        if (document.version !== version) {
          refresh();
          return;
        }
        resolve(pick.selectedItems[0]);
        pick.hide();
      });
      pick.onDidHide(() => resolve(undefined));
      pick.show();
    });
    changes.dispose();
    pick.dispose();
    if (chosen === undefined) {
      return;
    }
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(chosen.line, 0, chosen.line, 0) });
  });

  module.commands.handle(AssignDiagramName, async (context: OperationContext, args): Promise<void> => {
    const [uri, line, version] = args;
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri);
    if (document === undefined || typeof line !== 'number') {
      return;
    }
    // Offered on the document as it was then: edited since, the line may
    // start another diagram, or none.
    const unchanged = (): boolean => document.version === version;
    const plantUml = document.languageId === 'plantuml';
    const stale = (): void => {
      void context.notify.warn(context.l10n.t('The file has changed. Name the diagram again.'));
    };
    const target = unchanged()
      ? unnamedAt(document.getText(), line, plantUml, withoutExtension(fileNameOf(document)))
      : undefined;
    if (target === undefined) {
      stale();
      return;
    }

    const name = await context.ask.text({
      prompt:
        target.current === null
          ? context.l10n.t('Diagram name (used as the exported file name)')
          : context.l10n.t('New diagram name (replaces {0} and is used as the exported file name)', target.current),
      placeHolder: 'my-diagram',
      validate: (value: string) =>
        isValidBlockName(value)
          ? undefined
          : context.l10n.t(
              'Use 1–128 letters (A–Z, a–z), digits, hyphens, or underscores. Reserved file names such as CON are not allowed.'
            ),
    });
    if (name === undefined) {
      return;
    }
    const written = document.lineAt(line);
    const named = unchanged() ? withName(written.text, name, plantUml) : null;
    if (named === null) {
      stale();
      return;
    }
    // One edit to the line, so one Undo takes the name away again.
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, written.range, named);
    await vscode.workspace.applyEdit(edit);
  });

  module.commands.handle(AddMissingEnd, async (context: OperationContext, args): Promise<void> => {
    const [uri, line, version] = args;
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri);
    if (document === undefined || typeof line !== 'number') {
      return;
    }
    // Offered on the document as it was then: edited since, the diagram may
    // have its end line, or start on another line.
    const fix =
      document.version === version
        ? missingEndAt(document.getText(), line, document.languageId === 'plantuml', withoutExtension(fileNameOf(document)))
        : undefined;
    if (fix === undefined) {
      void context.notify.warn(context.l10n.t('The file has changed. Check the diagram again.'));
      return;
    }
    // One insertion after the diagram's last line, so one Undo takes it away.
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.lineAt(fix.afterLine).range.end, `${eol}${fix.prefix}${fix.end}`);
    await vscode.workspace.applyEdit(edit);
  });

  module.raw.register({
    id: 'plantuml.codeActions',
    inject: { l10n: Localization },
    bind: ({ registrations }, { l10n }): undefined => {
      // Offers a name to a diagram without a usable one
      // (src/language/code-actions.ts), on the line the name goes on only:
      // anywhere in the block, every unnamed diagram would show a light bulb.
      // And the end line a diagram lacks, on the problem that reports it.
      registrations.own(
        vscode.languages.registerCodeActionsProvider(
          [{ language: 'markdown' }, { language: 'plantuml' }],
          {
            provideCodeActions: (document, range, context) => {
              const line = range.start.line;
              const plantUml = document.languageId === 'plantuml';
              const fileName = withoutExtension(fileNameOf(document));
              const text = document.getText();
              const actions: vscode.CodeAction[] = [];
              if (namesDiagram(document.lineAt(line).text, plantUml) && unnamedAt(text, line, plantUml, fileName) !== undefined) {
                const action = new vscode.CodeAction(l10n.t('Name this diagram for export…'), vscode.CodeActionKind.QuickFix);
                action.command = {
                  title: action.title,
                  command: COMMANDS.ASSIGN_DIAGRAM_NAME,
                  arguments: [document.uri.toString(), line, document.version],
                };
                actions.push(action);
              }
              // Added by a command that reads the document again when the fix
              // runs: the fix was offered on the document as it was when the
              // problem was found.
              const offered = new Set<number>();
              for (const diagnostic of context.diagnostics) {
                const at = diagnostic.range.start.line;
                if (diagnostic.source !== EXTENSION_NAME || diagnostic.code !== PROBLEM_CODES.DOC002 || offered.has(at)) {
                  continue;
                }
                const fix = missingEndAt(text, at, plantUml, fileName);
                if (fix === undefined) {
                  continue;
                }
                offered.add(at);
                const action = new vscode.CodeAction(l10n.t('Add the missing {0} line', fix.end), vscode.CodeActionKind.QuickFix);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                action.command = {
                  title: action.title,
                  command: COMMANDS.ADD_MISSING_END,
                  arguments: [document.uri.toString(), at, document.version],
                };
                actions.push(action);
              }
              return actions.length > 0 ? actions : undefined;
            },
          },
          { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
      );
      return undefined;
    },
  });

  return undefined;
});

/**
 * VS Code reads `extendMarkdownIt` off whatever `activate` resolves to, so it
 * is declared rather than assembled by hand: the framework builds it last in
 * activation, from the same instance the clear-cache command and the theme
 * watcher got.
 */
const app = defineExtension({
  name: EXTENSION_NAME,
  modules: [plantuml],
  exports: {
    inject: { plugin: Plugin },
    create: ({ plugin }) => ({
      extendMarkdownIt: (md: MarkdownIt): MarkdownIt => plugin.extendMarkdownIt(md),
    }),
  },
});

export const activate = app.activate;

// The compiled plan, for tooling: `vscode-ext-kit plan` and `vscode-ext-kit
// manifest` read it off the built bundle, and a test can hand it to
// `createTestHost`. Data only — nothing callable is reachable through it.
export const plan = app.plan;
export const deactivate = app.deactivate;
