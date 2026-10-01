import type MarkdownIt from 'markdown-it';
import { describe, expect, it, vi } from 'vitest';

import { createPlantUmlPlugin, type PluginDeps } from '../../src/preview/plugin';

/**
 * The plugin is exercised through a minimal stand-in for markdown-it:
 * just the renderer.rules bag the plugin patches, plus the fence token
 * shape it reads.
 */

const LABELS = {
  loading: 'loading…',
  failedTitle: 'failed',
  emptySource: 'source is empty',
  remoteReference: 'remote references are not supported',
  emojiUnavailable: 'emoji are not available',
  severalDiagrams: 'one diagram per block',
  pages: 'no pages',
  missingEnd: (end: string): string => `no ${end}`,
};

interface Harness {
  deps: PluginDeps & { render: ReturnType<typeof vi.fn> };
  plugin: ReturnType<typeof createPlantUmlPlugin>;
  /**
   * Renders one fence. `env` is what VS Code passes (`currentDocument` in a
   * preview); `before` are the ```plantuml blocks above it in the document.
   */
  fence(info: string, content: string, env?: object, before?: string[]): string;
  refreshes(): number;
  /** Waits until all in-flight renders have settled. */
  settle(): Promise<void>;
  /** Waits until the renders just asked for have started (the palette is resolved first). */
  started(): Promise<void>;
}

