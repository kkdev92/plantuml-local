import type MarkdownIt from 'markdown-it';

import {
  EMOJI_UNAVAILABLE,
  EXPORT_FRAGMENT,
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  MAX_DOCUMENTS_IN_VIEW,
  hasRemoteReference,
  isDiagramFence,
} from '../core/constants';
import { diagramShape } from '../core/shape';
import type { DiagramRender, IncludedStyle, RenderLog } from '../core/types';
import { hasLocalInclude } from '../includes/describe';
import { changeTo } from '../includes/tracking';
import { drawReadable } from '../render/palette';

/**
 * The markdown-it side of the extension.
 *
 * markdown-it's `fence` rule must return HTML synchronously, while
 * rendering is asynchronous. The two meet through a cache-and-refresh
 * cycle:
 *
 * 1. `fence` is called; if the SVG for this source is cached, return it.
 * 2. Otherwise start rendering in the background, and return the diagram
 *    last shown at this place in the document (or a placeholder the first
 *    time), so editing a block does not make the preview flicker.
 * 3. When the render settles, store the result and ask VS Code to
 *    refresh the preview (`requestRefresh`).
 * 4. The refreshed preview calls `fence` again; the cache hits and the
 *    diagram appears. Cache hits never request a refresh, so the cycle
 *    always terminates.
 *
 * With the update mode `onSave` or `manual`, a block that already shows a
 * diagram starts no render at step 2 until its document is saved or
 * everything is drawn again; the diagram stays, marked as not updated.
 *
 * This module deliberately has no dependency on the `vscode` module —
 * everything host-specific arrives through {@link PluginDeps} — so the
 * whole cycle is unit-testable.
 */

/** User-visible strings, localised by the caller (vscode.l10n). */
export interface PluginLabels {
  /** Placeholder shown while a diagram renders for the first time. */
  loading: string;
  /** Heading of the error box. */
  failedTitle: string;
  /** Error for an empty ```plantuml block. */
  emptySource: string;
  /** Error for `!include https://…` and friends. */
  remoteReference: string;
  /** Error for a diagram that uses an emoji, which cannot be drawn here. */
  emojiUnavailable: string;
  /** Error for a block holding more than one diagram. */
  severalDiagrams: string;
  /** Error for a diagram split into pages with `newpage`. */
  pages: string;
  /** Note above a diagram drawn with `end`, the end line its block lacks. */
  missingEnd(end: string): string;
  /** Note above a diagram not drawn again since its block changed. */
  notUpdated(mode: Exclude<UpdateMode, 'onChange'>): string;
  /** Note above a diagram whose local include of `path` failed, and why. */
  includeFailed(path: string, reason: string): string;
}

/**
 * When a changed block is drawn again: as it changes, once the document is
 * saved, or only when everything is drawn again on request.
 */
export type UpdateMode = 'onChange' | 'onSave' | 'manual';

export interface PluginDeps {
  /** Whether diagrams should currently render in dark colours. */
  isDark(): boolean;
  /**
   * Renders PlantUML source to sanitised SVG (the worker round-trip); its
   * local includes are looked for next to `document`, a URI.
   */
  render(source: string, dark: boolean, document: string | undefined): Promise<DiagramRender>;
  /**
   * The palette to draw `source` in when `dark` is asked for: the other one
   * for a diagram whose `!theme` cannot be read in it (src/render/palette.ts),
   * `included` telling what the files it included set, once drawn.
   */
  resolvePalette(source: string, dark: boolean, included?: IncludedStyle): Promise<boolean>;
  /** Asks VS Code to refresh Markdown previews (debounced by the caller). */
  requestRefresh(): void;
  /** Escapes text for inclusion in HTML. */
  escapeHtml(text: string): string;
  /** Whether images marked {@link EXPORT_FRAGMENT} are hidden in the preview. */
  hideExportedImages(): boolean;
  /** When the changed blocks of `document`, a URI, are drawn again. */
  updateMode(document: string): UpdateMode;
  log: RenderLog;
  labels: PluginLabels;
}

