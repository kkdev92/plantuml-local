import {
  createExtensionKit,
  debounce,
  defineConfigSchema,
  escapeHtml,
  field,
  l10n,
  s,
  showInfo,
} from '@kkdev92/vscode-ext-kit';
import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';

import { COMMANDS, CONFIG, EXTENSION_ID, EXTENSION_NAME, REFRESH_DEBOUNCE_MS } from './core/constants';
import { createPlantUmlPlugin } from './preview/plugin';
import { RendererClient, defaultWorkerPath } from './render/client';

/**
 * Extension entry point: wires VS Code, the markdown-it plugin and the
 * render worker together. All behaviour lives in src/preview and
 * src/worker; this file stays declarative.
 */

/**
 * Typed mirror of `contributes.configuration`. Every read is validated
 * against the schema, so a hand-edited or stale `settings.json` falls back
 * to the declared default instead of reaching the renderer as garbage.
 */
const config = defineConfigSchema(EXTENSION_ID, {
  [CONFIG.THEME]: field(s.enum('auto', 'light', 'dark'), 'auto'),
  [CONFIG.LOG_LEVEL]: field(s.enum('trace', 'debug', 'info', 'warn', 'error'), 'info'),
});

function isDark(): boolean {
  const setting = config.get(CONFIG.THEME);
  if (setting === 'light') {
    return false;
  }
  if (setting === 'dark') {
    return true;
  }

  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

export function activate(context: vscode.ExtensionContext): {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
} {
  // The kit owns the logger plus a disposable scope, and registers itself
  // in context.subscriptions — everything below is torn down with it.
  const kit = createExtensionKit<typeof COMMANDS.CLEAR_CACHE>(context, EXTENSION_NAME, {
    logger: { level: config.get(CONFIG.LOG_LEVEL) },
  });
  const { logger } = kit;

  const renderer = new RendererClient(defaultWorkerPath(), logger);

  // Rendering five diagrams on one page settles five promises in quick
  // succession; coalesce them into a single preview refresh.
  const requestRefresh = debounce(() => {
    void vscode.commands.executeCommand('markdown.preview.refresh');
  }, REFRESH_DEBOUNCE_MS);

  kit.disposables.push(
    { dispose: () => { renderer.dispose(); } },
    { dispose: () => { requestRefresh.cancel(); } }
  );

  const plugin = createPlantUmlPlugin({
    isDark,
    render: (source, dark) => renderer.render(source, dark),
    requestRefresh,
    escapeHtml,
    log: logger,
    labels: {
      loading: l10n.t('Rendering diagram…'),
      failedTitle: l10n.t('Failed to render diagram'),
      emptySource: l10n.t('The PlantUML source is empty.'),
      remoteReference: l10n.t('URL-based external references (!include, !theme) are not supported.'),
    },
  });

  kit.registerCommands({
    [COMMANDS.CLEAR_CACHE]: async () => {
      plugin.clearCache();
      logger.info('Render cache cleared');
      await showInfo(l10n.t('PlantUML render cache cleared.'));
    },
  });

  kit.disposables.push(
    // Re-render with the matching palette when the colour theme flips.
    vscode.window.onDidChangeActiveColorTheme(() => {
      logger.debug('Colour theme changed; re-rendering diagrams');
      plugin.clearCache();
    }),
    config.onDidChange(CONFIG.THEME, () => {
      plugin.clearCache();
    }),
    // The level arrives schema-validated, unlike the logger's own
    // `configSection` re-read.
    config.onDidChange(CONFIG.LOG_LEVEL, (level) => {
      logger.setLevel(level);
    })
  );

  logger.info('Activated');

  return {
    extendMarkdownIt: (md: MarkdownIt) => plugin.extendMarkdownIt(md),
  };
}

export function deactivate(): void {
  // Disposal happens through context.subscriptions.
}
