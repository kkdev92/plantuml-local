import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { DiagramRender } from '../../src/core/types';
import { DiagramViewer, parseRequest, viewerBody, type ViewerDeps } from '../../src/viewer/viewer';

/** A panel that keeps what it is sent. */
function makePanel(): { post: ReturnType<typeof vi.fn>; sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    post: vi.fn((message: unknown) => {
      sent.push(message);
      return Promise.resolve(true);
    }),
  };
}

function makeDeps(
  overrides?: Partial<Omit<ViewerDeps, 'render'>> & {
    /** The SVG, or the SVG with the includes that failed. */
    render?: (source: string, dark: boolean, document: string) => Promise<string | DiagramRender>;
  }
): ViewerDeps & { render: ReturnType<typeof vi.fn>; exportPng: ReturnType<typeof vi.fn>; copyPng: ReturnType<typeof vi.fn> } {
  const inner = overrides?.render ?? ((source: string) => Promise.resolve(`<svg>${source}</svg>`));
  const render = vi.fn((source: string, dark: boolean, document: string) =>
    inner(source, dark, document).then((value): DiagramRender =>
      typeof value === 'string' ? { svg: value, failedIncludes: new Map(), dependencies: [] } : value
    )
  );
  return {
    resolvePalette: (_source: string, dark: boolean) => Promise.resolve(dark),
    isDark: () => false,
    exportPng: vi.fn(() => Promise.resolve()),
    copySvgText: vi.fn(() => Promise.resolve()),
    copyPng: vi.fn((_uri: string, diagram: { source: string }) =>
      Promise.resolve({ svg: `<svg>${diagram.source}</svg>`, width: 20, height: 10, background: '#FFFFFF' })
    ),
    labels: {
      errorMessage: (message) => message,
      diagram: (position) => `Diagram ${String(position)}`,
      unnamed: (position, file) => `Diagram ${String(position)} of ${file}`,
      entry: (name, line) => `${name} (line ${String(line)})`,
      rendering: 'rendering',
      rendered: (name) => `rendered ${name}`,
      gone: 'gone',
      choose: 'choose',
      empty: 'empty',
      remoteReference: 'remote',
      emojiUnavailable: 'emoji',
      pages: 'pages',
      formula: (tag) => `formula ${tag}`,
      embeddedDiagram: 'embedded',
      image: 'image',
      engineError: (message, line) => `engine: ${message} @ ${String(line)}`,
      otherPalette: (dark) => `other palette ${String(dark)}`,
    },
    ...overrides,
    render,
  } as ViewerDeps & { render: ReturnType<typeof vi.fn>; exportPng: ReturnType<typeof vi.fn>; copyPng: ReturnType<typeof vi.fn> };
}

const FLOWS = [
  '@startuml(id=orders)',
  'A -> B : orders',
  '@enduml',
  '',
  '@startuml',
  'C -> D : unnamed',
  '@enduml',
].join('\n');

const of = (sent: unknown[], type: string): unknown[] =>
  sent.filter((message) => (message as { type: string }).type === type);

describe('parseRequest', () => {
  it('accepts a ready page, a choice among the diagrams, and the PNG, Copy and Copy SVG buttons', () => {
    expect(parseRequest({ type: 'ready' }, 2)).toEqual({ type: 'ready' });
    expect(parseRequest({ type: 'exportPng' }, 2)).toEqual({ type: 'exportPng' });
    expect(parseRequest({ type: 'copySvg' }, 2)).toEqual({ type: 'copySvg' });
    expect(parseRequest({ type: 'select', index: 1 }, 2)).toEqual({ type: 'select', index: 1 });
    expect(parseRequest({ type: 'copyPng', id: 3 }, 2)).toEqual({ type: 'copyPng', id: 3 });
  });

  it('ignores anything else the page sends', () => {
    for (const message of [
      null,
      'ready',
      { type: 'select', index: 2 },
      { type: 'select', index: -1 },
      { type: 'select', index: 0.5 },
      { type: 'select', index: '0' },
      { type: 'copyPng' },
      { type: 'copyPng', id: 0 },
      { type: 'copyPng', id: 1.5 },
      { type: 'copyPng', id: '1' },
      { type: 'copyPng', id: Number.MAX_SAFE_INTEGER + 1 },
      { type: 'open', path: '/etc/passwd' },
    ]) {
      expect(parseRequest(message, 2), JSON.stringify(message)).toBeNull();
    }
  });
});