export interface PlantUmlPlugin {
  /** Passed to VS Code through the extension's `extendMarkdownIt` export. */
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
  /** Drops all cached renders (theme switches, user command). */
  clearCache(): void;
  /**
   * Takes the blocks of `document` as they are now, `sources`, for the ones
   * to draw, as when it is saved with `onSave`. The caller refreshes the
   * preview.
   */
  accept(document: string, sources: readonly string[]): void;
  /**
   * Files changed (path key → saved or changed on disk): the diagrams whose
   * local includes depend on one of them are drawn again under their update
   * mode — at once with `onChange`, once saved with `onSave` — or else marked
   * as not updated. The rest are left alone.
   */
  filesChanged(changes: ReadonlyMap<string, boolean>): void;
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
function createBoundedStore(
  maxEntries: number,
  maxSize: number,
  pinned: (key: string) => boolean = () => false
): BoundedStore {
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

  /** The oldest entry that may go: not pinned, and not the one just set. */
  function oldestEvictable(newest: string): string | undefined {
    for (const key of entries.keys()) {
      if (key !== newest && !pinned(key)) {
        return key;
      }
    }
    return undefined;
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
        const oldest = oldestEvictable(key);
        if (oldest === undefined) {
          break;
        }
        drop(oldest);
      }
    },
  };
}

