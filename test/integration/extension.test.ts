import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContextStub, type ContextStub } from './helpers/context-stub';
import {
  createVscodeStub,
  type CancellationTokenStub,
  type CodeActionStub,
  type CodeLensStub,
  type ColorInformationStub,
  type ColorRegistrationStub,
  type CompletionItemStub,
  type DiagnosticStub,
  type DocumentSymbolStub,
  type FileWatcherStub,
  type FoldingRangeStub,
  type MarkdownStringStub,
  type RenameRegistrationStub,
  type SignatureHelpStub,
  type SymbolInformationStub,
  type TextEditorStub,
  type TreeItemStub,
  type TreeViewHandle,
  type UriStub,
  type VscodeStub,
  type WebviewPanelStub,
  type WorkspaceSymbolRegistrationStub,
} from './helpers/vscode-stub';
import { englishMessages } from '../../src/core/messages';
import { expandSnippet, SNIPPETS } from '../../src/language/completion';
import {
  codeBlock,
  escapeLines,
  escapeMarkdown,
  helpFor,
  helpMarkdown,
  inlineCode,
  type BuiltinTarget,
} from '../../src/language/hover';
import { propertyHelp, skinparamHelp, STYLE_RULES } from '../../src/language/style';

/**
 * Loads the built dist/extension.js with a stubbed `vscode` module and
 * exercises the whole pipeline: fence dispatch → worker render →
 * cache → preview refresh. Requires `npm run bundle`.
 */

const extensionPath = join(__dirname, '../../dist/extension.js');
const require = createRequire(import.meta.url);

/**
 * `activate` is asynchronous: the framework builds what it resolves to last,
 * once everything else is registered. VS Code awaits it before
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

  it("asks no refresh of the Markdown previews while VS Code's Markdown extension has not started", async () => {
    const refreshes = (): number =>
      vscodeStub._test.executedCommands.filter((command) => command === 'markdown.preview.refresh').length;
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));
    try {
      // Not started: it shows no preview, and its command would start it.
      vscodeStub._test.setMarkdownExtension('inactive');
      await settle();
      const before = refreshes();
      vscodeStub._test.setThemeKind(vscodeStub.ColorThemeKind.Dark);
      await settle();
      expect(refreshes()).toBe(before);

      // Started, or in another extension host, where it is not known here: asked.
      for (const [state, kind] of [
        ['active', vscodeStub.ColorThemeKind.Light],
        ['absent', vscodeStub.ColorThemeKind.Dark],
      ] as const) {
        vscodeStub._test.setMarkdownExtension(state);
        const from = refreshes();
        vscodeStub._test.setThemeKind(kind);
        expect(await waitFor(() => refreshes() > from, 5_000)).toBe(true);
      }
    } finally {
      vscodeStub._test.setMarkdownExtension('active');
      vscodeStub._test.setThemeKind(vscodeStub.ColorThemeKind.Light);
    }
  });

  it('applies a new plantumlLocal.logLevel to the next entry, without a reload', async () => {
    const md = makeMd();
    api.extendMarkdownIt(md);
    const rendered = (from: number): string[] =>
      vscodeStub._test.logs.slice(from).filter((line) => line.startsWith('debug: Diagram rendered'));

    const loud = vscodeStub._test.logs.length;
    vscodeStub._test.setConfiguration('logLevel', 'debug');
    try {
      await waitForRender(md, 'plantuml', '@startuml\nAlice -> Bob : loud\n@enduml');
      expect(rendered(loud)).toHaveLength(1);

      const quiet = vscodeStub._test.logs.length;
      vscodeStub._test.setConfiguration('logLevel', 'warn');
      await waitForRender(md, 'plantuml', '@startuml\nAlice -> Bob : quiet\n@enduml');
      expect(rendered(quiet)).toEqual([]);
    } finally {
      vscodeStub._test.setConfiguration('logLevel', undefined);
    }
  });

  it('with onSave, draws an edited diagram again only once its document is saved', async () => {
    const uri = 'file:///c/onsave/doc.md';
    const md = makeMd();
    api.extendMarkdownIt(md);
    const fence = (content: string): string => {
      const rule = md.renderer.rules.fence;
      if (rule === undefined) {
        throw new Error('fence rule missing');
      }
      return rule([{ info: 'plantuml', content }], 0, {}, { currentDocument: { toString: () => uri } }, {
        renderToken: () => '',
      });
    };
    const first = '@startuml\nAlice -> Bob : first\n@enduml';
    const edited = '@startuml\nAlice -> Bob : edited\n@enduml';
    const refreshes = (): number =>
      vscodeStub._test.executedCommands.filter((command) => command === 'markdown.preview.refresh').length;
    vscodeStub._test.setConfiguration('preview.updateMode', 'onSave', 'file:///c/onsave');
    try {
      expect(await waitFor(() => fence(first).includes('first'))).toBe(true);

      const stale = fence(edited);
      expect(stale).toContain('Preview is out of date. Save the file to refresh it.');
      expect(stale).toContain('first');

      // Nothing renders now, so the next refresh is the one the save asks for.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const before = refreshes();
      vscodeStub._test.saveDocument(makeEditor(uri, ['```plantuml', edited, '```'].join('\n'), 0).document);
      expect(await waitFor(() => refreshes() > before, 5_000)).toBe(true);

      expect(await waitFor(() => fence(edited).includes('edited'))).toBe(true);
      expect(fence(edited)).not.toContain('Not updated');
    } finally {
      vscodeStub._test.setConfiguration('preview.updateMode', undefined, 'file:///c/onsave');
    }
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
    expect(html).toContain('There is no PlantUML code to render.');
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

  it.each([
    ['the Azure icons', ['!include <azure/AzureCommon>', '!include <azure/Compute/AzureFunction>', 'AzureFunction(fn, "Orders", "Functions")']],
    ['the C4 library', ['!include <C4/C4_Container>', 'Container(orders, "Orders", "TypeScript")']],
  ])('draws a diagram with %s in the light palette in a dark theme, unless it picks a theme', async (_what, body) => {
    const md = makeMd(() => '<pre></pre>');
    api.extendMarkdownIt(md);
    const lines = [...body, '@enduml'];
    const source = ['@startuml', ...lines].join('\n');
    // A theme made for a dark page keeps the dark one.
    const themed = ['@startuml', '!theme cyborg', ...lines].join('\n');

    vscodeStub._test.setThemeKind(vscodeStub.ColorThemeKind.Dark);
    try {
      const html = await waitForRender(md, 'plantuml', source);
      expect(html).toContain('plantuml-diagram--light');
      expect(html).toContain('Orders');
      expect(await waitForRender(md, 'plantuml', themed)).toContain('plantuml-diagram--dark');
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
  // Split once for each text, as VS Code keeps a document's lines.
  let lines = text.split('\n');
  const inserted: { value: string; line: number; character: number; options: unknown }[] = [];
  return {
    document: {
      languageId: options?.languageId ?? 'markdown',
      version: 1,
      isUntitled: options?.isUntitled ?? false,
      uri: {
        toString: () => path,
        scheme: path.slice(0, path.indexOf(':')),
        path: path.replace(/^[a-z][\w+.-]*:(\/\/[^/]*)?/i, ''),
        fsPath: path.replace(/^[a-z][\w+.-]*:\/\//i, ''),
      },
      getText: () => current,
      lineAt: (at: number) => {
        const lineText = lines[at] ?? '';
        return {
          text: lineText,
          range: new vscodeStub.Range(at, 0, at, lineText.length),
          firstNonWhitespaceCharacterIndex: lineText.length - lineText.trimStart().length,
        };
      },
      setText: (next: string) => {
        current = next;
        lines = next.split('\n');
      },
    },
    selection: { active: { line } },
    inserted,
    insertSnippet: (snippet, location, options) => {
      inserted.push({ value: snippet.value, line: location.line, character: location.character, options });
      return Promise.resolve(true);
    },
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
    expect(vscodeStub._test.notifications.warn.some((m) => m.includes('Unnamed'))).toBe(true);
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
          // The host refuses the include, saying why: /c is no folder on disk.
          [12, 'PLLOCAL-INC001', ERROR],
          [20, 'PLLOCAL-DOC003', ERROR],
          // !includesub reads its file through the loader too, which refuses it.
          [27, 'PLLOCAL-INC001', ERROR],
          [33, 'PLLOCAL-DOC002', WARNING],
          [38, 'PLLOCAL-WRN001', WARNING],
        ]);
        expect(found[0]?.message).toContain('Syntax error.');
        // In the quote, past the marker; and an explanation, not the engine's bare words.
        expect(found[1]?.character).toBe(2);
        // Worded as the preview's note words it, for the file the engine asked for.
        expect(found[1]?.message).toBe(
          "Could not include shared.puml: Open the folder containing this document as a workspace. Included files must be within that workspace folder."
        );
        expect(found[3]?.message).toBe(
          "Could not include shared.puml: Open the folder containing this document as a workspace. Included files must be within that workspace folder."
        );
        expect(found[found.length - 2]?.message).toContain('@enduml');
        expect(found[found.length - 1]?.message).toContain('deprecated');
      } finally {
        vscodeStub._test.closeDocument(document);
      }
      // Closing the document takes its problems away.
      expect(vscodeStub._test.diagnostics.has(uri)).toBe(false);
    });

    it('warns about an image the engine does not draw, and names the file the C4 library leaves out', async () => {
      const uri = 'file:///c/diag/c4.md';
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=';
      const text = [
        '```plantuml images',
        '@startuml',
        '!include <C4/C4_Context>',
        'Person(customer, "Customer", $sprite="img:customer.png")',
        `System(shop, "Online shop", $sprite="img:${png}")`,
        'Rel(customer, shop, "Places orders")',
        '@enduml',
        '```',
        '',
        '```plantuml left-out',
        '@startuml',
        '!include <C4/C4_Nope>',
        '@enduml',
        '```',
      ].join('\n');
      const document = makeEditor(uri, text, 0).document;
      vscodeStub._test.openDocument(document);
      try {
        const found = await problemsOf(uri, (items) => items.length >= 2);
        expect(found.map((p) => [p.line, p.code, p.severity])).toEqual([
          [3, 'PLLOCAL-CAP001', vscodeStub.DiagnosticSeverity.Warning],
          [11, 'PLLOCAL-CAP001', vscodeStub.DiagnosticSeverity.Error],
        ]);
        expect(found[0]?.message).toBe(
          'The bundled engine draws only images written inline as PNG (data:image/png;base64,…); any other image is drawn as placeholder text.'
        );
        expect(found[1]?.message).toBe(
          'The C4 library bundled with this extension does not include <C4/C4_Nope>. ' +
            'It includes C4, C4_Context, C4_Container, C4_Component, C4_Dynamic, C4_Deployment, C4_Sequence.'
        );
      } finally {
        vscodeStub._test.closeDocument(document);
      }
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

    it('checks each diagram of a PlantUML file on its own, on the lines of the file', async () => {
      const uri = 'file:///c/diag/flows.puml';
      const text = [
        '@startuml(id=good)',
        'Alice -> Bob',
        '@enduml',
        '',
        '@startuml(id=bad)',
        'Alice -> Bob',
        'this is not valid ;;; [[[',
        '@enduml',
        '',
        '@startuml(id=paged)',
        'Alice -> Bob',
        'newpage',
        'Carol -> Dave',
        '@enduml',
        '',
        '@startuml(id=open)',
        'Alice -> Bob',
      ].join('\n');
      const document = makeEditor(uri, text, 0, { languageId: 'plantuml' }).document;
      vscodeStub._test.openDocument(document);
      try {
        const found = await problemsOf(uri, (items) => items.length >= 3);
        expect(found.map((p) => [p.line, p.code, p.severity])).toEqual([
          [6, 'PLLOCAL-SYN001', vscodeStub.DiagnosticSeverity.Error],
          [11, 'PLLOCAL-CAP001', vscodeStub.DiagnosticSeverity.Error],
          [15, 'PLLOCAL-DOC002', vscodeStub.DiagnosticSeverity.Warning],
        ]);
        // The whole line, from its first character: a PlantUML file has no fence to be inside.
        expect(found[0]?.character).toBe(0);
      } finally {
        vscodeStub._test.closeDocument(document);
      }
      expect(vscodeStub._test.diagnostics.has(uri)).toBe(false);
    });

    it('reads start and end lines in a note or legend as its text, in a PlantUML file and in Markdown', async () => {
      const file = 'file:///c/diag/notes.puml';
      const fileText = [
        '@startuml(id=noted)',
        'Alice -> Bob',
        'note over Alice',
        'Write a diagram as',
        '  @startuml',
        '  A -> B',
        '  @enduml',
        'end note',
        'legend right',
        '@enduml',
        'endlegend',
        'Bob -> Alice',
        '@enduml',
        '',
        '@startuml(id=bad)',
        'this is not valid ;;; [[[',
        '@enduml',
      ].join('\n');
      const markdown = 'file:///c/diag/notes.md';
      const markdownText = [
        '```plantuml noted',
        '@startuml',
        'Alice -> Bob',
        'note over Alice',
        '@startuml',
        'end note',
        '@enduml',
        '```',
        '',
        '```plantuml bad',
        '@startuml',
        'this is not valid ;;; [[[',
        '@enduml',
        '```',
      ].join('\n');
      const fileDocument = makeEditor(file, fileText, 0, { languageId: 'plantuml' }).document;
      const markdownDocument = makeEditor(markdown, markdownText, 0).document;
      vscodeStub._test.openDocument(fileDocument);
      vscodeStub._test.openDocument(markdownDocument);
      try {
        const ERROR = vscodeStub.DiagnosticSeverity.Error;
        const inFile = await problemsOf(file, (items) => items.length >= 1);
        const inMarkdown = await problemsOf(markdown, (items) => items.length >= 1);
        // Only the diagram that is wrong: the one with the note is a diagram
        // of its own, drawn whole.
        expect({
          file: inFile.map((p) => [p.line, p.code, p.severity]),
          markdown: inMarkdown.map((p) => [p.line, p.code, p.severity]),
        }).toEqual({ file: [[15, 'PLLOCAL-SYN001', ERROR]], markdown: [[11, 'PLLOCAL-SYN001', ERROR]] });
      } finally {
        vscodeStub._test.closeDocument(fileDocument);
        vscodeStub._test.closeDocument(markdownDocument);
      }
    });

    it('leaves a PlantUML file with no start line alone: its lines are meant to be included', async () => {
      const uri = 'file:///c/diag/shared.iuml';
      const document = makeEditor(uri, '!procedure $greet($who)\n$who -> World : hello\n!endprocedure\n', 0, {
        languageId: 'plantuml',
      }).document;
      vscodeStub._test.openDocument(document);
      try {
        expect(await problemsOf(uri, () => true)).toEqual([]);
      } finally {
        vscodeStub._test.closeDocument(document);
      }
    });

    it('checks a PlantUML file with no start line while its preview shows it as a diagram', async () => {
      const uri = 'file:///c/diag/loose.puml';
      const editor = makeEditor(uri, 'Alice -> Bob\nthis is not valid ;;; [[[\n', 0, { languageId: 'plantuml' });
      vscodeStub._test.openDocument(editor.document);
      const before = vscodeStub._test.webviewPanels.length;
      try {
        expect(await problemsOf(uri, () => true)).toEqual([]);

        vscodeStub._test.setActiveEditor(editor);
        await vscodeStub._test.registeredCommands.get('plantumlLocal.openPreviewToSide')?.();
        const panel = vscodeStub._test.webviewPanels[before];
        expect(panel?.title).toBe('Preview: loose.puml');
        const shown = await problemsOf(uri, (items) => items.length === 1);
        expect(shown.map((p) => [p.line, p.code])).toEqual([[1, 'PLLOCAL-SYN001']]);

        // Closing the preview takes the check away with it.
        panel?.dispose();
        expect(await problemsOf(uri, (items) => items.length === 0)).toEqual([]);
      } finally {
        vscodeStub._test.setActiveEditor(undefined);
        vscodeStub._test.closeDocument(editor.document);
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
        title: 'Select the Markdown file to export diagrams from',
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

      expect(vscodeStub._test.notifications.warn.at(-1)).toBe('Open a Markdown file to export its diagrams.');
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
        'Place the cursor inside the PlantUML code block you want to export.'
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
    const panels = vscodeStub._test.webviewPanels.length;

    vscodeStub.workspace.isTrusted = false;
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportPng')?.();
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportFolderSvg')?.(vscodeStub.Uri.parse('file:///c/docs'));
    } finally {
      vscodeStub.workspace.isTrusted = true;
    }

    expect(vscodeStub._test.writtenFiles.size).toBe(before);
    expect(vscodeStub._test.webviewPanels).toHaveLength(panels);
    expect(vscodeStub._test.notifications.warn.some((m) => m.includes('Restricted Mode'))).toBe(true);

    // The notification offers VS Code's own way of trusting the workspace.
    const calls = vscodeStub._test.commandCalls.length;
    vscodeStub.workspace.isTrusted = false;
    vscodeStub._test.notificationReply = 'Manage Workspace Trust';
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportFolderSvg')?.(vscodeStub.Uri.parse('file:///c/docs'));
      const managed = (): boolean => vscodeStub._test.commandCalls.slice(calls).some((call) => call.id === 'workbench.trust.manage');
      expect(await waitFor(managed, 5000)).toBe(true);
    } finally {
      vscodeStub._test.notificationReply = null;
      vscodeStub.workspace.isTrusted = true;
    }
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
    expect(warning).toContain('Diagrams exported: 1');
    expect(warning).toContain('Image links were not updated because the Markdown file changed during export. Export again to update them.');
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
    expect(vscodeStub._test.notifications.warn.slice(warningsBefore).some((m) => m.includes('Diagrams that could not be exported: 1'))).toBe(true);

    // The reference inserted above the broken block pushed it down: the
    // reason names the line it is on now, not the one the export read.
    const now = after.split('\n').indexOf('this is not valid ;;; [[[') + 1;
    expect(now).toBe(text.split('\n').indexOf('this is not valid ;;; [[[') + 1 + 2);
    const reason = vscodeStub._test.logs
      .slice(logsBefore)
      .find((line) => line.startsWith('warn: Could not export broken:'));
    expect(reason).toContain(`PlantUML error on line ${String(now)}: Syntax error.`);
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
    const calls = vscodeStub._test.commandCalls.length;

    // The failures are in the output channel, which the notification opens.
    vscodeStub._test.notificationReply = 'Show Output';
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
    } finally {
      vscodeStub._test.notificationReply = null;
    }

    // Nothing is inserted, so the line stays where the export read it.
    expect(editor.document.getText()).toBe(text);
    const reason = vscodeStub._test.logs
      .slice(logsBefore)
      .find((line) => line.startsWith('warn: Could not export broken:'));
    expect(reason).toContain('PlantUML error on line 5: Syntax error.');
    // VS Code's command for the channel, named after the extension's id.
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { publisher: string; name: string };
    expect(vscodeStub._test.commandCalls.slice(calls).map((call) => call.id)).toContain(
      `workbench.action.output.show.${manifest.publisher}.${manifest.name}.PlantUML Local.log`
    );
  });

  it('export-all offers to name a diagram when every block was left out for want of a name', async () => {
    const text = ['# Title', '', '```plantuml', '@startuml', 'A -> B', '@enduml', '```'].join('\n');
    const editor = makeEditor('file:///c/unnamed/doc.md', text, 0);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);
    const calls = vscodeStub._test.commandCalls.length;

    vscodeStub._test.notificationReply = 'Name Diagram…';
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
    } finally {
      vscodeStub._test.notificationReply = null;
    }

    expect(vscodeStub._test.notifications.warn.at(-1)).toBe(
      'Unnamed code blocks were not exported: 1. Add a name after ```plantuml, for example: "```plantuml my-diagram".'
    );
    // The light bulb's command, on the line the name goes on, with the document open there.
    expect(vscodeStub._test.commandCalls.slice(calls)).toContainEqual({
      id: 'plantumlLocal.assignDiagramName',
      args: ['file:///c/unnamed/doc.md', 2, editor.document.version],
    });
    expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: 'file:///c/unnamed/doc.md', line: 2 });
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

  it('refuses an export directory that would leave the document folder', async () => {
    // A rooted path, a drive with or without a separator, a network share and
    // a parent segment, whichever separator reaches it.
    const outside = ['../images', 'a\\..\\..\\b', '/etc', '\\images', 'C:images', 'C:/temp', '\\\\server\\share'];
    const said: string[] = [];
    for (const value of outside) {
      const before = vscodeStub._test.notifications.error.length;
      vscodeStub._test.setConfiguration('exportDirectory', value, 'file:///c/outside');
      try {
        vscodeStub._test.setActiveEditor(makeEditor('file:///c/outside/doc.md', NAMED_BLOCK, 1));
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        vscodeStub._test.setConfiguration('exportDirectory', undefined, 'file:///c/outside');
      }
      said.push(vscodeStub._test.notifications.error.slice(before).join(' | '));
    }
    expect(said).toEqual(
      outside.map((value) => `The folder for exported images, ${value}, cannot be used. In Settings, enter a folder inside the file's folder, for example images.`)
    );
  });

  it('says why an empty export directory or a reserved name is refused', async () => {
    vscodeStub._test.setConfiguration('exportDirectory', '', 'file:///c/empty');
    try {
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/empty/doc.md', NAMED_BLOCK, 1));
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
    } finally {
      vscodeStub._test.setConfiguration('exportDirectory', undefined, 'file:///c/empty');
    }
    expect(vscodeStub._test.notifications.error.at(-1)).toBe(
      'No folder is set for exported images. Enter one in Settings, for example images.'
    );

    // Only whitespace is empty too. The button opens the setting.
    const errorsBefore = vscodeStub._test.notifications.error.length;
    const callsBefore = vscodeStub._test.commandCalls.length;
    vscodeStub._test.setConfiguration('exportDirectory', '   ', 'file:///c/blank');
    vscodeStub._test.notificationReply = 'Open Settings';
    try {
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/blank/doc.md', NAMED_BLOCK, 1));
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      const opened = (): boolean =>
        vscodeStub._test.commandCalls
          .slice(callsBefore)
          .some((call) => call.id === 'workbench.action.openSettings' && call.args[0] === '@id:plantumlLocal.exportDirectory');
      expect(await waitFor(opened, 5000)).toBe(true);
    } finally {
      vscodeStub._test.notificationReply = null;
      vscodeStub._test.setConfiguration('exportDirectory', undefined, 'file:///c/blank');
    }
    expect(vscodeStub._test.notifications.error.slice(errorsBefore)).toEqual([
      'No folder is set for exported images. Enter one in Settings, for example images.',
    ]);

    const reserved = ['```plantuml CON', '@startuml', 'A -> B', '@enduml', '```'].join('\n');
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/reserved/doc.md', reserved, 1));
    await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
    const failure =
      'Could not export CON: Use 1–128 letters (A–Z, a–z), digits, hyphens, or underscores. Reserved file names such as CON are not allowed.';
    expect(vscodeStub._test.logs.some((line) => line.includes(failure))).toBe(true);
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

    it('points a refused export to the Problems panel, which lists PlantUML files too', async () => {
      vscodeStub._test.setActiveEditor(
        pumlEditor('file:///c/pumlbroken/broken.puml', '@startuml\nthis is not valid ;;; [[[\n@enduml\n', 1)
      );
      const calls = vscodeStub._test.commandCalls.length;

      vscodeStub._test.notificationReply = 'Show Problems';
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      } finally {
        vscodeStub._test.notificationReply = null;
      }

      expect(vscodeStub._test.notifications.error.at(-1)).toMatch(/^Could not export the diagram: PlantUML error on line 2: /);
      const called = vscodeStub._test.commandCalls.slice(calls).map((call) => call.id);
      expect(called).toContain('workbench.actions.view.problems');
      expect(called.some((id) => id.startsWith('workbench.action.output.show.'))).toBe(false);
      expect(vscodeStub._test.writtenFiles.has('file:///c/pumlbroken/images/broken.svg')).toBe(false);
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
        'Diagrams exported: 2 · Unnamed diagrams were not exported: 1. Add a name to the start line, for example: "@startuml(id=my-diagram)".'
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
          message: 'handmade/images/orders.svg already exists and has different contents. Overwrite it?',
          detail: undefined,
          buttons: ['Overwrite'],
        },
      ]);
      expect(vscodeStub._test.writtenFiles.get(target)).toBe('<svg>drawn by hand</svg>');

      vscodeStub._test.messageReply = 'Overwrite';
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

    it('replaces a file it exported as the diagram changes, until the file is edited or open with edits', async () => {
      const target = 'file:///c/owned/images/orders.svg';
      const exportLabel = async (label: string): Promise<void> => {
        vscodeStub._test.setActiveEditor(
          makeEditor('file:///c/owned/doc.md', NAMED_BLOCK.replace('hi', label), 1)
        );
        await exportSvg();
      };
      await exportLabel('first');
      const modalsBefore = vscodeStub._test.modals.length;

      await exportLabel('second');
      expect(vscodeStub._test.modals.length).toBe(modalsBefore);
      expect(vscodeStub._test.writtenFiles.get(target)).toContain('second');

      // Edited by hand since: asked about, and kept as the stub declines.
      vscodeStub._test.writtenFiles.set(target, '<svg>edited</svg>');
      vscodeStub._test.writtenBytes.delete(target);
      await exportLabel('third');
      expect(vscodeStub._test.writtenFiles.get(target)).toBe('<svg>edited</svg>');

      // Replaced once told to, it is the export's again; open with unsaved
      // edits, it is asked about all the same.
      vscodeStub._test.messageReply = 'Overwrite';
      try {
        await exportLabel('fourth');
      } finally {
        vscodeStub._test.messageReply = null;
      }
      const open = Object.assign(makeEditor(target, '<svg>typing</svg>', 0, { languageId: 'xml' }).document, {
        isDirty: true,
      });
      vscodeStub._test.openDocuments.push(open);
      try {
        await exportLabel('fifth');
      } finally {
        vscodeStub._test.openDocuments.splice(vscodeStub._test.openDocuments.indexOf(open), 1);
      }
      expect(vscodeStub._test.writtenFiles.get(target)).toContain('fourth');

      const asked = 'owned/images/orders.svg already exists and has different contents. Overwrite it?';
      expect(vscodeStub._test.modals.slice(modalsBefore).map((modal) => modal.message)).toEqual([
        asked,
        asked,
        asked,
      ]);
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

      vscodeStub._test.messageReply = 'Keep Existing Files';
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        vscodeStub._test.messageReply = null;
      }

      expect(vscodeStub._test.modals.slice(modalsBefore)).toEqual([
        {
          message: '2 files already exist and have different contents. Overwrite them?',
          detail: 'bulk/images/kept-a.svg\nbulk/images/kept-b.svg',
          buttons: ['Overwrite', 'Keep Existing Files'],
        },
      ]);
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/kept-a.svg')).toBe('old a');
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/kept-b.svg')).toBe('old b');
      expect(vscodeStub._test.writtenFiles.get('file:///c/bulk/images/fresh.svg')).toContain('new');
      expect(vscodeStub._test.notifications.info.at(-1)).toBe(
        'Diagrams exported: 1 · Existing files kept: 2'
      );
    });

    it('never writes over a folder of the same name', async () => {
      vscodeStub._test.writtenFiles.set('file:///c/folder/images/orders.svg/inside.txt', 'kept');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/folder/doc.md', NAMED_BLOCK, 1));
      const calls = vscodeStub._test.commandCalls.length;

      // The notification shows the folder in the way.
      vscodeStub._test.notificationReply = 'Show in Explorer';
      try {
        await exportSvg();
      } finally {
        vscodeStub._test.notificationReply = null;
      }

      // Renaming over it would have deleted the folder and what it holds.
      expect(vscodeStub._test.writtenFiles.get('file:///c/folder/images/orders.svg/inside.txt')).toBe(
        'kept'
      );
      expect(vscodeStub._test.writtenFiles.has('file:///c/folder/images/orders.svg')).toBe(false);
      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: Cannot save to folder/images/orders.svg because a folder with that name already exists.'
      );
      const revealed = vscodeStub._test.commandCalls.slice(calls).filter((call) => call.id === 'revealInExplorer');
      expect(revealed.map((call) => String(call.args[0]))).toEqual(['file:///c/folder/images/orders.svg']);
    });

    it('points to the Problems panel when the diagram itself is wrong', async () => {
      const broken = ['```plantuml broken-one', '@startuml', 'this is not valid ;;; [[[', '@enduml', '```'].join('\n');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/problems/doc.md', broken, 1));
      const calls = vscodeStub._test.commandCalls.length;

      vscodeStub._test.notificationReply = 'Show Problems';
      try {
        await exportSvg();
      } finally {
        vscodeStub._test.notificationReply = null;
      }

      expect(vscodeStub._test.notifications.error.at(-1)).toMatch(/^Could not export the diagram: PlantUML error on line 3: /);
      expect(vscodeStub._test.commandCalls.slice(calls).map((call) => call.id)).toContain('workbench.actions.view.problems');
      expect(vscodeStub._test.writtenFiles.has('file:///c/problems/images/broken-one.svg')).toBe(false);
    });

    it('writes a diagram the engine draws without its formula, and says so in the notice', async () => {
      const block = ['```plantuml formula', '@startuml', 'A -> B : <math>x</math>', '@enduml', '```'].join('\n');
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/formula/doc.md', block, 1));

      await exportSvg();

      expect(vscodeStub._test.writtenFiles.has('file:///c/formula/images/formula.svg')).toBe(true);
      expect(vscodeStub._test.notifications.warn.at(-1)).toBe(
        'Exported to formula/images/formula.svg The bundled engine does not draw <math> formulas; the formula is left out of the diagram.'
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

    it('offers to reveal the file it wrote in the Explorer view', async () => {
      const revealed = (): string[] =>
        vscodeStub._test.commandCalls
          .filter((call) => call.id === 'revealInExplorer')
          .map((call) => String(call.args[0]));
      const before = revealed().length;
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/reveal/doc.md', NAMED_BLOCK, 1));

      // Dismissed, as the stub answers by default.
      await exportSvg();
      expect(revealed()).toHaveLength(before);

      vscodeStub._test.notificationReply = 'Show in Explorer';
      try {
        await exportSvg();
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportAllSvg')?.();
      } finally {
        vscodeStub._test.notificationReply = null;
      }
      expect(revealed().slice(before)).toEqual([
        'file:///c/reveal/images/orders.svg',
        'file:///c/reveal/images/orders.svg',
      ]);
    });
  });

  describe('a folder', () => {
    const exportFolder = async (folder?: string): Promise<void> => {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportFolderSvg')?.(
        folder === undefined ? undefined : vscodeStub.Uri.parse(folder)
      );
    };
    const block = (name: string, label: string): string =>
      ['```plantuml ' + name, '@startuml', `A -> B : ${label}`, '@enduml', '```'].join('\n');

    it('offers to choose another folder when one has too many files to export at once', async () => {
      const files = Array.from({ length: 501 }, (_, index) => `file:///c/crowded/doc-${String(index).padStart(3, '0')}.md`);
      for (const file of files) {
        vscodeStub._test.writtenFiles.set(file, '# Doc');
      }
      const calls = vscodeStub._test.commandCalls.length;
      vscodeStub._test.notificationReply = 'Choose Folder…';
      try {
        await exportFolder('file:///c/crowded');
        // Without a folder, the command asks for one.
        const chosen = (): boolean =>
          vscodeStub._test.commandCalls
            .slice(calls)
            .some((call) => call.id === 'plantumlLocal.exportFolderSvg' && call.args.length === 0);
        expect(await waitFor(chosen, 5000)).toBe(true);
      } finally {
        vscodeStub._test.notificationReply = null;
        for (const file of files) {
          vscodeStub._test.writtenFiles.delete(file);
        }
      }
      expect(vscodeStub._test.notifications.warn.at(-1)).toBe(
        'crowded has more than 500 Markdown and PlantUML files, too many to export at once. Choose a smaller folder.'
      );
    });

    it('exports the named diagrams of its documents once that is confirmed, beside each document', async () => {
      vscodeStub._test.writtenFiles.set('file:///c/tree/a.md', block('one', 'first'));
      vscodeStub._test.writtenFiles.set('file:///c/tree/sub/b.puml', '@startuml(id=two)\nC -> D : second\n@enduml');
      vscodeStub._test.writtenFiles.set('file:///c/tree/lib.iuml', '!procedure $box()\n!endprocedure');
      vscodeStub._test.writtenFiles.set('file:///c/tree/node_modules/pkg/c.md', block('three', 'third'));
      const modals = vscodeStub._test.modals.length;

      vscodeStub._test.messageReply = 'Export';
      try {
        await exportFolder('file:///c/tree');
      } finally {
        vscodeStub._test.messageReply = null;
      }

      expect(vscodeStub._test.modals.slice(modals)).toEqual([
        {
          message: 'Export 2 named diagrams in tree?',
          detail: 'Source files: 2\ntree/a.md\ntree/sub/b.puml',
          buttons: ['Export'],
        },
      ]);
      expect(vscodeStub._test.writtenFiles.get('file:///c/tree/images/one.svg')).toContain('first');
      expect(vscodeStub._test.writtenFiles.get('file:///c/tree/sub/images/two.svg')).toContain('second');
      expect([...vscodeStub._test.writtenFiles.keys()].filter((key) => key.includes('three'))).toEqual([]);
      expect(vscodeStub._test.notifications.info.at(-1)).toBe('Diagrams exported: 2');
    });

    it('writes nothing when the export is not confirmed, or no folder is picked', async () => {
      vscodeStub._test.writtenFiles.set('file:///c/declined/a.md', block('one', 'first'));
      const modals = vscodeStub._test.modals.length;

      // Dismissed, as the stub answers by default.
      await exportFolder('file:///c/declined');
      // No folder passed, and none picked.
      await exportFolder();

      expect(vscodeStub._test.modals.slice(modals).map((modal) => modal.message)).toEqual([
        'Export the named diagram in declined?',
      ]);
      expect(vscodeStub._test.writtenFiles.has('file:///c/declined/images/one.svg')).toBe(false);
    });

    it('refuses a folder outside the workspace', async () => {
      await exportFolder('file:///elsewhere/docs');

      expect(vscodeStub._test.notifications.warn.at(-1)).toBe('Select a folder within the current workspace.');
    });

    it('says how to name the unnamed diagrams of each kind of document', async () => {
      const unnamedBlock = ['```plantuml', '@startuml', 'E -> F', '@enduml', '```'].join('\n');
      const unnamedDiagrams = '@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml';
      vscodeStub._test.writtenFiles.set('file:///c/mixed/a.md', `${block('one', 'first')}\n\n${unnamedBlock}`);
      vscodeStub._test.writtenFiles.set('file:///c/mixed/b.puml', unnamedDiagrams);
      vscodeStub._test.writtenFiles.set('file:///c/unnamed/c.puml', unnamedDiagrams);

      vscodeStub._test.messageReply = 'Export';
      try {
        await exportFolder('file:///c/mixed');
        // Nothing named, so nothing to export.
        await exportFolder('file:///c/unnamed');
      } finally {
        vscodeStub._test.messageReply = null;
      }

      expect(vscodeStub._test.notifications.warn.slice(-2)).toEqual([
        'Diagrams exported: 1' +
          ' · Unnamed code blocks were not exported: 1. Add a name after ```plantuml, for example: "```plantuml my-diagram".' +
          ' · Unnamed diagrams were not exported: 2. Add a name to the start line, for example: "@startuml(id=my-diagram)".',
        'Unnamed diagrams were not exported: 2. Add a name to the start line, for example: "@startuml(id=my-diagram)".',
      ]);
    });
  });

  describe('PNG', () => {
    /** The start of a PNG of `width`×`height` pixels: its signature and IHDR chunk. */
    const pngOf = (width: number, height: number): Uint8Array => {
      const png = new Uint8Array(33);
      const view = new DataView(png.buffer);
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      view.setUint32(8, 13);
      png.set(new TextEncoder().encode('IHDR'), 12);
      view.setUint32(16, width);
      view.setUint32(20, height);
      return png;
    };
    /** Starts the PNG export of the block, and waits for the panel it draws in. */
    const start = async (path: string): Promise<{ panel: WebviewPanelStub; done: Promise<unknown> }> => {
      vscodeStub._test.setActiveEditor(makeEditor(path, NAMED_BLOCK, 1));
      const before = vscodeStub._test.webviewPanels.length;
      const done = Promise.resolve(vscodeStub._test.registeredCommands.get('plantumlLocal.exportPng')?.());
      expect(await waitFor(() => vscodeStub._test.webviewPanels.length > before, 30_000)).toBe(true);
      return { panel: vscodeStub._test.webviewPanels[before]!, done };
    };
    const writtenUnder = (folder: string): string[] =>
      [...vscodeStub._test.writtenFiles.keys()].filter((key) => key.startsWith(folder));

    it('draws the diagram in a panel beside the editor and writes the PNG it sends back', async () => {
      const { panel, done } = await start('file:///c/png/doc.md');

      expect(panel).toMatchObject({ viewType: 'plantumlLocal.png', title: 'Exporting PNG…' });
      // Beside the editor, without taking the focus from it.
      expect(panel.column).toEqual({ viewColumn: vscodeStub.ViewColumn.Beside, preserveFocus: true });
      // Kept while hidden behind another tab, so the PNG still comes.
      expect(panel.options).toMatchObject({ enableScripts: true, enableForms: false, retainContextWhenHidden: true });
      expect(panel.options.localResourceRoots?.map(String)).toEqual([
        expect.stringMatching(/^file:\/\/\/.*\/media\/png$/),
      ]);
      const csp = (/Content-Security-Policy" content="([^"]*)"/.exec(panel.webview.html)?.[1] ?? '').replace(
        /&#039;/g,
        "'"
      );
      expect(csp).toMatch(/default-src 'none'/);
      expect(csp).toMatch(/script-src 'nonce-[^' ]+'(;|$)/);
      expect(csp).toMatch(/img-src [^;]*blob:/);
      expect(panel.webview.html).toContain('/media/png/png.js');
      expect(panel.webview.posted).toEqual([]);

      panel.receive({ type: 'ready' });
      const draw = panel.webview.posted[0] as { svg: string; width: number; height: number };
      // Twice the size the SVG gives itself: the default scale.
      const width = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(draw.svg)?.[1]);
      const height = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(draw.svg)?.[1]);
      expect(draw).toMatchObject({
        type: 'draw',
        width: Math.ceil(width * 2),
        height: Math.ceil(height * 2),
        background: '#FFFFFF',
      });
      expect(draw.svg).toContain('hi');

      // Only bytes are taken for the PNG.
      panel.receive({ type: 'png', data: [1, 2, 3] });
      expect(panel.disposed).toBe(false);
      const png = pngOf(draw.width, draw.height);
      panel.receive({ type: 'png', data: png });
      await done;

      expect(panel.disposed).toBe(true);
      expect(vscodeStub._test.writtenBytes.get('file:///c/png/images/orders.png')).toEqual(png);
      // Named as the Explorer names it, not by its URI.
      expect(vscodeStub._test.notifications.info.at(-1)).toBe('Exported to png/images/orders.png');
    });

    it('writes nothing when the page cannot draw it, or sends back another size', async () => {
      const failed = await start('file:///c/pngfail/doc.md');
      failed.panel.receive({ type: 'ready' });
      failed.panel.receive({ type: 'error', error: 'no PNG came out of the canvas' });
      await failed.done;
      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: PNG creation failed: no PNG came out of the canvas'
      );

      // The failure the page itself names is explained once, not wrapped again.
      const unencoded = await start('file:///c/pngfail/doc.md');
      unencoded.panel.receive({ type: 'ready' });
      unencoded.panel.receive({ type: 'error', error: 'PNG encoding failed' });
      await unencoded.done;
      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: The PNG could not be created. Try exporting as SVG.'
      );

      const wrong = await start('file:///c/pngfail/doc.md');
      wrong.panel.receive({ type: 'ready' });
      wrong.panel.receive({ type: 'png', data: pngOf(1, 1) });
      await wrong.done;
      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: The PNG was not created correctly. Try exporting as SVG.'
      );

      expect([failed.panel.disposed, unencoded.panel.disposed, wrong.panel.disposed]).toEqual([true, true, true]);
      expect(writtenUnder('file:///c/pngfail/')).toEqual([]);
    });

    it('stops without writing when its panel is closed before the PNG is back', async () => {
      const { panel, done } = await start('file:///c/pngclosed/doc.md');
      panel.receive({ type: 'ready' });
      panel.dispose();
      await done;

      expect(vscodeStub._test.notifications.error.at(-1)).toBe(
        'Could not export the diagram: PNG export stopped because its panel was closed.'
      );
      expect(writtenUnder('file:///c/pngclosed/')).toEqual([]);
    });

    it('refuses a PNG past the size limits before drawing it, at the scale set for the document', async () => {
      const wide = ['```plantuml wide', '@startuml', `Alice -> Bob : ${'wide '.repeat(100)}`, '@enduml', '```'];
      vscodeStub._test.setConfiguration('exportPngScale', 4, 'file:///c/pngwide');
      const panels = vscodeStub._test.webviewPanels.length;
      const calls = vscodeStub._test.commandCalls.length;
      // The setting the message names is a button away.
      vscodeStub._test.notificationReply = 'Open Settings';
      try {
        vscodeStub._test.setActiveEditor(makeEditor('file:///c/pngwide/doc.md', wide.join('\n'), 1));
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportPng')?.();
      } finally {
        vscodeStub._test.notificationReply = null;
        vscodeStub._test.setConfiguration('exportPngScale', undefined, 'file:///c/pngwide');
      }

      expect(vscodeStub._test.webviewPanels).toHaveLength(panels);
      expect(vscodeStub._test.notifications.error.at(-1)).toMatch(
        /^Could not export the diagram: The PNG would be \d+ × \d+ pixels, over the size limit for PNG images\. Set the PNG scale to 2 in Settings, or export as SVG\.$/
      );
      expect(vscodeStub._test.commandCalls.slice(calls)).toContainEqual({
        id: 'workbench.action.openSettings',
        args: ['@id:plantumlLocal.exportPngScale'],
      });
      expect(writtenUnder('file:///c/pngwide/')).toEqual([]);

      // The other button exports the same diagram as an SVG, under its name.
      vscodeStub._test.setConfiguration('exportPngScale', 4, 'file:///c/pngwide');
      vscodeStub._test.notificationReply = 'Export as SVG';
      try {
        await vscodeStub._test.registeredCommands.get('plantumlLocal.exportPng')?.();
      } finally {
        vscodeStub._test.notificationReply = null;
        vscodeStub._test.setConfiguration('exportPngScale', undefined, 'file:///c/pngwide');
      }
      expect(writtenUnder('file:///c/pngwide/')).toEqual(['file:///c/pngwide/images/wide.svg']);
      expect(vscodeStub._test.notifications.info.at(-1)).toBe('Exported to pngwide/images/wide.svg');
    });

    it('exports the diagram that a file and a line name, as the .puml preview asks', async () => {
      const flows = makeEditor('file:///c/pngview/flows.puml', '@startuml(id=orders)\nAlice -> Bob : named\n@enduml', 0, {
        languageId: 'plantuml',
      });
      vscodeStub._test.openDocument(flows.document);
      // Another document has the focus meanwhile.
      vscodeStub._test.setActiveEditor(makeEditor('file:///c/pngview/other.md', NAMED_BLOCK, 1));
      const before = vscodeStub._test.webviewPanels.length;
      try {
        const done = Promise.resolve(
          vscodeStub._test.registeredCommands.get('plantumlLocal.exportPng')?.({
            uri: 'file:///c/pngview/flows.puml',
            line: 0,
          })
        );
        expect(await waitFor(() => vscodeStub._test.webviewPanels.length > before, 30_000)).toBe(true);
        const panel = vscodeStub._test.webviewPanels[before]!;
        panel.receive({ type: 'ready' });
        const draw = panel.webview.posted[0] as { svg: string; width: number; height: number };
        expect(draw.svg).toContain('named');
        panel.receive({ type: 'png', data: pngOf(draw.width, draw.height) });
        await done;
      } finally {
        vscodeStub._test.closeDocument(flows.document);
      }

      expect(writtenUnder('file:///c/pngview/')).toEqual(['file:///c/pngview/images/orders.png']);
    });

    it('exports the named diagrams of a folder as PNG, drawn one after another in one panel', async () => {
      const block = (name: string, label: string): string =>
        ['```plantuml ' + name, '@startuml', `A -> B : ${label}`, '@enduml', '```'].join('\n');
      vscodeStub._test.writtenFiles.set('file:///c/pngtree/a.md', block('one', 'first'));
      vscodeStub._test.writtenFiles.set('file:///c/pngtree/sub/b.md', block('two', 'second'));
      const panels = vscodeStub._test.webviewPanels.length;

      vscodeStub._test.messageReply = 'Export';
      try {
        const done = Promise.resolve(
          vscodeStub._test.registeredCommands.get('plantumlLocal.exportFolderPng')?.(
            vscodeStub.Uri.parse('file:///c/pngtree')
          )
        );
        expect(await waitFor(() => vscodeStub._test.webviewPanels.length > panels, 30_000)).toBe(true);
        const panel = vscodeStub._test.webviewPanels[panels]!;
        expect(panel.webview.html).toContain('Creating PNG images…');
        panel.receive({ type: 'ready' });
        for (const index of [0, 1]) {
          expect(await waitFor(() => panel.webview.posted.length > index, 30_000)).toBe(true);
          const draw = panel.webview.posted[index] as { width: number; height: number };
          panel.receive({ type: 'png', data: pngOf(draw.width, draw.height) });
        }
        await done;
        expect(panel.disposed).toBe(true);
      } finally {
        vscodeStub._test.messageReply = null;
      }

      // One panel for both, closed once they are drawn.
      expect(vscodeStub._test.webviewPanels).toHaveLength(panels + 1);
      expect(writtenUnder('file:///c/pngtree/').sort()).toEqual([
        'file:///c/pngtree/a.md',
        'file:///c/pngtree/images/one.png',
        'file:///c/pngtree/sub/b.md',
        'file:///c/pngtree/sub/images/two.png',
      ]);
      expect(vscodeStub._test.notifications.info.at(-1)).toBe('Diagrams exported: 2');
    });
  });
});

