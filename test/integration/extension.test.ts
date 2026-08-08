import { existsSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVscodeStub, type VscodeStub } from './helpers/vscode-stub';

/**
 * Loads the built dist/extension.js with a stubbed `vscode` module and
 * exercises the whole pipeline: fence dispatch → worker render →
 * cache → preview refresh. Requires `npm run bundle`.
 */

const extensionPath = join(__dirname, '../../dist/extension.js');
const require = createRequire(import.meta.url);

/**
 * `activate` is asynchronous: the framework starts hosted services inside it,
 * and the plugin does not exist until they have run. VS Code awaits it before
 * reading `extendMarkdownIt` off the resolved value — `getContributedMarkdownItPlugins`
 * in markdown-language-features stores the thenable and awaits it — so this
 * mirrors what the editor does.
 */
interface ExtensionModule {
  activate(context: unknown): Promise<{
    extendMarkdownIt(md: unknown): { renderer: { rules: Record<string, unknown> } };
  }>;
  deactivate(): Promise<void>;
}

let vscodeStub: VscodeStub;
let extension: ExtensionModule;
/**
 * Enough of an ExtensionContext for the framework to build every capability
 * adapter. It wires storage, secrets and webviews at activation regardless of
 * whether the extension declares any, so these have to exist even though this
 * extension uses none of them.
 */
interface ContextStub {
  subscriptions: { dispose(): void }[];
  globalState: { get(): undefined; update(): Promise<void>; keys(): string[]; setKeysForSync(): void };
  workspaceState: { get(): undefined; update(): Promise<void>; keys(): string[] };
  secrets: { get(): Promise<undefined>; store(): Promise<void>; delete(): Promise<void> };
  extensionUri: unknown;
}

