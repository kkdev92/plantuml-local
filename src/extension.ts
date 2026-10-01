import {
  Localization,
  Log,
  debounce,
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  escapeHtml,
  serviceToken,
  setting,
  type OperationContext,
  type ServiceToken,
} from '@kkdev92/vscode-ext-kit';
import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';

import {
  COMMANDS,
  CONFIG,
  CONTEXT_KEYS,
  DEFAULT_EXPORT_DIRECTORY,
  EXTENSION_ID,
  EXTENSION_NAME,
  REFRESH_DEBOUNCE_MS,
} from './core/constants';
import {
  blockAtLine,
  findPlantUmlBlocks,
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
import { createPlantUmlPlugin, type PlantUmlPlugin } from './preview/plugin';
import type { RenderLog } from './core/types';
import { RendererClient, defaultWorkerPath } from './render/client';
import { ThemePalettes } from './render/palette';

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
    [CONFIG.EXPORT_DIRECTORY]: setting.string({ default: DEFAULT_EXPORT_DIRECTORY }),
    [CONFIG.EXPORT_THEME]: setting.enum({ values: ['light', 'dark', 'preview'], default: 'light' }),
    [CONFIG.HIDE_EXPORTED_IMAGES]: setting.boolean({ default: true }),
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

/** The worker client. An object with `dispose`, so the container shuts it down. */
const Renderer: ServiceToken<RendererClient> = serviceToken<RendererClient>('plantuml.renderer');

/**
 * Which palette a themed diagram can be read in, measured once per set of
 * `!theme` lines and shared by the preview and the export commands.
 */
const Palettes: ServiceToken<ThemePalettes> = serviceToken<ThemePalettes>('plantuml.palettes');

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

/** The Markdown document to export from: its text, path and cursor line. */
interface ActiveMarkdown {
  text: string;
  path: string;
  /** The cursor line in the document's editor, or null when none is visible. */
  line: number | null;
  /** Kept for the reference updater, which edits the buffer. */
  textDocument: vscode.TextDocument;
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

  const open = vscode.workspace.textDocuments.filter(
    (document) => document.languageId === 'markdown'
  );
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
 * The Markdown document to export from, or null after explaining why
 * there is none.
 *
 * `vscode.window` rather than the kit's editor service because export
 * needs the document's own URI to resolve a relative directory against,
 * and the cursor's line number rather than its text.
 */
async function activeMarkdown(context: OperationContext): Promise<ActiveMarkdown | null> {
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

  const document = await chooseMarkdownDocument(context);
  if (document === null) {
    return null;
  }
  if (document.isUntitled) {
    // There is no folder to write beside.
    void context.notify.warn(context.l10n.t('Save the Markdown file before exporting.'));
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
  };
}

/** The configured export directory, or null after rejecting a bad one. */
function exportDirectory(
  context: OperationContext,
  settings: { read(): { values: Record<string, unknown> } }
): string | null {
  const directory = String(settings.read().values[CONFIG.EXPORT_DIRECTORY]);
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
        : context.l10n.t('Use letters, digits, hyphens and underscores only.'),
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
  settings: { read(): { values: Record<string, unknown> } }
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
      'Use letters, digits, hyphens and underscores only.'
    ),
    engineErrorMessage: (message, line) => engineErrorMessage(context, message, line),
    // Exports default to the light palette regardless of the editor theme:
    // the files face hosts like GitHub, whose background this extension
    // does not control, and a dark diagram on a white page reads as broken.
    // `preview` restores the old follow-the-editor behaviour.
    isDark: (): boolean => {
      const mode = settings.read().values[CONFIG.EXPORT_THEME] as 'light' | 'dark' | 'preview';
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
    writeFile: async (path, content): Promise<void> => {
      const uri = vscode.Uri.parse(path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    },
  };
}

/** How the settings accessor is seen by the helpers below. */
type SettingsReader = { read(): { values: Record<string, unknown> } };

/** The bulk export with progress, shared by both Export All commands. */
function runBulkExport(
  context: OperationContext,
  renderer: RendererClient,
  palettes: ThemePalettes,
  settings: SettingsReader,
  document: ActiveMarkdown,
  directory: string
): Promise<ExportOutcome> {
  return context.progress.run({ title: context.l10n.t('Exporting diagrams…') }, (report) =>
    exportAll(
      exporterDeps(context, renderer, palettes, settings),
      document.path,
      directory,
      document.text,
      (done, total, name) => {
        report.report({
          message: `${name} (${String(done + 1)}/${String(total)})`,
          increment: total === 0 ? 0 : 100 / total,
        });
      }
    )
  );
}

/** One summary notification for a bulk export, warnings when warranted. */
async function reportOutcome(
  context: OperationContext,
  outcome: ExportOutcome,
  extra: readonly string[],
  forceWarn: boolean
): Promise<void> {
  const messages: string[] = [];
  if (outcome.written.length > 0) {
    messages.push(context.l10n.t('Exported {0} diagram(s)', String(outcome.written.length)));
  }
  messages.push(...extra);
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
      context.l10n.t(
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

  module.services.singleton(RequestRefresh, () =>
    debounce(() => {
      void vscode.commands.executeCommand('markdown.preview.refresh');
    }, REFRESH_DEBOUNCE_MS)
  );

  module.services.singleton(Plugin, {
    inject: {
      renderer: Renderer,
      palettes: Palettes,
      requestRefresh: RequestRefresh,
      logger: Log,
      l10n: Localization,
      settings: Settings.token,
    },
    create: ({ renderer, palettes, requestRefresh, logger, l10n, settings }) =>
      createPlantUmlPlugin({
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        render: (source, dark) => renderer.render(source, dark),
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
        },
      }),
  });

  module.commands.handle(ClearCache, {
    inject: { plugin: Plugin },
    execute: async (context: OperationContext, _args, { plugin }): Promise<void> => {
      plugin.clearCache();
      context.logger.info('Render cache cleared');
      await context.notify.info(context.l10n.t('PlantUML render cache cleared.'));
    },
  });

  module.commands.handle(ExportSvg, {
    inject: { renderer: Renderer, palettes: Palettes, settings: Settings.token },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings }
    ): Promise<void> => {
      const document = await activeMarkdown(context);
      if (document === null) {
        return;
      }

      const blocks = findPlantUmlBlocks(document.text);
      // The block under the cursor, or the only block when there is nothing
      // to choose between — a document picked from a list has no cursor.
      const atCursor = document.line === null ? null : blockAtLine(blocks, document.line);
      const block = atCursor ?? (blocks.length === 1 ? (blocks[0] ?? null) : null);
      if (block === null) {
        await context.notify.warn(
          context.l10n.t('Put the cursor inside a ```plantuml block first.')
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

      const directory = exportDirectory(context, settings);
      if (directory === null) {
        return;
      }

      const result = await exportOne(
        exporterDeps(context, renderer, palettes, settings),
        document.path,
        directory,
        block,
        name
      );

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
      const document = await activeMarkdown(context);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, document, directory);
      await reportOutcome(context, outcome, [], false);
    },
  });

  module.commands.handle(ExportAllAndUpdateRefs, {
    inject: { renderer: Renderer, palettes: Palettes, settings: Settings.token },
    execute: async (
      context: OperationContext,
      _args,
      { renderer, palettes, settings }
    ): Promise<void> => {
      const document = await activeMarkdown(context);
      if (document === null) {
        return;
      }

      const directory = exportDirectory(context, settings);
      if (directory === null) {
        return;
      }

      const outcome = await runBulkExport(context, renderer, palettes, settings, document, directory);

      // Plan against the buffer as it is *now*, not the snapshot the
      // exports rendered from: they take time, and an edit meanwhile
      // would shift every line a reference is about to be anchored to.
      // Only successfully exported names get one — a failed block must
      // not gain a link to a file that is stale or absent.
      const exported = new Set(outcome.written.map((result) => result.name));
      const edits = planReferenceEdits(document.textDocument.getText(), exported, directory);

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
    id: 'plantuml.exportMenu',
    start: (context) => {
      // Keeps the context keys behind the editor context-menu entries
      // current: "Export Diagram" shows only with the cursor inside a
      // ```plantuml block, "Export All" only when the document has one.
      // Blocks are rescanned only when the document itself changes; a
      // plain cursor move reuses the previous scan.
      let scanned = '';
      let blocks: readonly PlantUmlBlock[] = [];
      const state = { hasDiagrams: false, inDiagram: false };

      const update = (editor: vscode.TextEditor | undefined): void => {
        let hasDiagrams = false;
        let inDiagram = false;

        if (editor !== undefined && editor.document.languageId === 'markdown') {
          const stamp = `${editor.document.uri.toString()}#${String(editor.document.version)}`;
          if (stamp !== scanned) {
            blocks = findPlantUmlBlocks(editor.document.getText());
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
