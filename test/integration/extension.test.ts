import { existsSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVscodeStub, type CompletionItemStub, type TextEditorStub, type VscodeStub } from './helpers/vscode-stub';

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
      uri: {
        toString: () => path,
        scheme: path.slice(0, path.indexOf(':')),
        path: path.replace(/^[a-z][\w+.-]*:(\/\/[^/]*)?/i, ''),
      },
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

  describe('diagnostics', () => {
    const DOCUMENT = [
      '# Doc',
      '',
      '```plantuml syntax',
      '@startuml',
      'Alice -> Bob',
      'this is not valid ;;; [[[',
      '@enduml',
      '```',
      '',
      '> ```plantuml quoted',
      '> @startuml',
      '> Alice -> Bob',
      '> !include shared.puml',
      '> @enduml',
      '> ```',
      '',
      '```plantuml two',
      '@startuml',
      'A -> B',
      '@enduml',
      '@startuml',
      'C -> D',
      '@enduml',
      '```',
      '',
      '```plantuml sub',
      '@startuml',
      '!includesub shared.puml!PART',
      'Alice -> Bob',
      '@enduml',
      '```',
      '',
      '```plantuml open',
      '@startuml',
      'Alice -> Bob',
      '```',
      '',
      '```plantuml warned',
      '@startuml',
      'start',
      '#pink:deprecated colour',
      'second line;',
      'stop',
      '@enduml',
      '```',
    ].join('\n');

    /** Waits until the document's problems satisfy `ready`, then returns them. */
    async function problemsOf(
      uri: string,
      ready: (found: readonly { message: string; code?: unknown }[]) => boolean
    ): Promise<{ line: number; character: number; code: unknown; severity: number; message: string }[]> {
      for (let waited = 0; waited < 30_000; waited += 100) {
        const found = vscodeStub._test.diagnostics.get(uri);
        if (found !== undefined && ready(found)) {
          return found.map((d) => ({
            line: d.range.start.line,
            character: d.range.start.character,
            code: d.code,
            severity: d.severity,
            message: d.message,
          }));
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`no problems for ${uri}: ${JSON.stringify(vscodeStub._test.diagnostics.get(uri))}`);
    }

    it('puts each problem on its line: engine errors and warnings, and what the engine drops', async () => {
      const uri = 'file:///c/diag/doc.md';
      const document = makeEditor(uri, DOCUMENT, 0).document;
      vscodeStub._test.openDocument(document);
      try {
        const found = await problemsOf(uri, (items) => items.length >= 6);
        const ERROR = vscodeStub.DiagnosticSeverity.Error;
        const WARNING = vscodeStub.DiagnosticSeverity.Warning;
        expect(found.map((p) => [p.line, p.code, p.severity])).toEqual([
          [5, 'PLLOCAL-SYN001', ERROR],
          [12, 'PLLOCAL-CAP001', ERROR],
          [20, 'PLLOCAL-DOC003', ERROR],
          [27, 'PLLOCAL-CAP001', WARNING],
          [33, 'PLLOCAL-DOC002', WARNING],
          [38, 'PLLOCAL-WRN001', WARNING],
        ]);
        expect(found[0]?.message).toContain('Syntax Error?');
        // In the quote, past the marker; and an explanation, not the engine's bare words.
        expect(found[1]?.character).toBe(2);
        expect(found[1]?.message).toBe('cannot include shared.puml: the bundled engine reads no files.');
        expect(found[4]?.message).toContain('@enduml');
        expect(found[5]?.message).toContain('deprecated');
      } finally {
        vscodeStub._test.closeDocument(document);
      }
      // Closing the document takes its problems away.
      expect(vscodeStub._test.diagnostics.has(uri)).toBe(false);
    });

    it('drops a document’s problems as soon as it changes, then checks it again', async () => {
      const uri = 'file:///c/diag/edit.md';
      const editor = makeEditor(uri, '```plantuml broken\n@startuml\nthis is not valid ;;; [[[\n@enduml\n```', 0);
      vscodeStub._test.openDocument(editor.document);
      try {
        await problemsOf(uri, (items) => items.length === 1);

        editor.document.setText('```plantuml broken\n@startuml\nAlice -> Bob\n@enduml\n```');
        vscodeStub._test.changeDocument(editor.document);
        expect(vscodeStub._test.diagnostics.has(uri)).toBe(false);

        expect(await problemsOf(uri, () => true)).toEqual([]);
      } finally {
        vscodeStub._test.closeDocument(editor.document);
      }
    });

    it('reports nothing when turned off', async () => {
      const uri = 'file:///c/diag/off.md';
      vscodeStub._test.setConfiguration('diagnostics.enabled', false);
      const document = makeEditor(uri, '```plantuml broken\n@startuml\nthis is not valid ;;; [[[\n@enduml\n```', 0).document;
      try {
        vscodeStub._test.openDocument(document);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(vscodeStub._test.diagnostics.has(uri)).toBe(false);
      } finally {
        vscodeStub._test.closeDocument(document);
        vscodeStub._test.setConfiguration('diagnostics.enabled', undefined);
      }
    });
  });

  describe('when no Markdown editor has focus', () => {
    // A focused preview leaves no active text editor at all; a focused file
    // of another language is the same situation for these commands.
    const TWO_BLOCKS = [NAMED_BLOCK, '', NAMED_BLOCK.replace('orders', 'billing')].join('\n');

    function reset(): void {
      vscodeStub._test.openDocuments.length = 0;
      vscodeStub._test.visibleEditors.length = 0;
      vscodeStub._test.quickPickReply = null;
    }

    it('export-all uses the only open Markdown document without asking', async () => {
      vscodeStub._test.setActiveEditor(
        makeEditor('file:///c/only/index.ts', 'const x = 1;', 0, { languageId: 'typescript' })
      );
      vscodeStub._test.openDocuments.push(makeEditor('file:///c/only/doc.md', NAMED_BLOCK, 0).document);
      const picksBefore = vscodeStub._test.quickPicksShown.length;
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.writtenFiles.get('file:///c/only/images/orders.svg')).toContain('hi');
      expect(vscodeStub._test.quickPicksShown.length).toBe(picksBefore);
    });

    it('export-all leaves out Markdown documents it cannot export beside', async () => {
      // A notebook's Markdown cell and the git side of a diff are Markdown
      // documents too; neither is a file to write next to.
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.openDocuments.push(
        makeEditor('vscode-notebook-cell:/c/cells/notes.ipynb#W0', 'Notes', 0).document,
        makeEditor('git:/c/cells/doc.md?ref', NAMED_BLOCK, 0).document,
        makeEditor('file:///c/cells/doc.md', NAMED_BLOCK, 0).document
      );
      const picksBefore = vscodeStub._test.quickPicksShown.length;
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.quickPicksShown.length).toBe(picksBefore);
      expect(vscodeStub._test.writtenFiles.get('file:///c/cells/images/orders.svg')).toContain('hi');
    });

    it('export-all asks which document when several are open, rather than taking a visible one', async () => {
      vscodeStub._test.setActiveEditor(undefined);
      const visible = makeEditor('file:///c/two/visible.md', NAMED_BLOCK, 0);
      const previewed = makeEditor('file:///c/two/previewed.md', NAMED_BLOCK.replace('orders', 'billing'), 0);
      vscodeStub._test.visibleEditors.push(visible);
      vscodeStub._test.openDocuments.push(previewed.document, visible.document);
      vscodeStub._test.quickPickReply = 'two/previewed.md';
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        reset();
      }

      // Visible documents are listed first; the choice, not visibility, decides.
      expect(vscodeStub._test.quickPicksShown.at(-1)).toEqual({
        title: 'Choose the Markdown document to export from',
        labels: ['two/visible.md', 'two/previewed.md'],
      });
      expect(vscodeStub._test.writtenFiles.has('file:///c/two/images/billing.svg')).toBe(true);
      expect(vscodeStub._test.writtenFiles.has('file:///c/two/images/orders.svg')).toBe(false);
    });

    it('export-all writes nothing when the choice is dismissed', async () => {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.openDocuments.push(
        makeEditor('file:///c/dismissed/a.md', NAMED_BLOCK, 0).document,
        makeEditor('file:///c/dismissed/b.md', NAMED_BLOCK, 0).document
      );
      const warningsBefore = vscodeStub._test.notifications.warn.length;
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        reset();
      }

      expect([...vscodeStub._test.writtenFiles.keys()].some((k) => k.startsWith('file:///c/dismissed/'))).toBe(false);
      expect(vscodeStub._test.notifications.warn.length).toBe(warningsBefore);
    });

    it('export warns when no Markdown document is open at all', async () => {
      vscodeStub._test.setActiveEditor(undefined);
      const picksBefore = vscodeStub._test.quickPicksShown.length;
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.notifications.warn.at(-1)).toBe('Open a Markdown file first.');
      expect(vscodeStub._test.quickPicksShown.length).toBe(picksBefore);
    });

    it('export takes the only block of a document that has no visible editor', async () => {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.openDocuments.push(makeEditor('file:///c/lone/doc.md', NAMED_BLOCK, 0).document);
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.writtenFiles.get('file:///c/lone/images/orders.svg')).toContain('hi');
    });

    it('export needs the cursor when such a document has several blocks', async () => {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.openDocuments.push(makeEditor('file:///c/several/doc.md', TWO_BLOCKS, 0).document);
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.notifications.warn.at(-1)).toBe(
        'Put the cursor inside a ```plantuml block first.'
      );
      expect([...vscodeStub._test.writtenFiles.keys()].some((k) => k.startsWith('file:///c/several/'))).toBe(false);
    });

    it("export uses the cursor of the chosen document's own editor", async () => {
      vscodeStub._test.setActiveEditor(undefined);
      // Cursor on line 7: inside the second block (lines 6-10).
      const editor = makeEditor('file:///c/cursor/doc.md', TWO_BLOCKS, 7);
      vscodeStub._test.visibleEditors.push(editor);
      vscodeStub._test.openDocuments.push(editor.document);
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        reset();
      }

      expect(vscodeStub._test.writtenFiles.has('file:///c/cursor/images/billing.svg')).toBe(true);
      expect(vscodeStub._test.writtenFiles.has('file:///c/cursor/images/orders.svg')).toBe(false);
    });
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

  it('update-references leaves the references alone when the document changed during the export', async () => {
    const text = ['```plantuml moving', '@startuml', 'A -> B : m', '@enduml', '```'].join('\n');
    const editor = makeEditor('file:///c/moving/doc.md', text, 0);
    // An edit while the export runs: the version moves once the SVG is written.
    const svg = 'file:///c/moving/images/moving.svg';
    Object.defineProperty(editor.document, 'version', {
      get: () => (vscodeStub._test.writtenFiles.has(svg) ? 2 : 1),
    });
    vscodeStub._test.setActiveEditor(editor);
    const warningsBefore = vscodeStub._test.notifications.warn.length;

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllAndUpdateRefs')?.();

    expect(vscodeStub._test.writtenFiles.get(svg)).toContain('m');
    expect(editor.document.getText()).toBe(text);
    const warning = vscodeStub._test.notifications.warn.slice(warningsBefore).join('\n');
    expect(warning).toContain('Exported 1 diagram(s)');
    expect(warning).toContain('The document changed during the export, so the references were not updated');
  });

  it('update-references links no block that the engine could not render', async () => {
    const text = [
      '```plantuml working',
      '@startuml',
      'A -> B : fine',
      '@enduml',
      '```',
      '',
      '```plantuml broken',
      '@startuml',
      'this is not valid ;;; [[[',
      '@enduml',
      '```',
    ].join('\n');
    const editor = makeEditor('file:///c/broken/doc.md', text, 0);
    vscodeStub._test.setActiveEditor(editor);
    const warningsBefore = vscodeStub._test.notifications.warn.length;
    const logsBefore = vscodeStub._test.logs.length;

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllAndUpdateRefs')?.();

    // The engine drew its error diagram for the broken block: it must be
    // neither written as the diagram nor linked from the document.
    expect(vscodeStub._test.writtenFiles.get('file:///c/broken/images/working.svg')).toContain('fine');
    expect(vscodeStub._test.writtenFiles.has('file:///c/broken/images/broken.svg')).toBe(false);
    const after = editor.document.getText();
    expect(after).toContain('![working](images/working.svg#plantuml-local)');
    expect(after).not.toContain('broken.svg');
    expect(vscodeStub._test.notifications.warn.slice(warningsBefore).some((m) => m.includes('failed'))).toBe(true);

    // The reference inserted above the broken block pushed it down: the
    // reason names the line it is on now, not the one the export read.
    const now = after.split('\n').indexOf('this is not valid ;;; [[[') + 1;
    expect(now).toBe(text.split('\n').indexOf('this is not valid ;;; [[[') + 1 + 2);
    const reason = vscodeStub._test.logs
      .slice(logsBefore)
      .find((line) => line.startsWith('warn: Export failed for broken:'));
    expect(reason).toContain(`PlantUML reported an error at line ${String(now)}: Syntax Error?`);
  });

  it('export-all names the line of a failed block as the document has it', async () => {
    const text = [
      '# Title',
      '',
      '```plantuml broken',
      '@startuml',
      'this is not valid ;;; [[[',
      '@enduml',
      '```',
    ].join('\n');
    const editor = makeEditor('file:///c/plain/doc.md', text, 0);
    vscodeStub._test.setActiveEditor(editor);
    const logsBefore = vscodeStub._test.logs.length;

    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();

    // Nothing is inserted, so the line stays where the export read it.
    expect(editor.document.getText()).toBe(text);
    const reason = vscodeStub._test.logs
      .slice(logsBefore)
      .find((line) => line.startsWith('warn: Export failed for broken:'));
    expect(reason).toContain('PlantUML reported an error at line 5: Syntax Error?');
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

  it('reads the export settings for the document, so a folder can have its own', async () => {
    vscodeStub._test.setConfiguration('exportDirectory', 'diagrams', 'file:///c/own');
    vscodeStub._test.setConfiguration('exportTheme', 'dark', 'file:///c/own');
    try {
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/own/doc.md', NAMED_BLOCK, 1));
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/other/doc.md', NAMED_BLOCK, 1));
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    } finally {
      vscodeStub._test.setConfiguration('exportDirectory', undefined, 'file:///c/own');
      vscodeStub._test.setConfiguration('exportTheme', undefined, 'file:///c/own');
    }

    expect(vscodeStub._test.writtenFiles.get('file:///c/own/diagrams/orders.svg')).toBe(
      vscodeStub._test.writtenFiles.get('file:///c/dark/images/orders.svg')
    );
    expect(vscodeStub._test.writtenFiles.get('file:///c/other/images/orders.svg')).toBe(
      vscodeStub._test.writtenFiles.get('file:///c/docs/images/orders.svg')
    );
  });

  describe('PlantUML files', () => {
    const FLOWS = [
      '@startuml(id=orders)',
      'Alice -> Bob : orders',
      '@enduml',
      '',
      '@startuml',
      'Carol -> Dave : unnamed',
      '@enduml',
      '',
      '@startuml(id=billing)',
      'Erin -> Frank : billing',
      '@enduml',
    ].join('\n');
    const pumlEditor = (path: string, text: string, line: number): TextEditorStub =>
      makeEditor(path, text, line, { languageId: 'plantuml' });

    it('tracks the context keys behind the editor menu', () => {
      const editor = pumlEditor('file:///c/puml/flows.puml', FLOWS, 1);
      vscodeStub._test.setActiveEditor(editor);

      expect(vscodeStub._test.contextKeys.get('plantumlLocal.hasDiagrams')).toBe(true);
      expect(vscodeStub._test.contextKeys.get('plantumlLocal.cursorInDiagram')).toBe(true);

      // The blank line between two diagrams belongs to neither.
      editor.selection.active.line = 3;
      vscodeStub._test.fireSelection(editor);
      expect(vscodeStub._test.contextKeys.get('plantumlLocal.cursorInDiagram')).toBe(false);
    });

    it('export writes the diagram under the cursor, named by its id', async () => {
      vscodeStub._test.setActiveEditor(pumlEditor('file:///c/puml/flows.puml', FLOWS, 9));

      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();

      expect(vscodeStub._test.writtenFiles.get('file:///c/puml/images/billing.svg')).toContain(
        'billing'
      );
      expect(vscodeStub._test.writtenFiles.has('file:///c/puml/images/orders.svg')).toBe(false);
    });

    it('export names the only diagram of a file after the file', async () => {
      vscodeStub._test.setActiveEditor(
        pumlEditor('file:///c/puml/sequence.puml', '@startuml\nAlice -> Bob : single\n@enduml\n', 5)
      );

      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();

      expect(vscodeStub._test.writtenFiles.get('file:///c/puml/images/sequence.svg')).toContain(
        'single'
      );
    });

    it('export-all writes the named diagrams and says how to name the rest', async () => {
      vscodeStub._test.setActiveEditor(pumlEditor('file:///c/pumlall/flows.puml', FLOWS, 0));

      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();

      expect(vscodeStub._test.writtenFiles.get('file:///c/pumlall/images/orders.svg')).toContain(
        'orders'
      );
      expect(vscodeStub._test.writtenFiles.get('file:///c/pumlall/images/billing.svg')).toContain(
        'billing'
      );
      expect(vscodeStub._test.notifications.warn.at(-1)).toBe(
        'Exported 2 diagram(s) · 1 unnamed diagram(s) skipped — name one with @startuml(id=my-diagram)'
      );
    });
  });

  describe('existing files', () => {
    const exportSvg = async (): Promise<void> => {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    };

    it('writes a temporary file beside the target and renames it over the target', async () => {
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/staged/doc.md', NAMED_BLOCK, 1));
      const writesBefore = vscodeStub._test.fileWrites.length;

      await exportSvg();

      // Never the target itself: a write that stopped part way would leave
      // half an image under the name the document links to.
      expect(vscodeStub._test.fileWrites.slice(writesBefore)).toEqual([
        expect.stringMatching(/^file:\/\/\/c\/staged\/images\/\.orders\.svg\.[0-9a-f]{8}\.tmp$/),
      ]);
      expect(vscodeStub._test.writtenFiles.get('file:///c/staged/images/orders.svg')).toContain('hi');
      expect([...vscodeStub._test.writtenFiles.keys()].filter((key) => key.endsWith('.tmp'))).toEqual(
        []
      );
    });

    it('asks before replacing a file that holds something else, and keeps it unless told to', async () => {
      const target = 'file:///c/handmade/images/orders.svg';
      vscodeStub._test.writtenFiles.set(target, '<svg>drawn by hand</svg>');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/handmade/doc.md', NAMED_BLOCK, 1));
      const modalsBefore = vscodeStub._test.modals.length;

      // Dismissed, as the stub answers by default.
      await exportSvg();

      expect(vscodeStub._test.modals.slice(modalsBefore)).toEqual([
        {
          message: 'handmade/images/orders.svg already exists with different contents. Replace it?',
          detail: undefined,
          buttons: ['Replace'],
        },
      ]);
      expect(vscodeStub._test.writtenFiles.get(target)).toBe('<svg>drawn by hand</svg>');

      vscodeStub._test.messageReply = 'Replace';
      try {
        await exportSvg();
      } finally {
        vscodeStub._test.messageReply = null;
      }
      expect(vscodeStub._test.writtenFiles.get(target)).toContain('hi');

      // Now the file holds the diagram: exporting again neither asks nor writes.
      const modalsAfter = vscodeStub._test.modals.length;
      const writesAfter = vscodeStub._test.fileWrites.length;
      await exportSvg();
      expect(vscodeStub._test.modals.length).toBe(modalsAfter);
      expect(vscodeStub._test.fileWrites.length).toBe(writesAfter);
    });

    it('export-all asks once for every file it would replace, and can keep them', async () => {
      const text = [
        '```plantuml kept-a',
        '@startuml',
        'A -> B : a',
        '@enduml',
        '```',
        '',
        '```plantuml kept-b',
        '@startuml',
        'A -> B : b',
        '@enduml',
        '```',
        '',
        '```plantuml fresh',
        '@startuml',
        'A -> B : new',
        '@enduml',
        '```',
      ].join('\n');
      vscodeStub._test.writtenFiles.set('file:///c/bulk/images/kept-a.svg', 'old a');
      vscodeStub._test.writtenFiles.set('file:///c/bulk/images/kept-b.svg', 'old b');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/bulk/doc.md', text, 0));
      const modalsBefore = vscodeStub._test.modals.length;

      vscodeStub._test.messageReply = 'Keep Existing';
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        vscodeStub._test.messageReply = null;
      }

      expect(vscodeStub._test.modals.slice(modalsBefore)).toEqual([
        {
          message: '2 files already exist with different contents. Replace them?',
          detail: 'bulk/images/kept-a.svg\nbulk/images/kept-b.svg',
          buttons: ['Replace', 'Keep Existing'],
        },
      ]);
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/kept-a.svg')).toBe('old a');
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/kept-b.svg')).toBe('old b');
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/fresh.svg')).toContain('new');
      expect(vscodeStub._test.notifications.info.at(-1)).toBe(
        'Exported 1 diagram(s) · 2 existing file(s) kept'
      );
    });

    it('never writes over a folder of the same name', async () => {
      vscodeStub._test.writtenFiles.set('file:///c/folder/images/orders.svg/inside.txt', 'kept');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/folder/doc.md', NAMED_BLOCK, 1));

      await exportSvg();

      // Renaming over it would have deleted the folder and what it holds.
      expect(vscodeStub._test.writtenFiles.get('file:///c/folder/images/orders.svg/inside.txt')).toBe(
        'kept'
      );
      expect(vscodeStub._test.writtenFiles.has('file:///c/folder/images/orders.svg')).toBe(false);
      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: folder/images/orders.svg is a folder, not a file.'
      );
    });

    it('removes the temporary file when the rename fails', async () => {
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/failing/doc.md', NAMED_BLOCK, 1));

      vscodeStub._test.failRename = true;
      try {
        await exportSvg();
      } finally {
        vscodeStub._test.failRename = false;
      }

      expect(
        [...vscodeStub._test.writtenFiles.keys()].filter((key) => key.startsWith('file:///c/failing/'))
      ).toEqual([]);
      expect(vscodeStub._test.notifications.error.at(-1)).toMatch(/^Could not export the diagram: /);
    });
  });
});