describe('Insert Diagram Template (dist)', () => {
  const insert = async (editor: TextEditorStub, reply: string | null): Promise<void> => {
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.quickPickReply = reply;
    try {
      await vscodeStub._test.registeredCommands.get('plantumlLocal.insertTemplate')?.();
    } finally {
      vscodeStub._test.quickPickReply = null;
    }
  };

  it('offers the sixteen kinds, and inserts the one picked as one edit where a diagram can start', async () => {
    const editor = makeEditor('file:///c/tpl/doc.md', '# Title\n\nText\n', 1);
    const shown = vscodeStub._test.quickPicksShown.length;

    await insert(editor, 'Sequence diagram');

    expect(vscodeStub._test.quickPicksShown.slice(shown)).toEqual([
      {
        title: 'Insert Diagram Template',
        labels: [
          'Sequence diagram',
          'Class diagram',
          'Activity diagram',
          'State diagram',
          'Component diagram',
          'Use case diagram',
          'Object diagram',
          'Entity relationship diagram',
          'Deployment diagram',
          'Timing diagram',
          'Gantt chart',
          'Mind map',
          'Work breakdown structure',
          'Salt wireframe',
          'JSON data',
          'YAML data',
        ],
      },
    ]);
    expect(editor.inserted).toEqual([
      {
        // Apart from the heading above it.
        value: expect.stringMatching(/^\n```plantuml \$\{1:sequence-diagram\}\n@startuml\n[^]*\n@enduml\n```\n$/),
        line: 1,
        character: 0,
        options: { undoStopBefore: true, undoStopAfter: true, keepWhitespace: true },
      },
    ]);
  });

  it('asks before adding a block after one that holds a diagram, and refuses one inside a diagram', async () => {
    const markdown = makeEditor('file:///c/tpl/full.md', NAMED_BLOCK, 2);
    const modals = vscodeStub._test.modals.length;

    // Dismissed, as the stub answers by default.
    await insert(markdown, 'Class diagram');
    expect(markdown.inserted).toEqual([]);
    vscodeStub._test.messageReply = 'Insert Below';
    try {
      await insert(markdown, 'Class diagram');
    } finally {
      vscodeStub._test.messageReply = null;
    }
    expect(vscodeStub._test.modals.slice(modals).map((modal) => modal.message)).toEqual([
      'This code block already contains a diagram. Insert the template in a new code block below it?',
      'This code block already contains a diagram. Insert the template in a new code block below it?',
    ]);
    // After the closing fence, the last line of the document, and apart from it.
    expect(markdown.inserted).toMatchObject([
      { line: 4, character: 3, value: expect.stringMatching(/^\n\n```plantuml \$\{1:class-diagram\}\n/) },
    ]);

    const flows = makeEditor('file:///c/tpl/flows.puml', '@startuml\nA -> B\n@enduml', 1, { languageId: 'plantuml' });
    await insert(flows, 'State diagram');
    expect(flows.inserted).toEqual([]);
    expect(vscodeStub._test.notifications.warn.at(-1)).toBe('Templates cannot be inserted inside an existing diagram.');
  });
});

describe('completion (dist)', () => {
  const complete = (
    document: TextEditorStub['document'],
    line: number,
    character: number
  ): Promise<CompletionItemStub[] | undefined> =>
    vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
      document,
      new vscodeStub.Position(line, character)
    );

  it('is registered for Markdown and PlantUML files, opening on the characters suggestions follow', () => {
    expect(vscodeStub._test.completionProviders).toHaveLength(2);
    expect(vscodeStub._test.completionProviders[0]?.selector).toEqual([
      { language: 'markdown' },
      { language: 'plantuml' },
    ]);
    expect(vscodeStub._test.completionProviders[0]?.triggers).toEqual(['@', '!', '&', ' ', '$']);
  });

  it('completes the path of a local include, and goes to its file, in files on disk', async () => {
    const onDisk = [
      { language: 'markdown', scheme: 'file' },
      { language: 'plantuml', scheme: 'file' },
    ];
    expect(vscodeStub._test.completionProviders[1]?.selector).toEqual(onDisk);
    expect(vscodeStub._test.completionProviders[1]?.triggers).toEqual([' ', '/', '\\']);
    // Go to Definition of what diagrams define comes first, for every document.
    expect(vscodeStub._test.definitionProviders.map((registered) => registered.selector)).toEqual([
      [{ language: 'markdown' }, { language: 'plantuml' }],
      onDisk,
    ]);
    // The stub's workspace folder is no folder on disk: nothing is looked for in it.
    const document = makeEditor('file:///c/inc/a.puml', '!include common.puml', 0, { languageId: 'plantuml' }).document;
    await expect(
      vscodeStub._test.definitionProviders[1]?.provider.provideDefinition(document, new vscodeStub.Position(0, 12))
    ).resolves.toBeUndefined();
    await expect(
      vscodeStub._test.completionProviders[1]?.provider.provideCompletionItems(document, new vscodeStub.Position(0, 9))
    ).resolves.toBeUndefined();
  });

  it('suggests in the diagram blocks of a Markdown document only', async () => {
    const document = makeEditor(
      'file:///c/complete/doc.md',
      ['# Title', '@', '```js', '@', '```', '```plantuml', '@', '```'].join('\n'),
      0
    ).document;

    expect(await complete(document, 1, 1)).toBeUndefined();
    expect(await complete(document, 3, 1)).toBeUndefined();
    const items = await complete(document, 6, 1);
    expect(items?.[0]).toMatchObject({ label: '@startuml', insertText: '@startuml' });
    expect(items?.[0]?.range?.replacing.start).toEqual({ line: 6, character: 0 });
  });

  it('offers the themes and icons the engine ships, read from its files', async () => {
    const document = makeEditor(
      'file:///c/complete/flows.puml',
      ['@startuml', '!theme ', 'A -> B : <&', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;

    const themes = (await complete(document, 1, 7))?.map((item) => item.label);
    expect(themes).toContain('cerulean');
    // Left out of the package for the licence its header declares.
    expect(themes).not.toContain('mars');
    expect(themes).toHaveLength(40);

    const icons = await complete(document, 2, 11);
    expect(icons).toHaveLength(223);
    expect(icons?.find((item) => item.label === 'heart')?.insertText).toBe('heart>');
  });

  it('leaves the quote markers of a block in a quote outside what it replaces', async () => {
    const document = makeEditor(
      'file:///c/complete/quote.md',
      ['> ```plantuml', '> @startuml', '> @en', '> ```'].join('\n'),
      0
    ).document;

    const items = await complete(document, 2, 5);
    expect(items?.map((item) => item.label)).toEqual(['@enduml']);
    expect(items?.[0]?.range?.replacing).toEqual({
      start: { line: 2, character: 2 },
      end: { line: 2, character: 5 },
    });
  });

  describe('aliases, words and snippets', () => {
    /** As VS Code asks while a word is typed, or on Ctrl+Space. */
    const invoke = (document: TextEditorStub['document'], line: number, character: number): Promise<CompletionItemStub[] | undefined> =>
      vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
        document,
        new vscodeStub.Position(line, character),
        undefined,
        { triggerKind: vscodeStub.CompletionTriggerKind.Invoke }
      );
    const labelOf = (item: CompletionItemStub): string => (typeof item.label === 'string' ? item.label : item.label.label);
    const inserted = (item: CompletionItemStub | undefined): string =>
      typeof item?.insertText === 'object' ? item.insertText.value : String(item?.insertText);
    const flows = [
      '@startuml',
      'participant "注文係" as A',
      'participant Server as B',
      'A -> B : hello',
      '',
      '@enduml',
      '@startuml',
      'participant "Other" as O',
      'O -> P : elsewhere',
      '@enduml',
    ].join('\n');

    it('offers the aliases with what they stand for, then the snippets of the diagram type, then its words', async () => {
      const document = makeEditor('file:///c/names/flows.puml', flows, 0, { languageId: 'plantuml' }).document;

      const items = (await invoke(document, 4, 0)) ?? [];
      expect(items.map(labelOf)).toEqual([
        'A',
        'alt',
        'opt',
        'loop',
        'par',
        'ref',
        'note',
        'participant',
        'as',
        'Server',
        'B',
        'hello',
      ]);
      expect(items[0]).toMatchObject({
        label: { label: 'A', description: '注文係' },
        kind: vscodeStub.CompletionItemKind.Variable,
        detail: 'Alias in this diagram',
      });
      expect(items[1]).toMatchObject({
        label: { label: 'alt', description: 'Alternative paths' },
        kind: vscodeStub.CompletionItemKind.Snippet,
        keepWhitespace: true,
      });
      expect(inserted(items[1])).toBe('alt ${1:condition}\n  $2\nelse ${3:otherwise}\n  $4\nend');
      expect(items.at(-1)).toMatchObject({ kind: vscodeStub.CompletionItemKind.Text, detail: 'Word in this diagram' });
      // VS Code sorts by sortText after how well the typed word matches.
      const sorted = [...items].sort((a, b) => String(a.sortText).localeCompare(String(b.sortText)));
      expect(sorted.slice(0, 7).map(labelOf)).toEqual(['A', 'alt', 'opt', 'loop', 'par', 'ref', 'note']);
      expect(items[0]?.range).toEqual({
        inserting: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
        replacing: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
      });
    });

    it('replaces the whole word at the cursor, and leaves it out of the words', async () => {
      const document = makeEditor('file:///c/names/typed.md', '```plantuml\n@startuml\nA -> Server\nSerXY\n@enduml\n```', 0)
        .document;

      const items = (await invoke(document, 3, 3)) ?? [];
      expect(items.map(labelOf)).toEqual(['A', 'Server']);
      expect(items[0]?.range).toEqual({
        inserting: { start: { line: 3, character: 0 }, end: { line: 3, character: 3 } },
        replacing: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } },
      });
    });

    it('leaves a list of words alone to VS Code in a PlantUML file, unless word suggestions are on there', async () => {
      const source = '@startuml\nA -> Server\nSe\n@enduml';
      const file = makeEditor('file:///c/names/alone.puml', source, 0, { languageId: 'plantuml' }).document;
      const markdown = makeEditor('file:///c/names/alone.md', ['```plantuml', source, '```'].join('\n'), 0).document;

      // By default VS Code lists no words while inline suggestions are on, which cannot be told.
      expect(await invoke(file, 2, 2)).toBeUndefined();
      // In Markdown it lists them, and the list opens only when asked for.
      expect((await invoke(markdown, 3, 2))?.map(labelOf)).toEqual(['A', 'Server']);
      try {
        for (const value of ['currentDocument', 'matchingDocuments', 'allDocuments']) {
          vscodeStub._test.setLanguageConfiguration('plantuml', 'editor.wordBasedSuggestions', value);
          expect((await invoke(file, 2, 2))?.map(labelOf), value).toEqual(['A', 'Server']);
        }
      } finally {
        vscodeStub._test.setLanguageConfiguration('plantuml', 'editor.wordBasedSuggestions', undefined);
      }
    });

    it('offers what follows a trigger character only, and nothing else on one', async () => {
      const document = makeEditor('file:///c/names/space.puml', flows, 0, { languageId: 'plantuml' }).document;

      const typed = await vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
        document,
        new vscodeStub.Position(3, 5),
        undefined,
        { triggerKind: vscodeStub.CompletionTriggerKind.TriggerCharacter, triggerCharacter: ' ' }
      );
      expect(typed).toBeUndefined();
      expect((await invoke(document, 3, 5))?.map(labelOf)).toContain('Server');
    });

    it('takes the words of the Markdown block only, and carries its quote markers into a snippet', async () => {
      const document = makeEditor(
        'file:///c/names/quote.md',
        ['# Prose words', '> ```plantuml', '> @startuml', '> participant A', '>   al', '> ```', 'tail'].join('\n'),
        0
      ).document;

      const items = (await invoke(document, 4, 6)) ?? [];
      expect(items.map(labelOf)).toEqual(['alt', 'opt', 'loop', 'par', 'ref', 'note', 'participant', 'A']);
      expect(inserted(items[0])).toBe('alt ${1:condition}\n>     $2\n>   else ${3:otherwise}\n>     $4\n>   end');
      expect(items[0]?.range?.replacing).toEqual({
        start: { line: 4, character: 4 },
        end: { line: 4, character: 6 },
      });
      // Outside the block: VS Code's own suggestions.
      expect(await invoke(document, 0, 7)).toBeUndefined();
      expect(await invoke(document, 6, 4)).toBeUndefined();
    });

    it('offers nothing in a comment, in quoted text, or where nothing is found', async () => {
      const document = makeEditor(
        'file:///c/names/quiet.puml',
        ['@startuml', "' a comment", 'participant "Web" as W', '@enduml', '@startuml', '', '@enduml'].join('\n'),
        0,
        { languageId: 'plantuml' }
      ).document;

      expect(await invoke(document, 1, 5)).toBeUndefined();
      expect(await invoke(document, 2, 15)).toBeUndefined();
      expect(await invoke(document, 5, 0)).toBeUndefined();
    });

    it('leaves out the words where word suggestions are turned off for PlantUML, in a Markdown block too', async () => {
      const file = makeEditor('file:///c/names/off.puml', flows, 0, { languageId: 'plantuml' }).document;
      const markdown = makeEditor('file:///c/names/off.md', ['```plantuml', flows, '```'].join('\n'), 0).document;
      try {
        vscodeStub._test.setLanguageConfiguration('markdown', 'editor.wordBasedSuggestions', 'off');
        // In a block, VS Code reads the settings of the language at the cursor.
        expect((await invoke(markdown, 5, 0))?.map(labelOf)).toContain('hello');

        vscodeStub._test.setLanguageConfiguration('plantuml', 'editor.wordBasedSuggestions', 'off');
        for (const [document, line] of [
          [file, 4],
          [markdown, 5],
        ] as const) {
          expect((await invoke(document, line, 0))?.map(labelOf)).toEqual(['A', 'alt', 'opt', 'loop', 'par', 'ref', 'note']);
        }
      } finally {
        vscodeStub._test.setLanguageConfiguration('markdown', 'editor.wordBasedSuggestions', undefined);
        vscodeStub._test.setLanguageConfiguration('plantuml', 'editor.wordBasedSuggestions', undefined);
      }
    });
  });
});

describe('style items and skinparams in completion and hovers (dist)', () => {
  /** As VS Code asks while a word is typed, or on Ctrl+Space. */
  const invoke = async (document: TextEditorStub['document'], line: number, character: number): Promise<CompletionItemStub[] | undefined> =>
    await vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
      document,
      new vscodeStub.Position(line, character),
      undefined,
      { triggerKind: vscodeStub.CompletionTriggerKind.Invoke }
    );
  const labelOf = (item: CompletionItemStub): string => (typeof item.label === 'string' ? item.label : item.label.label);
  /** The hover at the position: its sections, as Markdown, and the columns it is for on its line. */
  const hoverAt = async (
    document: TextEditorStub['document'],
    line: number,
    character: number
  ): Promise<{ sections: string[]; columns: [number, number] } | undefined> => {
    const hover = await vscodeStub._test.hoverProviders[0]?.provider.provideHover(document, new vscodeStub.Position(line, character), {
      isCancellationRequested: false,
    });
    if (hover === undefined) {
      return undefined;
    }
    for (const section of hover.contents) {
      expect(section.isTrusted).toBe(false);
      expect(section.supportHtml).toBe(false);
    }
    return {
      sections: hover.contents.map((section) => section.value),
      columns: [hover.range?.start.character ?? -1, hover.range?.end.character ?? -1],
    };
  };
  const participant = STYLE_RULES.find(({ selectors }) => selectors.at(-1) === 'participant')!;
  /**
   * A diagram whose participant rule holds `line`, on line 4, and whose
   * line 8 is `skinparam`; its end line is line 10. What follows the cursor
   * is not read, what precedes it is: a property left without a value
   * takes the next line as its value, as the engine reads it.
   */
  const sheet = (line: string, skinparam = 'skinparam default'): string =>
    ['@startuml', '<style>', 'sequenceDiagram {', '  participant {', `    ${line}`, '  }', '}', '</style>', skinparam, 'Alice -> Bob', '@enduml'].join(
      '\n'
    );

  it('offers the properties of a rule, each with its help, replacing the name only', async () => {
    const document = makeEditor('file:///c/style/props.puml', sheet('Font'), 0, { languageId: 'plantuml' }).document;

    const items = (await invoke(document, 4, 8)) ?? [];
    expect(items.map(labelOf)).toEqual(['FontName', 'FontSize', 'FontColor', 'BackGroundColor', 'LineColor', 'LineThickness']);
    expect(items[2]).toMatchObject({ kind: vscodeStub.CompletionItemKind.Property, insertText: 'FontColor' });
    expect(items[2]?.range).toEqual({
      inserting: { start: { line: 4, character: 4 }, end: { line: 4, character: 8 } },
      replacing: { start: { line: 4, character: 4 }, end: { line: 4, character: 8 } },
    });
    const documentation = items[2]?.documentation as MarkdownStringStub;
    expect(documentation).toMatchObject({ isTrusted: false, supportHtml: false });
    expect(documentation.value).toBe(helpMarkdown(propertyHelp(participant, 'FontColor', englishMessages), englishMessages));
  });

  it('offers the values of a property, in the form typed, replacing the value only, and opens on no space', async () => {
    const document = makeEditor('file:///c/style/values.puml', sheet('FontColor: #to;'), 0, { languageId: 'plantuml' }).document;

    const colours = (await invoke(document, 4, 18)) ?? [];
    const tomato = colours.find((item) => labelOf(item) === '#tomato');
    expect(tomato).toMatchObject({ kind: vscodeStub.CompletionItemKind.Color, detail: '#FF6347', insertText: '#tomato' });
    // The semicolon after the value stays.
    expect(tomato?.range?.replacing).toEqual({ start: { line: 4, character: 15 }, end: { line: 4, character: 18 } });
    // After a space, the list waits for a letter or Ctrl+Space.
    const spacedDocument = makeEditor('file:///c/style/space.puml', sheet('LineColor '), 0, { languageId: 'plantuml' }).document;
    const spaced = await vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
      spacedDocument,
      new vscodeStub.Position(4, 14),
      undefined,
      { triggerKind: vscodeStub.CompletionTriggerKind.TriggerCharacter, triggerCharacter: ' ' }
    );
    expect(spaced).toBeUndefined();
    expect((await invoke(spacedDocument, 4, 14))?.map(labelOf)).toContain('#tomato');
  });

  it('offers the skinparams and their values, and nothing in a rule it does not offer', async () => {
    const document = makeEditor('file:///c/style/skinparams.puml', sheet('FontColor red'), 0, { languageId: 'plantuml' }).document;

    const names = (await invoke(document, 8, 17)) ?? [];
    expect(names.map(labelOf)).toEqual(['defaultFontName', 'defaultFontSize', 'defaultFontColor', 'backgroundColor']);
    expect(names[0]?.range?.replacing).toEqual({ start: { line: 8, character: 10 }, end: { line: 8, character: 17 } });
    expect((names[3]?.documentation as MarkdownStringStub).value).toBe(
      helpMarkdown(skinparamHelp('backgroundColor', englishMessages), englishMessages)
    );
    const value = makeEditor('file:///c/style/value.puml', sheet('FontColor red', 'skinparam backgroundColor '), 0, {
      languageId: 'plantuml',
    }).document;
    expect((await invoke(value, 8, 26))?.map(labelOf)).toContain('#white');
    // A rule the catalogue has not: nothing, as before.
    const other = makeEditor('file:///c/style/other.puml', ['@startuml', '<style>', 'note {', '  Font', '}', '</style>', '@enduml'].join('\n'), 0, {
      languageId: 'plantuml',
    }).document;
    expect(await invoke(other, 3, 6)).toBeUndefined();
  });

  it('works in a Markdown block in a quote, its markers outside what it replaces, the other words after', async () => {
    const document = makeEditor(
      'file:///c/style/quote.md',
      [
        '> ```plantuml',
        '> <style>',
        '> element {',
        '>   LineColor: #E0',
        '> }',
        '> </style>',
        '> skinparam defaultFontSize ',
        '> skinparam BackgroundColor #FFF',
        '> skinparam ',
        '> Alice -> Bob',
        '> ```',
      ].join('\n'),
      0
    ).document;

    const colours = (await invoke(document, 3, 18)) ?? [];
    expect(colours.length).toBeGreaterThan(100);
    expect(colours[0]?.range?.replacing).toEqual({ start: { line: 3, character: 15 }, end: { line: 3, character: 18 } });
    const sizes = (await invoke(document, 6, 28)) ?? [];
    expect(sizes.slice(0, 7).map(labelOf)).toEqual(['10', '12', '14', '16', '18', '20', '24']);
    expect(sizes[0]?.range?.replacing).toEqual({ start: { line: 6, character: 28 }, end: { line: 6, character: 28 } });
    // Markdown lists the words of the block too, as it did.
    expect(sizes.map(labelOf)).toContain('Alice');
    // But not a word that is a name offered, in any case.
    const names = ((await invoke(document, 8, 12)) ?? []).map(labelOf);
    expect(names.slice(0, 4)).toEqual(['defaultFontName', 'defaultFontSize', 'defaultFontColor', 'backgroundColor']);
    expect(names.filter((name) => name.toLowerCase() === 'backgroundcolor')).toEqual(['backgroundColor']);
    expect(names).toContain('Alice');
  });

  it('explains a property and a skinparam on hover, in any case, and nothing on a value or a selector', async () => {
    const document = makeEditor(
      'file:///c/style/hover.puml',
      [
        '@startuml',
        '<style>',
        'sequenceDiagram {',
        '  participant {',
        '    fontcolor: red;',
        '  }',
        '}',
        '</style>',
        'skinparam BackgroundColor #FFF',
        'Alice -> Bob',
        '@enduml',
      ].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;

    expect(await hoverAt(document, 4, 6)).toEqual({
      sections: [helpMarkdown(propertyHelp(participant, 'FontColor', englishMessages), englishMessages)],
      columns: [4, 13],
    });
    expect(await hoverAt(document, 8, 12)).toEqual({
      sections: [helpMarkdown(skinparamHelp('backgroundColor', englishMessages), englishMessages)],
      columns: [10, 25],
    });
    expect(await hoverAt(document, 4, 16)).toBeUndefined();
    expect(await hoverAt(document, 2, 4)).toBeUndefined();
    expect(await hoverAt(document, 8, 27)).toBeUndefined();
  });

  it('offers and explains nothing while plantumlLocal.styleHelp.enabled is off for the document, and leaves the rest', async () => {
    const document = makeEditor('file:///c/styleoff/props.puml', sheet('Font'), 0, { languageId: 'plantuml' }).document;
    const hovered = makeEditor('file:///c/styleoff/hover.puml', sheet('FontColor red'), 0, { languageId: 'plantuml' }).document;
    try {
      vscodeStub._test.setConfiguration('styleHelp.enabled', false, 'file:///c/styleoff');
      expect(await invoke(document, 4, 8)).toBeUndefined();
      expect(await invoke(document, 8, 17)).toBeUndefined();
      expect(await hoverAt(hovered, 4, 6)).toBeUndefined();
      // The other suggestions stay: the end line of the diagram.
      expect((await invoke(document, 10, 3))?.map(labelOf)).toContain('@enduml');
      // Another folder keeps the help.
      const other = makeEditor('file:///c/style/props.puml', sheet('Font'), 0, { languageId: 'plantuml' }).document;
      expect((await invoke(other, 4, 8))?.map(labelOf)).toContain('FontColor');
    } finally {
      vscodeStub._test.setConfiguration('styleHelp.enabled', undefined, 'file:///c/styleoff');
    }
    expect((await invoke(document, 4, 8))?.map(labelOf)).toContain('FontColor');
    expect(await hoverAt(hovered, 4, 6)).toBeDefined();
  });

  it('explains each snippet of syntax in the details of the list, with the lines it inserts', async () => {
    const document = makeEditor('file:///c/style/snippets.puml', ['@startuml', 'participant A', 'A -> B : hi', '', '@enduml'].join('\n'), 0, {
      languageId: 'plantuml',
    }).document;

    const snippets = ((await invoke(document, 3, 0)) ?? []).filter((item) => item.kind === vscodeStub.CompletionItemKind.Snippet);
    expect(snippets.map(labelOf)).toEqual(SNIPPETS.sequence.map(({ label }) => label));
    for (const [index, item] of snippets.entries()) {
      const documentation = item.documentation as MarkdownStringStub;
      expect(documentation).toMatchObject({ isTrusted: false, supportHtml: false });
      expect(documentation.value).toContain(codeBlock(expandSnippet(SNIPPETS.sequence[index]?.body ?? ''), 'plantuml'));
    }
    expect((snippets[0]?.documentation as MarkdownStringStub).value).toBe(
      [
        escapeMarkdown('A box of messages for each case: those sent when the condition holds, then, after else, the others.'),
        codeBlock('alt condition\n  \nelse otherwise\n  \nend', 'plantuml'),
      ].join('\n\n')
    );
  });
});

describe('definitions in completion and parameter hints (dist)', () => {
  const provide = (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    options: { trigger?: string; cancelled?: boolean } = {}
  ): Promise<CompletionItemStub[] | undefined> => {
    const registration = vscodeStub._test.completionProviders[0];
    if (registration === undefined) {
      throw new Error('no completion provider registered');
    }
    return registration.provider.provideCompletionItems(
      document,
      new vscodeStub.Position(line, character),
      { isCancellationRequested: options.cancelled === true },
      options.trigger === undefined
        ? { triggerKind: vscodeStub.CompletionTriggerKind.Invoke }
        : { triggerKind: vscodeStub.CompletionTriggerKind.TriggerCharacter, triggerCharacter: options.trigger }
    );
  };
  const hints = (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    options: { chosen?: SignatureHelpStub; cancelled?: boolean } = {}
  ): Promise<SignatureHelpStub | undefined> => {
    const registration = vscodeStub._test.signatureProviders[0];
    if (registration === undefined) {
      throw new Error('no signature help provider registered');
    }
    return registration.provider.provideSignatureHelp(
      document,
      new vscodeStub.Position(line, character),
      { isCancellationRequested: options.cancelled === true },
      options.chosen === undefined
        ? {
            triggerKind: vscodeStub.SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: '(',
            isRetrigger: false,
            activeSignatureHelp: undefined,
          }
        : {
            triggerKind: vscodeStub.SignatureHelpTriggerKind.ContentChange,
            triggerCharacter: undefined,
            isRetrigger: true,
            activeSignatureHelp: options.chosen,
          }
    );
  };
  const labelOf = (item: CompletionItemStub): string => (typeof item.label === 'string' ? item.label : item.label.label);
  /** The Markdown of the details or the parameter hints, which, as a hover, may run no command and let no HTML through. */
  const markdownOf = (documentation: unknown): string => {
    const markdown = documentation as MarkdownStringStub;
    expect(markdown.isTrusted).toBe(false);
    expect(markdown.supportHtml).toBe(false);
    return markdown.value;
  };
  const status = (): (typeof vscodeStub._test.languageStatusItems)[number] | undefined =>
    vscodeStub._test.languageStatusItems.find((item) => item.id === 'plantumlLocal.definitions');
  const boxes = (call: string): string =>
    [
      '@startuml',
      "' Draws a box",
      '!procedure Box($a, $b = "x")',
      '!endprocedure',
      '!$size = 3',
      '!function $twice($n) !return $n * 2',
      call,
      '@enduml',
    ].join('\n');

  it('offers what the diagram defines before the cursor, with where and how it is defined', async () => {
    const document = makeEditor('file:///c/defs/boxes.puml', boxes('Bo'), 0, { languageId: 'plantuml' }).document;

    const items = (await provide(document, 6, 2)) ?? [];
    const box = items.find((item) => labelOf(item) === 'Box');
    expect(box).toMatchObject({
      label: { label: 'Box', detail: '($a, $b = "x")', description: 'this diagram · procedure' },
      kind: vscodeStub.CompletionItemKind.Method,
      insertText: { value: 'Box(${1:\\$a})' },
      sortText: '21Box 002',
      command: { title: '', command: 'editor.action.triggerParameterHints' },
      range: {
        inserting: { start: { line: 6, character: 0 }, end: { line: 6, character: 2 } },
        replacing: { start: { line: 6, character: 0 }, end: { line: 6, character: 2 } },
      },
    });
    expect(markdownOf(box?.documentation)).toBe(
      [
        inlineCode('!procedure Box($a, $b = "x")'),
        escapeMarkdown('this diagram, line 3'),
        escapeLines('Draws a box'),
      ].join('\n\n')
    );
    expect(items.find((item) => labelOf(item) === '$twice')).toMatchObject({
      label: { label: '$twice', detail: '($n)', description: 'this diagram · function' },
      kind: vscodeStub.CompletionItemKind.Function,
      insertText: { value: '\\$twice(${1:\\$n})' },
    });
    const size = items.find((item) => labelOf(item) === '$size');
    expect(size).toMatchObject({
      label: { label: '$size', description: 'this diagram · variable' },
      kind: vscodeStub.CompletionItemKind.Variable,
      insertText: { value: '\\$size' },
    });
    expect(size).not.toHaveProperty('command');
    // The definitions come before the words, which VS Code would not list alone in a PlantUML file.
    const sorted = [...items].sort((a, b) => String(a.sortText).localeCompare(String(b.sortText)));
    expect(sorted.slice(0, 3).map(labelOf)).toEqual(['$size', '$twice', 'Box']);
    expect(sorted.slice(3).every((item) => item.kind === vscodeStub.CompletionItemKind.Text)).toBe(true);
    // A word that is a definition's name is offered once, as the definition.
    expect(sorted.slice(3).map(labelOf)).toEqual(expect.arrayContaining(['procedure', 'size']));
    expect(items.filter((item) => labelOf(item) === 'Box')).toHaveLength(1);
  });

  it('offers what a file of a bundled library declares, and the files it includes, from the package', async () => {
    const document = makeEditor(
      'file:///c/defs/context.puml',
      ['@startuml', '!include <C4/C4_Context>', 'Per', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;

    const items = (await provide(document, 2, 3)) ?? [];
    const person = items.find((item) => labelOf(item) === 'Person');
    expect(person).toMatchObject({
      label: {
        label: 'Person',
        detail: '($alias, $label, $descr = "", $sprite = "", $tags = "", $link = "", $type = "")',
        description: '<C4/C4_Context> · procedure',
      },
      insertText: { value: 'Person(${1:\\$alias}, ${2:\\$label})' },
    });
    const declared = [
      inlineCode('!unquoted procedure Person($alias, $label, $descr = "", $sprite = "", $tags = "", $link = "", $type = "")'),
      escapeMarkdown('<C4/C4_Context>, line 366'),
    ].join('\n\n');
    expect(markdownOf(person?.documentation).slice(0, declared.length)).toBe(declared);
    // C4_Context includes C4, which declares the tags.
    expect(items.find((item) => labelOf(item) === 'AddElementTag')).toMatchObject({
      label: { description: '<C4/C4> · procedure' },
    });
  });

  it('offers only the names that start with `$` on `$`, and none of the words', async () => {
    const document = makeEditor('file:///c/defs/dollar.puml', boxes('!$y = $'), 0, { languageId: 'plantuml' }).document;

    expect((await provide(document, 6, 7, { trigger: '$' }))?.map(labelOf)).toEqual(['$size', '$twice']);
    expect((await provide(document, 6, 7))?.map(labelOf)).toEqual(['$size', '$twice']);
    // On another trigger character, nothing.
    expect(await provide(document, 6, 7, { trigger: ' ' })).toBeUndefined();
    // Where nothing is defined, `$` leaves the list to VS Code.
    const bare = makeEditor('file:///c/defs/none.puml', '@startuml\nA -> B : $\n@enduml', 0, { languageId: 'plantuml' })
      .document;
    expect(await provide(bare, 1, 10, { trigger: '$' })).toBeUndefined();
  });

  it('shows the parameter hints of a call, the parameter the cursor is in highlighted', async () => {
    expect(vscodeStub._test.signatureProviders).toHaveLength(1);
    expect(vscodeStub._test.signatureProviders[0]).toMatchObject({
      selector: [{ language: 'markdown' }, { language: 'plantuml' }],
      metadata: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
    });
    const document = makeEditor('file:///c/defs/call.puml', boxes('Box(1, '), 0, { languageId: 'plantuml' }).document;

    const help = await hints(document, 6, 7);
    expect(help).toMatchObject({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{ label: 'Box($a, $b = "x")', parameters: [{ label: [4, 6] }, { label: [8, 16] }], activeParameter: 1 }],
    });
    expect(markdownOf(help?.signatures[0]?.documentation)).toBe(
      [escapeMarkdown('this diagram · procedure'), codeBlock('Draws a box', 'text')].join('\n\n')
    );
    // Outside a call, and on a name nothing defines: none.
    expect(await hints(document, 6, 0)).toBeUndefined();
    const unknown = makeEditor('file:///c/defs/unknown.puml', boxes('Nope('), 0, { languageId: 'plantuml' }).document;
    expect(await hints(unknown, 6, 5)).toBeUndefined();
  });

  it('shows the comment above a definition as written in the details and the parameter hints, as the hovers do', async () => {
    const comment = [
      "<img src='https://example.com/x.png'> <b>bold</b> <script>alert(1)</script>",
      '[run](command:workbench.action.quit) ![image](https://example.com/y.png) **not bold**',
      '&lt;i&gt; &amp; https://example.com www.example.com',
      '```',
    ];
    const hostile = (call: string): string =>
      ['@startuml', ...comment.map((line) => `' ${line}`), '!procedure Box($a)', '!endprocedure', call, '@enduml'].join('\n');
    const typed = makeEditor('file:///c/defs/hostile.puml', hostile('Bo'), 0, { languageId: 'plantuml' }).document;
    const box = ((await provide(typed, 7, 2)) ?? []).find((item) => labelOf(item) === 'Box');
    const called = makeEditor('file:///c/defs/hostile-call.puml', hostile('Box('), 0, { languageId: 'plantuml' }).document;
    const help = await hints(called, 7, 4);
    expect(box?.documentation).toBeDefined();
    expect(help?.signatures[0]?.documentation).toBeDefined();

    // Read back the way most permissive: HTML let through and bare links turned into links.
    const md = new MarkdownIt({ html: true, linkify: true });
    const details = md.render(markdownOf(box?.documentation));
    const shown = md.render(markdownOf(help?.signatures[0]?.documentation));
    const lines = comment.map((line) => md.utils.escapeHtml(line));
    for (const html of [details, shown]) {
      expect(html).not.toMatch(/<(?:a|img|b|script)\b/);
    }
    // The details break the lines where the comment does, as text that wraps; the hints keep them in a code block.
    expect(details).toContain(lines.join('<br>\n'));
    expect(details).not.toMatch(/<pre\b/);
    expect(shown).toContain(lines.join('\n'));
  });

  it('reads a call in a Markdown block from its quote markers on, and keeps the definition picked while it takes the arguments', async () => {
    const markdown = makeEditor(
      'file:///c/defs/doc.md',
      [
        '> ```plantuml',
        '> !procedure P($a)',
        '> !endprocedure',
        '> !procedure P($a, $b)',
        '> !endprocedure',
        '> P(',
        "> ' P(",
        '> ```',
      ].join('\n'),
      0
    ).document;

    // A comment, after the quote marker.
    expect(await hints(markdown, 6, 6)).toBeUndefined();
    const first = await hints(markdown, 5, 4);
    expect(first).toMatchObject({
      activeSignature: 0,
      activeParameter: 0,
      signatures: [{ label: 'P($a)' }, { label: 'P($a, $b)' }],
    });
    if (first === undefined) {
      throw new Error('no hints');
    }
    expect(await hints(markdown, 5, 4, { chosen: { ...first, activeSignature: 1 } })).toMatchObject({ activeSignature: 1 });
    // Picked, but past what it takes: the first that takes them.
    const more = makeEditor(
      'file:///c/defs/more.md',
      ['```plantuml', '!procedure P($a)', '!endprocedure', '!procedure P($a, $b)', '!endprocedure', 'P(1, ', '```'].join('\n'),
      0
    ).document;
    expect(await hints(more, 5, 5, { chosen: { ...first, activeSignature: 0 } })).toMatchObject({ activeSignature: 1 });
  });

  it('shows in the language status what was read, and says once in the output why something was not', async () => {
    expect(status()).toMatchObject({
      selector: [{ language: 'markdown' }, { language: 'plantuml' }],
      name: 'PlantUML Definitions',
    });
    const partial = makeEditor(
      'file:///c/defs/partial.puml',
      ['@startuml', '!include <C4/C4_Nothing>', '!include <C4/C4_Context>', 'Per', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    const other = makeEditor('file:///c/defs/other.puml', boxes('Bo'), 0, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(partial);
    const logged = vscodeStub._test.logs.length;

    await provide(partial.document, 3, 3);
    await provide(partial.document, 3, 2);
    await hints(partial.document, 3, 3);
    expect(status()).toMatchObject({
      text: 'Definitions: diagram and includes (partial)',
      severity: vscodeStub.LanguageStatusSeverity.Warning,
      detail: 'Some definitions are missing. See the Output panel for the reasons.',
    });
    expect(vscodeStub._test.logs.slice(logged)).toEqual([
      expect.stringMatching(
        /^info: Completion, parameter hints, hovers, Go to Definition and Find All References in defs\/partial\.puml did not read:\ndefs\/partial\.puml, line 2: <C4\/C4_Nothing> was not read\. No bundled library has this file\./
      ),
    ]);

    // Another document in the editor: what was read for it.
    vscodeStub._test.setActiveEditor(other);
    await provide(other.document, 6, 2);
    expect(status()).toMatchObject({
      text: 'Definitions: diagram and includes',
      severity: vscodeStub.LanguageStatusSeverity.Information,
      detail:
        'Completion, parameter hints, hovers, Go to Definition and Find All References read what this diagram and the files it includes define.',
    });
    vscodeStub._test.setActiveEditor(partial);
    expect(status()?.text).toBe('Definitions: diagram and includes (partial)');

    // Once the include is fixed, all of it.
    partial.document.setText(['@startuml', '!include <C4/C4_Container>', '!include <C4/C4_Context>', 'Per', '@enduml'].join('\n'));
    await provide(partial.document, 3, 3);
    expect(status()?.text).toBe('Definitions: diagram and includes');
    expect(vscodeStub._test.logs.slice(logged)).toHaveLength(1);
    vscodeStub._test.setActiveEditor(undefined);
  });

  it('reads a file with no start line whole, as a file only included', async () => {
    const fragment = makeEditor(
      'file:///c/defs/parts.iuml',
      ['!procedure Box($a)', '!endprocedure', 'Bo', 'Box('].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;
    expect((await provide(fragment, 2, 2))?.map(labelOf)).toContain('Box');
    expect(await hints(fragment, 3, 4)).toMatchObject({ signatures: [{ label: 'Box($a)' }] });
  });

  it('reads no definitions of a document past the limits, and says so', async () => {
    const big = makeEditor(
      'file:///c/defs/big.puml',
      ['@startuml', '!$size = 3', ...Array<string>(50_000).fill('A -> B'), '$', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    vscodeStub._test.setActiveEditor(big);

    expect(await provide(big.document, 50_002, 1, { trigger: '$' })).toBeUndefined();
    expect(status()).toMatchObject({
      text: 'Definitions: not read',
      severity: vscodeStub.LanguageStatusSeverity.Warning,
      detail:
        'The document is larger than 2 MiB or longer than 50000 lines, so completion, parameter hints, hovers, Go to Definition and Find All References do not read its definitions.',
    });
    vscodeStub._test.setActiveEditor(undefined);
  });

  it('answers nothing once the request is cancelled or the document changes while it reads', async () => {
    const document = makeEditor('file:///c/defs/stale.puml', boxes('Box(1, '), 0, { languageId: 'plantuml' }).document;
    // A version for each time it is read: edited between any two reads.
    let reads = 0;
    const changing: TextEditorStub['document'] = {
      ...document,
      get version(): number {
        reads += 1;
        return reads;
      },
    };

    expect(await provide(document, 6, 2, { cancelled: true })).toBeUndefined();
    expect(await hints(document, 6, 7, { cancelled: true })).toBeUndefined();
    expect(await provide(changing, 6, 2)).toBeUndefined();
    expect(await hints(changing, 6, 7)).toBeUndefined();
    expect(reads).toBeGreaterThan(0);
    // As it is, it answers.
    expect(await hints(document, 6, 7)).toMatchObject({ activeParameter: 1 });
  });
});

describe('Go to Definition (dist)', () => {
  type RangeLike = { start: { line: number; character: number }; end: { line: number; character: number } };
  interface LinkStub {
    originSelectionRange: RangeLike;
    targetUri: { toString(): string };
    targetRange: RangeLike;
    targetSelectionRange?: RangeLike;
  }
  /** `line:character-line:character`. */
  const span = (range: RangeLike | undefined): string =>
    range === undefined
      ? ''
      : `${String(range.start.line)}:${String(range.start.character)}-${String(range.end.line)}:${String(range.end.character)}`;
  /** Where Go to Definition at the position leads: the name it starts from, the URI, the range and the name there. */
  const definitions = async (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    options: { cancelled?: boolean } = {}
  ): Promise<{ from: string; to: string; range: string; name: string }[] | undefined> => {
    const registration = vscodeStub._test.definitionProviders[0];
    if (registration === undefined) {
      throw new Error('no definition provider registered');
    }
    const links = (await registration.provider.provideDefinition(document, new vscodeStub.Position(line, character), {
      isCancellationRequested: options.cancelled === true,
    })) as LinkStub[] | undefined;
    return links?.map((link) => ({
      from: span(link.originSelectionRange),
      to: link.targetUri.toString(),
      range: span(link.targetRange),
      name: span(link.targetSelectionRange),
    }));
  };
  const puml = (path: string, lines: readonly string[]): TextEditorStub['document'] =>
    makeEditor(path, lines.join('\n'), 0, { languageId: 'plantuml' }).document;
  /** The text the package bundles of a file of C4. */
  const c4Text = (key: string): string =>
    (JSON.parse(readFileSync(join(__dirname, '../../dist/stdlib/c4.json'), 'utf8')) as { entries: Record<string, string> })
      .entries[key] ?? '';

  it('goes to what the diagram the cursor is in declares, and not to the same name in another diagram', async () => {
    const two = puml('file:///c/goto/two.puml', [
      '@startuml(id=first)',
      'participant "注文係" as A',
      'participant Server as B',
      'A -> B : hello A',
      '@enduml',
      '@startuml(id=second)',
      'participant "Other" as A',
      'A -> A : ping',
      '@enduml',
    ]);

    expect(await definitions(two, 3, 0)).toEqual([
      { from: '3:0-3:1', to: 'file:///c/goto/two.puml', range: '1:0-1:22', name: '1:21-1:22' },
    ]);
    expect(await definitions(two, 7, 5)).toEqual([
      { from: '7:5-7:6', to: 'file:///c/goto/two.puml', range: '6:0-6:24', name: '6:23-6:24' },
    ]);
    // A word of a label, even an alias, names nothing; nor does a name nothing declares.
    expect(await definitions(two, 3, 15)).toBeUndefined();
    expect(await definitions(two, 3, 10)).toBeUndefined();
  });

  it('goes to each line that declares an element, a body to its end, in a Markdown block from its quote markers on', async () => {
    const markdown = makeEditor(
      'file:///c/goto/doc.md',
      [
        '# Order',
        '> ```plantuml',
        '> participant "注文係" as A',
        '> package P {',
        '>   class C',
        '> }',
        '> class C',
        '> A -> C : hello',
        '> ```',
      ].join('\n'),
      0
    ).document;

    expect(await definitions(markdown, 7, 2)).toEqual([
      { from: '7:2-7:3', to: 'file:///c/goto/doc.md', range: '2:0-2:24', name: '2:23-2:24' },
    ]);
    expect(await definitions(markdown, 7, 7)).toEqual([
      { from: '7:7-7:8', to: 'file:///c/goto/doc.md', range: '4:0-4:11', name: '4:10-4:11' },
      { from: '7:7-7:8', to: 'file:///c/goto/doc.md', range: '6:0-6:9', name: '6:8-6:9' },
    ]);
    // In the text of the document, nothing.
    expect(await definitions(markdown, 0, 3)).toBeUndefined();
  });

  it('goes to the definition a call stands for by the arguments it is given, from its line to the end of its body', async () => {
    const calls = puml('file:///c/goto/calls.puml', [
      '@startuml',
      '!procedure P($a)',
      '!endprocedure',
      '!procedure P($a, $b = 2)',
      '  A -> B : $b',
      '!endprocedure',
      '!$size = 3',
      'P(1, "a, b")',
      'P(1)',
      'A -> B : "$size"',
      "' P(1)",
      'P(1, 2, 3)',
      '@enduml',
    ]);

    expect(await definitions(calls, 7, 0)).toEqual([
      { from: '7:0-7:1', to: 'file:///c/goto/calls.puml', range: '3:0-5:13', name: '3:11-3:12' },
    ]);
    expect(await definitions(calls, 8, 0)).toEqual([
      { from: '8:0-8:1', to: 'file:///c/goto/calls.puml', range: '1:0-2:13', name: '1:11-1:12' },
    ]);
    // A variable in quoted text, the cursor on its `$`.
    expect(await definitions(calls, 9, 10)).toEqual([
      { from: '9:10-9:15', to: 'file:///c/goto/calls.puml', range: '6:0-6:10', name: '6:1-6:6' },
    ]);
    // A parameter in the body it is a parameter of: on the line that declares it.
    expect(await definitions(calls, 4, 11)).toEqual([
      { from: '4:11-4:13', to: 'file:///c/goto/calls.puml', range: '3:0-3:24', name: '3:17-3:19' },
    ]);
    // A comment, and a call no definition takes.
    expect(await definitions(calls, 10, 2)).toBeUndefined();
    expect(await definitions(calls, 11, 0)).toBeUndefined();
  });

  it('gives each definition a call may stand for, and none where text that was not read may define it again', async () => {
    const branches = puml('file:///c/goto/branches.puml', [
      '@startuml',
      '!if %true()',
      '!procedure P()',
      '!endprocedure',
      '!else',
      '!procedure P()',
      '!endprocedure',
      '!endif',
      'P()',
      '@enduml',
    ]);
    expect((await definitions(branches, 8, 0))?.map(({ name }) => name)).toEqual(['2:11-2:12', '5:11-5:12']);

    const dynamic = makeEditor(
      'file:///c/goto/dynamic.puml',
      ['@startuml', '!procedure P()', '!endprocedure', '!$file = "parts.puml"', '!include $file', 'P()', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    vscodeStub._test.setActiveEditor(dynamic);
    const logged = vscodeStub._test.logs.length;
    expect(await definitions(dynamic.document, 5, 0)).toBeUndefined();
    expect(vscodeStub._test.languageStatusItems.find((item) => item.id === 'plantumlLocal.definitions')).toMatchObject({
      text: 'Definitions: diagram and includes (partial)',
    });
    expect(vscodeStub._test.logs.slice(logged)).toEqual([
      expect.stringMatching(
        /^info: Completion, parameter hints, hovers, Go to Definition and Find All References in goto\/dynamic\.puml did not read:\ngoto\/dynamic\.puml, line 5: \$file was not read\./
      ),
    ]);
    vscodeStub._test.setActiveEditor(undefined);
  });

  it('opens what a bundled library defines in its read-only view, at the definition the completion picks', async () => {
    const context = puml('file:///c/goto/context.puml', [
      '@startuml',
      '!include <C4/C4_Context>',
      'Person(user, "User")',
      '@enduml',
    ]);
    const person = await definitions(context, 2, 3);
    expect(person).toEqual([
      {
        from: '2:0-2:6',
        to: 'plantuml-local-library:/C4/C4_Context.puml',
        range: `365:0-379:${String(c4Text('c4_context').split('\n')[379]?.length)}`,
        name: '365:20-365:26',
      },
    ]);
    expect(c4Text('c4_context').split('\n')[365]?.slice(20, 26)).toBe('Person');

    // In a Dynamic diagram, `Rel` with three arguments may be either of the two C4_Dynamic defines.
    const dynamic = puml('file:///c/goto/dynamic-c4.puml', [
      '@startuml',
      '!include <C4/C4_Dynamic>',
      'Person(a, "A")',
      'Person(b, "B")',
      'Rel(a, b, "asks")',
      '@enduml',
    ]);
    const rel = await definitions(dynamic, 4, 1);
    expect(rel?.map(({ to, name }) => `${to}#${name}`)).toEqual([
      'plantuml-local-library:/C4/C4_Dynamic.puml#37:20-37:23',
      'plantuml-local-library:/C4/C4_Dynamic.puml#33:20-33:23',
    ]);
    expect(c4Text('c4_dynamic').split('\n')[37]?.slice(20, 23)).toBe('Rel');
  });

  it('goes from the path of an include of a bundled library to its file, named as upstream writes it', async () => {
    const includes = puml('file:///c/goto/includes.puml', [
      '@startuml',
      '!include <C4/C4_Context>',
      '!include <azure/Compute/AzureFunction>',
      '!include <C4/C4_Nothing>',
      '@enduml',
    ]);

    expect(await definitions(includes, 1, 12)).toEqual([
      { from: '1:9-1:24', to: 'plantuml-local-library:/C4/C4_Context.puml', range: '0:0-0:0', name: '' },
    ]);
    expect((await definitions(includes, 2, 20))?.map(({ to }) => to)).toEqual([
      'plantuml-local-library:/azure/Compute/AzureFunction.puml',
    ]);
    // A file no bundled library has: nothing, as the engine includes nothing.
    expect(await definitions(includes, 3, 12)).toBeUndefined();
  });

  it('leaves the path of a local include, an !includesub and a theme to the provider of include paths', async () => {
    // A word of a path names nothing, not even a variable a label names.
    for (const path of ['!include lib/shapes.iuml', '!includesub parts/a.iuml!shapes']) {
      const words = puml('file:///c/goto/paths.puml', ['@startuml', '!shapes = "s"', 'A -> B : shapes', path, '@enduml']);
      expect((await definitions(words, 2, 10))?.map(({ name }) => name)).toEqual(['1:1-1:7']);
      expect(await definitions(words, 3, path.lastIndexOf('shapes') + 1)).toBeUndefined();
    }
    const paths = puml('file:///c/goto/paths.puml', [
      '@startuml',
      '!$dir = "lib"',
      '!theme local from ../themes',
      '!include $dir/shapes.iuml',
      '@enduml',
    ]);
    expect(await definitions(paths, 2, 8)).toBeUndefined();
    expect(await definitions(paths, 2, 22)).toBeUndefined();
    // A name that starts with `$` in the path is a reference to its variable.
    expect((await definitions(paths, 3, 11))?.map(({ name }) => name)).toEqual(['1:1-1:5']);
  });

  it('gives the text the package bundles of a library file, under the scheme of its read-only view', async () => {
    expect(vscodeStub._test.contentProviders.map(({ scheme }) => scheme)).toEqual(['plantuml-local-library']);
    const provider = vscodeStub._test.contentProviders[0]?.provider;
    const view = (path: string): Promise<string | undefined> | string | undefined =>
      provider?.provideTextDocumentContent(vscodeStub.Uri.from({ scheme: 'plantuml-local-library', path }));

    expect(await view('/C4/C4_Context.puml')).toBe(c4Text('c4_context'));
    expect(await view('/c4/c4_context.puml')).toBe(c4Text('c4_context'));
    expect(await view('/C4/C4_Nothing.puml')).toBeUndefined();
    expect(await view('/other/x.puml')).toBeUndefined();
  });

  it('reads a file with no start line whole, as the view of a library file or a file only included', async () => {
    // In the view of C4_Context.puml, $toElementArg, which C4.puml defines, on the line after Person's.
    const lines = c4Text('c4_context').split('\n');
    expect(lines[366]?.slice(9, 22)).toBe('$toElementArg');
    const view = puml('plantuml-local-library:/C4/C4_Context.puml', lines);
    expect((await definitions(view, 366, 12))?.map(({ from, to, name }) => `${from} ${to}#${name}`)).toEqual([
      '366:9-366:22 plantuml-local-library:/C4/C4.puml#397:19-397:32',
    ]);
    expect(c4Text('c4').split('\n')[397]?.slice(19, 32)).toBe('$toElementArg');

    const body = ['!procedure P($name)', '  rectangle $name', '!endprocedure', 'P(x)'];
    const included = puml('file:///c/goto/parts.iuml', body);
    expect((await definitions(included, 1, 13))?.map(({ name }) => name)).toEqual(['0:13-0:18']);
    expect((await definitions(included, 3, 0))?.map(({ name }) => name)).toEqual(['0:11-0:12']);
    // The same lines in a diagram: the same definitions, a line further down.
    const diagram = puml('file:///c/goto/parts.puml', ['@startuml', ...body, '@enduml']);
    expect((await definitions(diagram, 2, 13))?.map(({ name }) => name)).toEqual(['1:13-1:18']);
    expect((await definitions(diagram, 4, 0))?.map(({ name }) => name)).toEqual(['1:11-1:12']);
    // In a file with a start line, a line outside its diagrams is in none.
    const outside = puml('file:///c/goto/outside.puml', [...body, '@startuml', 'A -> B', '@enduml']);
    expect(await definitions(outside, 3, 0)).toBeUndefined();
  });

  it('answers nothing once the request is cancelled or the document changes while it reads', async () => {
    const document = puml('file:///c/goto/cancelled.puml', ['@startuml', '!procedure P()', '!endprocedure', 'P()', '@enduml']);
    expect(await definitions(document, 3, 0, { cancelled: true })).toBeUndefined();
    expect(await definitions(document, 3, 0)).toHaveLength(1);

    // Edited once the request has started: after what it first reads of the document.
    const library = puml('file:///c/goto/changing.puml', [
      '@startuml',
      '!include <C4/C4_Context>',
      'Person(a, "A")',
      '@enduml',
    ]);
    let reads = 0;
    const changing: TextEditorStub['document'] = {
      ...library,
      get version(): number {
        reads += 1;
        return reads === 1 ? 1 : 2;
      },
    };
    expect(await definitions(changing, 1, 12)).toBeUndefined();
    reads = 0;
    expect(await definitions(changing, 2, 1)).toBeUndefined();
    expect(await definitions(library, 1, 12)).toHaveLength(1);
    expect(await definitions(library, 2, 1)).toHaveLength(1);
  });
});

describe('Find All References (dist)', () => {
  type RangeLike = { start: { line: number; character: number }; end: { line: number; character: number } };
  /** What Find All References at the position lists: `uri#line:character-line:character`, in order. */
  const references = async (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    options: { includeDeclaration?: boolean; cancelled?: boolean } = {}
  ): Promise<string[] | undefined> => {
    const registration = vscodeStub._test.referenceProviders[0];
    if (registration === undefined) {
      throw new Error('no reference provider registered');
    }
    const locations = await registration.provider.provideReferences(
      document,
      new vscodeStub.Position(line, character),
      { includeDeclaration: options.includeDeclaration ?? true },
      { isCancellationRequested: options.cancelled === true }
    );
    const span = ({ start, end }: RangeLike): string =>
      `${String(start.line)}:${String(start.character)}-${String(end.line)}:${String(end.character)}`;
    return locations?.map(({ uri, range }) => `${uri.toString()}#${span(range)}`);
  };
  const puml = (path: string, lines: readonly string[]): TextEditorStub['document'] =>
    makeEditor(path, lines.join('\n'), 0, { languageId: 'plantuml' }).document;
  const status = (): (typeof vscodeStub._test.languageStatusItems)[number] | undefined =>
    vscodeStub._test.languageStatusItems.find((item) => item.id === 'plantumlLocal.definitions');

  it('finds the calls and variables that stand for the definition, in the diagram it is in alone', async () => {
    const two = 'file:///c/refs/two.puml';
    const document = puml(two, [
      '@startuml(id=first)',
      '!procedure P($a)',
      '  A -> B : $a',
      '!endprocedure',
      '!procedure P($a, $b)',
      '!endprocedure',
      'P(1)',
      "' P(2)",
      'A -> B : "P(3)"',
      'P(4, 5)',
      'P(6)',
      '@enduml',
      '@startuml(id=second)',
      '!procedure P($a)',
      '!endprocedure',
      'P(7)',
      '@enduml',
    ]);

    // From a call or from the name its definition declares: the definition first, then each call that picks it.
    const first = [`${two}#1:11-1:12`, `${two}#6:0-6:1`, `${two}#10:0-10:1`];
    expect(await references(document, 6, 0)).toEqual(first);
    expect(await references(document, 1, 11)).toEqual(first);
    expect(await references(document, 10, 1, { includeDeclaration: false })).toEqual(first.slice(1));
    // The definition the arguments pick instead; the one of the other diagram.
    expect(await references(document, 9, 0)).toEqual([`${two}#4:11-4:12`, `${two}#9:0-9:1`]);
    expect(await references(document, 15, 0)).toEqual([`${two}#13:11-13:12`, `${two}#15:0-15:1`]);
    // A parameter, in the body of its procedure.
    const parameter = [`${two}#1:13-1:15`, `${two}#2:11-2:13`];
    expect(await references(document, 2, 12)).toEqual(parameter);
    expect(await references(document, 1, 14)).toEqual(parameter);

    // A variable given a new value is another definition from there on; a parameter of its name, another still.
    const sizes = 'file:///c/refs/sizes.puml';
    const variables = puml(sizes, [
      '@startuml',
      '!$size = 3',
      'A -> B : $size',
      '!$size = 4',
      'A -> B : "$size"',
      '!procedure Box($size)',
      '  A -> B : $size',
      '!endprocedure',
      '@enduml',
    ]);
    expect(await references(variables, 2, 10)).toEqual([`${sizes}#1:1-1:6`, `${sizes}#2:9-2:14`]);
    expect(await references(variables, 3, 2)).toEqual([`${sizes}#3:1-3:6`, `${sizes}#4:10-4:15`]);
    expect(await references(variables, 6, 12)).toEqual([`${sizes}#5:15-5:20`, `${sizes}#6:11-6:16`]);
  });

  it('finds an element where a line names it before its label, and not in a label or another diagram', async () => {
    const elements = 'file:///c/refs/elements.puml';
    const document = puml(elements, [
      '@startuml(id=first)',
      'participant "Order" as A',
      'participant B',
      'A -> B : hello A',
      'B -> A',
      '@enduml',
      '@startuml(id=second)',
      'participant A',
      'A -> A',
      '@enduml',
    ]);

    const first = [`${elements}#1:23-1:24`, `${elements}#3:0-3:1`, `${elements}#4:5-4:6`];
    expect(await references(document, 3, 0)).toEqual(first);
    expect(await references(document, 1, 23)).toEqual(first);
    expect(await references(document, 4, 5, { includeDeclaration: false })).toEqual(first.slice(1));
    expect(await references(document, 3, 5)).toEqual([`${elements}#2:12-2:13`, `${elements}#3:5-3:6`, `${elements}#4:0-4:1`]);
    expect(await references(document, 8, 5)).toEqual([
      `${elements}#7:12-7:13`,
      `${elements}#8:0-8:1`,
      `${elements}#8:5-8:6`,
    ]);
  });

  it('finds nothing on a comment, a word of a label or a name no line declares', async () => {
    const document = puml('file:///c/refs/words.puml', ['@startuml', 'participant A', "' A", 'A -> B : hello', '@enduml']);
    expect(await references(document, 2, 2)).toBeUndefined();
    expect(await references(document, 3, 10)).toBeUndefined();
    expect(await references(document, 3, 5)).toBeUndefined();
    expect(await references(document, 3, 0)).toHaveLength(2);
  });

  it('counts the quote markers before the lines of a Markdown block', async () => {
    const doc = 'file:///c/refs/doc.md';
    const markdown = makeEditor(
      doc,
      ['# Order', '> ```plantuml', '> !procedure P()', '> !endprocedure', '> participant A', '> P()', '> A -> A', '> ```'].join('\n'),
      0
    ).document;

    expect(await references(markdown, 5, 2)).toEqual([`${doc}#2:13-2:14`, `${doc}#5:2-5:3`]);
    expect(await references(markdown, 6, 2)).toEqual([`${doc}#4:14-4:15`, `${doc}#6:2-6:3`, `${doc}#6:7-6:8`]);
    // In the text of the document, nothing.
    expect(await references(markdown, 0, 3)).toBeUndefined();
  });

  it('leaves out a place that text not read may define again, and says why', async () => {
    const uri = 'file:///c/refs/dynamic.puml';
    const dynamic = makeEditor(
      uri,
      ['@startuml', '!procedure P()', '!endprocedure', 'P()', '!$file = "parts.puml"', '!include $file', 'P()', '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    vscodeStub._test.setActiveEditor(dynamic);
    const logged = vscodeStub._test.logs.length;

    // From the call after it, nothing to look for, and why.
    expect(await references(dynamic.document, 6, 0)).toBeUndefined();
    expect(status()).toMatchObject({
      text: 'Definitions: diagram and includes (partial)',
      severity: vscodeStub.LanguageStatusSeverity.Warning,
      detail: 'Some definitions are missing. See the Output panel for the reasons.',
    });
    expect(vscodeStub._test.logs.slice(logged)).toEqual([
      expect.stringMatching(
        /^info: Completion, parameter hints, hovers, Go to Definition and Find All References in refs\/dynamic\.puml did not read:\nrefs\/dynamic\.puml, line 6: \$file was not read\./
      ),
    ]);
    // From the call before it, that call alone, for the same reason.
    expect(await references(dynamic.document, 3, 0)).toEqual([`${uri}#1:11-1:12`, `${uri}#3:0-3:1`]);
    expect(status()?.text).toBe('Definitions: diagram and includes (partial)');
    expect(vscodeStub._test.logs.slice(logged)).toHaveLength(1);
    vscodeStub._test.setActiveEditor(undefined);
  });

  it('lists the first 5000 references, and says that the list stops there', async () => {
    const uri = 'file:///c/refs/many.puml';
    const many = makeEditor(
      uri,
      ['@startuml', '!procedure P()', '!endprocedure', ...Array<string>(5_001).fill('P()'), '@enduml'].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    vscodeStub._test.setActiveEditor(many);
    const logged = vscodeStub._test.logs.length;

    const found = await references(many.document, 3, 0);
    expect(found).toHaveLength(5_000);
    expect(found?.slice(0, 2)).toEqual([`${uri}#1:11-1:12`, `${uri}#3:0-3:1`]);
    expect(found?.at(-1)).toBe(`${uri}#5001:0-5001:1`);
    expect(status()).toMatchObject({
      text: 'Definitions: diagram and includes (partial)',
      severity: vscodeStub.LanguageStatusSeverity.Warning,
      detail: 'Only the first 5000 references are listed.',
    });
    expect(vscodeStub._test.logs.slice(logged)).toEqual([
      expect.stringMatching(
        /^info: Completion, parameter hints, hovers, Go to Definition and Find All References in refs\/many\.puml did not read:\nOnly the first 5000 references are listed\./
      ),
    ]);
    // Without the definition, a call more.
    expect((await references(many.document, 3, 0, { includeDeclaration: false }))?.at(-1)).toBe(`${uri}#5002:0-5002:1`);
    expect(vscodeStub._test.logs.slice(logged)).toHaveLength(1);
    vscodeStub._test.setActiveEditor(undefined);
  });

  it('answers nothing once the request is cancelled or the document changes while it reads', async () => {
    const uri = 'file:///c/refs/cancelled.puml';
    const document = puml(uri, ['@startuml', '!procedure P()', '!endprocedure', 'P()', '@enduml']);
    expect(await references(document, 3, 0, { cancelled: true })).toBeUndefined();
    expect(await references(document, 3, 0)).toEqual([`${uri}#1:11-1:12`, `${uri}#3:0-3:1`]);

    // Edited once the request has started: after what it first reads of the document.
    let reads = 0;
    const changing: TextEditorStub['document'] = {
      ...document,
      get version(): number {
        reads += 1;
        return reads === 1 ? 1 : 2;
      },
    };
    expect(await references(changing, 3, 0)).toBeUndefined();
    reads = 0;
    expect(await references(changing, 1, 11)).toBeUndefined();
  });

  describe('with the local files a diagram includes', () => {
    const PARTS = [
      '!procedure Box($n)',
      '  rectangle "box $n"',
      '!endprocedure',
      '!procedure Boxes()',
      '  Box(1)',
      '  Box(2)',
      '!endprocedure',
    ];
    const MAIN = ['@startuml', '!include parts.iuml', '!include <C4/C4_Context>', 'Box(1)', 'Person(a, "A")', '@enduml'];
    let root = '';
    let folderOf: VscodeStub['workspace']['getWorkspaceFolder'] = () => undefined;
    const uriOf = (name: string): string => vscodeStub.Uri.file(join(root, name)).toString();
    /** A document in the workspace folder on disk: its URI as VS Code writes it, its path as the platform does. */
    const onDisk = (name: string, lines: readonly string[]): TextEditorStub['document'] => {
      const document = puml(uriOf(name), lines);
      return { ...document, uri: { ...document.uri, fsPath: join(root, name) } };
    };

    beforeAll(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-refs-')));
      await writeFile(join(root, 'parts.iuml'), PARTS.join('\n'));
      // The stub's folder, /c, is on no disk: this one is, so that its includes are read.
      folderOf = vscodeStub.workspace.getWorkspaceFolder;
      const folder = { uri: { ...vscodeStub.Uri.file(root), fsPath: root }, name: 'ws', index: 0 };
      const under = `${vscodeStub.Uri.file(root).toString()}/`;
      vscodeStub.workspace.getWorkspaceFolder = (uri) => (uri.toString().startsWith(under) ? folder : folderOf(uri));
    });

    afterAll(async () => {
      vscodeStub.workspace.getWorkspaceFolder = folderOf;
      await rm(root, { recursive: true, force: true });
    });

    it('looks in the local files the diagram includes, as the editor has them', async () => {
      const main = onDisk('main.puml', MAIN);
      const box = [
        `${uriOf('parts.iuml')}#0:11-0:14`,
        `${uriOf('main.puml')}#3:0-3:3`,
        `${uriOf('parts.iuml')}#4:2-4:5`,
        `${uriOf('parts.iuml')}#5:2-5:5`,
      ];
      expect(await references(main, 3, 0)).toEqual(box);
      expect(await references(main, 3, 0, { includeDeclaration: false })).toEqual(box.slice(1));

      // A change not saved yet.
      const edited = onDisk('parts.iuml', [...PARTS.slice(0, 6), '  Box(3)', ...PARTS.slice(6)]);
      vscodeStub._test.openDocument(edited);
      try {
        expect(await references(main, 3, 0)).toEqual([...box, `${uriOf('parts.iuml')}#6:2-6:5`]);
      } finally {
        vscodeStub._test.closeDocument(edited);
      }

      // Defined again after the include: the file's calls are to the one defined before them.
      const again = onDisk('again.puml', ['@startuml', '!include parts.iuml', '!procedure Box($n)', '!endprocedure', 'Box(3)', '@enduml']);
      expect(await references(again, 4, 0)).toEqual([`${uriOf('again.puml')}#2:11-2:14`, `${uriOf('again.puml')}#4:0-4:3`]);
    });

    it("lists where a bundled library defines a name, and not where the library's own files use it", async () => {
      const main = onDisk('main.puml', MAIN);
      expect(await references(main, 4, 0)).toEqual([
        'plantuml-local-library:/C4/C4_Context.puml#365:20-365:26',
        `${uriOf('main.puml')}#4:0-4:6`,
      ]);
      expect(await references(main, 4, 0, { includeDeclaration: false })).toEqual([`${uriOf('main.puml')}#4:0-4:6`]);
    });

    it('searches a file with no start line within itself, and not the diagrams that include it', async () => {
      const parts = onDisk('parts.iuml', PARTS);
      expect(await references(parts, 4, 2)).toEqual([
        `${uriOf('parts.iuml')}#0:11-0:14`,
        `${uriOf('parts.iuml')}#4:2-4:5`,
        `${uriOf('parts.iuml')}#5:2-5:5`,
      ]);
    });
  });
});

describe('hovers (dist)', () => {
  type RangeLike = { start: { line: number; character: number }; end: { line: number; character: number } };
  /** The hover at the position: its sections, as Markdown, and the range it is for, `line:character-line:character`. */
  const hoverAt = async (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    options: { cancelled?: boolean } = {}
  ): Promise<{ sections: string[]; range: string } | undefined> => {
    const registration = vscodeStub._test.hoverProviders[0];
    if (registration === undefined) {
      throw new Error('no hover provider registered');
    }
    const hover = await registration.provider.provideHover(document, new vscodeStub.Position(line, character), {
      isCancellationRequested: options.cancelled === true,
    });
    if (hover === undefined) {
      return undefined;
    }
    // Nothing a hover shows may run a command or let HTML through.
    for (const section of hover.contents) {
      expect(section.isTrusted).toBe(false);
      expect(section.supportHtml).toBe(false);
    }
    const span = ({ start, end }: RangeLike): string =>
      `${String(start.line)}:${String(start.character)}-${String(end.line)}:${String(end.character)}`;
    return { sections: hover.contents.map((section) => section.value), range: hover.range === undefined ? '' : span(hover.range) };
  };
  const puml = (path: string, lines: readonly string[]): TextEditorStub['document'] =>
    makeEditor(path, lines.join('\n'), 0, { languageId: 'plantuml' }).document;
  /** The Markdown of the built-in help of `target`, as the module that writes it gives it. */
  const help = (target: BuiltinTarget): string => {
    const found = helpFor(target, englishMessages);
    if (found === null) {
      throw new Error(`no help for ${target.name}`);
    }
    return helpMarkdown(found, englishMessages);
  };

  it('is registered for Markdown and PlantUML files', () => {
    expect(vscodeStub._test.hoverProviders.map(({ selector }) => selector)).toEqual([
      [{ language: 'markdown' }, { language: 'plantuml' }],
    ]);
  });

  it('gives built-in help on a directive, the kind of a diagram, a bundled theme and an icon, in their own case only', async () => {
    const document = puml('file:///c/hover/builtin.puml', [
      '@startgantt',
      '[Design] lasts 5 days',
      '@endgantt',
      '@startuml',
      '!theme plain',
      '  !foreach $name in ["Alice", "Bob"]',
      'participant $name <&heart>',
      '!endfor',
      '!final procedure $box($a) ',
      '!endprocedure',
      '!function $twice($n) !return $n * 2',
      '!Include common.puml',
      '!theme Plain',
      'A -> B : <&Heart>',
      '@enduml',
    ]);

    expect(await hoverAt(document, 0, 4)).toEqual({
      sections: [help({ kind: 'diagram', name: 'gantt', start: 0, end: 0 })],
      range: '0:0-0:11',
    });
    expect(await hoverAt(document, 2, 4)).toBeUndefined();
    expect(await hoverAt(document, 4, 2)).toEqual({
      sections: [help({ kind: 'directive', name: 'theme', start: 0, end: 0 })],
      range: '4:0-4:6',
    });
    expect(await hoverAt(document, 4, 9)).toEqual({
      sections: [help({ kind: 'theme', name: 'plain', start: 0, end: 0 })],
      range: '4:7-4:12',
    });
    expect(await hoverAt(document, 5, 3)).toEqual({
      sections: [help({ kind: 'directive', name: 'foreach', start: 0, end: 0 })],
      range: '5:2-5:10',
    });
    expect(await hoverAt(document, 6, 20)).toEqual({
      sections: [help({ kind: 'icon', name: 'heart', start: 0, end: 0 })],
      range: '6:18-6:26',
    });
    expect((await hoverAt(document, 8, 2))?.range).toBe('8:0-8:6');
    expect((await hoverAt(document, 8, 10))?.sections).toEqual([help({ kind: 'directive', name: 'procedure', start: 0, end: 0 })]);
    expect(await hoverAt(document, 10, 23)).toEqual({
      sections: [help({ kind: 'directive', name: 'return', start: 0, end: 0 })],
      range: '10:21-10:28',
    });
    for (const [line, character] of [
      [11, 3],
      [12, 9],
      [13, 11],
    ] as const) {
      expect(await hoverAt(document, line, character), `${String(line)}:${String(character)}`).toBeUndefined();
    }
  });

  it('shows the variable, not built-in help, on an icon or a theme whose name the text defines, as the engine puts its value there', async () => {
    const document = puml('file:///c/hover/replaced.puml', [
      '@startuml',
      '!heart = "person"',
      '!plain = "cerulean"',
      '!theme plain',
      'A -> B : <&heart> <&person>',
      '@enduml',
    ]);

    expect((await hoverAt(document, 4, 11))?.sections).toEqual([
      escapeMarkdown('this diagram · variable'),
      [codeBlock('!heart = "person"', 'plantuml'), escapeMarkdown('this diagram, line 2')].join('\n\n'),
    ]);
    expect((await hoverAt(document, 4, 21))?.sections).toEqual([help({ kind: 'icon', name: 'person', start: 0, end: 0 })]);
    expect(await hoverAt(document, 3, 9)).toEqual({
      sections: [
        escapeMarkdown('this diagram · variable'),
        [codeBlock('!plain = "cerulean"', 'plantuml'), escapeMarkdown('this diagram, line 3')].join('\n\n'),
      ],
      range: '3:7-3:12',
    });
  });

  it('gives built-in help on an icon or a theme that only another diagram of the file defines, as each diagram is drawn alone', async () => {
    const document = puml('file:///c/hover/diagrams.puml', [
      '@startuml',
      '!theme plain',
      'A -> B : <&heart>',
      '@enduml',
      '@startuml',
      '!heart = "person"',
      '!plain = "cerulean"',
      '@enduml',
    ]);

    expect((await hoverAt(document, 1, 9))?.sections).toEqual([help({ kind: 'theme', name: 'plain', start: 0, end: 0 })]);
    expect((await hoverAt(document, 2, 11))?.sections).toEqual([help({ kind: 'icon', name: 'heart', start: 0, end: 0 })]);
  });

  it('counts the quote markers before the lines of a Markdown block, and gives nothing in the text around it', async () => {
    const markdown = makeEditor(
      'file:///c/hover/doc.md',
      ['# Notes', '> ```plantuml', '> !foreach $x in [1, 2]', '> A -> B : <&heart> $x', '> !endfor', '> ```'].join('\n'),
      0
    ).document;

    expect((await hoverAt(markdown, 2, 3))?.range).toBe('2:2-2:10');
    expect((await hoverAt(markdown, 3, 14))?.range).toBe('3:11-3:19');
    expect(await hoverAt(markdown, 0, 3)).toBeUndefined();
  });

  it('gives nothing on the keywords of a diagram, its skinparam, an element, a comment or a word of a label', async () => {
    const document = puml('file:///c/hover/keywords.puml', [
      '@startuml',
      'skinparam monochrome true',
      'participant Alice',
      "' !include common.puml",
      'Alice -> Alice : hello',
      '@enduml',
    ]);
    for (const [line, character] of [
      [1, 3],
      [1, 12],
      [2, 3],
      [2, 13],
      [3, 4],
      [4, 0],
      [4, 18],
    ] as const) {
      expect(await hoverAt(document, line, character), `${String(line)}:${String(character)}`).toBeUndefined();
    }
  });

  it('shows each definition a name may stand for, with how sure that is, and the comment above it as written', async () => {
    const comment = [
      '<img src="https://example.com/x.png"> <b>bold</b> <script>alert(1)</script>',
      '[run](command:workbench.action.quit) ![image](https://example.com/y.png)',
    ];
    const document = puml('file:///c/hover/defined.puml', [
      '@startuml',
      ...comment.map((line) => `' ${line}`),
      '!procedure Box($name)',
      '  rectangle $name',
      '!endprocedure',
      'Box("a")',
      '!if %true()',
      '!procedure P()',
      '!endprocedure',
      '!else',
      '!procedure P()',
      '!endprocedure',
      '!endif',
      'P()',
      '@enduml',
    ]);

    expect(await hoverAt(document, 6, 1)).toEqual({
      sections: [
        escapeMarkdown('this diagram · procedure'),
        [
          codeBlock('!procedure Box($name)', 'plantuml'),
          escapeMarkdown('this diagram, line 4'),
          codeBlock(comment.join('\n'), 'text'),
        ].join('\n\n'),
      ],
      range: '6:0-6:3',
    });
    // A parameter, in the body of its procedure.
    expect(await hoverAt(document, 4, 14)).toEqual({
      sections: [
        escapeMarkdown('this diagram · parameter'),
        [codeBlock('$name', 'plantuml'), escapeMarkdown('this diagram, line 4')].join('\n\n'),
      ],
      range: '4:12-4:17',
    });
    expect(await hoverAt(document, 14, 0)).toEqual({
      sections: [
        escapeMarkdown('2 definitions · procedure · ambiguous'),
        [codeBlock('!procedure P()', 'plantuml'), escapeMarkdown('this diagram, line 9')].join('\n\n'),
        [codeBlock('!procedure P()', 'plantuml'), escapeMarkdown('this diagram, line 12')].join('\n\n'),
      ],
      range: '14:0-14:1',
    });
    // The keyword of the body, and the end of the diagram.
    expect(await hoverAt(document, 4, 4)).toBeUndefined();
    expect(await hoverAt(document, 15, 3)).toBeUndefined();
  });

  it('says what a bundled library or a URL an include names is, or why it is not read', async () => {
    const document = puml('file:///c/hover/libraries.puml', [
      '@startuml',
      '!include <C4/C4_Context>',
      '!include <C4/C4_Nothing>',
      '!include <nosuchlibrary/x>',
      '!include https://example.com/x.puml',
      '@enduml',
    ]);

    expect(await hoverAt(document, 1, 12)).toEqual({
      sections: [escapeMarkdown('Reads <C4/C4_Context>, bundled with this extension.')],
      range: '1:9-1:24',
    });
    expect((await hoverAt(document, 2, 12))?.sections).toEqual([
      escapeMarkdown('<C4/C4_Nothing> is not read. No bundled library has this file.'),
    ]);
    const notBundled = escapeMarkdown(
      '<nosuchlibrary/x> is not read. The nosuchlibrary standard library is not included with this extension. The bundled standard libraries are '
    );
    expect((await hoverAt(document, 3, 12))?.sections[0]?.startsWith(notBundled)).toBe(true);
    expect(await hoverAt(document, 4, 20)).toEqual({
      sections: [
        escapeMarkdown(
          'Loading files or themes from URLs (!include, !theme) is not supported. Use files in your workspace or bundled libraries and themes.'
        ),
      ],
      range: '4:9-4:35',
    });
  });

  it('answers nothing once the request is cancelled or the document changes while it reads', async () => {
    const document = puml('file:///c/hover/cancelled.puml', [
      '@startuml',
      '!include <C4/C4_Context>',
      '!procedure P()',
      '!endprocedure',
      'P()',
      '@enduml',
    ]);
    expect(await hoverAt(document, 1, 12, { cancelled: true })).toBeUndefined();
    expect(await hoverAt(document, 4, 0, { cancelled: true })).toBeUndefined();
    let reads = 0;
    const changing: TextEditorStub['document'] = {
      ...document,
      get version(): number {
        reads += 1;
        return reads === 1 ? 1 : 2;
      },
    };
    expect(await hoverAt(changing, 1, 12)).toBeUndefined();
    reads = 0;
    expect(await hoverAt(changing, 4, 0)).toBeUndefined();
    expect(await hoverAt(document, 4, 0)).toBeDefined();
  });

  describe('with the local files a diagram includes', () => {
    let base = '';
    let root = '';
    let folderOf: VscodeStub['workspace']['getWorkspaceFolder'] = () => undefined;
    const uriOf = (name: string): string => vscodeStub.Uri.file(join(root, name)).toString();
    /** A document in the workspace folder on disk: its URI as VS Code writes it, its path as the platform does. */
    const onDisk = (name: string, lines: readonly string[]): TextEditorStub['document'] => {
      const document = puml(uriOf(name), lines);
      return { ...document, uri: { ...document.uri, fsPath: join(root, name) } };
    };
    const LINES = [
      '@startuml',
      '!include parts.iuml',
      '!include missing.iuml',
      '!include ../outside.iuml',
      '!$dir = "."',
      '!include $dir/parts.iuml',
      '!procedure P()',
      '!include parts.iuml',
      '!endprocedure',
      '!theme local from themes',
      'Alice -> Bob : $dir',
      '@enduml',
    ];

    beforeAll(async () => {
      base = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-hover-')));
      root = join(base, 'ws');
      await mkdir(join(root, 'themes'), { recursive: true });
      await writeFile(join(root, 'parts.iuml'), 'Alice -> Bob : parts\n');
      await writeFile(join(root, 'themes', 'puml-theme-local.puml'), 'skinparam monochrome true\n');
      await writeFile(join(base, 'outside.iuml'), 'Alice -> Bob : outside\n');
      // The stub's folder, /c, is on no disk: this one is, so that its includes are read.
      folderOf = vscodeStub.workspace.getWorkspaceFolder;
      const folder = { uri: { ...vscodeStub.Uri.file(root), fsPath: root }, name: 'ws', index: 0 };
      const under = `${vscodeStub.Uri.file(root).toString()}/`;
      vscodeStub.workspace.getWorkspaceFolder = (uri) => (uri.toString().startsWith(under) ? folder : folderOf(uri));
    });

    afterAll(async () => {
      vscodeStub.workspace.getWorkspaceFolder = folderOf;
      await rm(base, { recursive: true, force: true });
    });

    it('says which file a path read as written reads, as a drawing finds it, or why it reads none', async () => {
      const main = onDisk('main.puml', LINES);

      expect(await hoverAt(main, 1, 12)).toEqual({ sections: [escapeMarkdown('Reads parts.iuml.')], range: '1:9-1:19' });
      expect(await hoverAt(main, 2, 12)).toEqual({
        sections: [
          escapeMarkdown('missing.iuml is not read. File not found. Check the path relative to the file containing this directive.'),
        ],
        range: '2:9-2:21',
      });
      expect((await hoverAt(main, 3, 12))?.sections).toEqual([
        escapeMarkdown(
          "../outside.iuml is not read. The path is outside the document's workspace folder. Move the file into that folder or correct the path."
        ),
      ]);
      // A theme read from a folder, from its name and from its folder.
      for (const character of [9, 20]) {
        expect((await hoverAt(main, 9, character))?.sections).toEqual([escapeMarkdown('Reads themes/puml-theme-local.puml.')]);
      }
    });

    it('takes a path as written when only another diagram of the file defines a word of it', async () => {
      const main = onDisk('diagrams.puml', ['@startuml', '!include parts.iuml', '@enduml', '@startuml', '!parts = "other"', '@enduml']);

      expect(await hoverAt(main, 1, 12)).toEqual({ sections: [escapeMarkdown('Reads parts.iuml.')], range: '1:9-1:19' });
    });

    it('says why it does not look up a path the diagram puts together, or one in a procedure, and shows the variable in it', async () => {
      const main = onDisk('main.puml', LINES);

      expect(await hoverAt(main, 5, 16)).toEqual({
        sections: [escapeMarkdown('$dir/parts.iuml is not looked up here. Its path is put together when the diagram is drawn.')],
        range: '5:9-5:24',
      });
      expect((await hoverAt(main, 5, 10))?.sections).toEqual([
        escapeMarkdown('this diagram · variable'),
        [codeBlock('!$dir = "."', 'plantuml'), escapeMarkdown('this diagram, line 5')].join('\n\n'),
      ]);
      // After that include, which may set it again: shown, unlike Go to Definition, and marked so.
      expect(await hoverAt(main, 10, 16)).toEqual({
        sections: [
          escapeMarkdown('this diagram · variable · unresolved'),
          [codeBlock('!$dir = "."', 'plantuml'), escapeMarkdown('this diagram, line 5')].join('\n\n'),
        ],
        range: '10:15-10:19',
      });
      expect((await hoverAt(main, 7, 12))?.sections).toEqual([
        escapeMarkdown(
          'parts.iuml is not looked up here. It is read when the procedure or function it is written in runs.'
        ),
      ]);
    });

    it('reads no local file in Restricted Mode, and says so', async () => {
      const main = onDisk('main.puml', LINES);
      vscodeStub.workspace.isTrusted = false;
      try {
        expect((await hoverAt(main, 1, 12))?.sections).toEqual([
          escapeMarkdown(
            'parts.iuml is not read. Local includes are unavailable in Restricted Mode. Trust this workspace to include files.'
          ),
        ]);
        // Built-in help needs nothing of the workspace.
        expect((await hoverAt(main, 1, 2))?.sections).toEqual([help({ kind: 'directive', name: 'include', start: 0, end: 0 })]);
      } finally {
        vscodeStub.workspace.isTrusted = true;
      }
    });
  });
});

describe('templates (dist)', () => {
  const complete = (
    document: TextEditorStub['document'],
    line: number,
    character: number
  ): Promise<CompletionItemStub[] | undefined> =>
    vscodeStub._test.completionProviders[0]?.provider.provideCompletionItems(
      document,
      new vscodeStub.Position(line, character)
    );
  const inserted = (item: CompletionItemStub | undefined): string =>
    typeof item?.insertText === 'object' ? item.insertText.value : String(item?.insertText);

  it('offers a whole block in the text of a Markdown document, the bare diagram in an empty block', async () => {
    const document = makeEditor(
      'file:///c/templates/doc.md',
      ['# Title', '', 'pu', '', '```plantuml', 'pu', '```', '```plantuml', '@startuml', 'pu', '```'].join('\n'),
      0
    ).document;

    const text = await complete(document, 2, 2);
    expect(text?.[0]?.label).toEqual({ label: 'puml-sequence', description: 'Sequence diagram' });
    expect(inserted(text?.[0])).toMatch(/^```plantuml \$\{1:sequence-diagram\}\n@startuml\n[\s\S]*\n@enduml\n```$/);
    expect(text?.[0]?.keepWhitespace).toBe(true);
    expect(text).toHaveLength(16);
    // Each kind under its own start line, as the engine wants it.
    expect(text?.map((item) => inserted(item).split('\n')[1])).toEqual([
      ...Array<string>(6).fill('@startuml'),
      '@startuml',
      '@startuml',
      '@startuml',
      '@startuml',
      '@startgantt',
      '@startmindmap',
      '@startwbs',
      '@startsalt',
      '@startjson',
      '@startyaml',
    ]);

    expect(inserted((await complete(document, 5, 2))?.[0])).toMatch(/^@startuml\n[\s\S]*\n@enduml$/);
    // Inside a diagram: no second start line.
    expect(await complete(document, 9, 2)).toBeUndefined();
  });

  it('offers nothing in another code block', async () => {
    const document = makeEditor('file:///c/templates/js.md', ['```js', 'pu', '```'].join('\n'), 0).document;

    expect(await complete(document, 1, 2)).toBeUndefined();
  });

  it('offers the bare diagram between the diagrams of a PlantUML file', async () => {
    const document = makeEditor(
      'file:///c/templates/flows.puml',
      ['@startuml', 'A -> B', '@enduml', 'pu'].join('\n'),
      0,
      { languageId: 'plantuml' }
    ).document;

    expect(inserted((await complete(document, 3, 2))?.[0])).toMatch(/^@startuml\n/);
    // Inside a diagram: no template, and its words alone are left to VS Code by default.
    expect(await complete(document, 1, 2)).toBeUndefined();
  });
});

describe('folding (dist)', () => {
  const fold = (text: string): FoldingRangeStub[] | undefined => {
    const registration = vscodeStub._test.foldingProviders[0];
    if (registration === undefined) {
      throw new Error('no folding provider registered');
    }
    return registration.provider.provideFoldingRanges(
      makeEditor('file:///c/fold/flows.puml', text, 0, { languageId: 'plantuml' }).document
    );
  };

  it('is registered for PlantUML files only, so Markdown keeps its own folding', () => {
    expect(vscodeStub._test.foldingProviders).toHaveLength(1);
    expect(vscodeStub._test.foldingProviders[0]?.selector).toEqual({ language: 'plantuml' });
  });

  it('folds by syntax, a block comment as a comment', () => {
    expect(fold(["/'", 'note', "'/", '@startuml', 'alt', '  A -> B', 'end', '@enduml'].join('\n'))).toEqual([
      { start: 0, end: 2, kind: vscodeStub.FoldingRangeKind.Comment },
      { start: 3, end: 6, kind: undefined },
      { start: 4, end: 5, kind: undefined },
    ]);
  });

  it('gives no list for a file with nothing to fold, which leaves it folding by indentation', () => {
    expect(fold('A -> B\n  B -> C')).toBeUndefined();
  });
});

describe('symbols (dist)', () => {
  const symbols = (text: string): DocumentSymbolStub[] => {
    const registration = vscodeStub._test.symbolProviders[0];
    if (registration === undefined) {
      throw new Error('no document symbol provider registered');
    }
    return registration.provider.provideDocumentSymbols(
      makeEditor('file:///c/symbols/flows.puml', text, 0, { languageId: 'plantuml' }).document
    );
  };
  const at = (line: number, character: number): { line: number; character: number } => ({ line, character });

  it('is registered for PlantUML files only, so Markdown keeps its outline of headings', () => {
    expect(vscodeStub._test.symbolProviders).toHaveLength(1);
    expect(vscodeStub._test.symbolProviders[0]?.selector).toEqual({ language: 'plantuml' });
  });

  it('gives a diagram the lines it spans, and a declaration its line, its alias and what it holds', () => {
    const text = ['@startuml(id=orders)', 'participant "Web App" as App', 'package P {', '  class C', '}', '@enduml'];

    expect(symbols(text.join('\n'))).toMatchObject([
      {
        name: 'orders',
        detail: '@startuml',
        kind: vscodeStub.SymbolKind.Module,
        range: { start: at(0, 0), end: at(5, 7) },
        selectionRange: { start: at(0, 0), end: at(0, 20) },
        children: [
          {
            name: 'App',
            detail: 'Web App',
            kind: vscodeStub.SymbolKind.Object,
            range: { start: at(1, 0), end: at(1, 28) },
            selectionRange: { start: at(1, 0), end: at(1, 28) },
            children: [],
          },
          {
            name: 'P',
            detail: '',
            kind: vscodeStub.SymbolKind.Package,
            range: { start: at(2, 0), end: at(4, 1) },
            selectionRange: { start: at(2, 0), end: at(2, 11) },
            children: [
              {
                name: 'C',
                kind: vscodeStub.SymbolKind.Class,
                range: { start: at(3, 0), end: at(3, 9) },
                // From the keyword, past the indentation.
                selectionRange: { start: at(3, 2), end: at(3, 9) },
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('lists nothing for a file that declares nothing', () => {
    expect(symbols('A -> B\nB -> C')).toEqual([]);
  });
});

describe('Go to Symbol in Workspace (dist)', () => {
  type FolderStub = { uri: UriStub; name: string; index: number };
  const ORDERS = [
    '@startuml(id=orders)',
    'participant OrderService',
    '!if %true()',
    'class Billing',
    '!endif',
    '!procedure $notify()',
    '!endprocedure',
    '@enduml',
  ];
  const PARTIAL = 'PlantUML Local: not every Markdown and PlantUML file was searched. See the Output panel for why.';
  let base = '';
  let ws = '';
  let folderOf: VscodeStub['workspace']['getWorkspaceFolder'] = () => undefined;
  let relativeOf: VscodeStub['workspace']['asRelativePath'] = () => '';

  /** A workspace folder on disk: its URI as VS Code writes it, its path as the platform does. */
  const folderAt = (path: string, name: string, index: number): FolderStub => ({
    uri: { ...vscodeStub.Uri.file(path), fsPath: path },
    name,
    index,
  });
  const folders = (): FolderStub[] => (vscodeStub.workspace.workspaceFolders ?? []) as FolderStub[];
  /** A file of the folder `ws`, by the URI the search gives it. */
  const uriOf = (path: string): UriStub => vscodeStub.Uri.file(join(ws, path));
  const write = (path: string, lines: readonly string[]): Promise<void> => writeFile(join(ws, path), lines.join('\n'));
  const provider = (): WorkspaceSymbolRegistrationStub => {
    const registration = vscodeStub._test.workspaceSymbolProviders[0];
    if (registration === undefined) {
      throw new Error('no workspace symbol provider registered');
    }
    return registration;
  };
  const token = (cancelled: boolean): CancellationTokenStub => ({
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  });
  const search = (query: string, cancelled = false): Promise<SymbolInformationStub[]> =>
    provider().provideWorkspaceSymbols(query, token(cancelled));
  const resolve = (symbol: SymbolInformationStub, cancelled = false): Promise<SymbolInformationStub> =>
    provider().resolveWorkspaceSymbol(symbol, token(cancelled));
  const only = (symbols: readonly SymbolInformationStub[]): SymbolInformationStub => {
    expect(symbols).toHaveLength(1);
    return symbols[0] as SymbolInformationStub;
  };
  /** What VS Code shows of each symbol: its name, what it is in, and the path of its file. */
  const rows = (symbols: readonly SymbolInformationStub[]): string[] =>
    symbols.map(
      ({ name, containerName, location }) => `${name} | ${containerName} | ${vscodeStub.workspace.asRelativePath(location.uri)}`
    );
  /** Where a symbol takes the editor, `line:character-line:character`. */
  const placeOf = ({ location: { range } }: SymbolInformationStub): string =>
    range === undefined
      ? 'nowhere'
      : `${String(range.start.line)}:${String(range.start.character)}-${String(range.end.line)}:${String(range.end.character)}`;
  const watcher = (): FileWatcherStub => {
    const found = vscodeStub._test.fileWatchers.find(({ pattern }) => (pattern as unknown) === '**/*');
    if (found === undefined) {
      throw new Error('the workspace is not watched');
    }
    return found;
  };
  const status = (): string | undefined => vscodeStub._test.statusBarMessages.at(-1);
  const warnings = (): string[] => vscodeStub._test.notifications.warn;
  /** What was written to the output after the first `from` lines, without the fields the logger adds to each. */
  const writtenSince = (from: number): string[] =>
    vscodeStub._test.logs.slice(from).map((line) => line.replace(/ \{"application":.*\}$/, ''));

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-workspace-symbols-')));
    ws = join(base, 'ws');
    await mkdir(join(ws, 'docs'), { recursive: true });
    await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(base, 'other'));
    await write('orders.puml', ORDERS);
    await write('docs/guide.md', ['# Guide', '', '```plantuml shop', 'participant OrderService', '```']);
    await write('node_modules/pkg/skipped.puml', ['participant OrderService']);
    await write('notes.txt', ['participant OrderService']);
    await writeFile(join(base, 'other', 'other.puml'), 'participant OtherService');
    // The stub's folder, /c, is on no disk: these are. As VS Code finds the
    // innermost folder of a URI, and writes a path from it, after the folder's
    // name when there are several.
    folderOf = vscodeStub.workspace.getWorkspaceFolder;
    relativeOf = vscodeStub.workspace.asRelativePath;
    const within = (uri: { toString(): string }): FolderStub | undefined =>
      folders()
        .filter((folder) => uri.toString() === folder.uri.toString() || uri.toString().startsWith(`${folder.uri.toString()}/`))
        .sort((a, b) => b.uri.toString().length - a.uri.toString().length)[0];
    vscodeStub.workspace.getWorkspaceFolder = (uri) => within(uri) ?? folderOf(uri);
    vscodeStub.workspace.asRelativePath = (uri) => {
      const folder = within(uri);
      if (folder === undefined) {
        return relativeOf(uri);
      }
      const path = uri.toString().slice(folder.uri.toString().length + 1);
      return folders().length > 1 ? `${folder.name}/${path}` : path;
    };
    vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0)]);
  });

  afterAll(async () => {
    vscodeStub._test.changeWorkspaceFolders(undefined);
    vscodeStub.workspace.getWorkspaceFolder = folderOf;
    vscodeStub.workspace.asRelativePath = relativeOf;
    await rm(base, { recursive: true, force: true });
  });

  it('reads nothing until a query is typed', async () => {
    expect(vscodeStub._test.workspaceSymbolProviders).toHaveLength(1);
    const watchers = vscodeStub._test.fileWatchers.length;
    expect(await search('')).toEqual([]);
    expect(status()).toBe('Type to search the diagrams and declarations of the Markdown and PlantUML files.');
    expect(vscodeStub._test.fileWatchers).toHaveLength(watchers);
  });

  it('lists the diagrams and declarations of the Markdown and PlantUML files, by path and line', async () => {
    const said = vscodeStub._test.statusBarMessages.length;
    const found = await search('OrdSvc');
    expect(rows(found)).toEqual([
      'OrderService | shop · participant · line 4 | docs/guide.md',
      'OrderService | orders · participant · line 2 | orders.puml',
    ]);
    // Without a place in the file, until one is picked.
    expect(found.map(({ kind, location }) => [kind, location.range])).toEqual([
      [vscodeStub.SymbolKind.Object, undefined],
      [vscodeStub.SymbolKind.Object, undefined],
    ]);

    // Once searched, an empty query gets all that was found: nothing from a folder skipped or a file of another kind.
    const all = await search('');
    expect(rows(all)).toEqual([
      'shop | ```plantuml · line 3 | docs/guide.md',
      'OrderService | shop · participant · line 4 | docs/guide.md',
      'orders | @startuml · line 1 | orders.puml',
      'OrderService | orders · participant · line 2 | orders.puml',
      'Billing | orders · class · line 4 · conditional | orders.puml',
      '$notify | orders · !procedure · line 6 | orders.puml',
    ]);
    const { Module, Object: Element, Class, Method } = vscodeStub.SymbolKind;
    expect(all.map(({ kind }) => kind)).toEqual([Module, Element, Module, Element, Class, Method]);
    // Nothing was left out, so nothing is said.
    expect(vscodeStub._test.statusBarMessages).toHaveLength(said);
  });

  it('goes to a symbol where it is when it is picked, and not to one changed or gone since', async () => {
    const billing = only(await search('Billing'));
    const picked = await resolve(billing);
    expect(picked).toMatchObject({ name: 'Billing', kind: vscodeStub.SymbolKind.Class, containerName: billing.containerName });
    expect(picked.location.uri.toString()).toBe(uriOf('orders.puml').toString());
    expect(placeOf(picked)).toBe('3:6-3:13');

    const warned = warnings().length;
    const gone = 'Billing in orders.puml has changed or is gone since the search. Search for it again.';
    try {
      // A line added above it since: the one Billing of its diagram, where it is now.
      await write('orders.puml', [...ORDERS.slice(0, 1), 'participant Added', ...ORDERS.slice(1)]);
      expect(placeOf(await resolve(billing))).toBe('4:6-4:13');
      // Declared twice, or not at all: nothing to go to, and a warning.
      await write('orders.puml', [...ORDERS.slice(0, 4), 'class Billing', ...ORDERS.slice(4)]);
      await expect(resolve(billing)).rejects.toMatchObject({ name: 'Canceled' });
      await write('orders.puml', ORDERS.filter((line) => line !== 'class Billing'));
      await expect(resolve(billing)).rejects.toMatchObject({ name: 'Canceled' });
      expect(await waitFor(() => warnings().length >= warned + 2, 5_000)).toBe(true);
      expect(warnings().slice(warned)).toEqual([gone, gone]);
      // Cancelled: no answer, and nothing said.
      await expect(resolve(billing, true)).rejects.toMatchObject({ name: 'Canceled' });
      expect(warnings()).toHaveLength(warned + 2);
    } finally {
      await write('orders.puml', ORDERS);
    }
  });

  it('searches an open document as the editor has it', async () => {
    const editor = makeEditor(
      uriOf('orders.puml').toString(),
      [...ORDERS.slice(0, 2), 'participant Unsaved', ...ORDERS.slice(2)].join('\n'),
      0,
      { languageId: 'plantuml' }
    );
    vscodeStub._test.openDocument(editor.document);
    try {
      const unsaved = only(await search('Unsaved'));
      expect(rows([unsaved])).toEqual(['Unsaved | orders · participant · line 3 | orders.puml']);
      expect(placeOf(await resolve(unsaved))).toBe('2:12-2:19');
      expect(rows(await search('Billing'))).toEqual(['Billing | orders · class · line 5 · conditional | orders.puml']);
    } finally {
      vscodeStub._test.closeDocument(editor.document);
    }
    // Closed without being saved: as on disk.
    expect(await search('Unsaved')).toEqual([]);
  });

  it('searches again when a file or a folder is created or deleted, and reads a file again when it changes', async () => {
    await search('OrdSvc');
    const events = watcher();
    try {
      await write('later.puml', ['participant Later']);
      // Not told of it yet.
      expect(await search('Later')).toEqual([]);
      // A change of a file it does not read, something created in a folder it skips: nothing to do.
      events.fire('change', uriOf('notes.txt'));
      events.fire('create', uriOf('node_modules/pkg/later.puml'));
      expect(await search('Later')).toEqual([]);
      events.fire('create', uriOf('later.puml'));
      expect(rows(await search('Later'))).toEqual(['Later | participant · line 1 | later.puml']);

      // Changed: that file read again, and nothing else.
      await write('later.puml', ['participant Later', 'participant Sooner']);
      await write('unseen.puml', ['participant Unseen']);
      events.fire('change', uriOf('later.puml'));
      expect(rows(await search('Sooner'))).toEqual(['Sooner | participant · line 2 | later.puml']);
      expect(await search('Unseen')).toEqual([]);

      await rm(join(ws, 'unseen.puml'));
      await rm(join(ws, 'later.puml'));
      events.fire('delete', uriOf('later.puml'));
      expect(await search('Later')).toEqual([]);
    } finally {
      await rm(join(ws, 'unseen.puml'), { force: true });
      await rm(join(ws, 'later.puml'), { force: true });
    }
  });

  it('says in the status bar and in the output what a search left out', async () => {
    await writeFile(join(ws, 'latin1.puml'), Buffer.from('participant Caf\xe9\n', 'latin1'));
    const logged = vscodeStub._test.logs.length;
    try {
      vscodeStub._test.changeWorkspaceFolders([
        folderAt(ws, 'ws', 0),
        { uri: vscodeStub.Uri.parse('vscode-vfs://github/owner/repo'), name: 'remote', index: 1 },
        folderAt(join(base, 'missing'), 'missing', 2),
      ]);
      expect(rows(await search('OrdSvc'))).toEqual([
        'OrderService | shop · participant · line 4 | ws/docs/guide.md',
        'OrderService | orders · participant · line 2 | ws/orders.puml',
      ]);
      expect(status()).toBe(PARTIAL);
      expect(writtenSince(logged)).toEqual([
        [
          'info: Go to Symbol in Workspace did not search every Markdown and PlantUML file:',
          'remote: the folder is not on disk, and is not searched.',
          'missing: the folder cannot be read.',
          'ws/latin1.puml: not UTF-8 text, and not read.',
        ].join('\n'),
      ]);
      // Said with each answer, written once for the search.
      const said = vscodeStub._test.statusBarMessages.length;
      await search('Billing');
      expect(vscodeStub._test.statusBarMessages.slice(said)).toEqual([PARTIAL]);
      expect(writtenSince(logged)).toHaveLength(1);
    } finally {
      await rm(join(ws, 'latin1.puml'));
      vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0)]);
    }
  });

  it('searches each file once, for the innermost folder, when a folder is inside another or opened twice', async () => {
    const said = vscodeStub._test.statusBarMessages.length;
    try {
      vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0), folderAt(join(ws, 'docs'), 'docs', 1), folderAt(ws, 'again', 2)]);
      expect(rows(await search('OrdSvc'))).toEqual([
        'OrderService | orders · participant · line 2 | ws/orders.puml',
        'OrderService | shop · participant · line 4 | docs/guide.md',
      ]);
      expect(vscodeStub._test.statusBarMessages).toHaveLength(said);
    } finally {
      vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0)]);
    }
  });

  it('leaves out what the settings of a folder leave out, and does not search a folder with an exclude it cannot read', async () => {
    const folder = folderAt(ws, 'ws', 0);
    const other = folderAt(join(base, 'other'), 'other', 1);
    const warned = warnings().length;
    try {
      vscodeStub._test.changeWorkspaceFolders([folder, other]);
      vscodeStub._test.setConfiguration('workspaceSymbols.exclude', ['docs/**'], folder.uri.toString());
      expect(rows(await search('Service'))).toEqual([
        'OrderService | orders · participant · line 2 | ws/orders.puml',
        'OtherService | participant · line 1 | other/other.puml',
      ]);

      // Turned off for one folder, the other is searched; for every folder, nothing is, and nothing is said.
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', false, folder.uri.toString());
      expect(rows(await search('Service'))).toEqual(['OtherService | participant · line 1 | other/other.puml']);
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', false, other.uri.toString());
      const said = vscodeStub._test.statusBarMessages.length;
      expect(await search('Service')).toEqual([]);
      expect(vscodeStub._test.statusBarMessages).toHaveLength(said);
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', undefined, folder.uri.toString());
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', undefined, other.uri.toString());

      // A pattern it cannot read: the folder is not searched, rather than searched more widely.
      vscodeStub._test.notificationReply = 'Open Settings';
      vscodeStub._test.setConfiguration('workspaceSymbols.exclude', ['docs/'], folder.uri.toString());
      const logged = vscodeStub._test.logs.length;
      expect(rows(await search('Service'))).toEqual(['OtherService | participant · line 1 | other/other.puml']);
      expect(status()).toBe(PARTIAL);
      const problem = 'Pattern 1, "docs/", ends with /. For a folder and what it holds, write folder/**.';
      const opened = (): { id: string; args: unknown[] }[] =>
        vscodeStub._test.commandCalls.filter(({ id }) => id === 'workbench.action.openSettings');
      expect(await waitFor(() => opened().length > 0, 5_000)).toBe(true);
      expect(warnings().slice(warned)).toEqual([
        `Go to Symbol in Workspace does not search the folder ws until plantumlLocal.workspaceSymbols.exclude is fixed. ${problem}`,
      ]);
      expect(opened().at(-1)?.args).toEqual(['@id:plantumlLocal.workspaceSymbols.exclude']);
      expect(writtenSince(logged)).toEqual([
        `info: Go to Symbol in Workspace did not search every Markdown and PlantUML file:\nws: plantumlLocal.workspaceSymbols.exclude is not valid, and the folder is not searched. ${problem}`,
      ]);
      // Searched again with the same setting: not warned again.
      vscodeStub._test.setConfiguration('workspaceSymbols.exclude', ['docs/'], folder.uri.toString());
      await search('Service');
      expect(warnings()).toHaveLength(warned + 1);
    } finally {
      vscodeStub._test.notificationReply = null;
      vscodeStub._test.setConfiguration('workspaceSymbols.exclude', undefined, folder.uri.toString());
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', undefined, folder.uri.toString());
      vscodeStub._test.setConfiguration('workspaceSymbols.enabled', undefined, other.uri.toString());
      vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0)]);
    }
  });

  it('answers nothing in Restricted Mode, and searches again once the workspace is trusted', async () => {
    await search('OrdSvc');
    await write('trusted.puml', ['participant Trusted']);
    try {
      vscodeStub.workspace.isTrusted = false;
      try {
        expect(await search('Trusted')).toEqual([]);
        expect(status()).toBe('PlantUML Local does not search the Markdown and PlantUML files of the workspace in Restricted Mode.');
      } finally {
        vscodeStub._test.grantTrust();
      }
      expect(rows(await search('Trusted'))).toEqual(['Trusted | participant · line 1 | trusted.puml']);
    } finally {
      await rm(join(ws, 'trusted.puml'));
      watcher().fire('delete', uriOf('trusted.puml'));
    }
  });

  it('does not search for a long text, and lists the first 5000 of what it finds', async () => {
    await search('OrdSvc');
    expect(await search('x'.repeat(257))).toEqual([]);
    expect(status()).toBe('PlantUML Local does not search for text longer than 256 characters.');

    await write('many.puml', Array.from({ length: 5_001 }, (_, index) => `participant P${String(index)}`));
    try {
      watcher().fire('create', uriOf('many.puml'));
      expect(await search('P')).toHaveLength(5_000);
      expect(status()).toBe('PlantUML Local: only the first 5000 diagrams and declarations are listed.');
    } finally {
      await rm(join(ws, 'many.puml'));
      watcher().fire('delete', uriOf('many.puml'));
    }
  });

  it('answers nothing to a request cancelled, and goes on searching for the next', async () => {
    vscodeStub._test.changeWorkspaceFolders([folderAt(ws, 'ws', 0)]);
    expect(await search('OrdSvc', true)).toEqual([]);
    expect(rows(await search('OrdSvc'))).toHaveLength(2);
  });
});

describe('Rename Symbol on an alias (dist)', () => {
  const provider = (): RenameRegistrationStub['provider'] => {
    const registration = vscodeStub._test.renameProviders[0];
    if (registration === undefined) {
      throw new Error('no rename provider registered');
    }
    return registration.provider;
  };
  const token = (cancelled = false): CancellationTokenStub => ({
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  });
  const markdown = (path: string, lines: readonly string[], options?: { isUntitled?: boolean }): TextEditorStub['document'] =>
    makeEditor(path, lines.join('\n'), 0, options).document;
  const DIAGRAM = ['# Orders', '', '```plantuml', '@startuml', 'participant "Orders desk" as A', 'A -> B : A', '@enduml', '```', ''];
  type RangeLike = { start: { line: number; character: number }; end: { line: number; character: number } };
  const span = ({ start, end }: RangeLike): string =>
    `${String(start.line)}:${String(start.character)}-${String(end.line)}:${String(end.character)}`;

  /** What F2 at the place prepares: the range and the name put in the box; or why it refuses. */
  const prepare = (document: TextEditorStub['document'], line: number, character: number): string | undefined => {
    try {
      const prepared = provider().prepareRename(document, new vscodeStub.Position(line, character), token());
      return prepared === undefined ? undefined : `${span(prepared.range)} ${prepared.placeholder}`;
    } catch (error) {
      return `refused: ${(error as Error).message}`;
    }
  };

  /** The text once the edits for `newName` are made, each a replacement in the document; or why it refuses. */
  const rename = (
    document: TextEditorStub['document'],
    line: number,
    character: number,
    newName: string,
    cancelled = false
  ): string | undefined => {
    let edit: ReturnType<RenameRegistrationStub['provider']['provideRenameEdits']>;
    try {
      edit = provider().provideRenameEdits(document, new vscodeStub.Position(line, character), newName, token(cancelled));
    } catch (error) {
      return `refused: ${(error as Error).message}`;
    }
    if (edit === undefined) {
      return undefined;
    }
    const lines = document.getText().split('\n');
    for (const op of [...edit.ops].reverse()) {
      expect(op.type).toBe('replace');
      expect(op.uri).toBe(document.uri.toString());
      if (op.type === 'replace') {
        expect(op.start.line).toBe(op.end.line);
        const old = lines[op.start.line] ?? '';
        lines[op.start.line] = old.slice(0, op.start.character) + op.text + old.slice(op.end.character);
      }
    }
    return lines.join('\n');
  };

  it('is registered for Markdown files on disk and untitled, and not for PlantUML files', () => {
    expect(vscodeStub._test.renameProviders.map(({ selector }) => selector)).toEqual([
      [
        { language: 'markdown', scheme: 'file' },
        { language: 'markdown', scheme: 'untitled' },
      ],
    ]);
  });

  it('prepares on an alias and renames it with one edit, the label left as it is', () => {
    const document = markdown('file:///c/rename/orders.md', DIAGRAM);
    expect(prepare(document, 4, 29)).toBe('4:29-4:30 A');
    expect(prepare(document, 5, 0)).toBe('5:0-5:1 A');
    expect(rename(document, 5, 1, 'Orders')).toBe(
      ['# Orders', '', '```plantuml', '@startuml', 'participant "Orders desk" as Orders', 'Orders -> B : A', '@enduml', '```', ''].join('\n')
    );
  });

  it('renames in an untitled document', () => {
    const document = markdown('untitled:Untitled-1', DIAGRAM, { isUntitled: true });
    expect(prepare(document, 4, 29)).toBe('4:29-4:30 A');
    expect(rename(document, 4, 29, 'Orders')).toContain('Orders -> B : A');
  });

  it('answers nothing where the cursor is on no participant name, for the Markdown rename to answer', () => {
    const document = markdown('file:///c/rename/elsewhere.md', DIAGRAM);
    for (const [line, character] of [
      [0, 3],
      [2, 4],
      [3, 3],
      [4, 15],
      [5, 10],
      [7, 1],
    ] as const) {
      expect(prepare(document, line, character), `${String(line)}:${String(character)}`).toBeUndefined();
    }
  });

  it('refuses on a participant name that cannot be renamed, with the reason', () => {
    const document = markdown('file:///c/rename/implicit.md', DIAGRAM);
    const reason =
      'refused: PlantUML Local does not rename B: it is not declared, so it is also the name the diagram shows. Give it an alias with as to rename it.';
    expect(prepare(document, 5, 5)).toBe(reason);
    expect(rename(document, 5, 5, 'Shop')).toBe(reason);
  });

  it('refuses a diagram with a line it does not read, giving the line', () => {
    const document = markdown('file:///c/rename/box.md', [...DIAGRAM.slice(0, 6), 'box "Shop"', 'end box', ...DIAGRAM.slice(6)]);
    const reason =
      'refused: PlantUML Local does not rename in this diagram: line 7 is not of a form it reads, so what the line names cannot be told.';
    expect(prepare(document, 4, 29)).toBe(reason);
    expect(rename(document, 4, 29, 'Orders')).toBe(reason);
  });

  it('refuses a new name with the reason, and changes nothing', () => {
    const document = markdown('file:///c/rename/names.md', DIAGRAM);
    expect(rename(document, 4, 29, 'B')).toBe(
      'refused: PlantUML Local does not rename to B: a participant of the diagram has that name already.'
    );
    expect(rename(document, 4, 29, 'End')).toBe('refused: PlantUML Local does not rename to End: it is a keyword of the diagram.');
    expect(rename(document, 4, 29, '1a')).toBe(
      'refused: PlantUML Local does not rename to 1a: an alias is of ASCII letters, digits and _, and does not start with a digit.'
    );
    expect(rename(document, 4, 29, 'a'.repeat(129))).toBe(
      'refused: PlantUML Local does not rename to a name longer than 128 characters.'
    );
    expect(document.getText()).toBe(DIAGRAM.join('\n'));
  });

  it('makes no change for the same name', () => {
    const document = markdown('file:///c/rename/same.md', DIAGRAM);
    expect(rename(document, 4, 29, 'A')).toBe(DIAGRAM.join('\n'));
    expect(provider().provideRenameEdits(document, new vscodeStub.Position(4, 29), 'A', token())?.ops).toEqual([]);
  });

  it('reads the document again when the edits are asked for', () => {
    const document = markdown('file:///c/rename/changed.md', DIAGRAM);
    expect(prepare(document, 4, 29)).toBe('4:29-4:30 A');
    document.setText([...DIAGRAM.slice(0, 6), 'hide footbox', ...DIAGRAM.slice(6)].join('\n'));
    expect(rename(document, 4, 29, 'Orders')).toBe(
      'refused: PlantUML Local does not rename in this diagram: line 7 is not of a form it reads, so what the line names cannot be told.'
    );
    document.setText(['', ...DIAGRAM].join('\n'));
    expect(rename(document, 4, 29, 'Orders')).toBe('refused: PlantUML Local finds no alias of a participant to rename here.');
  });

  it('makes no edit when cancelled, or past the most places', () => {
    const document = markdown('file:///c/rename/limits.md', DIAGRAM);
    expect(rename(document, 4, 29, 'Orders', true)).toBeUndefined();
    const many = markdown('file:///c/rename/many.md', [
      ...DIAGRAM.slice(0, 6),
      ...Array.from({ length: 1_000 }, () => 'A -> B : again'),
      ...DIAGRAM.slice(6),
    ]);
    const reason = 'refused: PlantUML Local does not rename A: it is used in more than 1000 places.';
    expect(prepare(many, 4, 29)).toBe(reason);
    expect(rename(many, 4, 29, 'Orders')).toBe(reason);
  });

  it('leaves a document past the limits of the analysis to the Markdown rename, and refuses its edits', () => {
    const document = markdown('file:///c/rename/large.md', [...DIAGRAM, ...Array.from({ length: 50_000 }, () => '')]);
    expect(prepare(document, 4, 29)).toBeUndefined();
    expect(rename(document, 4, 29, 'Orders')).toBe(
      'refused: PlantUML Local does not rename in a document larger than 2 MiB or longer than 50000 lines.'
    );
  });

  it('answers nothing when plantumlLocal.rename.enabled is off', () => {
    vscodeStub._test.setConfiguration('rename.enabled', false);
    try {
      const document = markdown('file:///c/rename/off.md', DIAGRAM);
      expect(prepare(document, 4, 29)).toBeUndefined();
      expect(rename(document, 4, 29, 'Orders')).toBeUndefined();
    } finally {
      vscodeStub._test.setConfiguration('rename.enabled', undefined);
    }
    expect(prepare(markdown('file:///c/rename/on.md', DIAGRAM), 4, 29)).toBe('4:29-4:30 A');
  });
});

describe('naming a diagram (dist)', () => {
  const actionsAt = (editor: TextEditorStub, line: number, diagnostics: DiagnosticStub[] = []): CodeActionStub[] | undefined => {
    const registration = vscodeStub._test.actionProviders[0];
    if (registration === undefined) {
      throw new Error('no code action provider registered');
    }
    const at = new vscodeStub.Position(line, 0);
    return registration.provider.provideCodeActions(editor.document, { start: at, end: at }, { diagnostics });
  };
  /** The warning the Problems panel shows for a diagram without its end line, on its start line. */
  const missingEnd = (line: number): DiagnosticStub => {
    const problem = new vscodeStub.Diagnostic(new vscodeStub.Range(line, 0, line, 9), 'The closing @enduml line is missing.', 1);
    problem.code = 'PLLOCAL-DOC002';
    problem.source = 'PlantUML Local';
    return problem;
  };
  const run = async (action: CodeActionStub | undefined): Promise<void> => {
    await vscodeStub._test.registeredCommands.get(action?.command?.command ?? '')?.(...(action?.command?.arguments ?? []));
  };

  it('is offered for Markdown and PlantUML files, as a quick fix', () => {
    expect(vscodeStub._test.actionProviders).toHaveLength(1);
    expect(vscodeStub._test.actionProviders[0]?.selector).toEqual([{ language: 'markdown' }, { language: 'plantuml' }]);
    expect(vscodeStub._test.actionProviders[0]?.metadata).toEqual({ providedCodeActionKinds: ['quickfix'] });
  });

  it('names an unnamed block on its opening line, changing that line only', async () => {
    const text = ['# Doc', '', '```plantuml', '@startuml', 'A -> B', '@enduml', '```'].join('\n');
    const editor = makeEditor('file:///c/naming/doc.md', text, 2);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);

    expect(actionsAt(editor, 3)).toBeUndefined();
    const [action] = actionsAt(editor, 2) ?? [];
    expect(action).toMatchObject({
      title: 'Name this diagram for export…',
      kind: 'quickfix',
      command: { command: 'plantumlLocal.assignDiagramName', arguments: ['file:///c/naming/doc.md', 2, 1] },
    });

    vscodeStub._test.inputBoxReply = 'orders';
    try {
      await run(action);
    } finally {
      vscodeStub._test.inputBoxReply = null;
    }
    expect(vscodeStub._test.inputBoxPrompts.at(-1)).toBe('Diagram name (used as the exported file name)');
    expect(editor.document.getText()).toBe(text.replace('```plantuml', '```plantuml orders'));
    // Named now: nothing more is offered.
    expect(actionsAt(editor, 2)).toBeUndefined();
  });

  it('adds the end line a diagram lacks, on the warning that reports it, with the quote marker of its block', async () => {
    const text = ['> ```plantuml', '> @startuml', '> A -> B', '>', '> ```'].join('\n');
    const editor = makeEditor('file:///c/ending/quoted.md', text, 1);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);

    // Without the warning, nothing is offered on that line.
    expect(actionsAt(editor, 1)).toBeUndefined();
    const actions = actionsAt(editor, 1, [missingEnd(1)]) ?? [];
    expect(actions.map((action) => action.title)).toEqual(['Add the missing @enduml line']);
    expect(actions[0]).toMatchObject({
      kind: 'quickfix',
      isPreferred: true,
      command: { command: 'plantumlLocal.addMissingEnd', arguments: ['file:///c/ending/quoted.md', 1, 1] },
    });
    expect(actions[0]?.diagnostics).toHaveLength(1);

    await run(actions[0]);
    expect(editor.document.getText()).toBe(['> ```plantuml', '> @startuml', '> A -> B', '> @enduml', '>', '> ```'].join('\n'));
  });

  it('ends a diagram of a PlantUML file before the next one, and does nothing a second time', async () => {
    const text = ['@startuml(id=one)', 'A -> B', '', '@startuml(id=two)', 'C -> D', '@enduml', ''].join('\n');
    const editor = makeEditor('file:///c/ending/flows.puml', text, 0, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);
    const [action] = actionsAt(editor, 0, [missingEnd(0)]) ?? [];
    expect(action?.title).toBe('Add the missing @enduml line');

    await run(action);
    const fixed = ['@startuml(id=one)', 'A -> B', '@enduml', '', '@startuml(id=two)', 'C -> D', '@enduml', ''].join('\n');
    expect(editor.document.getText()).toBe(fixed);

    // Run again from the same offer: the diagram has its end line now.
    const warnings = vscodeStub._test.notifications.warn.length;
    await run(action);
    expect(editor.document.getText()).toBe(fixed);
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual(['The file has changed. Check the diagram again.']);
    // Offered on an earlier version of the document: the same.
    await run({ ...action!, command: { ...action!.command!, arguments: ['file:///c/ending/flows.puml', 0, 0] } });
    expect(editor.document.getText()).toBe(fixed);
  });

  it('writes nothing once the document has changed since the name was offered', async () => {
    const text = ['```plantuml', 'A -> B', '```'].join('\n');
    const editor = makeEditor('file:///c/naming/changed.md', text, 0);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);
    const [action] = actionsAt(editor, 0) ?? [];
    const command = action?.command;
    if (command === undefined) {
      throw new Error('no action offered');
    }

    vscodeStub._test.inputBoxReply = 'orders';
    try {
      // As though offered on an earlier version of the document.
      await run({ ...action!, command: { ...command, arguments: ['file:///c/naming/changed.md', 0, 0] } });
    } finally {
      vscodeStub._test.inputBoxReply = null;
    }
    expect(editor.document.getText()).toBe(text);
    expect(vscodeStub._test.notifications.warn.at(-1)).toBe('The file has changed. Name the diagram again.');
  });

  it('gives every kind of diagram of a PlantUML file an id', async () => {
    const text = ['@startuml(id=first)', 'A -> B', '@enduml', '@startuml', 'C -> D', '@enduml', '@startmindmap', '* root', '@endmindmap'].join('\n');
    const editor = makeEditor('file:///c/naming/flows.puml', text, 3, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.openDocument(editor.document);

    for (const [line, name] of [
      [3, 'second'],
      [6, 'mind'],
    ] as const) {
      vscodeStub._test.inputBoxReply = name;
      try {
        await run((actionsAt(editor, line) ?? [])[0]);
      } finally {
        vscodeStub._test.inputBoxReply = null;
      }
    }
    const lines = editor.document.getText().split('\n');
    expect(lines[3]).toBe('@startuml(id=second)');
    expect(lines[6]).toBe('@startmindmap(id=mind)');
  });
});

describe('colours (dist)', () => {
  const provider = (): ColorRegistrationStub['provider'] => {
    const registration = vscodeStub._test.colorProviders[0];
    if (registration === undefined) {
      throw new Error('no colour provider registered');
    }
    return registration.provider;
  };
  const token = { isCancellationRequested: false };
  const summary = (info: ColorInformationStub): [number, number, number, string] => [
    info.range.start.line,
    info.range.start.character,
    info.range.end.character,
    `${Math.round(info.color.red * 255)},${Math.round(info.color.green * 255)},${Math.round(info.color.blue * 255)},${String(info.color.alpha)}`,
  ];

  it('is registered for Markdown and PlantUML files', () => {
    expect(vscodeStub._test.colorProviders).toHaveLength(1);
    expect(vscodeStub._test.colorProviders[0]?.selector).toEqual([{ language: 'markdown' }, { language: 'plantuml' }]);
  });

  it('shows the colours of a block in a quote where they are in the document, and none in a heading, a comment or a URL', () => {
    const text = [
      '# ABC',
      '',
      '> ```plantuml',
      '> skinparam backgroundColor #ABC',
      "> ' class Hidden #DEF",
      '> class Foo #pink',
      '> Foo -> Bar : [[http://example.com/#123]]',
      '> ```',
    ].join('\n');
    const colors = provider().provideDocumentColors(makeEditor('file:///c/colors/doc.md', text, 0).document, token) ?? [];
    expect(colors.map(summary)).toEqual([
      [3, 28, 32, '170,187,204,1'],
      [5, 12, 17, '255,192,203,1'],
    ]);
  });

  it('shows the colours of a PlantUML file with its own columns, and offers a pick as #RRGGBB unless it has an alpha', () => {
    const document = makeEditor('file:///c/colors/flows.puml', '@startuml\nclass Foo #pink\n@enduml', 0, { languageId: 'plantuml' }).document;
    const colors = provider().provideDocumentColors(document, token) ?? [];
    expect(colors.map(summary)).toEqual([[1, 10, 15, '255,192,203,1']]);

    const range = colors[0]!.range;
    const opaque = provider().provideColorPresentations(new vscodeStub.Color(1, 0.5, 0, 1), { document, range }, token) ?? [];
    expect(opaque.map((presentation) => presentation.label)).toEqual(['#FF8000']);
    const translucent = provider().provideColorPresentations(new vscodeStub.Color(1, 0.5, 0, 0.5), { document, range }, token) ?? [];
    expect(translucent).toEqual([]);
  });
});

describe('going to a diagram (dist)', () => {
  const run = (): Promise<unknown> => Promise.resolve(vscodeStub._test.registeredCommands.get('plantumlLocal.goToDiagram')?.());
  const QUOTED = ['> ```puml', '> @startmindmap', '> * Root', '> @endmindmap', '> ```'].join('\n');

  it('lists the diagrams of the active Markdown document in source order, and moves to the one picked', async () => {
    const editor = makeEditor('file:///c/goto/doc.md', ['# Doc', '', NAMED_BLOCK, '', QUOTED].join('\n'), 0);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.quickPickReply = 'Diagram without a name';
    try {
      await run();
    } finally {
      vscodeStub._test.quickPickReply = null;
      vscodeStub._test.setActiveEditor(undefined);
    }
    expect(vscodeStub._test.quickPicksShown.at(-1)).toEqual({ title: 'Go to Diagram in Document', labels: ['orders', 'Diagram without a name'] });
    expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: 'file:///c/goto/doc.md', line: 8 });
  });

  it('reads the document again when it changes while the list is open, and moves to where the block is then', async () => {
    const editor = makeEditor('file:///c/goto/moving.md', ['# Doc', NAMED_BLOCK].join('\n'), 0);
    vscodeStub._test.setActiveEditor(editor);
    vscodeStub._test.quickPickReply = 'orders';
    const shown = vscodeStub._test.quickPicksShown.length;
    const done = run();
    // The list is open: two lines go in above the block before the pick.
    expect(vscodeStub._test.quickPicksShown).toHaveLength(shown + 1);
    editor.document.setText(['# Doc', '', 'intro', NAMED_BLOCK].join('\n'));
    editor.document.version = 2;
    vscodeStub._test.changeDocument(editor.document);
    try {
      await done;
    } finally {
      vscodeStub._test.quickPickReply = null;
      vscodeStub._test.setActiveEditor(undefined);
    }
    expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: 'file:///c/goto/moving.md', line: 3 });
  });

  it('moves nowhere when the list is dismissed, says when there is no diagram, and asks for a Markdown file', async () => {
    const moved = vscodeStub._test.shownDocuments.length;
    const shown = vscodeStub._test.quickPicksShown.length;
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/goto/dismissed.md', NAMED_BLOCK, 0));
    await run();
    expect(vscodeStub._test.quickPicksShown).toHaveLength(shown + 1);
    expect(vscodeStub._test.shownDocuments).toHaveLength(moved);

    const infos = vscodeStub._test.notifications.info.length;
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/goto/empty.md', '# Nothing here\n', 0));
    await run();
    expect(vscodeStub._test.notifications.info.slice(infos)).toEqual(['No diagrams found in this file.']);

    const warnings = vscodeStub._test.notifications.warn.length;
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/goto/flows.puml', '@startuml\nA -> B\n@enduml', 0, { languageId: 'plantuml' }));
    try {
      await run();
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
    }
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual(['Open a Markdown file to go to one of its diagrams.']);
    expect(vscodeStub._test.quickPicksShown).toHaveLength(shown + 1);
    expect(vscodeStub._test.shownDocuments).toHaveLength(moved);
  });
});

