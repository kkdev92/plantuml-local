import type MarkdownIt from 'markdown-it';

import {
  EXPORT_FRAGMENT,
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  REMOTE_REFERENCE,
} from '../core/constants';
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
  /** Whether images marked {@link EXPORT_FRAGMENT} are hidden in the preview. */
  hideExportedImages(): boolean;
  log: RenderLog;
  labels: PluginLabels;
}

export interface PlantUmlPlugin {
  /** Passed to VS Code through the extension's `extendMarkdownIt` export. */
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
  /** Drops all cached renders (theme switches, user command). */
  clearCache(): void;
}

interface BoundedStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}

/**
 * A Map bounded by both entry count and total size, evicting oldest-first.
 *
 * An entry count alone is a poor proxy for memory once sprites are in
 * play: a plain sequence diagram is a few KB, while one carrying a dozen
 * rasterised icons is 100-150 KB, so 200 entries can mean anything from
 * half a megabyte to thirty. Size is counted in UTF-16 code units rather
 * than bytes on the wire — SVG is overwhelmingly ASCII, so the two are
 * close, and the point is to bound memory, not to be exact.
 */
function createBoundedStore(maxEntries: number, maxSize: number): BoundedStore {
  /** Insertion order doubles as eviction order. */
  const entries = new Map<string, string>();
  let size = 0;

  function drop(key: string): void {
    const existing = entries.get(key);
    if (existing !== undefined) {
      size -= existing.length;
      entries.delete(key);
    }
  }

  return {
    get: (key): string | undefined => entries.get(key),
    delete: drop,
    clear: (): void => {
      entries.clear();
      size = 0;
    },
    set(key, value): void {
      // Re-insert so a refreshed entry counts as the newest.
      drop(key);
      entries.set(key, value);
      size += value.length;

      while (entries.size > maxEntries || (size > maxSize && entries.size > 1)) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        drop(oldest);
      }
    },
  };
}

export function createPlantUmlPlugin(deps: PluginDeps): PlantUmlPlugin {
  /** key → sanitised SVG. */
  const rendered = createBoundedStore(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES);
  /** key → error message for renders that failed. */
  const failed = createBoundedStore(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES);
  /** Keys currently rendering, so a preview refresh does not re-enqueue. */
  const inFlight = new Set<string>();

  function cacheKey(source: string, dark: boolean): string {
    return `${dark ? 'dark' : 'light'}\n${source}`;
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
          rendered.set(key, svg);
          failed.delete(key);
          deps.log.debug(`Rendered diagram (${String(svg.length)} bytes)`);
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          failed.set(key, message);
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
      // The reference updater writes `![name](images/name.svg#plantuml-local)`
      // after each exported block so other hosts show the diagram. In this
      // preview the block itself already renders, so a marked image would be
      // the same diagram twice; drop it here rather than with CSS, which
      // would depend on the fragment surviving VS Code's resource-URI
      // rewrite. VS Code's own image rule wraps this one and preserves the
      // original target in `data-src` before delegating, so both attributes
      // are checked.
      const imageFallback = md.renderer.rules.image?.bind(md.renderer.rules);
      md.renderer.rules.image = (tokens, index, options, env, self): string => {
        const token = tokens[index];
        const source = token?.attrGet('data-src') ?? token?.attrGet('src') ?? '';
        if (deps.hideExportedImages() && source.endsWith(EXPORT_FRAGMENT)) {
          return '';
        }
        return imageFallback !== undefined
          ? imageFallback(tokens, index, options, env, self)
          : self.renderToken(tokens, index, options);
      };

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