function makeHarness(options?: {
  dark?: boolean;
  hideExportedImages?: boolean;
  render?: (source: string, dark: boolean) => Promise<string>;
  resolvePalette?: (source: string, dark: boolean) => Promise<boolean>;
}): Harness {
  let refreshCount = 0;
  let pending: Promise<unknown> = Promise.resolve();

  const render = vi.fn((source: string, dark: boolean) => {
    const result = (options?.render ?? ((s: string) => Promise.resolve(`<svg>${s}</svg>`)))(
      source,
      dark
    );
    pending = pending.then(
      () => result.catch(() => undefined),
      () => undefined
    );
    return result;
  });

  const deps: Harness['deps'] = {
    isDark: () => options?.dark ?? false,
    hideExportedImages: () => options?.hideExportedImages ?? true,
    render,
    resolvePalette: options?.resolvePalette ?? ((_source, dark) => Promise.resolve(dark)),
    requestRefresh: () => {
      refreshCount += 1;
    },
    escapeHtml: (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    labels: LABELS,
  };

  const plugin = createPlantUmlPlugin(deps);

  const md = {
    renderer: {
      rules: {
        fence: () => '<pre data-fallback="original"></pre>',
      },
    },
  } as unknown as MarkdownIt;
  plugin.extendMarkdownIt(md);

  const self = {
    renderToken: () => '<pre data-fallback="renderToken"></pre>',
  };

  return {
    deps,
    plugin,
    fence(info, content, env = {}, before = []) {
      const rule = md.renderer.rules.fence;
      if (rule === undefined) {
        throw new Error('fence rule missing');
      }
      const above = before.map((c) => ({ type: 'fence', info: 'plantuml', content: c }));
      return rule(
        [...above, { type: 'fence', info, content }] as never,
        above.length,
        {} as never,
        env,
        self as never
      );
    },
    refreshes: () => refreshCount,
    settle: async () => {
      // Two microtask hops: the render promise, then the .finally handler.
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    started: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';

describe('createPlantUmlPlugin', () => {
  it('leaves non-plantuml fences to the previous rule', () => {
    const h = makeHarness();
    for (const language of ['js', 'ts', 'bash', 'json', 'mermaid', '', 'PlantUML', 'uml', 'plantuml-x']) {
      expect(h.fence(language, 'const a = 1')).toBe('<pre data-fallback="original"></pre>');
    }
    expect(h.deps.render).not.toHaveBeenCalled();
  });

  it.each([
    ['two diagrams', '@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml', LABELS.severalDiagrams],
    ['pages', '@startuml\nA -> B\nnewpage\nC -> D\n@enduml', LABELS.pages],
  ])('says why it does not draw a block with %s, instead of drawing part of it', (_what, source, label) => {
    const h = makeHarness();
    const html = h.fence('plantuml', source);
    expect(html).toContain('plantuml-error');
    expect(html).toContain(label);
    expect(h.deps.render).not.toHaveBeenCalled();
  });

  it('draws a diagram missing its end line with the line added, and says so', async () => {
    const h = makeHarness();
    h.fence('plantuml', '@startuml\nA -> B');
    await h.settle();
    expect(h.deps.render).toHaveBeenCalledWith('@startuml\nA -> B\n@enduml', false);
    const html = h.fence('plantuml', '@startuml\nA -> B');
    expect(html).toContain('plantuml-notice');
    expect(html).toContain('no @enduml');
    expect(html).toContain('<svg>@startuml\nA -> B\n@enduml</svg>');
  });

  it('renders a puml fence as a diagram', async () => {
    const h = makeHarness();
    h.fence('puml name', SOURCE);
    await h.settle();
    expect(h.fence('puml name', SOURCE)).toContain(`<svg>${SOURCE}</svg>`);
  });

  it('falls back to renderToken when no previous fence rule exists', () => {
    const h = makeHarness();
    const md = {
      renderer: { rules: {} },
    } as unknown as MarkdownIt;
    h.plugin.extendMarkdownIt(md);

    const rule = md.renderer.rules.fence;
    expect(rule).toBeDefined();
    const html = rule?.(
      [{ info: 'js', content: 'x' } as never],
      0,
      {} as never,
      {},
      { renderToken: () => '<pre data-fallback="renderToken"></pre>' } as never
    );
    expect(html).toBe('<pre data-fallback="renderToken"></pre>');
  });

  it('returns a placeholder first, then the cached SVG after a refresh', async () => {
    const h = makeHarness();

    const first = h.fence('plantuml', SOURCE);
    expect(first).toContain('plantuml-loading');
    expect(first).toContain(LABELS.loading);

    await h.settle();
    expect(h.refreshes()).toBe(1);

    const second = h.fence('plantuml', SOURCE);
    expect(second).toContain('<div class="plantuml-diagram plantuml-diagram--light">');
    expect(second).toContain(`<svg>${SOURCE}</svg>`);
  });

  it('does not request a refresh on cache hits', async () => {
    const h = makeHarness();
    h.fence('plantuml', SOURCE);
    await h.settle();

    const before = h.refreshes();
    h.fence('plantuml', SOURCE);
    h.fence('plantuml', SOURCE);
    await h.settle();

    expect(h.refreshes()).toBe(before);
    expect(h.deps.render).toHaveBeenCalledTimes(1);
  });

  it('does not start a second render while one is in flight', async () => {
    let release: (svg: string) => void = () => undefined;
    const h = makeHarness({
      render: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    });

    h.fence('plantuml', SOURCE);
    h.fence('plantuml', SOURCE);
    await h.started();
    expect(h.deps.render).toHaveBeenCalledTimes(1);

    release('<svg/>');
    await h.settle();
    expect(h.fence('plantuml', SOURCE)).toContain('<svg/>');
  });

  it('shows the failure with the source when rendering rejects', async () => {
    const h = makeHarness({
      render: () => Promise.reject(new Error('Syntax Error line 2')),
    });

    h.fence('plantuml', SOURCE);
    await h.settle();

    const html = h.fence('plantuml', SOURCE);
    expect(html).toContain('plantuml-error');
    expect(html).toContain(LABELS.failedTitle);
    expect(html).toContain('Syntax Error line 2');
    expect(html).toContain('plantuml-source');
  });

  it('explains a diagram that uses an emoji instead of showing the engine error', async () => {
    const h = makeHarness({
      render: () => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js')),
    });

    h.fence('plantuml', SOURCE);
    await h.settle();

    const html = h.fence('plantuml', SOURCE);
    expect(html).toContain(LABELS.emojiUnavailable);
    expect(html).not.toContain('RuntimeException');
    expect(html).toContain('plantuml-source');
  });

  it('escapes HTML in error messages and source', async () => {
    const wicked = '@startuml\n<script>alert(1)</script>\n@enduml';
    const h = makeHarness({
      render: () => Promise.reject(new Error('<img onerror=x>')),
    });

    h.fence('plantuml', wicked);
    await h.settle();

    const html = h.fence('plantuml', wicked);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects an empty source without calling the renderer', () => {
    const h = makeHarness();
    const html = h.fence('plantuml', '   \n  ');
    expect(html).toContain('plantuml-error');
    expect(html).toContain(LABELS.emptySource);
    expect(h.deps.render).not.toHaveBeenCalled();
  });

  it.each([
    '!include https://example.com/theme.puml',
    '  !include http://example.com/theme.puml',
    '!includeurl https://example.com/x.puml',
    '!include_once https://example.com/x.puml',
    '!include_many https://example.com/x.puml',
    '!includesub https://example.com/x.puml!PART',
    '!import https://example.com/x.zip',
    '!theme sunlust from https://example.com/themes',
    '!theme sunlust FROM https://example.com/themes',
    "/' a one-line comment '/\n!include https://example.com/x.puml",
  ])('rejects a URL-based external reference without calling the renderer: %s', (line) => {
    const h = makeHarness();
    const html = h.fence('plantuml', `@startuml\n${line}\nA -> B\n@enduml`);
    expect(html).toContain(LABELS.remoteReference);
    expect(h.deps.render).not.toHaveBeenCalled();
  });

  // The engine draws all of these: the URL is not a directive's argument.
  it.each([
    'title Hello!world https://example.com',
    'A -> B : Wow!great see https://example.com',
    '!$url = "https://example.com"',
    "' !include https://example.com/x.puml",
    "/'\n!include https://example.com/x.puml\n'/",
    '!include <C4/C4_Context>',
  ])('renders a diagram whose URL is not a directive argument: %s', async (line) => {
    const h = makeHarness();
    const html = h.fence('plantuml', `@startuml\n${line}\nA -> B\n@enduml`);
    await h.settle();
    expect(html).not.toContain(LABELS.remoteReference);
    expect(h.deps.render).toHaveBeenCalledTimes(1);
  });

  it('renders dark diagrams with the dark marker class and dark=true', async () => {
    const h = makeHarness({ dark: true });
    h.fence('plantuml', SOURCE);
    await h.settle();

    expect(h.deps.render).toHaveBeenCalledWith(SOURCE, true);
    expect(h.fence('plantuml', SOURCE)).toContain('plantuml-diagram--dark');
  });

  it('draws in the palette the theme can be read in, on the backdrop of that palette', async () => {
    // A theme made for a white page, asked for in a dark editor.
    const h = makeHarness({ dark: true, resolvePalette: () => Promise.resolve(false) });
    h.fence('plantuml', SOURCE);
    await h.settle();

    expect(h.deps.render).toHaveBeenCalledWith(SOURCE, false);
    const html = h.fence('plantuml', SOURCE);
    expect(html).toContain('plantuml-diagram--light');
    expect(html).not.toContain('plantuml-diagram--dark');
  });

  it('caches light and dark renders separately', async () => {
    let dark = false;
    const h = makeHarness();
    h.deps.isDark = () => dark;

    h.fence('plantuml', SOURCE);
    await h.settle();
    dark = true;
    h.fence('plantuml', SOURCE);
    await h.settle();

    expect(h.deps.render).toHaveBeenCalledTimes(2);
  });

  it('clearCache drops results and requests one refresh', async () => {
    const h = makeHarness();
    h.fence('plantuml', SOURCE);
    await h.settle();

    h.plugin.clearCache();
    expect(h.fence('plantuml', SOURCE)).toContain('plantuml-loading');
    await h.settle();
    expect(h.deps.render).toHaveBeenCalledTimes(2);
  });

  describe('while an edited block re-renders', () => {
    const DOC = { currentDocument: 'file:///docs/a.md' };
    const EDITED = '@startuml\nAlice -> Bob : Hello!\n@enduml';

    it('keeps showing the diagram that was there, then the new one', async () => {
      const h = makeHarness();
      h.fence('plantuml', SOURCE, DOC);
      await h.settle();
      expect(h.fence('plantuml', SOURCE, DOC)).toContain(`<svg>${SOURCE}</svg>`);

      const during = h.fence('plantuml', EDITED, DOC);
      expect(during).toContain(`<svg>${SOURCE}</svg>`);
      expect(during).not.toContain('plantuml-loading');

      await h.settle();
      expect(h.fence('plantuml', EDITED, DOC)).toContain(`<svg>${EDITED}</svg>`);
    });

    it('keeps each block in its own place', async () => {
      const h = makeHarness();
      const FIRST = '@startuml\nCarol -> Dave\n@enduml';
      h.fence('plantuml', FIRST, DOC);
      h.fence('plantuml', SOURCE, DOC, [FIRST]);
      await h.settle();
      h.fence('plantuml', FIRST, DOC);
      h.fence('plantuml', SOURCE, DOC, [FIRST]);

      const during = h.fence('plantuml', EDITED, DOC, [FIRST]);
      expect(during).toContain(`<svg>${SOURCE}</svg>`);
      expect(during).not.toContain(`<svg>${FIRST}</svg>`);
    });

    it('never carries a diagram over to another document', async () => {
      const h = makeHarness();
      h.fence('plantuml', SOURCE, DOC);
      await h.settle();
      h.fence('plantuml', SOURCE, DOC);

      expect(h.fence('plantuml', EDITED, { currentDocument: 'file:///docs/b.md' })).toContain('plantuml-loading');
    });

    it('shows the placeholder when the document is not known', async () => {
      const h = makeHarness();
      h.fence('plantuml', SOURCE);
      await h.settle();
      h.fence('plantuml', SOURCE);

      expect(h.fence('plantuml', EDITED)).toContain('plantuml-loading');
    });
  });

  it('supports many diagrams on one page without mixing results', async () => {
    const h = makeHarness();
    const sources = [1, 2, 3, 4, 5].map((n) => `@startuml\nA${n} -> B${n}\n@enduml`);

    for (const source of sources) {
      expect(h.fence('plantuml', source)).toContain('plantuml-loading');
    }
    await h.settle();

    for (const source of sources) {
      expect(h.fence('plantuml', source)).toContain(`<svg>${source}</svg>`);
    }
  });

  it('evicts the oldest cache entries beyond the cap instead of growing forever', async () => {
    const h = makeHarness();

    // Render one diagram, then push it past the eviction horizon.
    h.fence('plantuml', 'first');
    await h.settle();

    for (let i = 0; i < 200; i++) {
      h.fence('plantuml', `filler ${String(i)}`);
    }
    await h.settle();

    // 'first' was evicted, so asking again triggers a fresh render.
    const before = h.deps.render.mock.calls.length;
    h.fence('plantuml', 'first');
    await h.started();
    expect(h.deps.render.mock.calls.length).toBe(before + 1);
  });

  it('evicts on total size too, so a few huge diagrams cannot hold megabytes', async () => {
    // A diagram carrying rasterised sprites is 100-150 KB against a few KB
    // for a plain one, so the entry cap alone is a poor memory bound.
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const h = makeHarness({ render: (source) => Promise.resolve(`<svg>${source}${huge}</svg>`) });

    h.fence('plantuml', 'first');
    await h.settle();
    expect(h.fence('plantuml', 'first')).toContain('<svg>first');

    // Nine more at ~2 MB each pushes the total past the 16 MB budget
    // while staying far below the 200-entry cap.
    for (let i = 0; i < 9; i++) {
      h.fence('plantuml', `big ${String(i)}`);
    }
    await h.settle();

    const before = h.deps.render.mock.calls.length;
    h.fence('plantuml', 'first');
    await h.started();
    expect(h.deps.render.mock.calls.length).toBe(before + 1);
  });

  it('keeps the most recent entry even when it alone exceeds the budget', async () => {
    // Evicting down to empty would make the render that just finished
    // unreachable, and the fence would re-request it forever.
    const enormous = 'x'.repeat(20 * 1024 * 1024);
    const h = makeHarness({ render: () => Promise.resolve(`<svg>${enormous}</svg>`) });

    h.fence('plantuml', 'only');
    await h.settle();

    const before = h.deps.render.mock.calls.length;
    expect(h.fence('plantuml', 'only')).toContain('<svg>');
    expect(h.deps.render.mock.calls.length).toBe(before);
  });
});

describe('exported-image hiding (image rule)', () => {
  type Token = { attrGet(name: string): string | null };
  type ImageRule = (
    tokens: Token[],
    index: number,
    options: unknown,
    env: unknown,
    self: { renderToken: () => string }
  ) => string;

  /** Extends a fresh md object and returns its patched image rule. */
  function imageRule(h: Harness, fallback?: string): ImageRule {
    const md = {
      renderer: {
        rules: fallback !== undefined ? { image: (): string => fallback } : {},
      },
    };
    h.plugin.extendMarkdownIt(md as unknown as Parameters<Harness['plugin']['extendMarkdownIt']>[0]);
    return (md as { renderer: { rules: { image: ImageRule } } }).renderer.rules.image;
  }

  const token = (attrs: Record<string, string>): Token => ({
    attrGet: (name) => attrs[name] ?? null,
  });
  const self = { renderToken: (): string => '<img data-fallback="renderToken">' };

  it('drops an image whose src carries the export marker', () => {
    const rule = imageRule(makeHarness(), '<img data-fallback="original">');
    const marked = token({ src: 'images/orders.svg#plantuml-local' });

    expect(rule([marked], 0, {}, {}, self)).toBe('');
  });

  it('drops it when only data-src carries the marker', () => {
    // VS Code's own image rule wraps this one: it rewrites src to a
    // webview resource URI but stores the original in data-src first.
    const rewritten = token({
      src: 'https://file+.vscode-resource.vscode-cdn.net/c/docs/images/orders.svg',
      'data-src': 'images/orders.svg#plantuml-local',
    });

    const rule = imageRule(makeHarness(), '<img data-fallback="original">');
    expect(rule([rewritten], 0, {}, {}, self)).toBe('');
  });

  it('delegates unmarked images to the previous rule', () => {
    const rule = imageRule(makeHarness(), '<img data-fallback="original">');
    const plain = token({ src: 'images/photo.png' });

    expect(rule([plain], 0, {}, {}, self)).toBe('<img data-fallback="original">');
  });

  it('falls back to renderToken when no previous rule exists', () => {
    const rule = imageRule(makeHarness());
    const plain = token({ src: 'images/photo.png' });

    expect(rule([plain], 0, {}, {}, self)).toBe('<img data-fallback="renderToken">');
  });

  it('shows marked images when hiding is turned off', () => {
    const rule = imageRule(
      makeHarness({ hideExportedImages: false }),
      '<img data-fallback="original">'
    );
    const marked = token({ src: 'images/orders.svg#plantuml-local' });

    expect(rule([marked], 0, {}, {}, self)).toBe('<img data-fallback="original">');
  });
});
