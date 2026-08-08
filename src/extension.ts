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

import { COMMANDS, CONFIG, EXTENSION_ID, EXTENSION_NAME, REFRESH_DEBOUNCE_MS } from './core/constants';
import { createPlantUmlPlugin, type PlantUmlPlugin } from './preview/plugin';
import type { RenderLog } from './core/types';
import { RendererClient, defaultWorkerPath } from './render/client';

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
  },
});

/** Clears the render cache so every diagram on the page is drawn again. */
export const ClearCache = defineCommandContract<readonly [], void>({
  id: COMMANDS.CLEAR_CACHE,
});

/** The worker client. An object with `dispose`, so the container shuts it down. */
const Renderer: ServiceToken<RendererClient> = serviceToken<RendererClient>('plantuml.renderer');

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

  module.services.singleton(RequestRefresh, () =>
    debounce(() => {
      void vscode.commands.executeCommand('markdown.preview.refresh');
    }, REFRESH_DEBOUNCE_MS)
  );

  module.services.singleton(Plugin, {
    inject: {
      renderer: Renderer,
      requestRefresh: RequestRefresh,
      logger: Log,
      l10n: Localization,
      settings: Settings.token,
    },
    create: ({ renderer, requestRefresh, logger, l10n, settings }) =>
      createPlantUmlPlugin({
        isDark: () => isDark(settings.read().values[CONFIG.THEME]),
        render: (source, dark) => renderer.render(source, dark),
        requestRefresh,
        escapeHtml,
        log: filtered(logger, settings.read().values[CONFIG.LOG_LEVEL]),
        labels: {
          loading: l10n.t('Rendering diagram…'),
          failedTitle: l10n.t('Failed to render diagram'),
          emptySource: l10n.t('The PlantUML source is empty.'),
          remoteReference: l10n.t(
            'URL-based external references (!include, !theme) are not supported.'
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
export const deactivate = app.deactivate;
