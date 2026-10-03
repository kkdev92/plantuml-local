import {
  Commands,
  Localization,
  Log,
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
import { join } from 'node:path';
import * as vscode from 'vscode';

import {
  COMMANDS,
  CONFIG,
  CONTEXT_KEYS,
  DEFAULT_EXPORT_DIRECTORY,
  DIAGNOSTICS_DEBOUNCE_MS,
  EXTENSION_ID,
  EXTENSION_NAME,
  PNG_PANEL_TYPE,
  REFRESH_DEBOUNCE_MS,
  SAVE_REFRESH_DELAY_MS,
  VIEWER_DEBOUNCE_MS,
  VIEWER_TYPE,
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
  writeDocuments,
  type DrawnDocument,
  type ExportFormat,
  type ExporterDeps,
  type ExportOutcome,
} from './export/exporter';
import { MAX_DOCUMENTS, findDocuments } from './export/folder';
import { isLastExport, withExport, type ExportRecords } from './export/ownership';
import { START, forEachCodeLine } from './core/shape';
import { lineAfterEdits, planReferenceEdits, type ReferenceEdit } from './export/references';
import {
  lineContext,
  mightSuggest,
  readCompletionData,
  suggest,
  suggestTemplates,
  TEMPLATES,
  type CompletionData,
  type Suggestions,
} from './language/completion';
import { templatePlace } from './language/templates';
import { namesDiagram, unnamedAt, withName } from './language/code-actions';
import { foldingRanges } from './language/folding';
import { declarations, type Declaration } from './language/symbols';
import {
  checkSource,
  renderProblems,
  type BlockProblem,
  type ProblemLabels,
  type RenderOutcome,
} from './diagnostics/problems';
import { createPlantUmlPlugin, type PlantUmlPlugin, type UpdateMode } from './preview/plugin';
import { RendererClient, defaultWorkerPath } from './render/client';
import { shareRenders, type SharedRender } from './render/memo';
import { ThemePalettes } from './render/palette';
import { DiagramViewer, viewerBody, type ToolbarLabels, type ViewerDeps } from './viewer/viewer';

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

/** The worker client. An object with `dispose`, so the container shuts it down. */
const Renderer: ServiceToken<RendererClient> = serviceToken<RendererClient>('plantuml.renderer');

/**
 * Which palette a themed diagram can be read in, measured once per set of
 * `!theme` lines and shared by the preview and the export commands.
 */
const Palettes: ServiceToken<ThemePalettes> = serviceToken<ThemePalettes>('plantuml.palettes');

/** Renders shared by the preview and the diagnostics, so a diagram both need is drawn once. */
const Renders: ServiceToken<SharedRender> = serviceToken<SharedRender>('plantuml.renders');

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
  const inside = text.startsWith(container) ? container.length : 0;
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
 * A Markdown document that is a file, or will be one once saved. A
 * notebook's Markdown cells and the read-only side of a diff are Markdown
 * documents too, but there is nowhere to export beside them, and their
 * problems are not the user's to fix there.
 */
function isMarkdownFile(document: vscode.TextDocument): boolean {
  return (
    document.languageId === 'markdown' &&
    (document.isUntitled || vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === true)
  );
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
    void context.notify.warn(context.l10n.t('Open a Markdown file first.'));
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
    title: context.l10n.t('Choose the Markdown document to export from'),
  });
  return picked?.document ?? null;
}

/**
 * The document to export from, or null after explaining why there is
 * none: a Markdown document, or with `plantUml`, the PlantUML file in the
 * active editor.
 *
 * `vscode.window` rather than the kit's editor service because export
 * needs the document's own URI to resolve a relative directory against,
 * and the cursor's line number rather than its text.
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
    void context.notify.warn(
      context.l10n.t('Exporting needs a trusted workspace. The preview works either way.')
    );
    return null;
  }

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
  if (document.isUntitled) {
    // There is no folder to write beside.
    void context.notify.warn(context.l10n.t('Save the file before exporting.'));
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

/** How the settings accessor is seen by the helpers below. */
type SettingsReader = {
  read(scope?: { resource: vscode.Uri }): { values: Record<string, unknown> };
};

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
    void context.notify.error(
      problem === 'empty'
        ? context.l10n.t(
            'plantumlLocal.exportDirectory is empty. Set a folder relative to the document, such as images.'
          )
        : context.l10n.t('plantumlLocal.exportDirectory must be a relative path without "..": {0}', directory)
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
    ? l10n.t('Not updated: the diagram is drawn again when the file is saved.')
    : l10n.t('Not updated: run "PlantUML Local: Clear Render Cache and Re-render" to draw it again.');
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
            'Use up to 128 ASCII letters, digits, hyphens and underscores. Windows device names such as CON cannot be used.'
          ),
  });
  return name ?? null;
}