describe('DiagramViewer', () => {
  it('lists the diagrams and draws the one at the cursor, on its palette', async () => {
    const panel = makePanel();
    const viewer = new DiagramViewer(panel, makeDeps({ isDark: () => true }), 'flows', 'file:///flows.puml');

    await viewer.show(FLOWS, 5);

    expect(of(panel.sent, 'diagrams')).toEqual([
      {
        type: 'diagrams',
        items: ['orders (line 1)', 'Diagram 2 (line 5)'],
        selected: 1,
        keep: { uri: 'file:///flows.puml', name: null },
      },
    ]);
    expect(of(panel.sent, 'render')).toEqual([
      {
        type: 'render',
        svg: '<svg>@startuml\nC -> D : unnamed\n@enduml</svg>',
        backdrop: '#1b1b1b',
        // Unnamed: the page keeps its zoom by its position.
        key: '#1',
        // And a screen reader knows it by its place in the file.
        label: 'Diagram 2 of flows',
      },
    ]);
    // The last word is an empty status: drawn and current.
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: '', error: false, clear: false, spoken: 'rendered Diagram 2 of flows' });
  });

  it('waits for the page before drawing a diagram it was told to show', async () => {
    const panel = makePanel();
    const viewer = new DiagramViewer(panel, makeDeps(), 'flows', 'file:///flows.puml');

    viewer.select(FLOWS, 1);
    expect(panel.post).not.toHaveBeenCalled();

    await viewer.receive({ type: 'ready' }, FLOWS);
    expect(of(panel.sent, 'render')).toHaveLength(1);
    expect(JSON.stringify(of(panel.sent, 'render'))).toContain('orders');
  });

  it('draws the diagram the page picks, and nothing for a message it does not know', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    viewer.select(FLOWS, null);

    await viewer.receive({ type: 'select', index: 1 }, FLOWS);
    expect(deps.render).toHaveBeenLastCalledWith('@startuml\nC -> D : unnamed\n@enduml', false, 'file:///flows.puml');

    panel.sent.length = 0;
    await viewer.receive({ type: 'select', index: 7 }, FLOWS);
    await viewer.receive({ type: 'reveal', line: 3 }, FLOWS);
    expect(panel.sent).toEqual([]);
  });

  it('exports the diagram shown when the page asks, and none in place of one that has gone', async () => {
    const deps = makeDeps();
    const viewer = new DiagramViewer(makePanel(), deps, 'flows', 'file:///flows.puml');
    viewer.select(FLOWS, 5);

    await viewer.receive({ type: 'exportPng' }, FLOWS);
    expect(deps.exportPng).toHaveBeenLastCalledWith('file:///flows.puml', 4);
    await viewer.receive({ type: 'select', index: 0 }, FLOWS);
    await viewer.receive({ type: 'exportPng' }, FLOWS);
    expect(deps.exportPng).toHaveBeenLastCalledWith('file:///flows.puml', 0);

    await viewer.receive({ type: 'exportPng' }, FLOWS.replace('(id=orders)', '(id=renamed)'));
    expect(deps.exportPng).toHaveBeenCalledTimes(2);
  });

  it('copies the diagram shown as SVG text when the page asks, and none in place of one that has gone', async () => {
    const deps = makeDeps();
    const viewer = new DiagramViewer(makePanel(), deps, 'flows', 'file:///flows.puml');
    viewer.select(FLOWS, 5);
    await viewer.receive({ type: 'copySvg' }, FLOWS);
    expect(deps.copySvgText).toHaveBeenLastCalledWith('file:///flows.puml', 4);
    expect(deps.exportPng).not.toHaveBeenCalled();
    await viewer.receive({ type: 'select', index: 0 }, FLOWS);
    await viewer.receive({ type: 'copySvg' }, FLOWS);
    expect(deps.copySvgText).toHaveBeenLastCalledWith('file:///flows.puml', 0);
    // The named diagram shown is gone: nothing is copied in its place.
    await viewer.receive({ type: 'copySvg' }, FLOWS.replace('(id=orders)', '(id=renamed)'));
    expect(deps.copySvgText).toHaveBeenCalledTimes(2);
  });

  it('answers a copy with what to draw of the diagram shown, under the number the page gave it', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    viewer.select(FLOWS, 0);

    await viewer.receive({ type: 'copyPng', id: 7 }, FLOWS);

    expect(deps.copyPng).toHaveBeenCalledWith('file:///flows.puml', expect.objectContaining({ name: 'orders', openLine: 0 }));
    expect(panel.sent).toEqual([
      {
        type: 'copy',
        id: 7,
        svg: '<svg>@startuml(id=orders)\nA -> B : orders\n@enduml</svg>',
        width: 20,
        height: 10,
        background: '#FFFFFF',
      },
    ]);
    // Copying draws nothing in the panel.
    expect(deps.render).not.toHaveBeenCalled();
  });

  it('answers a copy that cannot be made with the reason, as for a diagram that has gone or an error', async () => {
    const panel = makePanel();
    const deps = makeDeps({
      copyPng: vi
        .fn()
        .mockResolvedValueOnce({ error: 'too large' })
        .mockRejectedValueOnce(new Error('worker stopped')),
    });
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    viewer.select(FLOWS, 0);

    await viewer.receive({ type: 'copyPng', id: 1 }, FLOWS);
    await viewer.receive({ type: 'copyPng', id: 2 }, FLOWS);
    await viewer.receive({ type: 'copyPng', id: 3 }, FLOWS.replace('(id=orders)', '(id=renamed)'));

    expect(panel.sent).toEqual([
      { type: 'copyFailed', id: 1, message: 'too large' },
      { type: 'copyFailed', id: 2, message: 'worker stopped' },
      { type: 'copyFailed', id: 3, message: 'gone' },
    ]);
    expect(deps.copyPng).toHaveBeenCalledTimes(2);
  });

  it('follows a named diagram when diagrams move about', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    await viewer.show(FLOWS, 0);

    // A diagram inserted above: the one shown is still `orders`.
    await viewer.update(`@startuml(id=first)\nX -> Y\n@enduml\n${FLOWS}`);

    expect(deps.render).toHaveBeenLastCalledWith('@startuml(id=orders)\nA -> B : orders\n@enduml', false, 'file:///flows.puml');
    expect(of(panel.sent, 'diagrams').at(-1)).toMatchObject({ selected: 1 });
  });

  it('gives the page the file and the diagram to keep, for a restart', async () => {
    const panel = makePanel();
    await new DiagramViewer(panel, makeDeps(), 'flows', 'file:///flows.puml').show(FLOWS, 1);

    expect(of(panel.sent, 'diagrams')[0]).toMatchObject({ keep: { uri: 'file:///flows.puml', name: 'orders' } });
  });

  it('comes back after a restart on the diagram it was given by name', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');

    viewer.restore('orders');
    await viewer.receive({ type: 'ready' }, `@startuml\nfirst\n@enduml\n${FLOWS}`);

    expect(deps.render).toHaveBeenCalledWith('@startuml(id=orders)\nA -> B : orders\n@enduml', false, 'file:///flows.puml');
  });

  it('asks for a choice after a restart when the diagram had no name', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');

    viewer.restore(null);
    await viewer.receive({ type: 'ready' }, FLOWS);

    expect(deps.render).not.toHaveBeenCalled();
    expect(of(panel.sent, 'diagrams')[0]).toMatchObject({ selected: -1 });
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'choose', error: false, clear: true, spoken: 'choose' });

    // Picking one from the list draws it.
    await viewer.receive({ type: 'select', index: 1 }, FLOWS);
    expect(deps.render).toHaveBeenCalledWith('@startuml\nC -> D : unnamed\n@enduml', false, 'file:///flows.puml');
  });

  it('says so when the diagram shown has gone, rather than showing another', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    await viewer.show(FLOWS, 0);
    deps.render.mockClear();

    await viewer.update('@startuml(id=billing)\nE -> F\n@enduml');

    expect(deps.render).not.toHaveBeenCalled();
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'gone', error: true, clear: true, spoken: 'gone' });
  });

  it('explains what the engine cannot draw instead of drawing it', async () => {
    for (const [source, reason] of [
      ['@startuml\n!include https://example.com/x.puml\n@enduml', 'remote'],
      ['@startuml\nA -> B\nnewpage\nC -> D\n@enduml', 'pages'],
    ] as const) {
      const panel = makePanel();
      const deps = makeDeps();
      await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show(source, 0);

      expect(deps.render, reason).not.toHaveBeenCalled();
      expect(panel.sent.at(-1)).toEqual({ type: 'status', text: reason, error: true, clear: true, spoken: reason });
    }
  });

  it('shows the error the engine drew, naming the line of the file it points to', async () => {
    const svg = readFileSync(join(__dirname, 'fixtures/engine-output/syntax-error.svg'), 'utf8');
    const panel = makePanel();
    const source = ['@startuml(id=first)', 'A -> B', '@enduml', '', '@startuml', 'Alice -> Bob', 'this is not valid ;;; [[[', '@enduml'].join('\n');
    const viewer = new DiagramViewer(panel, makeDeps({ render: vi.fn(() => Promise.resolve(svg)) }), 'two', 'file:///two.puml');

    await viewer.show(source, 6);

    expect(of(panel.sent, 'render')).toHaveLength(1);
    expect(panel.sent.at(-1)).toEqual({
      type: 'status',
      text: 'engine: Syntax Error? (Assumed diagram type: sequence) @ 7',
      error: true,
      clear: false,
      spoken: 'engine: Syntax Error? (Assumed diagram type: sequence) @ 7',
    });
  });

  it('says why an include failed, for the file the engine asked for', async () => {
    const svg = readFileSync(join(__dirname, 'fixtures/engine-output/include-failure.svg'), 'utf8');
    const failedIncludes = new Map([['shared.puml', 'not found']]);
    const panel = makePanel();
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve({ svg, failedIncludes, dependencies: [] })) });
    const viewer = new DiagramViewer(panel, deps, 'one', 'file:///one.puml');

    await viewer.show(['@startuml', '!include shared.puml', 'Alice -> Bob', '@enduml'].join('\n'), 0);

    expect(panel.sent.at(-1)).toEqual({
      type: 'status',
      text: 'engine: cannot include shared.puml: not found @ 2',
      error: true,
      clear: false,
      spoken: 'engine: cannot include shared.puml: not found @ 2',
    });
  });

  it('shows a translated warning alongside the palette notice', async () => {
    const svg = readFileSync(join(__dirname, 'fixtures/engine-output/warning.svg'), 'utf8');
    const panel = makePanel();
    const deps = makeDeps({
      render: () => Promise.resolve(svg),
      resolvePalette: () => Promise.resolve(true),
    });
    deps.labels.errorMessage = () => '行末に <<#pink>> を追加してください。';
    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\nA -> B\n@enduml', 0);
    expect(panel.sent.at(-1)).toMatchObject({
      type: 'status',
      text: '行末に <<#pink>> を追加してください。 other palette true',
      error: false,
      clear: false,
    });
  });

  it('says in the status what the engine drew the diagram without', async () => {
    const panel = makePanel();
    const viewer = new DiagramViewer(panel, makeDeps(), 'one', 'file:///one.puml');

    await viewer.show(
      ['@startuml', 'A -> B : <math>x</math>', 'note left', '{{', 'C -> D', '}}', 'end note', 'A -> B : <img:pic.png>', '@enduml'].join('\n'),
      0
    );

    expect(panel.sent.at(-1)).toEqual({
      type: 'status',
      text: 'formula <math> embedded image',
      error: false,
      clear: false,
      spoken: 'rendered one formula <math> embedded image',
    });
  });

  it('names an emoji as the reason when the engine fails on one', async () => {
    const panel = makePanel();
    const deps = makeDeps({
      render: vi.fn(() => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js'))),
    });

    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\nA -> B : <:smile:>\n@enduml', 0);

    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'emoji', error: true, clear: true, spoken: 'emoji' });
  });

  it('drops a drawing that finishes after a newer one was asked for', async () => {
    let finishFirst: (svg: string) => void = () => undefined;
    const render = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
      .mockImplementation((source: string) => Promise.resolve(`<svg>${source}</svg>`));
    const panel = makePanel();
    const viewer = new DiagramViewer(panel, makeDeps({ render }), 'one', 'file:///one.puml');

    const first = viewer.show('@startuml\nold\n@enduml', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await viewer.update('@startuml\nnew\n@enduml');
    finishFirst('<svg>old</svg>');
    await first;

    expect(of(panel.sent, 'render')).toEqual([
      // The lone diagram of a file goes by the file's name.
      { type: 'render', svg: '<svg>@startuml\nnew\n@enduml</svg>', backdrop: '#FFFFFF', key: 'one', label: 'one' },
    ]);
  });
});