describe('diagram dependencies (dist)', () => {
  const DOCUMENT = [
    '# Dependencies',
    '',
    '```plantuml deps',
    '@startuml',
    '!include common.puml',
    '!theme mine from themes',
    '!$name = "dyn"',
    '!include $name.iuml',
    '!include gone.puml',
    '!include after.puml',
    'Alice -> Bob',
    '@enduml',
    '```',
    '',
    '```plantuml link',
    '@startuml',
    '!include linked/secret.puml',
    '@enduml',
    '```',
    '',
    '```plantuml outside',
    '@startuml',
    '!include ../../outside/secret.puml',
    '@enduml',
    '```',
    '',
    '```plantuml library',
    '@startuml',
    '!include <C4/C4_Context>',
    'Person(a, "A")',
    '@enduml',
    '```',
  ];
  const SHARED = ['!include parts/inner.puml', 'Alice -> Bob : fromShared'];
  let base = '';
  let root = '';
  let folderOf: VscodeStub['workspace']['getWorkspaceFolder'] = () => undefined;
  let parse: VscodeStub['Uri']['parse'] = (value) => vscodeStub.Uri.file(value);
  const pathOf = (name: string): string => join(root, ...name.split('/'));
  const uriOf = (name: string): string => vscodeStub.Uri.file(pathOf(name)).toString();
  /** An editor of a document in the workspace folder on disk, its path as the platform writes it. */
  const onDisk = (name: string, lines: readonly string[], line = 0, languageId = 'markdown'): TextEditorStub => {
    const editor = makeEditor(uriOf(name), lines.join('\n'), line, { languageId });
    return { ...editor, document: { ...editor.document, uri: { ...editor.document.uri, fsPath: pathOf(name) } } };
  };
  const view = (): TreeViewHandle => {
    const handle = vscodeStub._test.treeViews.get('plantumlLocal.dependencies');
    if (handle === undefined) {
      throw new Error('the view was not created');
    }
    return handle;
  };
  /** The items under `element` as the view shows them: label and description, with the items under each. */
  async function shown(element?: unknown): Promise<unknown[]> {
    const { provider } = view();
    return Promise.all(
      (await provider.getChildren(element)).map(async (child) => {
        const { label, description } = await provider.getTreeItem(child);
        const said = description === undefined || description === '' ? label : `${label} — ${description}`;
        const under = await shown(child);
        return under.length === 0 ? said : [said, under];
      })
    );
  }
  /** The view, once each diagram of the active editor has a drawing of it as it is. */
  async function drawn(): Promise<unknown[]> {
    let tree: unknown[] = [];
    for (let waited = 0; waited < 30_000; waited += 100) {
      tree = await shown();
      if (!/drawing…|changed since drawn/.test(JSON.stringify(tree))) {
        return tree;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`not drawn: ${JSON.stringify(tree)}`);
  }
  /** The item reached from the top through the items labelled `labels`. */
  async function itemAt(...labels: string[]): Promise<{ element: unknown; item: TreeItemStub }> {
    const { provider } = view();
    let found: { element: unknown; item: TreeItemStub } | undefined;
    for (const label of labels) {
      const children = await provider.getChildren(found?.element);
      const items = await Promise.all(children.map(async (element) => ({ element, item: await provider.getTreeItem(element) })));
      found = items.find((entry) => entry.item.label === label);
      if (found === undefined) {
        throw new Error(`no ${label} among ${items.map((entry) => entry.item.label).join(', ')}`);
      }
    }
    if (found === undefined) {
      throw new Error('no item named');
    }
    return found;
  }
  const run = (id: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(vscodeStub._test.registeredCommands.get(id)?.(...args));
  /** Makes `editor` the active one, and waits for the view to say that it changed, as the editor does before it asks again. */
  async function activate(editor: TextEditorStub): Promise<void> {
    const changed = new Promise<void>((resolve) => {
      const listening = view().provider.onDidChangeTreeData?.(() => {
        listening?.dispose();
        resolve();
      });
    });
    vscodeStub._test.setActiveEditor(editor);
    await changed;
  }
  /** Runs `body` with `editors` open, the first one active, and the view shown; then puts all back. */
  async function withView(editors: readonly TextEditorStub[], body: () => Promise<void>): Promise<void> {
    for (const editor of editors) {
      vscodeStub._test.openDocument(editor.document);
    }
    vscodeStub._test.setActiveEditor(editors[0]);
    view().setVisible(true);
    try {
      await body();
    } finally {
      view().setVisible(false);
      vscodeStub._test.setActiveEditor(undefined);
      for (const editor of editors) {
        vscodeStub._test.closeDocument(editor.document);
      }
    }
  }

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-dependencies-')));
    root = join(base, 'ws');
    await mkdir(pathOf('docs'), { recursive: true });
    await mkdir(pathOf('shared/parts'), { recursive: true });
    await mkdir(pathOf('shared/themes'), { recursive: true });
    await mkdir(join(base, 'outside'), { recursive: true });
    // The same name at the top of the folder, where the diagram does not look.
    await writeFile(pathOf('common.puml'), 'Alice -> Bob : fromTop\n');
    await writeFile(pathOf('shared/common.puml'), `${SHARED.join('\n')}\n`);
    await writeFile(pathOf('shared/parts/inner.puml'), '!include ../common.puml\nCarol -> Dave : fromInner\n');
    await writeFile(pathOf('shared/themes/puml-theme-mine.puml'), '!include skin.iuml\n');
    await writeFile(pathOf('shared/skin.iuml'), 'skinparam shadowing false\n');
    await writeFile(pathOf('docs/dyn.iuml'), 'Eve -> Frank : fromDyn\n');
    await writeFile(join(base, 'outside', 'secret.puml'), 'Mallory -> Bob : secret\n');
    await symlink(join(base, 'outside'), pathOf('docs/linked'), 'junction');
    // The stub's folder, /c, is on no disk: this one is, so that its includes are read.
    folderOf = vscodeStub.workspace.getWorkspaceFolder;
    const folder = { uri: { ...vscodeStub.Uri.file(root), fsPath: root }, name: 'ws', index: 0 };
    const under = `${vscodeStub.Uri.file(root).toString()}/`;
    vscodeStub.workspace.getWorkspaceFolder = (uri) => (uri.toString().startsWith(under) ? folder : folderOf(uri));
    // A drawing takes the path of its document from the document's URI, as the platform writes it.
    parse = vscodeStub.Uri.parse;
    vscodeStub.Uri.parse = (value) =>
      value.startsWith(under) ? { ...parse(value), fsPath: pathOf(value.slice(under.length)) } : parse(value);
    vscodeStub._test.setConfiguration('includePaths', ['shared']);
  });

  afterAll(async () => {
    vscodeStub._test.setConfiguration('includePaths', undefined);
    vscodeStub.Uri.parse = parse;
    vscodeStub.workspace.getWorkspaceFolder = folderOf;
    await rm(base, { recursive: true, force: true });
  });

  it('lists what each diagram asked for under the file that asked, apart from its include lines no request matches', async () => {
    await withView([onDisk('docs/doc.md', DOCUMENT)], async () => {
      expect(await drawn()).toEqual([
        [
          'deps',
          [
            [
              'common.puml — !include · read · line 5',
              [['parts/inner.puml — !include · read', ['../common.puml — !include · read · in a cycle']]],
            ],
            'themes/puml-theme-mine.puml — !theme · read · line 6',
            // Written in the theme: asked for as the diagram asks, by none of its lines.
            'skin.iuml — !include · read',
            'dyn.iuml — !include · read',
            'gone.puml — !include · not found · line 9',
            [
              'Other include lines — 2',
              [
                '$name.iuml — !include · path worked out when drawn · line 8',
                // After the file not found, where the drawing stopped.
                'after.puml — !include · not asked for when drawn · line 10',
              ],
            ],
          ],
        ],
        ['link', ['linked/secret.puml — !include · refused · line 17']],
        ['outside', ['../../outside/secret.puml — !include · outside the folder · line 23']],
        ['library', [['Bundled libraries — 2', ['C4/C4_Context.puml', 'C4/C4.puml']]]],
      ]);

      const tooltip = async (...labels: string[]): Promise<unknown> => (await itemAt(...labels)).item.tooltip;
      // Read from the folder of the setting once not found next to the document, not from the top of the folder.
      expect(await tooltip('deps', 'common.puml')).toBe(
        [
          'common.puml',
          '!include · read · line 5',
          'Asked for by the diagram.',
          `Read ${pathOf('shared/common.puml')}.`,
          `Looked at: ${pathOf('docs/common.puml')}`,
        ].join('\n')
      );
      expect(await tooltip('deps', 'common.puml', 'parts/inner.puml')).toBe(
        [
          'parts/inner.puml',
          '!include · read',
          `Asked for by ${pathOf('shared/common.puml')}.`,
          `Read ${pathOf('shared/parts/inner.puml')}.`,
        ].join('\n')
      );
      expect(await tooltip('deps', 'skin.iuml')).toBe(
        [
          'skin.iuml',
          '!include · read',
          'Asked for by the diagram.',
          `Read ${pathOf('shared/skin.iuml')}.`,
          `Looked at: ${pathOf('docs/skin.iuml')}`,
          'No line of the diagram asks for it as written, so the line that asked is not known.',
        ].join('\n')
      );
      expect(await tooltip('deps', 'gone.puml')).toBe(
        [
          'gone.puml',
          '!include · not found · line 9',
          'Asked for by the diagram.',
          'not found: File not found relative to the file containing this directive or in the plantumlLocal.includePaths folders.',
          `Looked at: ${pathOf('docs/gone.puml')}`,
          `Looked at: ${pathOf('shared/gone.puml')}`,
        ].join('\n')
      );
      expect(await tooltip('link', 'linked/secret.puml')).toBe(
        [
          'linked/secret.puml',
          '!include · refused · line 17',
          'Asked for by the diagram.',
          'refused: Files accessed through symbolic links or junctions cannot be included. Use a path within the workspace folder that does not pass through either.',
          `Looked at: ${pathOf('docs/linked/secret.puml')}`,
        ].join('\n')
      );
      expect(await tooltip('outside', '../../outside/secret.puml')).toBe(
        [
          '../../outside/secret.puml',
          '!include · outside the folder · line 23',
          'Asked for by the diagram.',
          "outside the folder: The path is outside the document's workspace folder. Move the file into that folder or correct the path.",
        ].join('\n')
      );
      // What was read was given to the engine; it is not said to be used.
      expect(await tooltip('deps')).toBe(
        [
          'deps',
          'What its last drawing asked for, and its include lines that no request matches. A file read was given to the engine, which may skip it or use only part of it.',
        ].join('\n')
      );
    });
  });

  it('opens a file read once found again where a drawing reads it, and goes to the line that asked', async () => {
    await withView([onDisk('docs/doc.md', DOCUMENT), onDisk('shared/common.puml', SHARED, 0, 'plantuml')], async () => {
      await drawn();
      const calls = vscodeStub._test.commandCalls.length;
      await run('plantumlLocal.openDependency', (await itemAt('deps', 'common.puml')).element);
      expect(
        vscodeStub._test.commandCalls
          .slice(calls)
          .filter(({ id }) => id === 'vscode.open')
          .map(({ args }) => String(args[0]))
      ).toEqual([uriOf('shared/common.puml')]);

      // Asked for by a file: the line of that file written as it asked.
      await run('plantumlLocal.goToIncludeLine', (await itemAt('deps', 'common.puml', 'parts/inner.puml')).element);
      expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: uriOf('shared/common.puml'), line: 0 });

      // Asked for from the theme: to the diagram, saying that the line is not known.
      const infos = vscodeStub._test.notifications.info.length;
      await run('plantumlLocal.goToIncludeLine', (await itemAt('deps', 'skin.iuml')).element);
      expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: uriOf('docs/doc.md'), line: 3 });

      // Gone since it was read: not opened.
      const dyn = await itemAt('deps', 'dyn.iuml');
      await rm(pathOf('docs/dyn.iuml'));
      try {
        await run('plantumlLocal.openDependency', dyn.element);
      } finally {
        await writeFile(pathOf('docs/dyn.iuml'), 'Eve -> Frank : fromDyn\n');
      }
      expect(vscodeStub._test.notifications.info.slice(infos)).toEqual([
        'The line that asked for skin.iuml is not known.',
        'dyn.iuml was not opened: it is no longer there.',
      ]);
      expect(
        vscodeStub._test.commandCalls
          .slice(calls)
          .filter(({ id }) => id === 'vscode.open')
          .map(({ args }) => String(args[0]))
      ).toEqual([uriOf('shared/common.puml')]);

      // Only an item the view made acts.
      const shownBefore = vscodeStub._test.shownDocuments.length;
      await run('plantumlLocal.goToIncludeLine', { type: 'request', node: { request: { from: null }, lines: [0] } });
      expect(vscodeStub._test.shownDocuments).toHaveLength(shownBefore);
    });
  });

  it('reads no file in Restricted Mode, and opens none a drawing read before', async () => {
    await withView([onDisk('docs/doc.md', DOCUMENT)], async () => {
      await drawn();
      const common = await itemAt('deps', 'common.puml');
      const restricted = onDisk('docs/restricted.md', ['```plantuml r', '@startuml', '!include common.puml', '@enduml', '```']);
      vscodeStub.workspace.isTrusted = false;
      try {
        const infos = vscodeStub._test.notifications.info.length;
        const calls = vscodeStub._test.commandCalls.length;
        await run('plantumlLocal.openDependency', common.element);
        expect(vscodeStub._test.notifications.info.slice(infos)).toEqual([
          'common.puml was not opened: files are not read for this document now.',
        ]);
        expect(vscodeStub._test.commandCalls.slice(calls).filter(({ id }) => id === 'vscode.open')).toEqual([]);

        vscodeStub._test.openDocument(restricted.document);
        await activate(restricted);
        expect(await drawn()).toEqual([['r', ['common.puml — !include · not read · line 3']]]);
        expect((await itemAt('r', 'common.puml')).item.tooltip).toBe(
          [
            'common.puml',
            '!include · not read · line 3',
            'Asked for by the diagram.',
            'not read: Local includes are unavailable in Restricted Mode. Trust this workspace to include files.',
          ].join('\n')
        );
      } finally {
        vscodeStub.workspace.isTrusted = true;
        vscodeStub._test.closeDocument(restricted.document);
      }
    });
  });

  it('lists the diagrams of open documents whose drawings read the active file, and goes to them', async () => {
    const shared = onDisk('shared/common.puml', SHARED, 0, 'plantuml');
    await withView([onDisk('docs/doc.md', DOCUMENT), shared], async () => {
      await drawn();
      await activate(shared);
      expect(await drawn()).toEqual([['Diagrams that read this file — in open documents', [`deps — ${uriOf('docs/doc.md')}`]]]);
      await run('plantumlLocal.openDependency', (await itemAt('Diagrams that read this file', 'deps')).element);
      expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: uriOf('docs/doc.md'), line: 3 });
    });
  });

  it('shows the view with the diagram at the cursor selected', async () => {
    const editor = onDisk('docs/doc.md', DOCUMENT, 16);
    vscodeStub._test.openDocument(editor.document);
    vscodeStub._test.setActiveEditor(editor);
    try {
      const calls = vscodeStub._test.commandCalls.length;
      await run('plantumlLocal.showDependencies');
      expect(vscodeStub._test.commandCalls.slice(calls).map(({ id }) => id)).toContain('plantumlLocal.dependencies.focus');
      expect((await view().provider.getTreeItem(view().revealed.at(-1))).label).toBe('link');
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.closeDocument(editor.document);
    }
  });
});