/** The reason given for a diagram the engine drew as an error. */
function engineErrorMessage(
  context: OperationContext,
  message: string,
  line: number | null
): string {
  return line === null
    ? context.l10n.t('PlantUML reported an error: {0}', message)
    : context.l10n.t('PlantUML reported an error at line {0}: {1}', String(line), message);
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
    return { ...failure, error: engineErrorMessage(context, blamed.message, line) };
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
  const closedError = (): Error => new Error(l10n.t('The PNG was not finished: its panel was closed.'));
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
      pending?.(new Error(l10n.t('The PNG could not be drawn: {0}', String(error))));
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
          finish(new Error(l10n.t('The PNG was not drawn within 30 seconds.')));
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
  const panel = openPngPanel(l10n, l10n.t('Drawing a PNG of {0}×{1} pixels…', String(width), String(height)));
  try {
    return await panel.draw(svg, width, height, background);
  } finally {
    panel.dispose();
  }
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
  return {
    render: (source, dark) => renderer.render(source, dark),
    resolvePalette: (source, dark) => palettes.resolve(source, dark),
    remoteReferenceMessage: context.l10n.t(
      'URL-based external references (!include, !theme) are not supported.'
    ),
    emojiUnavailableMessage: context.l10n.t(
      'Emoji (<:name:>) are not supported: the emoji images are not bundled.'
    ),
    invalidNameMessage: context.l10n.t(
      'Use up to 128 ASCII letters, digits, hyphens and underscores. Windows device names such as CON cannot be used.'
    ),
    severalDiagramsMessage: context.l10n.t(
      'This block holds more than one diagram, and only the first would be drawn. Give each diagram a block of its own.'
    ),
    pagesMessage: context.l10n.t(
      'Pages after newpage cannot be drawn, so only the first page would be. Give each page a block of its own.'
    ),
    engineErrorMessage: (message, line) => engineErrorMessage(context, message, line),
    pngTooLargeMessage: (width, height, fits) =>
      fits === null
        ? context.l10n.t(
            'The PNG would be {0}×{1} pixels, larger than a PNG is made (8192 a side, 16 million in all), even at a scale of 1. Export it as SVG instead.',
            String(width),
            String(height)
          )
        : context.l10n.t(
            'The PNG would be {0}×{1} pixels, larger than a PNG is made (8192 a side, 16 million in all). It fits at plantumlLocal.exportPngScale {2}.',
            String(width),
            String(height),
            String(fits)
          ),
    pngFailedMessage: context.l10n.t('The PNG could not be made as asked.'),
    sameFileMessage: context.l10n.t('Another diagram is exported to the same file.'),
    changedMessage: context.l10n.t('The file changed while the export was running, so it was left as it is.'),
    pngScale: (): number => {
      const scale = settings.read({ resource: document }).values[CONFIG.EXPORT_PNG_SCALE];
      return PNG_SCALES.includes(scale as 1 | 2 | 4) ? Number(scale) : 2;
    },
    toPng: (svg, width, height, background) => drawPng(context.l10n, svg, width, height, background),
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
          context.l10n.t('{0} is a folder, not a file.', workspace.relativePath(uri))
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
          context.logger.warn(`Could not record the export of ${path}: ${String(error)}`);
        });
      }
    },
    confirmReplace: (paths, canKeep): Promise<'replace' | 'keep' | undefined> => {
      const files = paths.map((path) => workspace.relativePath(vscode.Uri.parse(path)));
      const replace = { title: context.l10n.t('Replace'), value: 'replace' as const };
      const keep = { title: context.l10n.t('Keep Existing'), value: 'keep' as const };
      const actions = canKeep ? [replace, keep] : [replace];
      // VS Code adds a Cancel button to a modal, which answers undefined.
      if (files.length === 1) {
        return context.notify.warn(
          context.l10n.t('{0} already exists with different contents. Replace it?', files[0] ?? ''),
          { modal: true, actions }
        );
      }
      return context.notify.warn(
        context.l10n.t(
          '{0} files already exist with different contents. Replace them?',
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
 * One summary notification for a bulk export, warnings when warranted.
 * `unnamedDiagrams` says how many of the unnamed are diagrams of PlantUML
 * files, which are named differently.
 */
async function reportOutcome(
  context: OperationContext,
  outcome: ExportOutcome,
  extra: readonly string[],
  forceWarn: boolean,
  unnamedDiagrams = 0
): Promise<void> {
  const messages: string[] = [];
  if (outcome.written.length > 0) {
    messages.push(context.l10n.t('Exported {0} diagram(s)', String(outcome.written.length)));
  }
  messages.push(...extra);
  if (outcome.kept > 0) {
    messages.push(context.l10n.t('{0} existing file(s) kept', String(outcome.kept)));
  }
  if (outcome.failed.length > 0) {
    messages.push(context.l10n.t('{0} failed', String(outcome.failed.length)));
    for (const failure of outcome.failed) {
      context.logger.warn(`Export failed for ${failure.name}: ${String(failure.error)}`);
    }
  }
  // Naming is what keeps a file tied to its block across edits; a
  // positional name would move the moment a block is inserted above.
  const unnamedBlocks = outcome.unnamed - unnamedDiagrams;
  if (unnamedBlocks > 0) {
    messages.push(
      context.l10n.t('{0} unnamed block(s) skipped — name one with ```plantuml my-diagram', String(unnamedBlocks))
    );
  }
  if (unnamedDiagrams > 0) {
    messages.push(
      context.l10n.t(
        '{0} unnamed diagram(s) skipped — name one with @startuml(id=my-diagram)',
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
    forceWarn || outcome.failed.length > 0 || outcome.unnamed > 0,
    outcome.written[0]?.path ?? undefined
  );
}

/**
 * Shows how an export went, with a button that selects `written`, a file
 * it wrote, in the Explorer view.
 */
async function announceExport(
  context: OperationContext,
  message: string,
  warn: boolean,
  written: string | undefined
): Promise<void> {
  if (written === undefined) {
    await (warn ? context.notify.warn(message) : context.notify.info(message));
    return;
  }
  const reveal = { title: context.l10n.t('Reveal in Explorer View'), value: 'reveal' as const };
  const choice = await (warn
    ? context.notify.warn(message, { actions: [reveal] })
    : context.notify.info(message, { actions: [reveal] }));
  if (choice === 'reveal') {
    await context.commands.execute('revealInExplorer', vscode.Uri.parse(written));
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
    void context.notify.warn(context.l10n.t('Choose a folder in the workspace.'));
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
    // A PlantUML file without a start line is lines to include, not a diagram.
    let diagram = false;
    forEachCodeLine(text, (line) => {
      diagram ||= START.test(line);
    });
    const name = withoutExtension(uri.path.slice(uri.path.lastIndexOf('/') + 1));
    const blocks = !document.plantUml ? findPlantUmlBlocks(text) : diagram ? findFileDiagrams(text, name) : [];
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
    inject: { logger: Log, settings: Settings.token },
    create: ({ logger, settings }) =>
      new RendererClient(
        defaultWorkerPath(),
        // plantumlLocal.logLevel can only make the channel quieter: VS Code
        // owns the channel's level, and an extension cannot raise it. Read on
        // every entry, so a change applies without a reload.
        filterLogger(logger, () => settings.read().values[CONFIG.LOG_LEVEL])
      ),
  });

  module.services.singleton(Palettes, {
    inject: { renderer: Renderer },
    create: ({ renderer }) => new ThemePalettes((source, dark) => renderer.render(source, dark)),
  });

  module.services.singleton(Renders, {
    inject: { renderer: Renderer },
    create: ({ renderer }) => shareRenders((source, dark) => renderer.render(source, dark)),
  });

  module.services.singleton(RequestRefresh, {
    inject: { commands: Commands },
    create: ({ commands }) =>
      debounce(() => {
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
        resolvePalette: (source, dark) => palettes.resolve(source, dark),
        requestRefresh,
        escapeHtml,
        hideExportedImages: () => settings.read().values[CONFIG.HIDE_EXPORTED_IMAGES],
        updateMode: (document) => updateModeOf(settings, vscode.Uri.parse(document)),
        log: filterLogger(logger, () => settings.read().values[CONFIG.LOG_LEVEL]),
        labels: {
          loading: l10n.t('Rendering diagram…'),
          failedTitle: l10n.t('Failed to render diagram'),
          emptySource: l10n.t('The PlantUML source is empty.'),
          remoteReference: l10n.t(
            'URL-based external references (!include, !theme) are not supported.'
          ),
          emojiUnavailable: l10n.t(
            'Emoji (<:name:>) are not supported: the emoji images are not bundled.'
          ),
          severalDiagrams: l10n.t(
            'This block holds more than one diagram, and only the first would be drawn. Give each diagram a block of its own.'
          ),
          pages: l10n.t(
            'Pages after newpage cannot be drawn, so only the first page would be. Give each page a block of its own.'
          ),
          missingEnd: (end) =>
            l10n.t('This diagram has no {0} line; it is drawn as if the block ended with one.', end),
          notUpdated: (mode) => notUpdatedNote(l10n, mode),
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
        resolvePalette: (source, dark) => palettes.resolve(source, dark),
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        exportPng: async (uri, line): Promise<void> => {
          await commands.invoke(ExportPng, { uri, line });
        },
        labels: {
          diagram: (position) => l10n.t('Diagram {0}', String(position)),
          entry: (name, line) => l10n.t('{0} (line {1})', name, String(line)),
          rendering: l10n.t('Rendering diagram…'),
          gone: l10n.t('The diagram shown is no longer in the file. Choose another.'),
          choose: l10n.t('Choose a diagram in the list.'),
          empty: l10n.t('The file holds no diagram.'),
          remoteReference: l10n.t(
            'URL-based external references (!include, !theme) are not supported.'
          ),
          emojiUnavailable: l10n.t(
            'Emoji (<:name:>) are not supported: the emoji images are not bundled.'
          ),
          pages: l10n.t(
            'Pages after newpage cannot be drawn, so only the first page would be. Give each page a diagram of its own.'
          ),
          engineError: (message, line) =>
            line === null
              ? l10n.t('PlantUML reported an error: {0}', message)
              : l10n.t('PlantUML reported an error at line {0}: {1}', String(line), message),
        },
      };
      const open = new Map<string, { viewer: DiagramViewer; document: vscode.TextDocument; reveal(): void }>();
      const media = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', 'media', 'viewer');
      const toolbar: ToolbarLabels = {
        toolbar: l10n.t('Zoom'),
        zoomOut: l10n.t('Zoom Out'),
        zoomIn: l10n.t('Zoom In'),
        fit: l10n.t('Fit'),
        actualSize: l10n.t('Actual Size'),
        exportPng: l10n.t('Export Diagram as PNG'),
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
          scripts: [panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.js')).toString()],
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
        panel.webview.onDidReceiveMessage((message: unknown) => {
          void viewer.receive(message, entry.document.getText());
        });
        panel.onDidDispose(() => {
          open.delete(key);
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
            l10n.t('Preview {0}', fileNameOf(document)),
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
      context.logger.info('Render cache cleared');
      await context.notify.info(context.l10n.t('PlantUML render cache cleared.'));
    },
  });

  /** Opens the viewer for the PlantUML file in the editor, in `column`. */
  const openPreview =
    (column: number) =>
    async (context: OperationContext, _args: readonly [], { viewers }: { viewers: ViewerSet }): Promise<void> => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId !== 'plantuml') {
        await context.notify.warn(context.l10n.t('Open a PlantUML file first.'));
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

      const blocks = diagramsOf(document.textDocument, document.text);
      // The block under the cursor, or the only block when there is nothing
      // to choose between — a document picked from a list has no cursor.
      const atCursor = document.line === null ? null : blockAtLine(blocks, document.line);
      const block = atCursor ?? (blocks.length === 1 ? (blocks[0] ?? null) : null);
      if (block === null) {
        await context.notify.warn(
          document.textDocument.languageId === 'plantuml'
            ? context.l10n.t('Put the cursor inside a diagram first.')
            : context.l10n.t('Put the cursor inside a ```plantuml block first.')
        );
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
      const result =
        format === 'svg'
          ? await exportOne(deps, document.path, directory, block, name)
          : await context.progress.run({ title: context.l10n.t('Exporting PNG…') }, () =>
              exportOne(deps, document.path, directory, block, name, 'png')
            );

      if (result === null) {
        return;
      }
      if (result.error !== null) {
        context.logger.warn(`Export failed: ${result.error}`);
        await context.notify.error(context.l10n.t('Could not export the diagram: {0}', result.error));
        return;
      }
      context.logger.info(`Exported ${String(result.path)}`);
      // The file as the Explorer names it, rather than its encoded URI.
      const written = workspace.relativePath(vscode.Uri.parse(String(result.path)));
      await announceExport(context, context.l10n.t('Exported {0}', written), false, result.path ?? undefined);
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
        document.textDocument.languageId === 'plantuml' ? outcome.unnamed : 0
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
          [context.l10n.t('The document changed during the export, so the references were not updated')],
          true
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
          extra.push(context.l10n.t('References are up to date'));
        }
      } else if (await applyReferenceEdits(document.textDocument, edits)) {
        const inserted = edits.filter((edit) => edit.kind === 'insert-after').length;
        const updated = edits.length - inserted;
        if (inserted > 0) {
          extra.push(context.l10n.t('{0} reference(s) inserted', String(inserted)));
        }
        if (updated > 0) {
          extra.push(context.l10n.t('{0} reference(s) updated', String(updated)));
        }
        reported = relocateEngineErrors(context, outcome, edits);
      } else {
        applyFailed = true;
        extra.push(context.l10n.t('Could not update the references'));
      }

      await reportOutcome(context, reported, extra, applyFailed);
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
        void context.notify.warn(
          context.l10n.t('Exporting needs a trusted workspace. The preview works either way.')
        );
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
      // Part of a folder is never exported as if it were the whole.
      if (sources === null) {
        void context.notify.warn(
          context.l10n.t('{0} holds more than {1} documents. Export a folder inside it.', where, String(MAX_DOCUMENTS))
        );
        return;
      }
      const named = sources.reduce((sum, source) => sum + source.blocks.filter((block) => block.name !== null).length, 0);
      if (named > MAX_FOLDER_DIAGRAMS) {
        void context.notify.warn(
          context.l10n.t(
            '{0} holds more than {1} named diagrams. Export a folder inside it.',
            where,
            String(MAX_FOLDER_DIAGRAMS)
          )
        );
        return;
      }
      if (named === 0) {
        const unnamed = sources.reduce((sum, source) => sum + source.blocks.length, 0);
        await reportOutcome(context, { written: [], failed: [], unnamed, kept: 0 }, [], false, unnamedDiagrams(sources));
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
        context.l10n.t(
          'Export {0} named diagram(s) from {1} document(s) in {2}?',
          String(named),
          String(planned.length),
          where
        ),
        {
          modal: true,
          detail: listed.join('\n'),
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
          const pngs = lazyPngPanel(context.l10n, context.l10n.t('Drawing PNGs…'));
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
      await reportOutcome(context, outcome, [], false, unnamedDiagrams(sources));
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
    inject: { plugin: Plugin, requestRefresh: RequestRefresh, settings: Settings.token },
    bind: ({ registrations, logger }, { plugin, requestRefresh, settings }): undefined => {
      // A colour-theme flip and a `theme` change both invalidate every cached
      // SVG: the palette is baked into the rendered output rather than applied
      // by CSS afterwards.
      registrations.own(
        vscode.window.onDidChangeActiveColorTheme(() => {
          logger.debug('Colour theme changed; re-rendering diagrams');
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
    inject: { renders: Renders, palettes: Palettes, settings: Settings.token, l10n: Localization },
    bind: ({ registrations, logger }, { renders, palettes, settings, l10n }): undefined => {
      // Puts the problems of the diagrams in open Markdown documents in the
      // Problems panel, whether or not a preview is open. Renders are shared
      // with the preview, so a document shown in both is drawn once.
      const collection = registrations.own(vscode.languages.createDiagnosticCollection(EXTENSION_ID));
      const labels: ProblemLabels = {
        remoteReference: l10n.t('URL-based external references (!include, !theme) are not supported.'),
        severalDiagrams: l10n.t(
          'This block holds more than one diagram, and only the first would be drawn. Give each diagram a block of its own.'
        ),
        pages: l10n.t(
          'Pages after newpage cannot be drawn, so only the first page would be. Give each page a block of its own.'
        ),
        missingEnd: (end) =>
          l10n.t('This diagram has no {0} line; it is drawn as if the block ended with one.', end),
        includesub: l10n.t('!includesub is not supported: the engine ignores it, so nothing is included.'),
        localFile: l10n.t('the bundled engine reads no files.'),
        themeFrom: l10n.t('only the bundled themes can be loaded.'),
        libraryNotBundled: (library) =>
          l10n.t('The {0} standard library is not bundled; only azure is.', library),
        emojiUnavailable: l10n.t('Emoji (<:name:>) are not supported: the emoji images are not bundled.'),
        tooLarge: l10n.t('The diagram is larger than the engine draws.'),
      };
      const timers = new Map<string, NodeJS.Timeout>();
      // Bumped on every change, so a check that finishes after the text moved
      // on does not bring back what it found in the old text.
      const generations = new Map<string, number>();

      const enabled = (document: vscode.TextDocument): boolean =>
        settings.read({ resource: document.uri }).values[CONFIG.DIAGNOSTICS_ENABLED] !== false;

      const outcomeOf = async (source: string): Promise<RenderOutcome> => {
        try {
          const dark = await palettes.resolve(source, isDark(settings.read().values[CONFIG.THEME]));
          return { svg: await renders(source, dark) };
        } catch (error: unknown) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      };

      const diagnose = async (document: vscode.TextDocument, generation: number): Promise<void> => {
        const key = document.uri.toString();
        const text = document.getText();
        const lines = text.split(/\r\n|\r|\n/);
        const found: vscode.Diagnostic[] = [];
        for (const block of findPlantUmlBlocks(text)) {
          const check = checkSource(block, labels);
          const problems = [...check.problems];
          if (check.render !== null) {
            const outcome = await outcomeOf(check.render);
            if (generations.get(key) !== generation) {
              return;
            }
            problems.push(...renderProblems(block, check, outcome, labels));
          }
          found.push(...problems.map((problem) => toDiagnostic(problem, lines, block.container)));
        }
        if (generations.get(key) === generation) {
          collection.set(document.uri, found);
        }
      };

      const schedule = (document: vscode.TextDocument, delay: number): void => {
        if (!isMarkdownFile(document)) {
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
              logger.warn(`Checking ${key} failed: ${String(error)}`);
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
      };

      registrations.own(
        vscode.workspace.onDidOpenTextDocument((document) => {
          schedule(document, 0);
        })
      );
      registrations.own(
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.contentChanges.length === 0 || !isMarkdownFile(event.document)) {
            return;
          }
          // What was found describes text that is gone; it must not stay up
          // until the next check finishes.
          collection.delete(event.document.uri);
          schedule(event.document, DIAGNOSTICS_DEBOUNCE_MS);
        })
      );
      registrations.own(vscode.workspace.onDidCloseTextDocument(forget));
      registrations.own(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.DIAGNOSTICS_ENABLED}`)) {
            for (const document of vscode.workspace.textDocuments) {
              schedule(document, 0);
            }
          }
        })
      );
      for (const document of vscode.workspace.textDocuments) {
        schedule(document, 0);
      }

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
    inject: { l10n: Localization },
    bind: ({ registrations }, { l10n }): undefined => {
      // Suggestions in the diagrams of Markdown documents and PlantUML files
      // (src/language/completion.ts). Markdown turns quick suggestions off,
      // so there they open on the characters a suggestion starts after.
      let data: CompletionData | undefined;
      let scanned = '';
      let blocks: readonly PlantUmlBlock[] = [];
      const names = templateNames(l10n);

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

        const stamp = `${document.uri.toString()}#${String(document.version)}`;
        if (stamp !== scanned) {
          blocks = findPlantUmlBlocks(document.getText());
          scanned = stamp;
        }
        const block = blocks.find(
          (candidate) =>
            position.line > candidate.openLine &&
            (position.line < candidate.closeLine ||
              (!candidate.closed && position.line === candidate.closeLine))
        );
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

      /** Suggestions on a diagram line: templates only where a diagram can start. */
      const inDiagram = (before: string, after: string, open: string | null): Suggestions | null => {
        data ??= readCompletionData(
          readFileSync(join(__dirname, 'engine', 'themes.cjs'), 'utf8'),
          readFileSync(join(__dirname, 'engine', 'openiconic.cjs'), 'utf8')
        );
        return (
          suggest(before, after, open, data) ??
          (open === null ? suggestTemplates(before, after, false, names) : null)
        );
      };

      const provide = (
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] | undefined => {
        const text = document.lineAt(position.line).text;
        if (!mightSuggest(text.slice(0, position.character))) {
          return undefined;
        }
        const { found, offset } = find(document, position, text);
        if (found === null) {
          return undefined;
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

      registrations.own(
        vscode.languages.registerCompletionItemProvider(
          [{ language: 'markdown' }, { language: 'plantuml' }],
          { provideCompletionItems: provide },
          '@',
          '!',
          '&',
          ' '
        )
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

  module.commands.handle(InsertTemplate, async (context: OperationContext): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const languageId = editor?.document.languageId;
    if (editor === undefined || (languageId !== 'markdown' && languageId !== 'plantuml')) {
      void context.notify.warn(context.l10n.t('Open a Markdown or PlantUML file to insert a template into.'));
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
      void context.notify.warn(
        place.reason === 'diagram'
          ? context.l10n.t('The cursor is in a diagram. A template is a whole diagram: put the cursor outside one.')
          : context.l10n.t(
              'A diagram cannot start here: put the cursor in the text of the document, not in a comment or in a block of another language.'
            )
      );
      return;
    }
    if (place.kind === 'after') {
      const answer = await context.notify.info(
        context.l10n.t('This block already holds a diagram. Insert the template as a new block after it?'),
        { modal: true, actions: [{ title: context.l10n.t('Insert After It'), value: 'after' as const }] }
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
      void context.notify.warn(context.l10n.t('The document changed. Name the diagram again from its line.'));
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
          ? context.l10n.t('Name for the diagram, which its exported files take')
          : context.l10n.t('Name for the diagram, in place of {0}', target.current),
      placeHolder: 'my-diagram',
      validate: (value: string) =>
        isValidBlockName(value)
          ? undefined
          : context.l10n.t(
              'Use up to 128 ASCII letters, digits, hyphens and underscores. Windows device names such as CON cannot be used.'
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

  module.raw.register({
    id: 'plantuml.codeActions',
    inject: { l10n: Localization },
    bind: ({ registrations }, { l10n }): undefined => {
      // Offers a name to a diagram without a usable one
      // (src/language/code-actions.ts), on the line the name goes on only:
      // anywhere in the block, every unnamed diagram would show a light bulb.
      registrations.own(
        vscode.languages.registerCodeActionsProvider(
          [{ language: 'markdown' }, { language: 'plantuml' }],
          {
            provideCodeActions: (document, range) => {
              const line = range.start.line;
              const plantUml = document.languageId === 'plantuml';
              if (
                !namesDiagram(document.lineAt(line).text, plantUml) ||
                unnamedAt(document.getText(), line, plantUml, withoutExtension(fileNameOf(document))) === undefined
              ) {
                return undefined;
              }
              const action = new vscode.CodeAction(l10n.t('Name this diagram for export…'), vscode.CodeActionKind.QuickFix);
              action.command = {
                title: action.title,
                command: COMMANDS.ASSIGN_DIAGRAM_NAME,
                arguments: [document.uri.toString(), line, document.version],
              };
              return [action];
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