describe('DiagramViewer not updated', () => {
  it('keeps the diagram, saying it is not updated, also when a drawing lands afterwards', async () => {
    let finish: (svg: string) => void = () => undefined;
    const render = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)))
      .mockImplementation((source: string) => Promise.resolve(`<svg>${source}</svg>`));
    const panel = makePanel();
    const viewer = new DiagramViewer(panel, makeDeps({ render }), 'one', 'file:///one.puml');

    const drawing = viewer.show('@startuml\nold\n@enduml', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await viewer.stale('not updated');
    finish('<svg>old</svg>');
    await drawing;

    expect(of(panel.sent, 'render')).toHaveLength(1);
    // As it is told, and once the drawing lands, with it.
    expect(of(panel.sent, 'status').slice(-2)).toEqual([
      { type: 'status', text: 'not updated', error: false, clear: false, spoken: 'not updated' },
      { type: 'status', text: 'not updated', error: false, clear: false, spoken: 'rendered one not updated' },
    ]);

    // Drawn again, as on a save: the note goes.
    await viewer.update('@startuml\nnew\n@enduml');
    expect(of(panel.sent, 'status').at(-1)).toEqual({ type: 'status', text: '', error: false, clear: false, spoken: 'rendered one' });
  });
});

describe('viewerBody', () => {
  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const copy = {
    text: 'Copy',
    label: 'Copy Diagram as PNG',
    copying: 'Copying…',
    copied: 'Copied.',
    failed: 'Could not copy: {0}',
    unmade: 'No PNG.',
    unwritten: 'Not taken.',
  };

  it('has a toolbar whose buttons name what they do and the key that does it too', () => {
    const body = viewerBody(
      {
        selectDiagram: 'Select a diagram',
        toolbar: 'Diagram zoom',
        zoomOut: 'Zoom Out',
        zoomIn: 'Zoom In',
        fit: 'Fit to Window',
        actualSize: 'Actual Size',
        zoomLevel: 'Zoom {0}',
        exportPng: 'Export Diagram as PNG',
        copySvgText: 'Copy Diagram as SVG Text',
        copy,
      },
      escape
    );

    expect(body).toContain('<div id="tools" role="toolbar" aria-label="Diagram zoom">');
    expect(body).toContain('<button id="zoom-out" type="button" aria-label="Zoom Out" title="Zoom Out (-)">−</button>');
    // The zoom shown between them, with what the page tells a screen reader of it.
    expect(body).toContain('</button><span id="zoom" data-spoken="Zoom {0}"></span><button id="zoom-in"');
    expect(body).toContain('<button id="zoom-in" type="button" aria-label="Zoom In" title="Zoom In (+)">+</button>');
    // Fit is a toggle, pressed while the diagram is fitted.
    expect(body).toContain('<select id="diagrams" aria-label="Select a diagram" hidden>');
    expect(body).toContain('<button id="fit" type="button" aria-label="Fit to Window" title="Fit to Window (0)" aria-pressed="true">Fit to Window</button>');
    expect(body).toContain('<button id="actual" type="button" aria-label="Actual Size" title="Actual Size (1)">100%</button>');
    // Beside the zoom, not in it, and kept together: the PNG button, then
    // Copy, which carries what the page says of a copy, then Copy SVG.
    expect(body).toContain('<div id="bar"><div id="tools" role="toolbar"');
    expect(body).toContain(
      '</div><div id="actions"><button id="export-png" type="button" aria-label="Export Diagram as PNG" title="Export Diagram as PNG">PNG</button>' +
        '<button id="copy-png" type="button" aria-label="Copy Diagram as PNG" title="Copy Diagram as PNG"' +
        ' data-copying="Copying…" data-copied="Copied." data-failed="Could not copy: {0}" data-unmade="No PNG." data-unwritten="Not taken.">Copy</button>' +
        '<button id="copy-svg" type="button" aria-label="Copy Diagram as SVG Text" title="Copy Diagram as SVG Text">Copy SVG</button></div></div></header>'
    );
    expect(body).toContain('<main id="stage" tabindex="0" aria-describedby="status">');
  });

  it('reads out only what the page tells a screen reader, through two regions that take turns', () => {
    const body = viewerBody(
      {
        selectDiagram: 'Select a diagram',
        toolbar: 'Diagram zoom',
        zoomOut: 'Zoom Out',
        zoomIn: 'Zoom In',
        fit: 'Fit to Window',
        actualSize: 'Actual Size',
        zoomLevel: 'Zoom {0}',
        exportPng: 'Export Diagram as PNG',
        copySvgText: 'Copy Diagram as SVG Text',
        copy,
      },
      escape
    );

    // The status line shows a drawing under way, so it is not read out as
    // it changes; nor is the zoom, which fitting changes as the file does.
    expect(body).toContain('<header><select id="diagrams" aria-label="Select a diagram" hidden></select><span id="status"></span>');
    expect(body).not.toContain('aria-live');
    expect(body.match(/role="status"/g)).toHaveLength(2);
    expect(body).toContain('</main><div id="announcer"><div role="status"></div><div role="status"></div></div>');
  });

  it('escapes the labels it is given', () => {
    const body = viewerBody(
      {
        selectDiagram: 'a"&b',
        toolbar: '"><script>',
        zoomOut: 'a&b',
        zoomIn: 'in',
        fit: '<b>',
        actualSize: 'x',
        zoomLevel: '<kbd>{0}',
        exportPng: '<i>',
        copySvgText: '<svg>',
        copy: { text: '<u>', label: '"><s>', copying: '<em>', copied: '"x"', failed: '<q>{0}', unmade: '<p>', unwritten: '<ol>' },
      },
      escape
    );

    for (const tag of ['<script>', '<b>', '<i>', '<u>', '<s>', '<em>', '<q>', '<p>', '<ol>', '<kbd>']) {
      expect(body).not.toContain(tag);
    }
    expect(body).toContain('data-spoken="&lt;kbd&gt;{0}"');
    expect(body).toContain('data-copied="&quot;x&quot;"');
    expect(body).toContain('aria-label="&quot;&gt;&lt;script&gt;"');
    expect(body).toContain('aria-label="a&amp;b"');
    expect(body).toContain('<select id="diagrams" aria-label="a&quot;&amp;b"');
  });
});