describe('copying SVG text (dist)', () => {
  const copies = (): string[] => vscodeStub._test.clipboardWrites;
  const run = async (...args: unknown[]): Promise<void> => {
    await vscodeStub._test.registeredCommands.get('plantumlLocal.copySvgText')?.(...args);
  };

  it('copies the block under the cursor as the SVG export writes it, without writing a file', async () => {
    const editor = makeEditor('file:///c/copy/design.md', `intro\n\n${NAMED_BLOCK}`, 3);
    vscodeStub._test.setActiveEditor(editor);
    const written = vscodeStub._test.writtenFiles.size;
    const count = copies().length;
    const infos = vscodeStub._test.notifications.info.length;
    try {
      await run();
      expect(copies()).toHaveLength(count + 1);
      const svg = copies().at(-1) ?? '';
      expect(svg).toMatch(/^<svg/);
      expect(svg).toContain('hi');
      expect(svg).toContain('fill="#FFFFFF"');
      expect(svg).not.toMatch(/<script/i);
      expect(vscodeStub._test.writtenFiles.size).toBe(written);
      expect(vscodeStub._test.notifications.info.slice(infos)).toEqual(['Copied the diagram as SVG text.']);

      // The same text the export writes.
      await vscodeStub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      expect(vscodeStub._test.writtenFiles.get('file:///c/copy/images/orders.svg')).toBe(svg);
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
    }
  });

  it('copies from an untitled document and in a restricted workspace, where nothing is written', async () => {
    const count = copies().length;
    const warnings = vscodeStub._test.notifications.warn.length;
    vscodeStub._test.setActiveEditor(makeEditor('untitled:Untitled-1', NAMED_BLOCK, 1, { isUntitled: true }));
    try {
      await run();
      expect(copies()).toHaveLength(count + 1);
      expect(copies().at(-1)).toContain('hi');

      vscodeStub.workspace.isTrusted = false;
      await run();
      expect(copies()).toHaveLength(count + 2);
    } finally {
      vscodeStub.workspace.isTrusted = true;
      vscodeStub._test.setActiveEditor(undefined);
    }
    // Neither the export's refusal of an untitled document nor Restricted Mode's.
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual([]);
  });

  it('copies the diagram a file and a line name, as the .puml preview asks, wherever the cursor is', async () => {
    const flows = makeEditor('file:///c/copyview/flows.puml', '@startuml(id=orders)\nAlice -> Bob : named\n@enduml\n\n@startuml\nC -> D : second\n@enduml', 0, {
      languageId: 'plantuml',
    });
    vscodeStub._test.openDocument(flows.document);
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/copyview/other.md', NAMED_BLOCK, 1));
    const count = copies().length;
    try {
      await run({ uri: 'file:///c/copyview/flows.puml', line: 4 });
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.closeDocument(flows.document);
    }
    expect(copies()).toHaveLength(count + 1);
    expect(copies().at(-1)).toContain('second');
    expect(copies().at(-1)).not.toContain('named');
  });

  it('copies nothing for a diagram the engine rejects, and points to the Problems panel', async () => {
    vscodeStub._test.setActiveEditor(
      makeEditor('file:///c/copybad/design.md', ['```plantuml', '@startuml', 'Alice -> Bob', 'this is not valid ;;; [[[', '@enduml', '```'].join('\n'), 2)
    );
    const count = copies().length;
    const errors = vscodeStub._test.notifications.error.length;
    try {
      await run();
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
    }
    expect(copies()).toHaveLength(count);
    expect(vscodeStub._test.notifications.error.slice(errors)).toEqual([
      expect.stringMatching(/^Could not copy the diagram: PlantUML error on line 4: /) as unknown,
    ]);
  });

  it('says when the clipboard does not take the text, and asks where to put the cursor', async () => {
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/copyheld/design.md', `intro\n\n${NAMED_BLOCK}`, 3));
    const count = copies().length;
    const errors = vscodeStub._test.notifications.error.length;
    const warnings = vscodeStub._test.notifications.warn.length;
    vscodeStub._test.failClipboard = true;
    try {
      await run();
    } finally {
      vscodeStub._test.failClipboard = false;
    }
    expect(copies()).toHaveLength(count);
    expect(vscodeStub._test.notifications.error.slice(errors)).toEqual([
      'Could not copy the diagram: The clipboard did not take the text. Try again, or export the diagram as SVG.',
    ]);

    // Outside the block, with two blocks to choose between: nothing to copy.
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/copyheld/two.md', [NAMED_BLOCK, '', NAMED_BLOCK.replace('orders', 'billing')].join('\n'), 5));
    try {
      await run();
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
    }
    expect(copies()).toHaveLength(count);
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual(['Place the cursor inside the PlantUML code block you want to export.']);
  });
});

