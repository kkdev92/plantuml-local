import { existsSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVscodeStub, type TextEditorStub, type VscodeStub } from './helpers/vscode-stub';

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

function makeEditor(
  path: string,
  text: string,
  line: number,
  options?: { languageId?: string; isUntitled?: boolean }
): TextEditorStub {
  // Mutable so the stub's workspace.applyEdit can write reference lines back.
  let current = text;
  return {
    document: {
      languageId: options?.languageId ?? 'markdown',
      version: 1,
      isUntitled: options?.isUntitled ?? false,
      uri: { toString: () => path },
      getText: () => current,
      lineAt: (at: number) => ({ text: current.split('\n')[at] ?? '' }),
      setText: (next: string) => {
        current = next;
      },
    },
    selection: { active: { line } },
  };
}

const NAMED_BLOCK = ['```plantuml orders', '@startuml', 'Alice -> Bob : hi', '@enduml', '```'].join(
  '\n'
);

describe('export (dist)', () => {
  it('tracks the context keys behind the editor menu as the cursor moves', () => {
    const editor = makeEditor('file:///c/docs/design.md', `intro\n\n${NAMED_BLOCK}\n\nafter`, 3);
    vscodeStub._test.setActiveEditor(editor);

    expect(vscodeStub._test.contextKeys.get('plantumlLocal.hasDiagrams')).toBe(true);
    expect(vscodeStub._test.contextKeys.get('plantumlLocal.cursorInDiagram')).toBe(true);

    // Cursor out of the block: same document, so the scan is reused.
    editor.selection.active.line = 0;
    vscodeStub._test.fireSelection(editor);
    expect(vscodeStub._test.contextKeys.get('plantumlLocal.hasDiagrams')).toBe(true);
    expect(vscodeStub._test.contextKeys.get('plantumlLocal.cursorInDiagram')).toBe(false);

    // A document without diagrams clears both.
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/docs/plain.md', '# prose only', 0));
    expect(vscodeStub._test.contextKeys.get('plantumlLocal.hasDiagrams')).toBe(false);
    expect(vscodeStub._test.contextKeys.get('plantumlLocal.cursorInDiagram')).toBe(false);
  });

  it('export command renders through the worker and writes beside the document', async () => {
    vscodeStub._test.setActiveEditor(
      makeEditor('file:///c/docs/design.md', `intro\n\n${NAMED_BLOCK}`, 3)
    );

    const command = vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg');
    expect(command).toBeDefined();
    await command?.();

    const svg = vscodeStub._test.writtenFiles.get('file:///c/docs/images/orders.svg');
    expect(svg, 'expected images/orders.svg beside the document').toBeDefined();
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('hi');
    expect(svg).not.toMatch(/<script/i);
  });

  it('export-all writes every named block and warns about unnamed ones', async () => {
    const text = [
      '```plantuml first',
      '@startuml',
      'A -> B : one',
      '@enduml',
      '```',
      '',
      '```plantuml second',
      '@startuml',
      'C -> D : two',
      '@enduml',
      '```',
      '',
      '```plantuml',
      '@startuml',
      'E -> F : anonymous',
      '@enduml',
      '```',
    ].join('\n');
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/notes/multi.md', text, 0));

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();

    expect(vscodeStub._test.writtenFiles.get('file:///c/notes/images/first.svg')).toContain('one');
    expect(vscodeStub._test.writtenFiles.get('file:///c/notes/images/second.svg')).toContain('two');
    // The unnamed block is skipped, not guessed at, and the summary says so.
    expect(vscodeStub._test.writtenFiles.size).toBe(3); // orders.svg + these two
    expect(vscodeStub._test.notifications.warn.some((m) => m.includes('unnamed'))).toBe(true);
  });

  it('refuses to export in an untrusted workspace', async () => {
    vscodeStub._test.setActiveEditor(
      makeEditor('file:///c/docs/design.md', `intro\n\n${NAMED_BLOCK}`, 3)
    );
    const before = vscodeStub._test.writtenFiles.size;

    vscodeStub.workspace.isTrusted = false;
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    } finally {
      vscodeStub.workspace.isTrusted = true;
    }

    expect(vscodeStub._test.writtenFiles.size).toBe(before);
    expect(vscodeStub._test.notifications.warn.some((m) => m.includes('trusted'))).toBe(true);
  });

  it('refuses an untitled document, which has no folder to write beside', async () => {
    vscodeStub._test.setActiveEditor(
      makeEditor('untitled:Untitled-1', NAMED_BLOCK, 1, { isUntitled: true })
    );
    const before = vscodeStub._test.writtenFiles.size;

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();

    expect(vscodeStub._test.writtenFiles.size).toBe(before);
    expect(vscodeStub._test.notifications.warn.some((m) => m.includes('Save'))).toBe(true);
  });

  it('never writes outside the document folder, whatever the block is named', async () => {
    // The name is document content, so on someone else's repository it is
    // attacker-controlled; Uri.joinPath would resolve the `..` segments.
    const traversal = ['```plantuml ../../../evil', '@startuml', 'A -> B', '@enduml', '```'].join(
      '\n'
    );
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/docs/evil.md', traversal, 1));
    const before = new Set(vscodeStub._test.writtenFiles.keys());
    vscodeStub._test.inputBoxPrompts.length = 0;

    // The prompt is dismissed (the stub's default), so nothing is written.
    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();

    expect([...vscodeStub._test.writtenFiles.keys()].filter((k) => !before.has(k))).toEqual([]);
    // The unusable name is treated as no name: the user is asked for one.
    expect(vscodeStub._test.inputBoxPrompts).toHaveLength(1);
  });

  it('exports under the name given at the prompt when the block has none', async () => {
    const unnamed = ['```plantuml', '@startuml', 'A -> B : prompted', '@enduml', '```'].join('\n');
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/asked/doc.md', unnamed, 1));
    vscodeStub._test.inputBoxReply = 'chosen-name';

    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    } finally {
      vscodeStub._test.inputBoxReply = null;
    }

    expect(vscodeStub._test.writtenFiles.get('file:///c/asked/images/chosen-name.svg')).toContain(
      'prompted'
    );
  });

  it('update-references inserts marked lines after each block and is idempotent', async () => {
    const text = [
      '# doc',
      '',
      '```plantuml refone',
      '@startuml',
      'A -> B : r1',
      '@enduml',
      '```',
      '',
      'body text',
      '',
      '```plantuml reftwo',
      '@startuml',
      'C -> D : r2',
      '@enduml',
      '```',
    ].join('\n');
    const editor = makeEditor('file:///c/refs/doc.md', text, 0);
    vscodeStub._test.setActiveEditor(editor);

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllAndUpdateRefs')?.();

    const after = editor.document.getText();
    // The SVGs were written and each block gained its marked reference,
    // separated from the fence and the following prose by blank lines.
    expect(vscodeStub._test.writtenFiles.get('file:///c/refs/images/refone.svg')).toContain('r1');
    expect(vscodeStub._test.writtenFiles.get('file:///c/refs/images/reftwo.svg')).toContain('r2');
    expect(after).toContain('```\n\n![refone](images/refone.svg#plantuml-local)\n\nbody text');
    expect(after.endsWith('![reftwo](images/reftwo.svg#plantuml-local)')).toBe(true);

    // Running it again re-exports but must not touch the document.
    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllAndUpdateRefs')?.();
    expect(editor.document.getText()).toBe(after);
  });

  it('exportTheme=dark renders the exported SVG in the dark palette', async () => {
    vscodeStub._test.setConfiguration('exportTheme', 'dark');
    try {
      const editor = makeEditor('file:///c/dark/doc.md', NAMED_BLOCK, 1);
      vscodeStub._test.setActiveEditor(editor);

      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    } finally {
      vscodeStub._test.setConfiguration('exportTheme', undefined);
    }

    const dark = vscodeStub._test.writtenFiles.get('file:///c/dark/images/orders.svg');
    const light = vscodeStub._test.writtenFiles.get('file:///c/docs/images/orders.svg');
    expect(dark).toBeDefined();
    // Same source as the earlier default-palette export; dark output draws
    // white text where light does not.
    expect(dark).not.toBe(light);
    expect(dark).toContain('#FFFFFF');
  });
});