describe('DiagramViewer and the files its diagram includes', () => {
  it('tells whether changed files are ones the diagram shown includes', async () => {
    const panel = makePanel();
    const deps = makeDeps({
      render: () =>
        Promise.resolve({ svg: '<svg/>', failedIncludes: new Map(), dependencies: ['/ws/docs/common.puml'] }),
    });
    const viewer = new DiagramViewer(panel, deps, 'one', 'file:///one.puml');
    // Nothing drawn yet: nothing to depend on.
    expect(viewer.dependsOn(new Map([['/ws/docs/common.puml', true]]))).toBe('none');

    await viewer.show('@startuml\n!include common.puml\n@enduml', 0);
    expect(viewer.dependsOn(new Map([['/ws/docs/common.puml', false]]))).toBe('edited');
    expect(viewer.dependsOn(new Map([['/ws/docs/common.puml', true]]))).toBe('saved');
    expect(viewer.dependsOn(new Map([['/ws/docs/other.puml', true]]))).toBe('none');
  });
});

describe('DiagramViewer and the palette', () => {
  it('says so when the diagram is drawn in the palette other than the one asked for', async () => {
    const panel = makePanel();
    const deps = makeDeps({ isDark: () => true, resolvePalette: () => Promise.resolve(false) });
    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\n!theme plain\nA -> B\n@enduml', 0);
    expect(panel.sent.at(-1)).toEqual({
      type: 'status',
      text: 'other palette false',
      error: false,
      clear: false,
      spoken: 'rendered one other palette false',
    });
  });

  it('says nothing when it is drawn as asked', async () => {
    const panel = makePanel();
    const deps = makeDeps({ isDark: () => true });
    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\nA -> B\n@enduml', 0);
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: '', error: false, clear: false, spoken: 'rendered one' });
  });
});

