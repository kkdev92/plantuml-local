import {
  createLogger,
  debounce,
  escapeHtml,
  getSetting,
  registerCommands,
  showInfo,
  t,
} from '@kkdev92/vscode-ext-kit';
import type { LogLevel } from '@kkdev92/vscode-ext-kit';
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

type ThemeSetting = 'auto' | 'light' | 'dark';

function isDark(): boolean {
  const setting = getSetting<ThemeSetting>(EXTENSION_ID, CONFIG.THEME, 'auto');
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
  const logger = createLogger(EXTENSION_NAME, {
    level: getSetting<LogLevel>(EXTENSION_ID, CONFIG.LOG_LEVEL, 'info'),
    configSection: `${EXTENSION_ID}.${CONFIG.LOG_LEVEL}`,
  });
  context.subscriptions.push(logger);

  const renderer = new RendererClient(defaultWorkerPath(), logger);
  context.subscriptions.push({ dispose: () => { renderer.dispose(); } });

  // Rendering five diagrams on one page settles five promises in quick
  // succession; coalesce them into a single preview refresh.
  const requestRefresh = debounce(() => {
    void vscode.commands.executeCommand('markdown.preview.refresh');
  }, REFRESH_DEBOUNCE_MS);
  context.subscriptions.push({ dispose: () => { requestRefresh.cancel(); } });

  const plugin = createPlantUmlPlugin({
    isDark,
    render: (source, dark) => renderer.render(source, dark),
    requestRefresh,
    escapeHtml,
    log: logger,
    labels: {
      loading: t('Rendering diagram…'),
      failedTitle: t('Failed to render diagram'),
      emptySource: t('The PlantUML source is empty.'),
      remoteReference: t('URL-based external references (!include, !theme) are not supported.'),
    },
  });

  registerCommands(context, logger, {
    [COMMANDS.CLEAR_CACHE]: async () => {
      plugin.clearCache();
      logger.info('Render cache cleared');
      await showInfo(t('PlantUML render cache cleared.'));
    },
  });

  context.subscriptions.push(
    // Re-render with the matching palette when the colour theme flips.
    vscode.window.onDidChangeActiveColorTheme(() => {
      logger.debug('Colour theme changed; re-rendering diagrams');
      plugin.clearCache();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${EXTENSION_ID}.${CONFIG.THEME}`)) {
        plugin.clearCache();
      }
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