function createContextStub(): ContextStub {
  return {
    subscriptions: [],
    globalState: {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
      setKeysForSync: () => undefined,
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: { get: async () => undefined, store: async () => undefined, delete: async () => undefined },
    extensionUri: { scheme: 'file', fsPath: '/ext', toString: () => 'file:///ext' },
  };
}

let context: ContextStub;
let api: Awaited<ReturnType<ExtensionModule['activate']>>;
let restoreLoad: (() => void) | null = null;

type FenceRule = (
  tokens: { info: string; content: string }[],
  index: number,
  options: unknown,
  env: unknown,
  self: { renderToken: () => string }
) => string;

function makeMd(fallback?: () => string): { renderer: { rules: { fence?: FenceRule } } } {
  return { renderer: { rules: fallback !== undefined ? { fence: fallback } : {} } };
}

function callFence(md: { renderer: { rules: { fence?: FenceRule } } }, info: string, content: string): string {
  const rule = md.renderer.rules.fence;
  if (rule === undefined) {
    throw new Error('fence rule missing');
  }
  return rule([{ info, content }], 0, {}, {}, {
    renderToken: () => '<pre data-fallback="renderToken"></pre>',
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 60_000): Promise<boolean> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function waitForRender(
  md: { renderer: { rules: { fence?: FenceRule } } },
  info: string,
  content: string
): Promise<string> {
  let html = '';
  const done = await waitFor(() => {
    html = callFence(md, info, content);
    return !html.includes('plantuml-loading');
  });
  expect(done, 'render did not settle in time').toBe(true);
  return html;
}

beforeAll(async () => {
  expect(existsSync(extensionPath), 'dist/extension.js missing — run `npm run bundle` first').toBe(true);

  vscodeStub = createVscodeStub();

  // dist/extension.js is CJS; intercept its require('vscode').
  const moduleAny = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
  };
  const originalLoad = moduleAny._load.bind(Module);
  moduleAny._load = (request: string, ...rest: unknown[]): unknown => {
    if (request === 'vscode') {
      return vscodeStub;
    }
    return originalLoad(request, ...rest);
  };
  restoreLoad = () => {
    moduleAny._load = originalLoad;
  };

  extension = require(extensionPath) as ExtensionModule;
  context = createContextStub();
  api = await extension.activate(context);
});

afterAll(async () => {
  // `deactivate` is the single cleanup path — it stops the worker thread and
  // cancels the pending refresh. Disposing the subscriptions afterwards only
  // fires the framework's synchronous failsafe, which is idempotent.
  await extension.deactivate();
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  restoreLoad?.();
});

describe('extension (dist)', () => {
  it('activate returns extendMarkdownIt and registers disposables', () => {
    expect(typeof api.extendMarkdownIt).toBe('function');
    expect(context.subscriptions.length).toBeGreaterThan(0);
  });

  it('registers the clear-cache command', () => {
    expect(vscodeStub._test.registeredCommands.has('plantumlLocal.clearCache')).toBe(true);
  });

  it('leaves non-plantuml fences untouched', () => {
    const md = makeMd(() => '<pre data-fallback="original"></pre>');
    api.extendMarkdownIt(md);

    for (const language of ['js', 'ts', 'bash', 'json', 'mermaid', '']) {
      expect(callFence(md, language, 'const a = 1')).toBe('<pre data-fallback="original"></pre>');
    }
  });

  it('renders a plantuml fence through the real worker', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);

    const first = callFence(md, 'plantuml', '@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(first).toContain('plantuml-loading');

    const done = await waitForRender(md, 'plantuml', '@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(done).toContain('plantuml-diagram--light');
    expect(done).toMatch(/<svg/);
    expect(done).toContain('Hello');
  });

  it('requests a preview refresh after rendering', async () => {
    const fired = await waitFor(() =>
      vscodeStub._test.executedCommands.includes('markdown.preview.refresh')
    );
    expect(fired).toBe(true);
  });

  it('serves repeat requests from cache without extra refreshes', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    await waitForRender(md, 'plantuml', '@startuml\nAlice -> Bob : Hello\n@enduml');

    // Let pending debounced refreshes drain before counting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const before = vscodeStub._test.executedCommands.length;

    const html = callFence(md, 'plantuml', '@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(html).toMatch(/<svg/);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(vscodeStub._test.executedCommands.length).toBe(before);
  });

  it('renders CJK (full-width) labels end to end', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);

    // CJK fixture text is required to exercise the full-width metrics path.
    const html = await waitForRender(md, 'plantuml', '@startuml\nactor "利用者" as U\nU -> B : 追加\n@enduml');
    expect(html).toContain('追加');
  });

  it('rejects empty sources inline', () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const html = callFence(md, 'plantuml', '   \n  ');
    expect(html).toContain('plantuml-error');
    expect(html).toContain('source is empty');
  });

  it('rejects URL-based external references inline', () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const html = callFence(md, 'plantuml', '@startuml\n!include https://example.com/x.puml\n@enduml');
    expect(html).toContain('plantuml-error');
    expect(html).toContain('not supported');
  });

  it('re-renders in the dark palette after a theme change', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const source = '@startuml\nClient -> API : call\n@enduml';

    const light = await waitForRender(md, 'plantuml', source);
    expect(light).toContain('plantuml-diagram--light');

    vscodeStub._test.setThemeKind(vscodeStub.ColorThemeKind.Dark);
    try {
      const dark = await waitForRender(md, 'plantuml', source);
      expect(dark).toContain('plantuml-diagram--dark');
      // Dark renders draw white text; the stylesheet supplies the backdrop.
      expect(dark).toContain('#FFFFFF');
      expect(dark).not.toBe(light);
    } finally {
      vscodeStub._test.setThemeKind(vscodeStub.ColorThemeKind.Light);
    }
  });

  it('clear-cache command empties the cache and re-renders', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const source = '@startuml\nCache -> Test : again\n@enduml';

    await waitForRender(md, 'plantuml', source);

    const command = vscodeStub._test.registeredCommands.get('plantumlLocal.clearCache');
    expect(command).toBeDefined();
    await command?.();

    expect(callFence(md, 'plantuml', source)).toContain('plantuml-loading');
    const again = await waitForRender(md, 'plantuml', source);
    expect(again).toMatch(/<svg/);
  });

  it('handles five diagrams on one page', async () => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const sources = [1, 2, 3, 4, 5].map(
      (n) => `@startuml\nP${String(n)} -> Q${String(n)} : msg${String(n)}\n@enduml`
    );

    for (const source of sources) {
      expect(callFence(md, 'plantuml', source)).toContain('plantuml-loading');
    }

    for (const [index, source] of sources.entries()) {
      const html = await waitForRender(md, 'plantuml', source);
      expect(html).toMatch(/<svg/);
      expect(html).toContain(`msg${String(index + 1)}`);
    }
  });
});