describe('diagram lenses (dist)', () => {
  const FLOWS = ['@startuml(id=first)', 'Alice -> Bob : first', '@enduml', '', '@startuml(id=second)', 'Carol -> Dave : second', '@enduml', ''].join(
    '\n'
  );
  const lensesOf = (document: TextEditorStub['document']): CodeLensStub[] => {
    const registration = vscodeStub._test.codeLensProviders[0];
    if (registration === undefined) {
      throw new Error('no code lens provider registered');
    }
    return registration.provider.provideCodeLenses(document, { isCancellationRequested: false }) ?? [];
  };
  const summary = (lens: CodeLensStub): [number, string | undefined] => [lens.range.start.line, lens.command?.title];
  const run = async (lens: CodeLensStub | undefined): Promise<void> => {
    await vscodeStub._test.registeredCommands.get(lens?.command?.command ?? '')?.(...(lens?.command?.arguments ?? []));
  };
  const written = (folder: string): string[] => [...vscodeStub._test.writtenFiles.keys()].filter((key) => key.startsWith(folder)).sort();
  const commandsSince = (count: number): { id: string; args: unknown[] }[] =>
    vscodeStub._test.commandCalls.slice(count).filter((call) => call.id !== 'setContext');

  it('is registered for Markdown and PlantUML files, and says when its lenses change', () => {
    expect(vscodeStub._test.codeLensProviders).toHaveLength(1);
    expect(vscodeStub._test.codeLensProviders[0]?.selector).toEqual([{ language: 'markdown' }, { language: 'plantuml' }]);
    expect(typeof vscodeStub._test.codeLensProviders[0]?.provider.onDidChangeCodeLenses).toBe('function');
  });

  it('puts Preview, Export SVG and Export PNG above each diagram of a PlantUML file, naming the document as it is', () => {
    const lenses = lensesOf(makeEditor('file:///c/lens/flows.puml', FLOWS, 0, { languageId: 'plantuml' }).document);
    expect(lenses.map(summary)).toEqual([
      [0, 'Preview'],
      [0, 'Export SVG'],
      [0, 'Export PNG'],
      [4, 'Preview'],
      [4, 'Export SVG'],
      [4, 'Export PNG'],
    ]);
    expect(lenses[4]?.command).toEqual({
      title: 'Export SVG',
      command: 'plantumlLocal.diagramAction',
      arguments: [{ action: 'svg', uri: 'file:///c/lens/flows.puml', version: 1, line: 4, name: 'second' }],
    });
    // A file with no start line holds lines to include: nothing to act on.
    const shared = makeEditor('file:///c/lens/shared.iuml', '!procedure $x()\nA -> B\n!endprocedure\n', 0, { languageId: 'plantuml' });
    expect(lensesOf(shared.document)).toEqual([]);
  });

  it('puts them above a Markdown block, and Preview only above a block holding several diagrams', () => {
    const text = ['# Doc', '', NAMED_BLOCK, '', '```plantuml', '@startuml', 'A -> B', '@enduml', '@startuml', 'C -> D', '@enduml', '```'].join('\n');
    const lenses = lensesOf(makeEditor('file:///c/lens/doc.md', text, 0).document);
    expect(lenses.map(summary)).toEqual([
      [2, 'Preview'],
      [2, 'Export SVG'],
      [2, 'Export PNG'],
      [8, 'Preview'],
    ]);
    expect(lenses[0]?.command?.arguments).toEqual([{ action: 'preview', uri: 'file:///c/lens/doc.md', version: 1, line: 2, name: 'orders' }]);
    expect(lenses[3]?.command?.arguments).toEqual([{ action: 'preview', uri: 'file:///c/lens/doc.md', version: 1, line: 8, name: null }]);
  });

  it('shows none while plantumlLocal.codeLens.enabled is off for the document, and says so when that changes', () => {
    const editor = makeEditor('file:///c/lensoff/flows.puml', FLOWS, 0, { languageId: 'plantuml' });
    let changes = 0;
    const listening = vscodeStub._test.codeLensProviders[0]!.provider.onDidChangeCodeLenses!(() => {
      changes += 1;
    });
    try {
      vscodeStub._test.setConfiguration('codeLens.enabled', false, 'file:///c/lensoff');
      expect(changes).toBe(1);
      expect(lensesOf(editor.document)).toEqual([]);
      // Another folder keeps its lenses.
      expect(lensesOf(makeEditor('file:///c/lens/flows.puml', FLOWS, 0, { languageId: 'plantuml' }).document)).toHaveLength(6);
    } finally {
      vscodeStub._test.setConfiguration('codeLens.enabled', undefined, 'file:///c/lensoff');
      listening.dispose();
    }
    expect(changes).toBe(2);
    expect(lensesOf(editor.document)).toHaveLength(6);
  });

  it('exports the diagram the lens belongs to, wherever the cursor is', async () => {
    const flows = makeEditor('file:///c/lensexport/flows.puml', FLOWS, 0, { languageId: 'plantuml' });
    vscodeStub._test.openDocument(flows.document);
    // The cursor is in another document meanwhile.
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/lensexport/other.md', NAMED_BLOCK, 1));
    try {
      await run(lensesOf(flows.document)[4]);
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.closeDocument(flows.document);
    }
    expect(written('file:///c/lensexport/')).toEqual(['file:///c/lensexport/images/second.svg']);
    expect(vscodeStub._test.writtenFiles.get('file:///c/lensexport/images/second.svg')).toContain('second');
  });

  it('finds a named diagram again once lines were added above it, and leaves an unnamed one alone once its document changed', async () => {
    const flows = makeEditor('file:///c/lensstale/flows.puml', FLOWS, 0, { languageId: 'plantuml' });
    vscodeStub._test.openDocument(flows.document);
    const lens = lensesOf(flows.document)[4];
    // The first diagram grows by a line: the second starts on line 5 now.
    flows.document.setText(FLOWS.replace('Alice -> Bob : first', 'Alice -> Bob : first\nBob -> Alice : again'));
    flows.document.version = 2;

    const blocks = ['```plantuml', '@startuml', 'A -> B : one', '@enduml', '```', '', '```plantuml', '@startuml', 'A -> B : two', '@enduml', '```'];
    const notes = makeEditor('file:///c/lensstale/notes.md', blocks.join('\n'), 0);
    vscodeStub._test.openDocument(notes.document);
    const unnamed = lensesOf(notes.document)[4];
    expect(unnamed?.command?.arguments).toEqual([{ action: 'svg', uri: 'file:///c/lensstale/notes.md', version: 1, line: 6, name: null }]);
    notes.document.setText(['# Title', ...blocks].join('\n'));
    notes.document.version = 2;

    const warnings = vscodeStub._test.notifications.warn.length;
    const prompts = vscodeStub._test.inputBoxPrompts.length;
    try {
      await run(lens);
      await run(unnamed);
    } finally {
      vscodeStub._test.closeDocument(flows.document);
      vscodeStub._test.closeDocument(notes.document);
    }
    expect(written('file:///c/lensstale/')).toEqual(['file:///c/lensstale/images/second.svg']);
    expect(vscodeStub._test.writtenFiles.get('file:///c/lensstale/images/second.svg')).toContain('second');
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual(['The file has changed. Check the diagram again.']);
    expect(vscodeStub._test.inputBoxPrompts).toHaveLength(prompts);
  });

  it("opens the .puml preview on the lens's diagram, leaving the cursor where it is", async () => {
    // Named apart from the other tests' flows.puml: the viewer tests find their panel by its title.
    const flows = makeEditor('file:///c/lensview/lensed.puml', FLOWS, 0, { languageId: 'plantuml' });
    vscodeStub._test.openDocument(flows.document);
    vscodeStub._test.setActiveEditor(flows);
    const before = vscodeStub._test.webviewPanels.length;
    try {
      await run(lensesOf(flows.document)[3]);
      const panel = vscodeStub._test.webviewPanels[before];
      expect(panel).toMatchObject({ viewType: 'plantumlLocal.viewer', title: 'Preview: lensed.puml' });
      expect(panel?.column).toBe(vscodeStub.ViewColumn.Beside);
      panel?.receive({ type: 'ready' });
      const posted = (): { type: string; items?: string[]; selected?: number }[] =>
        (panel?.webview.posted ?? []) as { type: string; items?: string[]; selected?: number }[];
      expect(await waitFor(() => posted().some((message) => message.type === 'render'), 30_000)).toBe(true);
      expect(posted().find((message) => message.type === 'diagrams')).toMatchObject({
        items: ['first (line 1)', 'second (line 5)'],
        selected: 1,
      });
      expect(flows.selection.active.line).toBe(0);
      panel?.dispose();
    } finally {
      vscodeStub._test.setActiveEditor(undefined);
      vscodeStub._test.closeDocument(flows.document);
    }
  });

  it("selects a Markdown block's source and opens the Markdown preview beside it", async () => {
    const editor = makeEditor('file:///c/lensmd/doc.md', `# Doc\n\n${NAMED_BLOCK}\n`, 0);
    vscodeStub._test.openDocument(editor.document);
    const calls = vscodeStub._test.commandCalls.length;
    try {
      await run(lensesOf(editor.document)[0]);
    } finally {
      vscodeStub._test.closeDocument(editor.document);
    }
    expect(vscodeStub._test.shownDocuments.at(-1)).toEqual({ uri: 'file:///c/lensmd/doc.md', line: 2 });
    expect(commandsSince(calls)).toEqual([{ id: 'markdown.showPreviewToSide', args: [editor.document.uri] }]);
  });

  it('acts on nothing for an argument it did not make, or a document that is not open', async () => {
    const warnings = vscodeStub._test.notifications.warn.length;
    const calls = vscodeStub._test.commandCalls.length;
    const panels = vscodeStub._test.webviewPanels.length;
    const command = vscodeStub._test.registeredCommands.get('plantumlLocal.diagramAction')!;
    await command({ action: 'open', uri: 'file:///c/lens/flows.puml', version: 1, line: 0, name: null });
    await command('file:///c/lens/flows.puml');
    expect(vscodeStub._test.notifications.warn).toHaveLength(warnings);
    await command({ action: 'preview', uri: 'file:///c/lens/absent.puml', version: 1, line: 0, name: null });
    expect(vscodeStub._test.notifications.warn.slice(warnings)).toEqual(['The file has changed. Check the diagram again.']);
    expect(commandsSince(calls)).toEqual([]);
    expect(vscodeStub._test.webviewPanels).toHaveLength(panels);
  });
});

