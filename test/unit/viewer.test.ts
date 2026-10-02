import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

function makeDeps(overrides?: Partial<ViewerDeps>): ViewerDeps & { render: ReturnType<typeof vi.fn> } {
  return {
    render: vi.fn((source: string) => Promise.resolve(`<svg>${source}</svg>`)),
    resolvePalette: (_source: string, dark: boolean) => Promise.resolve(dark),
    isDark: () => false,
    labels: {
      diagram: (position) => `Diagram ${String(position)}`,
      entry: (name, line) => `${name} (line ${String(line)})`,
      rendering: 'rendering',
      gone: 'gone',
      choose: 'choose',
      empty: 'empty',
      remoteReference: 'remote',
      emojiUnavailable: 'emoji',
      pages: 'pages',
      engineError: (message, line) => `engine: ${message} @ ${String(line)}`,
    },
    ...overrides,
  } as ViewerDeps & { render: ReturnType<typeof vi.fn> };
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
  it('accepts a ready page and a choice among the diagrams', () => {
    expect(parseRequest({ type: 'ready' }, 2)).toEqual({ type: 'ready' });
    expect(parseRequest({ type: 'select', index: 1 }, 2)).toEqual({ type: 'select', index: 1 });
  });

  it('ignores anything else the page sends', () => {
    for (const message of [
      null,
      'ready',
      { type: 'select', index: 2 },
      { type: 'select', index: -1 },
      { type: 'select', index: 0.5 },
      { type: 'select', index: '0' },
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
      },
    ]);
    // The last word is an empty status: drawn and current.
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: '', error: false, clear: false });
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
    expect(deps.render).toHaveBeenLastCalledWith('@startuml\nC -> D : unnamed\n@enduml', false);

    panel.sent.length = 0;
    await viewer.receive({ type: 'select', index: 7 }, FLOWS);
    await viewer.receive({ type: 'reveal', line: 3 }, FLOWS);
    expect(panel.sent).toEqual([]);
  });

  it('follows a named diagram when diagrams move about', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    await viewer.show(FLOWS, 0);

    // A diagram inserted above: the one shown is still `orders`.
    await viewer.update(`@startuml(id=first)\nX -> Y\n@enduml\n${FLOWS}`);

    expect(deps.render).toHaveBeenLastCalledWith('@startuml(id=orders)\nA -> B : orders\n@enduml', false);
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

    expect(deps.render).toHaveBeenCalledWith('@startuml(id=orders)\nA -> B : orders\n@enduml', false);
  });

  it('asks for a choice after a restart when the diagram had no name', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');

    viewer.restore(null);
    await viewer.receive({ type: 'ready' }, FLOWS);

    expect(deps.render).not.toHaveBeenCalled();
    expect(of(panel.sent, 'diagrams')[0]).toMatchObject({ selected: -1 });
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'choose', error: false, clear: true });

    // Picking one from the list draws it.
    await viewer.receive({ type: 'select', index: 1 }, FLOWS);
    expect(deps.render).toHaveBeenCalledWith('@startuml\nC -> D : unnamed\n@enduml', false);
  });

  it('says so when the diagram shown has gone, rather than showing another', async () => {
    const panel = makePanel();
    const deps = makeDeps();
    const viewer = new DiagramViewer(panel, deps, 'flows', 'file:///flows.puml');
    await viewer.show(FLOWS, 0);
    deps.render.mockClear();

    await viewer.update('@startuml(id=billing)\nE -> F\n@enduml');

    expect(deps.render).not.toHaveBeenCalled();
    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'gone', error: true, clear: true });
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
      expect(panel.sent.at(-1)).toEqual({ type: 'status', text: reason, error: true, clear: true });
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
    });
  });

  it('names an emoji as the reason when the engine fails on one', async () => {
    const panel = makePanel();
    const deps = makeDeps({
      render: vi.fn(() => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js'))),
    });

    await new DiagramViewer(panel, deps, 'one', 'file:///one.puml').show('@startuml\nA -> B : <:smile:>\n@enduml', 0);

    expect(panel.sent.at(-1)).toEqual({ type: 'status', text: 'emoji', error: true, clear: true });
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
      { type: 'render', svg: '<svg>@startuml\nnew\n@enduml</svg>', backdrop: '#FFFFFF', key: 'one' },
    ]);
  });
});

describe('viewerBody', () => {
  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  it('has a toolbar whose buttons name what they do and the key that does it too', () => {
    const body = viewerBody(
      { toolbar: 'Zoom', zoomOut: 'Zoom Out', zoomIn: 'Zoom In', fit: 'Fit', actualSize: 'Actual Size' },
      escape
    );

    expect(body).toContain('<div id="tools" role="toolbar" aria-label="Zoom">');
    expect(body).toContain('<button id="zoom-out" type="button" aria-label="Zoom Out" title="Zoom Out (-)">−</button>');
    expect(body).toContain('<button id="zoom-in" type="button" aria-label="Zoom In" title="Zoom In (+)">+</button>');
    // Fit is a toggle, pressed while the diagram is fitted.
    expect(body).toContain('<button id="fit" type="button" aria-label="Fit" title="Fit (0)" aria-pressed="true">Fit</button>');
    expect(body).toContain('<button id="actual" type="button" aria-label="Actual Size" title="Actual Size (1)">100%</button>');
    expect(body).toContain('<main id="stage" tabindex="0">');
  });

  it('escapes the labels it is given', () => {
    const body = viewerBody(
      { toolbar: '"><script>', zoomOut: 'a&b', zoomIn: 'in', fit: '<b>', actualSize: 'x' },
      escape
    );

    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<b>');
    expect(body).toContain('aria-label="&quot;&gt;&lt;script&gt;"');
    expect(body).toContain('aria-label="a&amp;b"');
  });
});