export function createPlantUmlPlugin(deps: PluginDeps): PlantUmlPlugin {
  /**
   * Document → the keys of the diagrams its latest preview showed, for the
   * documents previewed last. Those are never evicted: with more diagrams
   * in view than the cache holds, the next refresh would render an evicted
   * one again, its render would evict another, and the preview would never
   * settle.
   */
  const inView = new Map<string, { env: unknown; keys: Set<string> }>();

  function isInView(key: string): boolean {
    for (const pass of inView.values()) {
      if (pass.keys.has(key)) {
        return true;
      }
    }
    return false;
  }

  /** Notes that `document`'s preview, being drawn with `env`, shows `key`. */
  function showing(document: string, env: unknown, key: string): void {
    let pass = inView.get(document);
    // VS Code draws a preview with a new env each time: a new pass.
    if (pass === undefined || pass.env !== env) {
      inView.delete(document);
      pass = { env, keys: new Set<string>() };
      inView.set(document, pass);
      if (inView.size > MAX_DOCUMENTS_IN_VIEW) {
        const oldest = inView.keys().next().value;
        if (oldest !== undefined) {
          inView.delete(oldest);
        }
      }
    }
    pass.keys.add(key);
  }

  /** key → sanitised SVG in the wrapper that names its palette. */
  const rendered = createBoundedStore(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES, isInView);
  /** key → error message for renders that failed. */
  const failed = createBoundedStore(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES, isInView);
  /** Keys currently rendering, so a preview refresh does not re-enqueue. */
  const inFlight = new Set<string>();
  /**
   * Document and block position → the diagram last shown there. A source
   * that changed by one character is a cache miss; showing what was there
   * until the new render lands keeps the preview from flickering while the
   * author types.
   */
  const shown = createBoundedStore(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES);
  /** Document → the sources of its blocks when last accepted, as on a save. */
  const accepted = new Map<string, ReadonlySet<string>>();
  /**
   * Key → the document and the paths that a cached diagram with a local
   * include depends on: a change to one of them makes the drawing stale.
   */
  const dependents = new Map<string, { document: string | undefined; paths: readonly string[] }>();
  /** Keys shown although a file they include changed, as their update mode has them wait. */
  const stale = new Set<string>();
  /** Keys to draw whatever their document's update mode, as a file they include was saved. */
  const forced = new Set<string>();
  /** Key → the files that changed while it was rendering, weighed once it lands. */
  const changedWhileRendering = new Map<string, Map<string, boolean>>();

  /**
   * Takes a change to the files `key` depends on: drawn again when the update
   * mode allows, otherwise marked as not updated. False when none is touched.
   */
  function react(
    key: string,
    entry: { document: string | undefined; paths: readonly string[] },
    changes: ReadonlyMap<string, boolean>
  ): boolean {
    const change = changeTo(entry.paths, changes);
    if (change === 'none') {
      return false;
    }
    const mode = entry.document === undefined ? 'onChange' : deps.updateMode(entry.document);
    if (mode === 'onChange' || (mode === 'onSave' && change === 'saved')) {
      rendered.delete(key);
      failed.delete(key);
      dependents.delete(key);
      stale.delete(key);
      forced.add(key);
    } else {
      stale.add(key);
    }
    return true;
  }

  /**
   * A diagram with a local include draws the files next to its document,
   * so the same source in another document is another diagram.
   */
  function cacheKey(source: string, dark: boolean, document: string | undefined): string {
    const where = hasLocalInclude(source) ? `${document ?? ''}\n` : '';
    return `${dark ? 'dark' : 'light'}\n${where}${source}`;
  }

  function isPlantUmlFence(token: { type?: string; info: string } | undefined): boolean {
    return token !== undefined && isDiagramFence(token.info);
  }

  /**
   * The document VS Code is previewing, as a URI, or undefined when it is
   * not known (markdown-it rendering a plain string).
   */
  function documentOf(env: unknown): string | undefined {
    // A vscode.Uri, whose toString() is the URI.
    const document = (env as { currentDocument?: { toString(): string } | null } | undefined)
      ?.currentDocument;
    return document === undefined || document === null ? undefined : document.toString();
  }

  /**
   * Where a block sits: its document and how many ```plantuml blocks come
   * before it, so a diagram is never carried over to another document.
   */
  function positionKey(tokens: { type: string; info: string }[], index: number, document: string): string {
    let ordinal = 0;
    for (let i = 0; i < index; i++) {
      const token = tokens[i];
      if (token?.type === 'fence' && isPlantUmlFence(token)) {
        ordinal++;
      }
    }
    return `${document}\n${String(ordinal)}`;
  }

  function startRender(source: string, dark: boolean, key: string, document: string | undefined): void {
    if (inFlight.has(key)) {
      return;
    }
    inFlight.add(key);
    forced.delete(key);
    changedWhileRendering.set(key, new Map());

    drawReadable(
      source,
      dark,
      (themed, asked, included) => deps.resolvePalette(themed, asked, included),
      (palette) => deps.render(source, palette, document)
    ).then(
        ({ result, palette }) => {
          rendered.set(key, includeNotes(result.failedIncludes) + diagramHtml(result.svg, palette));
          failed.delete(key);
          stale.delete(key);
          if (result.dependencies.length > 0) {
            const entry = { document, paths: result.dependencies };
            dependents.set(key, entry);
            // A file it read may have changed after it was read.
            const during = changedWhileRendering.get(key);
            if (during !== undefined) {
              react(key, entry, during);
            }
          } else {
            dependents.delete(key);
          }
          deps.log.debug(`Rendered diagram (${String(result.svg.length)} bytes)`);
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          failed.set(key, EMOJI_UNAVAILABLE.test(message) ? deps.labels.emojiUnavailable : message);
          deps.log.warn(`Render failed: ${message}`);
        }
      )
      .finally(() => {
        inFlight.delete(key);
        changedWhileRendering.delete(key);
        deps.requestRefresh();
      });
  }

  /**
   * Tells the stylesheet which palette the diagram was rendered with. The
   * backdrop must follow the diagram, not the page theme: with
   * `plantumlLocal.theme` pinned to light or dark, or a theme drawn in the
   * other palette, a page-based backdrop would erase the text (dark
   * diagrams draw white text and no background of their own).
   */
  function diagramHtml(svg: string, dark: boolean): string {
    return `<div class="plantuml-diagram plantuml-diagram--${dark ? 'dark' : 'light'}">${svg}</div>`;
  }

  /** Why each failed include failed, above the engine's "cannot include" drawing. */
  function includeNotes(failedIncludes: ReadonlyMap<string, string>): string {
    return [...failedIncludes]
      .map(
        ([path, reason]) =>
          `<div class="plantuml-notice">${deps.escapeHtml(deps.labels.includeFailed(path, reason))}</div>`
      )
      .join('');
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
      shown.clear();
      dependents.clear();
      stale.clear();
      forced.clear();
      deps.requestRefresh();
    },

    accept(document: string, sources: readonly string[]): void {
      accepted.set(document, new Set(sources));
      // Saved: what it includes is drawn as it is now, as its own text is.
      for (const key of [...stale]) {
        if (dependents.get(key)?.document === document) {
          rendered.delete(key);
          dependents.delete(key);
          stale.delete(key);
          forced.add(key);
        }
      }
    },

    filesChanged(changes: ReadonlyMap<string, boolean>): void {
      for (const seen of changedWhileRendering.values()) {
        for (const [path, saved] of changes) {
          seen.set(path, seen.get(path) === true || saved);
        }
      }
      let touched = false;
      for (const [key, entry] of [...dependents]) {
        // Gone from the cache meanwhile: drawn afresh when it is next shown.
        if (rendered.get(key) === undefined) {
          dependents.delete(key);
          stale.delete(key);
          continue;
        }
        touched = react(key, entry, changes) || touched;
      }
      if (touched) {
        deps.requestRefresh();
      }
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
        // Everything that is not ```plantuml or ```puml stays untouched.
        if (!isPlantUmlFence(token)) {
          return fallback !== undefined
            ? fallback(tokens, index, options, env, self)
            : self.renderToken(tokens, index, options);
        }

        const source = token.content.trim();

        if (source === '') {
          return errorBlock(deps.labels.emptySource);
        }

        if (hasRemoteReference(source)) {
          return errorBlock(deps.labels.remoteReference);
        }

        // The engine would draw only the first diagram or page and drop the
        // rest without a word, so say so instead of drawing part of it.
        const shape = diagramShape(source);
        if (shape.kind === 'several') {
          return errorBlock(deps.labels.severalDiagrams);
        }
        if (shape.kind === 'pages') {
          return errorBlock(deps.labels.pages);
        }
        const notice =
          shape.addedEnd === null
            ? ''
            : `<div class="plantuml-notice">${deps.escapeHtml(deps.labels.missingEnd(shape.addedEnd))}</div>`;

        const dark = deps.isDark();
        const document = documentOf(env);
        const key = cacheKey(shape.source, dark, document);

        const position = document === undefined ? undefined : positionKey(tokens, index, document);
        if (document !== undefined) {
          showing(document, env, key);
        }

        const mode = document === undefined ? 'onChange' : deps.updateMode(document);
        const html = rendered.get(key);
        if (html !== undefined && stale.has(key) && mode === 'onChange') {
          // The update mode has changed since: draw it again now.
          rendered.delete(key);
          stale.delete(key);
          forced.add(key);
        } else if (html !== undefined) {
          if (position !== undefined) {
            shown.set(position, html);
          }
          const waiting =
            stale.has(key) && mode !== 'onChange'
              ? `<div class="plantuml-notice">${deps.escapeHtml(deps.labels.notUpdated(mode))}</div>`
              : '';
          return notice + waiting + html;
        }

        const message = failed.get(key);
        if (message !== undefined) {
          return errorBlock(message, source);
        }

        const previous = position !== undefined ? shown.get(position) : undefined;
        if (
          previous !== undefined &&
          document !== undefined &&
          mode !== 'onChange' &&
          !forced.has(key) &&
          accepted.get(document)?.has(source) !== true
        ) {
          return (
            notice + `<div class="plantuml-notice">${deps.escapeHtml(deps.labels.notUpdated(mode))}</div>` + previous
          );
        }

        startRender(shape.source, dark, key, document);
        return (
          notice +
          (previous ??
            `<div class="plantuml-diagram plantuml-loading">${deps.escapeHtml(deps.labels.loading)}</div>`)
        );
      };

      return md;
    },
  };
}