describe('viewer (dist)', () => {
  const FLOWS = [
    '@startuml(id=orders)',
    'Alice -> Bob : orders',
    '@enduml',
    '',
    '@startuml',
    'Carol -> Dave : second',
    '@enduml',
  ].join('\n');
  const posted = (panel: WebviewPanelStub, type: string): { type: string; svg?: string }[] =>
    (panel.webview.posted as { type: string; svg?: string }[]).filter((message) => message.type === type);
  const waitFor = async (check: () => boolean): Promise<void> => {
    for (let waited = 0; waited < 30_000; waited += 50) {
      if (check()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('timed out');
  };
  const run = async (id: string): Promise<void> => {
    await vscodeStub._test.registeredCommands.get(id)?.();
  };

  it('opens a panel for the file, showing the diagram under the cursor once the page runs', async () => {
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/view/flows.puml', FLOWS, 5, { languageId: 'plantuml' }));
    const before = vscodeStub._test.webviewPanels.length;

    await run('plantumlLocal.openPreviewToSide');

    const panel = vscodeStub._test.webviewPanels[before];
    expect(panel).toMatchObject({ viewType: 'plantumlLocal.viewer', title: 'Preview: flows.puml' });
    expect(panel?.column).toBe(vscodeStub.ViewColumn.Beside);
    expect(panel?.webview.options).toMatchObject({ enableScripts: true, enableForms: false });
    // The extension's own media/viewer, and nothing else.
    expect(panel?.webview.options.localResourceRoots?.map(String)).toEqual([
      expect.stringMatching(/^file:\/\/\/.*\/media\/viewer$/),
    ]);
    expect(String(panel?.webview.options.localResourceRoots?.[0])).not.toContain('/dist');
    // Scripts run only with the page's nonce, and the drawing comes in as a
    // Blob URL image.
    // The attribute is HTML-escaped, as an attribute value has to be.
    const csp = (/Content-Security-Policy" content="([^"]*)"/.exec(panel?.webview.html ?? '')?.[1] ?? '')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'nonce-[^' ]+'(;|$)/);
    expect(csp).toMatch(/img-src [^;]*blob:/);
    expect(panel?.webview.html).toContain('/media/viewer/viewer.js');
    // The page takes its zoom from zoom.js, which runs first.
    const html = panel?.webview.html ?? '';
    expect(html.indexOf('/media/viewer/zoom.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('/media/viewer/zoom.js"')).toBeLessThan(html.indexOf('/media/viewer/viewer.js"'));
    // The zoom toolbar, its buttons named in the display language.
    expect(panel?.webview.html).toContain('<div id="tools" role="toolbar" aria-label="Diagram zoom">');
    for (const label of ['Zoom Out', 'Zoom In', 'Fit to Window', 'Actual Size', 'Zoom to Area']) {
      expect(panel?.webview.html).toContain(`aria-label="${label}"`);
    }
    // Read out as they change: not the status line or the zoom, but the two
    // regions the page tells a screen reader through.
    expect(panel?.webview.html).toContain('<span id="status"></span>');
    expect(panel?.webview.html).toContain('<span id="zoom" data-spoken="Zoom {0}"></span>');
    expect(panel?.webview.html).toContain('<div id="announcer"><div role="status"></div><div role="status"></div></div>');
    // Nothing is sent before the page says it runs.
    expect(panel?.webview.posted).toEqual([]);

    panel?.receive({ type: 'ready' });
    await waitFor(() => (panel === undefined ? false : posted(panel, 'status').length > 1));
    expect(posted(panel!, 'diagrams')[0]).toEqual({
      type: 'diagrams',
      items: ['orders (line 1)', 'Diagram 2 (line 5)'],
      selected: 1,
      // The second diagram has no name: a restart could not tell which it was.
      keep: { uri: 'file:///c/view/flows.puml', name: null },
    });
    expect(posted(panel!, 'render')[0]?.svg).toContain('second');
    // What the page keeps the zoom of this diagram by, and what a screen
    // reader calls it, as it has neither a title nor a name.
    expect(posted(panel!, 'render')[0]).toMatchObject({ key: '#1', label: 'Diagram 2 of flows' });
    // A screen reader is told it is drawn, not that it is being drawn.
    expect(posted(panel!, 'status')).toEqual([
      { type: 'status', text: 'Rendering diagram…', error: false, clear: false, spoken: null },
      { type: 'status', text: '', error: false, clear: false, spoken: 'Rendered Diagram 2 of flows.' },
    ]);
  });

  it('names the diagram by the title the engine draws', async () => {
    const source = ['@startuml', 'title <u>Order</u> flow', 'Alice -> Bob', '@enduml'].join('\n');
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/viewtitle/orders.puml', source, 1, { languageId: 'plantuml' }));
    const before = vscodeStub._test.webviewPanels.length;
    await run('plantumlLocal.openPreviewToSide');
    const panel = vscodeStub._test.webviewPanels[before]!;

    panel.receive({ type: 'ready' });
    await waitFor(() => posted(panel, 'status').length > 1);

    // As drawn, without the markup of the source.
    expect(posted(panel, 'render')[0]).toMatchObject({ key: 'orders', label: 'Order flow' });
    expect(posted(panel, 'status').at(-1)).toMatchObject({ spoken: 'Rendered Order flow.' });
  });

  it('runs Export Diagram as PNG for the diagram shown when its PNG button is pressed', async () => {
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/viewpng/flows.puml', FLOWS, 5, { languageId: 'plantuml' }));
    const before = vscodeStub._test.webviewPanels.length;
    await run('plantumlLocal.openPreviewToSide');
    const panel = vscodeStub._test.webviewPanels[before]!;
    expect(panel.webview.html).toContain(
      '<button id="export-png" type="button" aria-label="Export Diagram as PNG" title="Export Diagram as PNG">PNG</button>'
    );
    panel.receive({ type: 'ready' });
    await waitFor(() => posted(panel, 'render').length > 0);
    const asked = (): unknown[] =>
      vscodeStub._test.commandCalls.filter((call) => call.id === 'plantumlLocal.exportPng').map((call) => call.args[0]);
    const count = asked().length;

    panel.receive({ type: 'exportPng' });
    await waitFor(() => asked().length > count);
    panel.receive({ type: 'select', index: 0 });
    panel.receive({ type: 'exportPng' });
    await waitFor(() => asked().length > count + 1);

    expect(asked().slice(count)).toEqual([
      { uri: 'file:///c/viewpng/flows.puml', line: 4 },
      { uri: 'file:///c/viewpng/flows.puml', line: 0 },
    ]);
  });

  it('runs Copy Diagram as SVG Text for the diagram shown when its Copy SVG button is pressed', async () => {
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/viewsvg/flows.puml', FLOWS, 5, { languageId: 'plantuml' }));
    const before = vscodeStub._test.webviewPanels.length;
    await run('plantumlLocal.openPreviewToSide');
    const panel = vscodeStub._test.webviewPanels[before]!;
    expect(panel.webview.html).toContain(
      '<button id="copy-svg" type="button" aria-label="Copy Diagram as SVG Text" title="Copy Diagram as SVG Text">Copy SVG</button>'
    );
    panel.receive({ type: 'ready' });
    await waitFor(() => posted(panel, 'render').length > 0);
    const asked = (): unknown[] =>
      vscodeStub._test.commandCalls.filter((call) => call.id === 'plantumlLocal.copySvgText').map((call) => call.args[0]);
    const count = asked().length;

    panel.receive({ type: 'copySvg' });
    await waitFor(() => asked().length > count);
    expect(asked().slice(count)).toEqual([{ uri: 'file:///c/viewsvg/flows.puml', line: 4 }]);
  });

  it('answers the Copy button with what the PNG button would export, or why there is none', async () => {
    const editor = makeEditor('file:///c/viewcopy/flows.puml', FLOWS, 5, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(editor);
    const before = vscodeStub._test.webviewPanels.length;
    await run('plantumlLocal.openPreviewToSide');
    const panel = vscodeStub._test.webviewPanels[before]!;
    expect(panel.webview.html).toContain('<button id="copy-png" type="button" aria-label="Copy Diagram as PNG" title="Copy Diagram as PNG"');
    panel.receive({ type: 'ready' });
    await waitFor(() => posted(panel, 'render').length > 0);
    type Answer = { type: string; id?: number; svg?: string; width?: number; height?: number; background?: string; message?: string };
    const answers = (): Answer[] =>
      (panel.webview.posted as Answer[]).filter((message) => message.type === 'copy' || message.type === 'copyFailed');

    panel.receive({ type: 'copyPng', id: 1 });
    await waitFor(() => answers().length > 0);
    const copy = answers()[0];
    // The diagram shown, in the light palette of exports with its
    // background, at the PNG scale: twice its size by default.
    expect(copy).toMatchObject({ type: 'copy', id: 1, background: '#FFFFFF' });
    expect(copy?.svg).toContain('second');
    expect(copy?.svg).toContain('fill="#FFFFFF"');
    const open = /^<svg[^>]*>/.exec(copy?.svg ?? '')?.[0] ?? '';
    const width = Number(/\swidth="([\d.]+)"/.exec(open)?.[1]);
    const height = Number(/\sheight="([\d.]+)"/.exec(open)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(copy).toMatchObject({ width: Math.ceil(width * 2), height: Math.ceil(height * 2) });

    // The palette and scale set for the file's folder.
    vscodeStub._test.setConfiguration('exportPngScale', 1, 'file:///c/viewcopy');
    vscodeStub._test.setConfiguration('exportTheme', 'dark', 'file:///c/viewcopy');
    try {
      panel.receive({ type: 'copyPng', id: 2 });
      await waitFor(() => answers().length > 1);
      expect(answers()[1]).toMatchObject({ type: 'copy', id: 2, width: Math.ceil(width), background: '#1b1b1b' });
    } finally {
      vscodeStub._test.setConfiguration('exportPngScale', undefined, 'file:///c/viewcopy');
      vscodeStub._test.setConfiguration('exportTheme', undefined, 'file:///c/viewcopy');
    }

    // A diagram the engine draws as an error is not copied.
    editor.document.setText(FLOWS.replace('Carol -> Dave : second', 'this is not valid ;;; [[['));
    panel.receive({ type: 'copyPng', id: 3 });
    await waitFor(() => answers().length > 2);
    expect(answers()[2]).toMatchObject({ type: 'copyFailed', id: 3, message: expect.stringMatching(/^PlantUML error on line 6: /) as unknown });
  });

  it('keeps one panel per file and draws the diagram it is asked for', async () => {
    const editor = makeEditor('file:///c/view/flows.puml', FLOWS, 1, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(editor);
    const panels = vscodeStub._test.webviewPanels.length;
    const panel = vscodeStub._test.webviewPanels.find((candidate) => candidate.title === 'Preview: flows.puml');
    const revealed = panel?.revealed ?? 0;

    await run('plantumlLocal.openPreview');

    expect(vscodeStub._test.webviewPanels).toHaveLength(panels);
    expect(panel?.revealed).toBe(revealed + 1);
    await waitFor(() => posted(panel!, 'render').some((message) => message.svg?.includes('orders') === true));

    panel?.receive({ type: 'select', index: 1 });
    const count = posted(panel!, 'render').length;
    await waitFor(() => posted(panel!, 'render').length > count);
    expect(posted(panel!, 'render').at(-1)?.svg).toContain('second');
  });

  it('has the viewer its context menu was opened on do what the menu chose, and no other', async () => {
    const before = vscodeStub._test.webviewPanels.length;
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/menu/one.puml', FLOWS, 1, { languageId: 'plantuml' }));
    await run('plantumlLocal.openPreviewToSide');
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/menu/two.puml', FLOWS, 1, { languageId: 'plantuml' }));
    await run('plantumlLocal.openPreviewToSide');
    const [one, two] = vscodeStub._test.webviewPanels.slice(before);
    const command = (id: string): ((...args: unknown[]) => unknown) => vscodeStub._test.registeredCommands.get(id)!;
    // What VS Code passes: what the page set where the menu was opened, and the view type.
    const context = { 'plantumlLocal.viewerUri': 'file:///c/menu/two.puml', webview: 'plantumlLocal.viewer' };
    const items = [
      ['plantumlLocal.zoomToArea', 'zoomToArea'],
      ['plantumlLocal.scrollToTop', 'top'],
      ['plantumlLocal.scrollToBottom', 'bottom'],
      ['plantumlLocal.scrollToLeftEdge', 'left'],
      ['plantumlLocal.scrollToRightEdge', 'right'],
      ['plantumlLocal.scrollToCentre', 'centre'],
    ] as const;

    for (const [id] of items) {
      await command(id)(context);
    }

    expect(posted(two!, 'act')).toEqual(items.map(([, action]) => ({ type: 'act', action })));
    expect(posted(one!, 'act')).toEqual([]);

    // A context that names no open viewer, or none, does nothing.
    for (const arg of [
      undefined,
      null,
      'file:///c/menu/two.puml',
      {},
      { 'plantumlLocal.viewerUri': 'file:///c/menu/three.puml' },
      { 'plantumlLocal.viewerUri': 42 },
      { uri: 'file:///c/menu/two.puml' },
    ]) {
      await command('plantumlLocal.scrollToTop')(arg);
    }
    expect(posted(two!, 'act')).toHaveLength(items.length);
    expect(posted(one!, 'act')).toEqual([]);
  });

  it('draws the file again once it stops changing', async () => {
    const editor = makeEditor('file:///c/view/flows.puml', FLOWS, 1, { languageId: 'plantuml' });
    const panel = vscodeStub._test.webviewPanels.find((candidate) => candidate.title === 'Preview: flows.puml');
    const count = posted(panel!, 'render').length;

    editor.document.setText(FLOWS.replace('second', 'edited'));
    vscodeStub._test.changeDocument(editor.document);

    await waitFor(() => posted(panel!, 'render').length > count);
    expect(posted(panel!, 'render').at(-1)?.svg).toContain('edited');
  });

  it('with onSave, says a changed file is not updated, and draws it again once it is saved', async () => {
    const editor = makeEditor('file:///c/viewsave/flows.puml', FLOWS, 1, { languageId: 'plantuml' });
    vscodeStub._test.setActiveEditor(editor);
    const before = vscodeStub._test.webviewPanels.length;
    await run('plantumlLocal.openPreviewToSide');
    const panel = vscodeStub._test.webviewPanels[before]!;
    panel.receive({ type: 'ready' });
    await waitFor(() => posted(panel, 'render').length > 0);
    const statuses = (): { text?: string; error?: boolean; clear?: boolean }[] =>
      posted(panel, 'status') as { text?: string; error?: boolean; clear?: boolean }[];

    vscodeStub._test.setConfiguration('preview.updateMode', 'onSave', 'file:///c/viewsave');
    try {
      // The setting changed: every viewer is drawn again.
      await waitFor(() => posted(panel, 'render').length > 1);
      const count = posted(panel, 'render').length;

      editor.document.setText(FLOWS.replace('Alice -> Bob : orders', 'Alice -> Bob : changed'));
      vscodeStub._test.changeDocument(editor.document);
      await waitFor(() => statuses().at(-1)?.text === 'Preview is out of date. Save the file to refresh it.');
      expect(statuses().at(-1)).toMatchObject({ error: false, clear: false, spoken: 'Preview is out of date. Save the file to refresh it.' });
      // Past the delay a change waits for before drawing: nothing drawn.
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(posted(panel, 'render')).toHaveLength(count);

      vscodeStub._test.saveDocument(editor.document);
      await waitFor(() => posted(panel, 'render').length > count);
      expect(posted(panel, 'render').at(-1)?.svg).toContain('changed');
    } finally {
      vscodeStub._test.setConfiguration('preview.updateMode', undefined, 'file:///c/viewsave');
    }
  });

  it('asks for a PlantUML file when the editor holds none', async () => {
    vscodeStub._test.setActiveEditor(makeEditor('file:///c/view/doc.md', '# Title', 0));
    const panels = vscodeStub._test.webviewPanels.length;

    await run('plantumlLocal.openPreview');

    expect(vscodeStub._test.webviewPanels).toHaveLength(panels);
    expect(vscodeStub._test.notifications.warn.at(-1)).toBe('Open a PlantUML file to preview its diagrams.');
  });

  describe('after a restart', () => {
    const restore = async (state: unknown, title = 'Preview: kept.puml'): Promise<WebviewPanelStub> => {
      const panel = vscodeStub._test.restoredPanel('plantumlLocal.viewer', title);
      await vscodeStub._test.webviewSerializers.get('plantumlLocal.viewer')?.deserializeWebviewPanel(panel, state);
      return panel;
    };
    const kept = makeEditor('file:///c/view/kept.puml', FLOWS, 0, { languageId: 'plantuml' }).document;

    it('brings a panel back on the diagram it showed, with options of this version', async () => {
      vscodeStub._test.openDocument(kept);
      let panel: WebviewPanelStub | undefined;
      try {
        panel = await restore({ uri: 'file:///c/view/kept.puml', name: 'orders' });

        // A restored panel keeps the options of the session that saved it.
        expect(panel.webview.options).toMatchObject({ enableScripts: true, enableForms: false });
        expect(panel.webview.options.localResourceRoots?.map(String)).toEqual([
          expect.stringMatching(/\/media\/viewer$/),
        ]);
        expect(panel.webview.html).toContain('/media/viewer/viewer.js');

        const shown = panel;
        shown.receive({ type: 'ready' });
        await waitFor(() => posted(shown, 'render').length > 0);
        expect(posted(shown, 'render')[0]?.svg).toContain('orders');
        // What the page is given to keep for the next restart.
        expect(posted(shown, 'diagrams')[0]).toMatchObject({
          keep: { uri: 'file:///c/view/kept.puml', name: 'orders' },
        });
      } finally {
        panel?.dispose();
        vscodeStub._test.closeDocument(kept);
      }
    });

    it('asks for a choice rather than guessing a diagram that had no name', async () => {
      vscodeStub._test.openDocument(kept);
      let panel: WebviewPanelStub | undefined;
      try {
        panel = await restore({ uri: 'file:///c/view/kept.puml', name: null });
        const shown = panel;
        shown.receive({ type: 'ready' });

        await waitFor(() => shown.webview.posted.length >= 2);
        expect(posted(shown, 'render')).toEqual([]);
        expect(shown.webview.posted.at(-1)).toEqual({
          type: 'status',
          text: 'Select a diagram from the list.',
          error: false,
          clear: true,
          spoken: 'Select a diagram from the list.',
        });
      } finally {
        panel?.dispose();
        vscodeStub._test.closeDocument(kept);
      }
    });

    it('closes a panel whose file is gone, or whose state cannot be read', async () => {
      for (const state of [{ uri: 'file:///c/view/missing.puml', name: 'x' }, { uri: 42 }, null, 'kept.puml']) {
        const panel = vscodeStub._test.restoredPanel('plantumlLocal.viewer', 'Preview: gone.puml');
        let disposed = false;
        panel.onDidDispose(() => {
          disposed = true;
        });

        await vscodeStub._test.webviewSerializers.get('plantumlLocal.viewer')?.deserializeWebviewPanel(panel, state);

        expect(disposed, JSON.stringify(state)).toBe(true);
        expect(panel.webview.html).toBe('');
      }
    });
  });
});
