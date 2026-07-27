import type MarkdownIt from 'markdown-it';

import { MAX_CACHE_ENTRIES, REMOTE_REFERENCE } from '../core/constants';
import type { RenderLog } from '../core/types';

/**
 * The markdown-it side of the extension.
 *
 * markdown-it's `fence` rule must return HTML synchronously, while
 * rendering is asynchronous. The two meet through a cache-and-refresh
 * cycle:
 *
 * 1. `fence` is called; if the SVG for this source is cached, return it.
 * 2. Otherwise return a placeholder and start rendering in the
 *    background.
 * 3. When the render settles, store the result and ask VS Code to
 *    refresh the preview (`requestRefresh`).
 * 4. The refreshed preview calls `fence` again; the cache hits and the
 *    diagram appears. Cache hits never request a refresh, so the cycle
 *    always terminates.
 *
 * This module deliberately has no dependency on the `vscode` module —
 * everything host-specific arrives through {@link PluginDeps} — so the
 * whole cycle is unit-testable.
 */

/** User-visible strings, localised by the caller (vscode.l10n). */
export interface PluginLabels {
  /** Placeholder shown while a diagram renders. */
  loading: string;
  /** Heading of the error box. */
  failedTitle: string;
  /** Error for an empty ```plantuml block. */
  emptySource: string;
  /** Error for `!include https://…` and friends. */
  remoteReference: string;
}

export interface PluginDeps {
  /** Whether diagrams should currently render in dark colours. */
  isDark(): boolean;
  /** Renders PlantUML source to sanitised SVG (the worker round-trip). */
  render(source: string, dark: boolean): Promise<string>;
  /** Asks VS Code to refresh Markdown previews (debounced by the caller). */
  requestRefresh(): void;
  /** Escapes text for inclusion in HTML. */
  escapeHtml(text: string): string;
  log: RenderLog;
  labels: PluginLabels;
}

export interface PlantUmlPlugin {
  /** Passed to VS Code through the extension's `extendMarkdownIt` export. */
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
  /** Drops all cached renders (theme switches, user command). */
  clearCache(): void;
}

export function createPlantUmlPlugin(deps: PluginDeps): PlantUmlPlugin {
  /** key → sanitised SVG. Insertion order doubles as eviction order. */
  const rendered = new Map<string, string>();
  /** key → error message for renders that failed. */
  const failed = new Map<string, string>();
  /** Keys currently rendering, so a preview refresh does not re-enqueue. */
  const inFlight = new Set<string>();

  function cacheKey(source: string, dark: boolean): string {
    return `${dark ? 'dark' : 'light'}\n${source}`;
  }

  function remember(store: Map<string, string>, key: string, value: string): void {
    if (store.size >= MAX_CACHE_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) {
        store.delete(oldest);
      }
    }
    store.set(key, value);
  }

  function startRender(source: string, dark: boolean, key: string): void {
    if (inFlight.has(key)) {
      return;
    }
    inFlight.add(key);

    deps
      .render(source, dark)
      .then(
        (svg) => {
          remember(rendered, key, svg);
          failed.delete(key);
          deps.log.debug(`Rendered diagram (${String(svg.length)} bytes)`);
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          remember(failed, key, message);
          deps.log.warn(`Render failed: ${message}`);
        }
      )
      .finally(() => {
        inFlight.delete(key);
        deps.requestRefresh();
      });
  }

  function errorBlock(message: string, source?: string): string {
    const detail =
      source !== undefined ? `<pre class="plantuml-source">${deps.escapeHtml(source)}</pre>` : '';
    return (
      `<div class="plantuml-error"><strong>${deps.escapeHtml(deps.labels.failedTitle)}</strong>` +
      `<pre>${deps.escapeHtml(message)}</pre>${detail}</div>`
    );
  }

  return {
    clearCache(): void {
      rendered.clear();
      failed.clear();
      deps.requestRefresh();
    },

    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      const fallback = md.renderer.rules.fence?.bind(md.renderer.rules);

      md.renderer.rules.fence = (tokens, index, options, env, self): string => {
        const token = tokens[index];
        if (token === undefined) {
          return '';
        }
        const language = token.info.trim().split(/\s+/)[0];

        // Everything that is not ```plantuml stays untouched.
        if (language !== 'plantuml') {
          return fallback !== undefined
            ? fallback(tokens, index, options, env, self)
            : self.renderToken(tokens, index, options);
        }

        const source = token.content.trim();

        if (source === '') {
          return errorBlock(deps.labels.emptySource);
        }

        if (REMOTE_REFERENCE.test(source)) {
          return errorBlock(deps.labels.remoteReference);
        }

        const dark = deps.isDark();
        const key = cacheKey(source, dark);

        const svg = rendered.get(key);
        if (svg !== undefined) {
          // Tell the stylesheet which palette the diagram was rendered
          // with. The background must follow the diagram, not the page
          // theme: with `plantumlLocal.theme` pinned to light or dark,
          // page-based backgrounds would erase the text (dark diagrams
          // draw white text and no background of their own).
          const mode = dark ? 'dark' : 'light';
          return `<div class="plantuml-diagram plantuml-diagram--${mode}">${svg}</div>`;
        }

        const message = failed.get(key);
        if (message !== undefined) {
          return errorBlock(message, source);
        }

        startRender(source, dark, key);
        return `<div class="plantuml-diagram plantuml-loading">${deps.escapeHtml(deps.labels.loading)}</div>`;
      };

      return md;
    },
  };
}