describe('DiagramViewer and screen readers', () => {
  /** An SVG with the title the engine draws for `title Order\nflow`, on two lines. */
  const TITLED =
    '<svg><g><g class="title"><text x="10" y="21.2">Order</text><text x="10" y="37.5">flow</text></g>' +
    '<text x="5" y="60">A</text></g></svg>';

  it('names the diagram by the title it draws, else by its name, else by its place in the file', async () => {
    const titled = makePanel();
    const deps = makeDeps({ render: (source) => Promise.resolve(source.includes('A -> B') ? TITLED : `<svg>${source}</svg>`) });
    const viewer = new DiagramViewer(titled, deps, 'flows', 'file:///flows.puml');

    await viewer.show(FLOWS, 0);
    expect(of(titled.sent, 'render').at(-1)).toMatchObject({ key: 'orders', label: 'Order flow' });
    await viewer.receive({ type: 'select', index: 1 }, FLOWS);
    expect(of(titled.sent, 'render').at(-1)).toMatchObject({ key: '#1', label: 'Diagram 2 of flows' });

    // An untitled diagram with a name goes by it, as a lone one goes by the file's.
    const named = makePanel();
    await new DiagramViewer(named, makeDeps(), 'flows', 'file:///flows.puml').show(FLOWS, 0);
    expect(of(named.sent, 'render').at(-1)).toMatchObject({ label: 'orders' });
    const lone = makePanel();
    await new DiagramViewer(lone, makeDeps(), 'one', 'file:///one.puml').show('@startuml\nX -> Y\n@enduml', 0);
    expect(of(lone.sent, 'render').at(-1)).toMatchObject({ label: 'one' });
  });

  it('names a diagram the engine drew as an error by its name, as the error has no title', async () => {
    const svg = readFileSync(join(__dirname, 'fixtures/engine-output/syntax-error.svg'), 'utf8');
    const panel = makePanel();
    const source = ['@startuml(id=first)', 'title Broken', 'this is not valid ;;; [[[', '@enduml'].join('\n');
    await new DiagramViewer(panel, makeDeps({ render: () => Promise.resolve(svg) }), 'one', 'file:///one.puml').show(source, 0);

    expect(of(panel.sent, 'render').at(-1)).toMatchObject({ label: 'first' });
  });

  it('has the page tell a screen reader what the drawing came to, and nothing while it is under way', async () => {
    const panel = makePanel();
    const deps = makeDeps({ render: () => Promise.resolve(TITLED) });
    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\ntitle Order\\nflow\nA -> B\n@enduml', 0);

    expect(of(panel.sent, 'status')).toEqual([
      { type: 'status', text: 'rendering', error: false, clear: false, spoken: null },
      { type: 'status', text: '', error: false, clear: false, spoken: 'rendered Order flow' },
    ]);
  });
});
