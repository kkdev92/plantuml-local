import {
  Localization,
  Log,
  Webviews,
  createWebviewHtml,
  debounce,
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  escapeHtml,
  generateCSP,
  generateNonce,
  serviceToken,
  setting,
  type OperationContext,
  type ServiceToken,
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
  REFRESH_DEBOUNCE_MS,
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
  exportAll,
  exportOne,
  isValidExportDirectory,
  type ExporterDeps,
  type ExportOutcome,
} from './export/exporter';
import { lineAfterEdits, planReferenceEdits, type ReferenceEdit } from './export/references';
import {
  lineContext,
  mightSuggest,
  readCompletionData,
  suggest,
  suggestTemplates,
  type CompletionData,
  type Suggestions,
} from './language/completion';
import {
  checkSource,
  renderProblems,
  type BlockProblem,
  type ProblemLabels,
  type RenderOutcome,
} from './diagnostics/problems';
import { createPlantUmlPlugin, type PlantUmlPlugin } from './preview/plugin';
import type { RenderLog } from './core/types';
import { RendererClient, defaultWorkerPath } from './render/client';
import { shareRenders, type SharedRender } from './render/memo';
import { ThemePalettes } from './render/palette';
import { DiagramViewer, VIEWER_BODY, type ViewerDeps } from './viewer/viewer';

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
const Settings = defineSettings({
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
    [CONFIG.HIDE_EXPORTED_IMAGES]: setting.boolean({ default: true }),
    // Resource-scoped: the diagnostics read it per document instead.
    [CONFIG.DIAGNOSTICS_ENABLED]: setting.boolean({ default: true }),
  },
});

/** Clears the render cache so every diagram on the page is drawn again. */
export const ClearCache = defineCommandContract<readonly [], void>({
  id: COMMANDS.CLEAR_CACHE,
});

/** Writes the diagram under the cursor to an SVG file. */
export const ExportSvg = defineCommandContract<readonly [], void>({
  id: COMMANDS.EXPORT_SVG,
});

/** Writes every named diagram in the active document to SVG files. */
export const ExportAllSvg = defineCommandContract<readonly [], void>({
  id: COMMANDS.EXPORT_ALL_SVG,
});

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
 * hosted service below cancels it instead.
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
  /** Draws again what a viewer of `document` shows, after the file changed. */
  update(document: vscode.TextDocument): void;
  /** Draws every viewer again, after the palette changed. */
  updateAll(): void;
}
const Viewers: ServiceToken<ViewerSet> = serviceToken<ViewerSet>('plantuml.viewers');

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
const SEVERITY: Record<Level, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

/**
 * Applies `plantumlLocal.logLevel` on top of the channel's own level.
 *
 * The framework logs into a `LogOutputChannel`, which VS Code filters by the
 * level chosen in the Output panel — and an extension cannot raise its own
 * channel's level. So this setting can make the log quieter but can no longer
 * turn on output VS Code is already dropping, which is what it did when the
 * extension owned a plain channel. It is kept because "warnings and worse" is
 * still a thing to ask for; `Developer: Set Log Level` is what turns `debug`
 * back on, and that choice is per channel and survives a restart.
 */
function filtered(logger: RenderLog, level: Level): RenderLog {
  if (level === 'trace') {
    return logger;
  }
  const floor = SEVERITY[level];
  return {
    debug: (message): void => {
      if (SEVERITY.debug >= floor) {
        logger.debug(message);
      }
    },
    warn: (message): void => {
      if (SEVERITY.warn >= floor) {
        logger.warn(message);
      }
    },
    error: (message): void => {
      if (SEVERITY.error >= floor) {
        logger.error(message);
      }
    },
  };
}

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
  context: OperationContext
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
  ].map((document) => ({ label: vscode.workspace.asRelativePath(document.uri), document }));
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
  plantUml: boolean
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
    plantUml && active?.languageId === 'plantuml' ? active : await chooseMarkdownDocument(context);
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
    line: editor?.selection.active.line ?? null,
    textDocument: document,
    version: document.version,
  };
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
  if (!isValidExportDirectory(directory)) {
    void context.notify.error(
      context.l10n.t(
        'plantumlLocal.exportDirectory must be a relative path without "..": {0}',
        directory
      )
    );
    return null;
  }
  return directory;
}