describe('completion (dist)', () => {
  const complete = (
    document: TextEditorStub['document'],
    line: number,
    character: number
  ): CompletionItemStub[] | undefined =>
    vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
      document,
      new vscodeStub.Position(line, character)
    );

  it('is registered for Markdown and PlantUML files, opening on the characters suggestions follow', () => {
    expect(vscodeStub._test.completionProviders).toHaveLength(1);
    expect(vscodeStub._test.completionProviders[0]?.selector).toEqual([
      { language: 'markdown' },
      { language: 'plantuml' },
    ]);
    expect(vscodeStub._test.completionProviders[0]?.triggers).toEqual(['@', '!', '&', ' ']);
  });

  it('suggests in the diagram blocks of a Markdown document only', () => {
    const document = makeEditor(
      'file:///c/complete/doc.md',
      ['# Title', '@', '```js', '@', '```', '```plantuml', '@', '```'].join('\n'),
      0
    ).document;

    expect(complete(document, 1, 1)).toBeUndefined();
    expect(complete(document, 3, 1)).toBeUndefined();
    const items = complete(document, 6, 1);
    expect(items?.[0]).toMatchObject({ label: '@startuml', insertText: '@startuml' });
    expect(items?.[0]?.range?.replacing.start).toEqual({ line: 6, character: 0 });
  });

  it('offers the themes and icons the engine ships, read from its files', () => {
    const document = makeEditor(
      'file:///c/complete/flows.puml',
      ['@startuml', '!theme ', 'A -> B : <&', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;

    const themes = complete(document, 1, 7)?.map((item) => item.label);
    expect(themes).toContain('cerulean');
    // Left out of the package for the licence its header declares.
    expect(themes).not.toContain('mars');
    expect(themes).toHaveLength(40);

    const icons = complete(document, 2, 11);
    expect(icons).toHaveLength(223);
    expect(icons?.find((item) => item.label === 'heart')?.insertText).toBe('heart>');
  });

  it('leaves the quote markers of a block in a quote outside what it replaces', () => {
    const document = makeEditor(
      'file:///c/complete/quote.md',
      ['> ```plantuml', '> @startuml', '> @en', '> ```'].join('\n'),
      0
    ).document;

    const items = complete(document, 2, 5);
    expect(items?.map((item) => item.label)).toEqual(['@enduml']);
    expect(items?.[0]?.range?.replacing).toEqual({
      start: { line: 2, character: 2 },
      end: { line: 2, character: 5 },
    });
  });
});