/** Prompts for a file name for a block that does not carry one. */
async function askForName(context: OperationContext): Promise<string | null> {
  const name = await context.ask.text({
    prompt: context.l10n.t('File name for the exported SVG (without .svg)'),
    placeHolder: 'my-diagram',
    validate: (value: string) =>
      isValidBlockName(value)
        ? undefined
        : context.l10n.t('Use up to 128 letters, digits, hyphens and underscores.'),
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
      'Use up to 128 letters, digits, hyphens and underscores.'
    ),
    severalDiagramsMessage: context.l10n.t(
      'This block holds more than one diagram, and only the first would be drawn. Give each diagram a block of its own.'
    ),
    pagesMessage: context.l10n.t(
      'Pages after newpage cannot be drawn, so only the first page would be. Give each page a block of its own.'
    ),
    engineErrorMessage: (message, line) => engineErrorMessage(context, message, line),
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
    readExisting: async (path): Promise<string | null> => {
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
          context.l10n.t('{0} is a folder, not a file.', vscode.workspace.asRelativePath(uri))
        );
      }
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    },
    confirmReplace: (paths, canKeep): Promise<'replace' | 'keep' | undefined> => {
      const files = paths.map((path) => vscode.workspace.asRelativePath(vscode.Uri.parse(path)));
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
        await vscode.workspace.fs.writeFile(temporary, new TextEncoder().encode(content));
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
  document: ActiveDocument,
  directory: string
): Promise<ExportOutcome | null> {
  return context.progress.run({ title: context.l10n.t('Exporting diagrams…') }, (report) =>
    exportAll(
      exporterDeps(context, renderer, palettes, settings, document.textDocument.uri),
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
 * `plantUml` says the document was a PlantUML file, which names its
 * diagrams differently.
 */
async function reportOutcome(
  context: OperationContext,
  outcome: ExportOutcome,
  extra: readonly string[],
  forceWarn: boolean,
  plantUml = false
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
  if (outcome.unnamed > 0) {
    // Naming is what keeps a file tied to its block across edits; a
    // positional name would move the moment a block is inserted above.
    messages.push(
      plantUml
        ? context.l10n.t(
            '{0} unnamed diagram(s) skipped — name one with @startuml(id=my-diagram)',
            String(outcome.unnamed)
          )
        : context.l10n.t(
            '{0} unnamed block(s) skipped — name one with ```plantuml my-diagram',
            String(outcome.unnamed)
          )
    );
  }
  if (messages.length === 0) {
    await context.notify.info(context.l10n.t('No diagrams to export.'));
    return;
  }

  const summary = messages.join(' · ');
  context.logger.info(summary);
  if (forceWarn || outcome.failed.length > 0 || outcome.unnamed > 0) {
    await context.notify.warn(summary);
  } else {
    await context.notify.info(summary);
  }
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

  module.services.singleton(Renderer, {
    inject: { logger: Log, settings: Settings.token },
    create: ({ logger, settings }) =>
      new RendererClient(
        defaultWorkerPath(),
        filtered(logger, settings.read().values[CONFIG.LOG_LEVEL])
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

  module.services.singleton(RequestRefresh, () =>
    debounce(() => {
      void vscode.commands.executeCommand('markdown.preview.refresh');
    }, REFRESH_DEBOUNCE_MS)
  );

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
        log: filtered(logger, settings.read().values[CONFIG.LOG_LEVEL]),
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
        },
      }),
  });

  module.services.singleton(Viewers, {
    inject: {
      webviews: Webviews,
      renders: Renders,
      palettes: Palettes,
      l10n: Localization,
      settings: Settings.token,
    },
    create: ({ webviews, renders, palettes, l10n, settings }): ViewerSet => {
      const deps: ViewerDeps = {
        render: renders,
        resolvePalette: (source, dark) => palettes.resolve(source, dark),
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        labels: {
          diagram: (position) => l10n.t('Diagram {0}', String(position)),
          entry: (name, line) => l10n.t('{0} (line {1})', name, String(line)),
          rendering: l10n.t('Rendering diagram…'),
          gone: l10n.t('The diagram shown is no longer in the file. Choose another.'),
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

      return {
        open: (document, line, column): void => {
          const key = document.uri.toString();
          const existing = open.get(key);
          if (existing !== undefined) {
            existing.document = document;
            existing.reveal();
            void existing.viewer.show(document.getText(), line);
            return;
          }

          const name = fileNameOf(document);
          const panel = webviews.openPanel({
            viewType: VIEWER_TYPE,
            title: l10n.t('Preview {0}', name),
            column,
            enableScripts: true,
            enableForms: false,
            localResourceRoots: ['media/viewer'],
          });
          const nonce = generateNonce();
          panel.setHtml(
            createWebviewHtml({
              title: name,
              // Blob URLs are how the page shows the SVG, as an image.
              csp: generateCSP(panel, { nonce, imgSrc: ['blob:'] }),
              styles: [panel.asWebviewUri('media/viewer/viewer.css')],
              scripts: [panel.asWebviewUri('media/viewer/viewer.js')],
              nonce,
              body: VIEWER_BODY,
            })
          );
          const entry = {
            viewer: new DiagramViewer(panel, deps, withoutExtension(name)),
            document,
            reveal: (): void => {
              panel.reveal();
            },
          };
          // Drawn once the page asks, as it does each time it is created.
          entry.viewer.select(document.getText(), line);
          open.set(key, entry);
          panel.onMessage((message) => {
            void entry.viewer.receive(message, entry.document.getText());
          });
          panel.onDidDispose(() => {
            open.delete(key);
          });
        },
        update: (document): void => {
          const entry = open.get(document.uri.toString());
          if (entry !== undefined) {
            entry.document = document;
            void entry.viewer.update(document.getText());
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

  module.hostedServices.add({
    id: 'plantuml.viewerUpdates',
    inject: { viewers: Viewers },
    start: (context, { viewers }) => {
      // Draws a viewer again once its file has stopped changing, and every
      // viewer when the palette may have changed with the theme or setting.
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const changed = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId !== 'plantuml' || event.contentChanges.length === 0) {
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
      });
      const themed = vscode.window.onDidChangeActiveColorTheme(() => {
        viewers.updateAll();
      });
      const configured = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.THEME}`)) {
          viewers.updateAll();
        }
      });
      context.signal.addEventListener('abort', () => {
        changed.dispose();
        themed.dispose();
        configured.dispose();
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
      });
    },
  });

  module.commands.handle(ExportSvg, {
    inject: { renderer: Renderer, palettes: Palettes, settings: Settings.token },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings }
    ): Promise<void> => {
      const document = await activeDocument(context, true);
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
      const name = declared ?? (await askForName(context));
      if (name === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const result = await exportOne(
        exporterDeps(context, renderer, palettes, settings, document.textDocument.uri),
        document.path,
        directory,
        block,
        name
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
      await context.notify.info(context.l10n.t('Exported {0}', String(result.path)));
    },
  });

  module.commands.handle(ExportAllSvg, {
    inject: { renderer: Renderer, palettes: Palettes, settings: Settings.token },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings }
    ): Promise<void> => {
      const document = await activeDocument(context, true);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, document, directory);
      if (outcome === null) {
        return;
      }
      await reportOutcome(
        context,
        outcome,
        [],
        false,
        document.textDocument.languageId === 'plantuml'
      );
    },
  });

  module.commands.handle(ExportAllAndUpdateRefs, {
    inject: { renderer: Renderer, palettes: Palettes, settings: Settings.token },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings }
    ): Promise<void> => {
      const document = await activeDocument(context, false);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings, document.textDocument.uri);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, document, directory);
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

  module.hostedServices.add({
    id: 'plantuml.preview',
    inject: { plugin: Plugin, requestRefresh: RequestRefresh, settings: Settings.token },
    start: (context, { plugin, requestRefresh, settings }) => {
      // A colour-theme flip and a `theme` change both invalidate every cached
      // SVG: the palette is baked into the rendered output rather than applied
      // by CSS afterwards.
      const themeChanged = vscode.window.onDidChangeActiveColorTheme(() => {
        context.logger.debug('Colour theme changed; re-rendering diagrams');
        plugin.clearCache();
      });
      const settingChanged = settings.watch(CONFIG.THEME, undefined, () => {
        plugin.clearCache();
      });

      context.signal.addEventListener('abort', () => {
        themeChanged.dispose();
        settingChanged.dispose();
        // A pending refresh would fire into a preview that is going away.
        requestRefresh.cancel();
      });
    },
  });

  module.hostedServices.add({
    id: 'plantuml.diagnostics',
    inject: { renders: Renders, palettes: Palettes, settings: Settings.token, l10n: Localization },
    start: (context, { renders, palettes, settings, l10n }) => {
      // Puts the problems of the diagrams in open Markdown documents in the
      // Problems panel, whether or not a preview is open. Renders are shared
      // with the preview, so a document shown in both is drawn once.
      const collection = vscode.languages.createDiagnosticCollection(EXTENSION_ID);
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
        vscode.workspace
          .getConfiguration(EXTENSION_ID, document.uri)
          .get<boolean>(CONFIG.DIAGNOSTICS_ENABLED, true) !== false;

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
              context.logger.warn(`Checking ${key} failed: ${String(error)}`);
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

      const subscriptions = [
        vscode.workspace.onDidOpenTextDocument((document) => {
          schedule(document, 0);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.contentChanges.length === 0 || !isMarkdownFile(event.document)) {
            return;
          }
          // What was found describes text that is gone; it must not stay up
          // until the next check finishes.
          collection.delete(event.document.uri);
          schedule(event.document, DIAGNOSTICS_DEBOUNCE_MS);
        }),
        vscode.workspace.onDidCloseTextDocument(forget),
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.DIAGNOSTICS_ENABLED}`)) {
            for (const document of vscode.workspace.textDocuments) {
              schedule(document, 0);
            }
          }
        }),
      ];
      for (const document of vscode.workspace.textDocuments) {
        schedule(document, 0);
      }

      context.signal.addEventListener('abort', () => {
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
        collection.dispose();
      });
    },
  });

  module.hostedServices.add({
    id: 'plantuml.exportMenu',
    start: (context) => {
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
          void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.HAS_DIAGRAMS, hasDiagrams);
        }
        if (inDiagram !== state.inDiagram) {
          state.inDiagram = inDiagram;
          void vscode.commands.executeCommand(
            'setContext',
            CONTEXT_KEYS.CURSOR_IN_DIAGRAM,
            inDiagram
          );
        }
      };

      const selectionChanged = vscode.window.onDidChangeTextEditorSelection((event) => {
        update(event.textEditor);
      });
      const editorChanged = vscode.window.onDidChangeActiveTextEditor((editor) => {
        update(editor);
      });
      update(vscode.window.activeTextEditor);

      context.signal.addEventListener('abort', () => {
        selectionChanged.dispose();
        editorChanged.dispose();
      });
    },
  });

  module.hostedServices.add({
    id: 'plantuml.completion',
    inject: { l10n: Localization },
    start: (context, { l10n }) => {
      // Suggestions in the diagrams of Markdown documents and PlantUML files
      // (src/language/completion.ts). Markdown turns quick suggestions off,
      // so there they open on the characters a suggestion starts after.
      let data: CompletionData | undefined;
      let scanned = '';
      let blocks: readonly PlantUmlBlock[] = [];
      const templateNames: Record<string, string> = {
        sequence: l10n.t('Sequence diagram'),
        class: l10n.t('Class diagram'),
        activity: l10n.t('Activity diagram'),
        state: l10n.t('State diagram'),
        component: l10n.t('Component diagram'),
        usecase: l10n.t('Use case diagram'),
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
          return { found: fits ? suggestTemplates(before, after, true, templateNames) : null, offset: 0 };
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
          (open === null ? suggestTemplates(before, after, false, templateNames) : null)
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

      const registration = vscode.languages.registerCompletionItemProvider(
        [{ language: 'markdown' }, { language: 'plantuml' }],
        { provideCompletionItems: provide },
        '@',
        '!',
        '&',
        ' '
      );
      context.signal.addEventListener('abort', () => {
        registration.dispose();
      });
    },
  });

  return undefined;
});

/**
 * VS Code reads `extendMarkdownIt` off whatever `activate` resolves to, so it
 * is declared rather than assembled by hand: the framework builds it after the
 * hosted services have started — the earliest point the plugin exists — from
 * the same instance the clear-cache command and the theme watcher got.
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
