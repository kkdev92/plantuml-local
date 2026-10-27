import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NAMED_COLORS, findColors } from '../../src/core/colors';
import { EMOJI_UNAVAILABLE } from '../../src/core/constants';
import type { RenderResponseMessage } from '../../src/core/types';
import { expandSnippet, SNIPPETS, TEMPLATES } from '../../src/language/completion';
import { diagramKind, type DiagramKind } from '../../src/language/diagram-kind';
import { protect } from '../../src/language/protected';
import { recognizeEngineError } from '../../src/render/engine-error';
import { drawnTitle } from '../../src/render/title';
import {
  choosePalette,
  labelContrast,
  lightenLinks,
  MIN_DRAWN_CONTRAST,
  MIN_TEXT_CONTRAST,
  probeSource,
  ThemePalettes,
  weakestTextContrast,
} from '../../src/render/palette';

/**
 * Runs the built dist/worker.js as-is — WASM Graphviz, DOM shims and all.
 * Passing here means diagrams render with no Java and no network.
 * Requires `npm run bundle` (the npm test script does this).
 */
const workerPath = join(__dirname, '../../dist/worker.js');

let worker: Worker;
let nextId = 1;
const pending = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void }>();

function render(source: string, dark = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, source, dark });
  });
}

beforeAll(() => {
  expect(existsSync(workerPath), 'dist/worker.js missing — run `npm run bundle` first').toBe(true);
  worker = new Worker(workerPath);
  worker.on('message', (message: RenderResponseMessage) => {
    const entry = pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
    } else {
      entry.resolve(message.svg ?? '');
    }
  });
});

afterAll(async () => {
  await worker.terminate();
});

describe('render worker (dist)', () => {
  it('renders a use-case diagram with Graphviz layout', async () => {
    const svg = await render(
      [
        '@startuml',
        'left to right direction',
        'actor "Guest" as Guest',
        'actor "Admin" as Admin',
        'rectangle "Product" {',
        '  usecase "Browse items" as View',
        '  usecase "Invite members" as Invite',
        '}',
        'Guest --> View',
        'Admin --> Invite',
        '@enduml',
      ].join('\n')
    );

    expect(svg).toMatch(/<svg/);
    expect(svg).toContain('Browse items');
    expect(svg).toContain('Invite members');
    // Ellipses only appear when the Graphviz (WASM) layout ran.
    expect(svg).toMatch(/<ellipse/);
  });

  it('renders a sequence diagram', async () => {
    const svg = await render('@startuml\nUser -> System : add item\nSystem --> User : done\n@enduml');
    expect(svg).toMatch(/<svg/);
    expect(svg).toContain('add item');
  });

  it('renders a state diagram', async () => {
    const svg = await render('@startuml\n[*] --> Draft\nDraft --> Confirmed : approve\n@enduml');
    expect(svg).toMatch(/<svg/);
    expect(svg).toContain('Draft');
  });

  it('renders CJK (full-width) labels without corruption', async () => {
    // CJK characters are the one fixture that cannot be expressed in
    // ASCII: they exercise the full-width branch of the text metrics.
    const svg = await render('@startuml\nactor "利用者" as U\nU -> B : 追加\n@enduml');
    expect(svg).toMatch(/<svg/);
    expect(svg).toContain('利用者');
    expect(svg).toContain('追加');
  });

  it('renders many diagrams back to back without mixing results', async () => {
    const sources = [1, 2, 3, 4, 5].map(
      (n) => `@startuml\nA${String(n)} -> B${String(n)} : m${String(n)}\n@enduml`
    );
    const results = await Promise.all(sources.map((source) => render(source)));

    expect(results).toHaveLength(5);
    for (const [index, svg] of results.entries()) {
      expect(svg).toMatch(/<svg/);
      // Serialisation guarantees each result carries its own label.
      expect(svg).toContain(`m${String(index + 1)}`);
    }
  });

  it('reads a diagram the same way whatever was rendered before it', async () => {
    // Ten lines of messages read as a sequence diagram — the engine's
    // first choice — and as a class diagram. The engine tries the diagram
    // type of the previous render first, for sources of ten lines or more.
    const messages = [
      '@startuml',
      'Alice -> Bob : request',
      'Bob -> Carol : forward',
      'Carol -> Dave : lookup',
      'Dave -> Carol : result',
      'Carol -> Bob : answer',
      'Bob -> Alice : response',
      'Alice -> Eve : notify',
      'Eve -> Alice : ack',
      '@enduml',
    ].join('\n');

    await render('@startuml\nAlice -> Bob : hi\n@enduml');
    const afterSequence = await render(messages);
    await render('@startuml\nclass Order\nclass Line\nOrder --> Line\n@enduml');
    const afterClass = await render(messages);

    expect(afterClass).toBe(afterSequence);
  });

  it('returns syntax errors as a diagram and keeps rendering afterwards', async () => {
    const broken = await render('@startuml\n@@@ not valid @@@\n@enduml');
    expect(broken).toMatch(/<svg/);
    expect(broken).toMatch(/Syntax Error|Error/i);

    const next = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(next).toMatch(/<svg/);
    expect(next).toContain('Hello');
  });

  // How the engine reads the shape of its input. The preview, the export and
  // the error messages are built around this, so it is re-checked on every
  // engine update. Upstream's TextareaSource (from 1.2026.9) ignores lines
  // before @startuml, puts one in front of a source without it, closes a
  // diagram that has no @enduml, and reads a start line only with `@`. When
  // an update fails here, take the new behaviour on purpose: adjust these,
  // src/core/shape.ts and the export tests, and say what changes for users in
  // the changelog.
  describe('the shape of the input (re-check on every engine update)', () => {
    it('draws only the first of two diagrams in one source', async () => {
      const svg = await render('@startuml\nAlice -> Bob : first\n@enduml\n@startuml\nCarol -> Dave : second\n@enduml');
      expect(svg).toContain('first');
      expect(svg).not.toContain('second');
    });

    it('draws only the first page of a diagram with newpage', async () => {
      const svg = await render('@startuml\nAlice -> Bob : page1\nnewpage\nCarol -> Dave : page2\n@enduml');
      expect(svg).toContain('page1');
      expect(svg).not.toContain('page2');
    });

    it('does not end a diagram at an @enduml in a block comment or a string', async () => {
      const comment = await render("@startuml\nAlice -> Bob : before\n/'\n@enduml\n'/\nCarol -> Dave : after\n@enduml");
      expect(comment).toContain('after');
      const string = await render('@startuml\nAlice -> Bob : "@enduml"\nCarol -> Dave : after\n@enduml');
      expect(string).toContain('after');
    });

    it('draws a source with a line before @startuml, without that line', async () => {
      const svg = await render('title Before\n@startuml\nAlice -> Bob : x\n@enduml');
      expect(svg).toContain('Alice');
      expect(svg).not.toContain('Before');
    });

    it('draws a source without @startuml as a diagram', async () => {
      const svg = await render('Alice -> Bob : no start line');
      expect(svg).toContain('no start line');
      expect(svg).not.toContain('Diagram not supported');
    });

    it('closes a diagram that has no @enduml', async () => {
      const svg = await render('@startuml\nAlice -> Bob : open');
      expect(svg).toContain('open');
    });

    it('does not read \\startuml as a start line', async () => {
      const svg = await render('\\startuml\nAlice -> Bob : x\n\\enduml');
      expect(svg).toMatch(/Syntax Error/);
    });
  });

  it('strips scripts and event handlers from the SVG', async () => {
    const svg = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+=/i);
  });

  it('keeps nothing of the source that the picture does not show', async () => {
    // The engine embeds the source in a plantuml-src processing instruction
    // and tags elements with their names — aliases and hidden ones included.
    const svg = await render(
      [
        '@startuml',
        "' zq-line-comment",
        "/' zq-block-comment '/",
        '!$unused = "zq-variable"',
        'class "Order Service" as zq_alias',
        'class Customer',
        'class zq_hidden',
        'Customer --> zq_alias',
        'hide zq_hidden',
        '@enduml',
      ].join('\n')
    );

    // What is drawn stays.
    expect(svg).toContain('Order Service');
    expect(svg).toContain('Customer');
    // What is not drawn is gone, and so is what carried it.
    expect(svg).not.toMatch(/zq[-_]/);
    expect(svg).not.toMatch(/<\?|<!--/);
    expect(svg).not.toMatch(/\sdata-/);
  });

  it('keeps the label of a link and nothing of where it leads', async () => {
    // The engine wraps what a link draws in an <a> whose title repeats the target.
    const svg = await render(
      ['@startuml', 'participant Carol [[https://zq.example/c]]', 'Alice -> Carol : [[https://zq.example/b go]]', '@enduml'].join(
        '\n'
      )
    );

    expect(svg).toContain('Carol');
    expect(svg).toContain('go');
    expect(svg).not.toContain('zq.example');
    expect(svg).not.toMatch(/<a\b/);
  });

  it('writes the characters XML does not allow as U+FFFD, in labels and in tooltips', async () => {
    // One of them makes the whole file unreadable as XML (see sanitizeSvg).
    const svg = await render(
      ['@startuml', 'Alice -> Bob : [[#target{TIP(\u0001)} LNK(\u000b)]]', 'Bob -> Alice : NON[\uffff]', 'note right: NUL[\u0000]', '@enduml'].join(
        '\n'
      )
    );

    expect(svg).toContain('title="TIP(\ufffd)"');
    expect(svg).toContain('LNK(\ufffd)');
    expect(svg).toContain('NON[\ufffd]');
    expect(svg).toContain('NUL[\ufffd]');
    expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u);
  });

  it('produces different output in dark mode', async () => {
    const light = await render('@startuml\nAlice -> Bob : Hello\n@enduml', false);
    const dark = await render('@startuml\nAlice -> Bob : Hello\n@enduml', true);
    expect(light).not.toBe(dark);
  });

  it('contains no external rendering service URLs', async () => {
    const svg = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(svg).not.toMatch(/plantuml\.com|kroki|unpkg|jsdelivr/i);
  });

  describe('themes, icons and emoji', () => {
    /** The fill colours an SVG uses. */
    function fills(svg: string): Set<string> {
      return new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{3,8})"/g)].map((m) => m[1] ?? ''));
    }

    it('applies a !theme from the bundled theme library', async () => {
      const plain = fills(await render('@startuml\nAlice -> Bob : Hello\n@enduml'));
      const themed = fills(await render('@startuml\n!theme cerulean\nAlice -> Bob : Hello\n@enduml'));
      expect([...themed].filter((colour) => !plain.has(colour))).not.toEqual([]);
    });

    /** The licence each theme's header declares, from a script that fills PLANTUML_THEMES. */
    function themeLicences(path: string): Map<string, string> {
      const sandbox: { PLANTUML_THEMES?: Record<string, string> } = {};
      runInNewContext(readFileSync(path, 'utf8'), sandbox);
      const licences = new Map<string, string>();
      for (const [name, text] of Object.entries(sandbox.PLANTUML_THEMES ?? {})) {
        const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        licences.set(name, /^license:[ \t]*(.*)$/m.exec(header)?.[1]?.trim() ?? '');
      }
      return licences;
    }

    it("ships only the themes under MIT or PlantUML's own", () => {
      const shipped = themeLicences(join(__dirname, '../../dist/engine/themes.cjs'));
      expect(shipped.size).toBeGreaterThan(0);
      expect([...shipped].filter(([, licence]) => licence !== '' && licence !== 'MIT')).toEqual([]);

      // The package's own library does hold themes under other licences, so
      // the filter in scripts/build.mjs is doing something.
      const all = themeLicences(createRequire(__filename).resolve('@plantuml/core/themes.js'));
      expect([...all.keys()].filter((name) => !shipped.has(name))).not.toEqual([]);
    });

    it('reports a theme that is not shipped the way the engine reports an unknown one', async () => {
      const svg = await render('@startuml\n!theme sunlust\nAlice -> Bob : Hello\n@enduml');
      expect(svg).toContain('Cannot load theme sunlust');
    });

    it('draws a themed diagram in a palette its theme can be read in', async () => {
      const palettes = new ThemePalettes(render);
      const themed = (name: string): string =>
        `@startuml\n!theme ${name}\nAlice -> Bob : Hello\n@enduml`;

      // Made for a white page: dark text and no background of its own.
      expect(await palettes.resolve(themed('plain'), true)).toBe(false);
      expect(await palettes.resolve(themed('plain'), false)).toBe(false);
      // Made for a dark page: white text and no background of its own.
      expect(await palettes.resolve(themed('cyborg'), false)).toBe(true);
      expect(await palettes.resolve(themed('cyborg'), true)).toBe(true);
      // Paints its own background: the same in either palette.
      expect(await palettes.resolve(themed('blueprint'), true)).toBe(true);
      expect(await palettes.resolve(themed('blueprint'), false)).toBe(false);
      // No theme, or one the engine cannot load: as asked.
      expect(await palettes.resolve('@startuml\nAlice -> Bob : Hello\n@enduml', true)).toBe(true);
      expect(await palettes.resolve(themed('sunlust'), true)).toBe(true);
    });

    it('never picks the palette a bundled theme is harder to read in', async () => {
      const names = [...themeLicences(join(__dirname, '../../dist/engine/themes.cjs')).keys()];
      expect(names.length).toBeGreaterThan(30);

      for (const name of names) {
        const probe = probeSource([`!theme ${name}`]);
        const light = labelContrast(await render(probe, false), false);
        const dark = labelContrast(await render(probe, true), true);
        // The probe's label is found for every theme, so each one is measured.
        expect(light, name).toBeDefined();
        expect(dark, name).toBeDefined();
        const measured = { light: light ?? 0, dark: dark ?? 0 };
        const reachable = Math.min(MIN_TEXT_CONTRAST, Math.max(measured.light, measured.dark));
        for (const asked of [false, true]) {
          const used = choosePalette(asked, measured) ? measured.dark : measured.light;
          expect(used, `${name}, ${asked ? 'dark' : 'light'} asked`).toBeGreaterThanOrEqual(reachable);
        }
      }
    });

    it('renders an OpenIconic icon', async () => {
      const plain = await render('@startuml\nAlice -> Bob : done\n@enduml');
      const icon = await render('@startuml\nAlice -> Bob : <&check> done\n@enduml');
      expect(icon.split('<path').length).toBeGreaterThan(plain.split('<path').length);
    });

    it('fails a diagram with an emoji with the error the extension explains', async () => {
      // The emoji images are not bundled; the preview and the export turn
      // this error into a message of their own.
      await expect(render('@startuml\nAlice -> Bob : <:smile:> hi\n@enduml')).rejects.toThrow(EMOJI_UNAVAILABLE);
    });
  });

  describe('the colours a diagram sets itself (re-check on every engine update)', () => {
    const diagram = (...lines: string[]): string => ['@startuml', ...lines, '@enduml'].join('\n');
    const inDark = async (source: string): Promise<number | undefined> =>
      weakestTextContrast(lightenLinks(await render(source, true)), true);

    it.each([
      ['a skinparam', ['skinparam participantBackgroundColor #DDEEFF', 'Alice -> Bob : hello']],
      ['a style', ['<style>', 'participant {', '  BackgroundColor #DDEEFF', '}', '</style>', 'Alice -> Bob : hello']],
      ['a colour on a participant', ['participant Alice #DDEEFF', 'Alice -> Bob : hello']],
      ['a colour on a class', ['class Foo #pink', 'class Bar', 'Foo --> Bar']],
      ['a colour on a use case', ['actor User', 'usecase (Do it) as UC #LightBlue', 'User --> UC']],
    ])('finds %s made for a white page hard to read in the dark palette, and easier in the light one', async (_what, lines) => {
      const source = diagram(...lines);
      const dark = (await inDark(source)) ?? Infinity;
      expect(dark).toBeLessThan(MIN_DRAWN_CONTRAST);
      expect(weakestTextContrast(await render(source, false), false)).toBeGreaterThan(dark);
    });

    it.each([
      ['a sequence', ['participant A', 'group Group', 'A -> B : message', 'ref over A, B : ref', 'end', '== Divider ==', 'note over A : note']],
      ['a header, a footer and a legend', ['header Header', 'footer Footer', 'title Title', 'legend', 'Legend', 'endlegend', 'A -> B']],
      ['a class', ['abstract class Abs', 'interface If', 'enum En {', 'ONE', '}', 'class Cls <<stereo>>', 'Abs <|-- Cls', 'note "note" as N']],
      ['an activity', ['start', 'partition Part {', ':step;', '}', 'if (test?) then (yes)', ':yes;', 'else (no)', ':no;', 'endif', 'note right: note', 'stop']],
      ['a component', ['package "Package" {', '[Component] as C', '}', 'node Node', 'database DB', 'cloud Cloud', 'C --> DB : uses', 'actor User', 'usecase (Use)']],
      ['a timing', ['robust "Web" as WB', 'concise "User" as WU', '@0', 'WU is Idle', 'WB is Idle', '@100', 'WU is Waiting', 'WB is Processing']],
    ])('leaves %s in the engine’s own colours in the dark palette, drawn once', async (_what, lines) => {
      expect(await inDark(diagram(...lines))).toBeGreaterThanOrEqual(MIN_DRAWN_CONTRAST);
    });

    it('leaves a Gantt chart, whose closed days are the faintest, in the dark palette', async () => {
      const gantt = '@startgantt\nProject starts 2026-01-01\n[Task] lasts 5 days\nsaturday are closed\n@endgantt';
      expect(await inDark(gantt)).toBeGreaterThanOrEqual(MIN_DRAWN_CONTRAST);
    });

    it('draws links, which the engine keeps blue in the dark palette, in a colour that reads there', async () => {
      const svg = await render(
        diagram('Alice -> Bob : see [[https://example.com docs]]', 'note right of Bob', '[[https://example.com in a note]]', 'end note'),
        true
      );
      expect(svg).toMatch(/fill="#0000FF"[^>]*text-decoration="underline"/);
      expect(weakestTextContrast(svg, true)).toBeLessThan(MIN_DRAWN_CONTRAST);
      expect(weakestTextContrast(lightenLinks(svg), true)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });
  });

  describe('the bundled C4 library (re-check on every engine or library update)', () => {
    const diagram = (...lines: string[]): string => ['@startuml', ...lines, '@enduml'].join('\n');
    /** The texts a drawing shows, in order, entities decoded. */
    const texts = (svg: string): string[] =>
      [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(([, text]) =>
        (text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      );
    /** What a drawing reads as: the engine writes each word of a label as a text of its own. */
    const shownIn = (svg: string): string => texts(svg).join(' ').replace(/\s+/g, ' ');
    const EXAMPLES: Record<string, string[]> = {
      C4_Context: [
        'Person(customer, "Customer", "Buys things")',
        'System(shop, "Online shop", "Takes orders")',
        'System_Ext(mail, "Mail service", "Sends email")',
        'Rel(customer, shop, "Places orders", "HTTPS")',
        'Rel(shop, mail, "Sends confirmations", "SMTP")',
      ],
      C4_Container: [
        'Person(customer, "Customer")',
        'System_Boundary(shop, "Online shop") {',
        '  Container(web, "Web app", "TypeScript", "Serves the shop")',
        '  ContainerDb(db, "Database", "PostgreSQL", "Holds orders")',
        '}',
        'Rel(customer, web, "Places orders", "HTTPS")',
        'Rel(web, db, "Reads and writes", "SQL")',
      ],
      C4_Component: [
        'Container_Boundary(api, "API") {',
        '  Component(orders, "Orders", "Controller", "Handles orders")',
        '  Component(repository, "Repository", "Data access")',
        '}',
        'ContainerDb(db, "Database", "PostgreSQL")',
        'Rel(orders, repository, "Uses")',
        'Rel(repository, db, "Reads and writes", "SQL")',
      ],
      C4_Dynamic: [
        'Person(customer, "Customer")',
        'Container(web, "Web app", "TypeScript")',
        'ContainerDb(db, "Database", "PostgreSQL")',
        'Rel(customer, web, "Submits an order")',
        'Rel(web, db, "Stores the order")',
      ],
      C4_Deployment: [
        'Deployment_Node(cloud, "Cloud", "Region") {',
        '  Deployment_Node(vm, "Virtual machine", "Linux") {',
        '    Container(web, "Web app", "TypeScript")',
        '  }',
        '  Deployment_Node(server, "Database server", "Managed") {',
        '    ContainerDb(db, "Database", "PostgreSQL")',
        '  }',
        '}',
        'Rel(web, db, "Reads and writes", "SQL")',
      ],
      C4_Sequence: [
        'Person(customer, "Customer")',
        'Container_Boundary(shop, "Online shop")',
        '  Container(web, "Web app", "TypeScript")',
        '  ContainerDb(db, "Database", "PostgreSQL")',
        'Boundary_End()',
        'Rel(customer, web, "Submits an order")',
        'Rel(web, db, "Stores the order")',
      ],
    };
    /** The labels of an example, each of which the drawing must show. */
    const labelsOf = (lines: readonly string[]): string[] =>
      lines.flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map(([, label]) => label ?? '')).filter((l) => !/^(?:HTTPS|SQL|SMTP)$/.test(l));

    it.each(Object.entries(EXAMPLES))('draws %s from the bundled library, every label in it', async (module, lines) => {
      const svg = await render(diagram(`!include <C4/${module}>`, ...lines));
      expect(recognizeEngineError(svg)).toBeNull();
      const shown = shownIn(svg);
      for (const label of labelsOf(lines)) {
        expect(shown, `${module}: ${label}`).toContain(label);
      }
    });

    it('draws nested boundaries, tags, a legend and relations, with definitions of the diagram’s own reused', async () => {
      const svg = await render(
        diagram(
          '!include <C4/C4_Container>',
          'AddElementTag("legacy", $bgColor="#7a3b2e", $legendText="legacy system")',
          'AddRelTag("async", $lineStyle=DashedLine(), $legendText="asynchronous")',
          '!procedure $service($alias, $label)',
          '  Container($alias, $label, "Go", "A service")',
          '!endprocedure',
          'Enterprise_Boundary(company, "Company") {',
          '  System_Boundary(shop, "Online shop") {',
          '    $service(orders, "Orders")',
          '    $service(billing, "Billing")',
          '    Container(old, "Old billing", "COBOL", $tags="legacy")',
          '  }',
          '}',
          'Rel(orders, billing, "Charges")',
          'Rel_D(billing, old, "Mirrors", $tags="async")',
          'BiRel(orders, old, "Reconciles")',
          'SHOW_LEGEND()'
        )
      );
      expect(recognizeEngineError(svg)).toBeNull();
      const shown = shownIn(svg);
      for (const label of ['Company', 'Online shop', 'Orders', 'Billing', 'Old billing', 'Charges', 'Mirrors', 'Reconciles', 'legacy system', 'asynchronous']) {
        expect(shown, label).toContain(label);
      }
      expect(svg).toMatch(/fill="#7A3B2E"/i);
    });

    it('reads the library whatever case its name is written in', async () => {
      const lines = EXAMPLES.C4_Context ?? [];
      const upper = await render(diagram('!include <C4/C4_Context>', ...lines));
      const lower = await render(diagram('!include <c4/C4_Context>', ...lines));
      expect(recognizeEngineError(lower)).toBeNull();
      expect(texts(lower)).toEqual(texts(upper));
    });

    it('draws C4 and Azure in one diagram', async () => {
      const svg = await render(
        diagram(
          '!include <C4/C4_Container>',
          '!include <azure/AzureCommon>',
          '!include <azure/Compute/AzureFunction>',
          'Container(web, "Web app", "TypeScript")',
          'AzureFunction(fn, "Mailer", "Functions")',
          'Rel(web, fn, "Queues mail")'
        )
      );
      expect(recognizeEngineError(svg)).toBeNull();
      expect(svg).toContain('«AzureFunction»');
      expect(shownIn(svg)).toContain('Queues mail');
    });

    it('fails a file the library leaves out, and a theme of it, with the engine’s error', async () => {
      expect(recognizeEngineError(await render(diagram('!include <C4/C4_Nope>', 'A -> B')))?.message).toBe(
        'cannot include <C4/C4_Nope>'
      );
      expect(
        recognizeEngineError(await render(diagram('!include <C4/C4_Context>', '!theme C4_united from <C4/themes>', 'Person(p, "P")')))?.message
      ).toBe('Cannot load theme C4_united in <C4/themes>');
    });

    // Why a diagram that includes the library is drawn in the light palette
    // (src/render/palette.ts): its colours are made for a white page.
    it.each(['C4_Container', 'C4_Component', 'C4_Sequence'])(
      'writes the names of %s boundaries in a grey the dark palette leaves hard to read',
      async (module) => {
        const source = diagram(`!include <C4/${module}>`, ...(EXAMPLES[module] ?? []));
        const dark = weakestTextContrast(lightenLinks(await render(source, true)), true) ?? Infinity;
        expect(dark).toBeLessThan(MIN_DRAWN_CONTRAST);
        expect(weakestTextContrast(await render(source, false), false)).toBeGreaterThan(dark);
      }
    );

    it('draws a legend whose title is black in either palette, and whose swatches no palette makes easier to read', async () => {
      const source = diagram(
        '!include <C4/C4_Context>',
        'Person(customer, "Customer")',
        'System_Ext(mail, "Mail service")',
        'Rel(customer, mail, "Reads")',
        'SHOW_LEGEND()'
      );
      const dark = lightenLinks(await render(source, true));
      const light = await render(source, false);
      expect(dark).toMatch(/<text\b[^>]*\sfill="#000000"[^>]*>Legend\s*<\/text>/);
      // So the light drawing reads no better by its weakest text, and looking
      // at the dark one alone would keep it.
      expect(weakestTextContrast(light, false)).toBeLessThanOrEqual(weakestTextContrast(dark, true) ?? 0);
    });
  });

  // What the warning about an image (src/core/notation.ts) says the engine does.
  describe('images (re-check on every engine update)', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=';
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
    const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>').toString('base64');
    const PLACEHOLDER = /\[img TBD\d*\]/;
    /** What a drawing reads as: C4 writes each word of a label, and each space, as a text of its own. */
    const shown = (svg: string): string =>
      [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
        .map(([, text]) => text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ');

    it.each([
      ['a file', 'A -> B : see <img:pic.png> here'],
      ['a file named with src=', 'A -> B : see <img src="pic.png"> here'],
      ['a URL', 'A -> B : see <img:https://example.invalid/pic.png> here'],
      ['inline JPEG', `A -> B : see <img:data:image/jpeg;base64,${JPEG}> here`],
      ['inline SVG', `A -> B : see <img:data:image/svg+xml;base64,${SVG}> here`],
    ])('draws placeholder text for %s', async (_what, line) => {
      const svg = await render(`@startuml\n${line}\n@enduml`);
      expect(recognizeEngineError(svg)).toBeNull();
      expect(shown(svg)).toMatch(PLACEHOLDER);
      expect(svg).not.toMatch(/<image\b/);
    });

    it.each([
      ['in a label', `A -> B : see <img:${PNG}> here`],
      ['with src= and quotes', `A -> B : see <img src="${PNG}"> here`],
      ['as a C4 sprite', `!include <C4/C4_Context>\nPerson(p, "Customer", $sprite="img:${PNG}")`],
    ])('draws a PNG written inline %s, which the sanitiser keeps', async (_what, line) => {
      const svg = await render(`@startuml\n${line}\n@enduml`);
      expect(shown(svg)).not.toMatch(PLACEHOLDER);
      expect(svg).toContain(`href="${PNG}"`);
    });

    it('draws placeholder text for a C4 sprite from a file, by name or by position', async () => {
      for (const line of ['Person(p, "Customer", $sprite="img:pic.png")', 'Person(p, "Customer", "Buys", "img:pic.png")']) {
        const svg = await render(`@startuml\n!include <C4/C4_Context>\n${line}\n@enduml`);
        expect(shown(svg), line).toMatch(PLACEHOLDER);
      }
    });

    it('takes <img only in that case for an image', async () => {
      expect(shown(await render('@startuml\nA -> B : <Img:pic.png>\n@enduml'))).not.toMatch(PLACEHOLDER);
      expect(shown(await render('@startuml\nA -> B : <iMG:pic.png>\n@enduml'))).toMatch(PLACEHOLDER);
    });
  });

  describe('sprites and the bundled standard library', () => {
    it('renders an inline sprite as an embedded PNG', async () => {
      const svg = await render(
        [
          '@startuml',
          'sprite $box [8x8/16] {',
          'FFFFFFFF',
          'F000000F',
          'F0FFFF0F',
          'F0F00F0F',
          'F0F00F0F',
          'F0FFFF0F',
          'F000000F',
          'FFFFFFFF',
          '}',
          'rectangle "<$box>" as a',
          '@enduml',
        ].join('\n')
      );

      // Survives sanitisation only because the payload really is a PNG.
      expect(svg).toMatch(/<image[^>]*href="data:image\/png;base64,iVBORw0KGg/);
    });

    it('resolves !include <azure/…> from the bundled library', async () => {
      const svg = await render(
        [
          '@startuml',
          '!include <azure/AzureCommon>',
          '!include <azure/Compute/AzureFunction>',
          'AzureFunction(fn, "注文API", "Functions")',
          '@enduml',
        ].join('\n')
      );

      expect(svg).not.toMatch(/Fatal parsing error/i);
      // The stereotype comes from AzureCommon's AzureEntity macro, so it
      // only appears if the include resolved from the bundled library.
      expect(svg).toContain('«AzureFunction»');
      expect(svg).toContain('[Functions]');
      // PlantUML emits CJK one glyph per <text>, so match a single character.
      expect(svg).toContain('注');
      expect(svg).toMatch(/data:image\/png;base64,iVBORw0KGg/);
    });

    it('renders one distinct icon per sprite on a multi-icon diagram', async () => {
      const svg = await render(
        [
          '@startuml',
          '!include <azure/AzureCommon>',
          '!include <azure/Compute/AzureFunction>',
          '!include <azure/Databases/AzureCosmosDb>',
          'AzureFunction(fn, "API", "Functions")',
          'AzureCosmosDb(db, "DB", "Cosmos DB")',
          'fn --> db',
          '@enduml',
        ].join('\n')
      );

      // Per-canvas raster state: a shared buffer would emit one image twice.
      const payloads = new Set(svg.match(/base64,iVBORw0KGg[A-Za-z0-9+/=]+/g) ?? []);
      expect(payloads.size).toBe(2);
    });

    it('fails fast on a library that is not bundled', async () => {
      // The engine falls back to injecting <script src="aws.min.js">. Left
      // alone that never settles and the render dies on the 30 s timeout.
      const started = Date.now();
      const svg = await render('@startuml\n!include <aws/AWSCommon>\nAlice -> Bob\n@enduml');

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(svg).toMatch(/<svg/);
    });

    it('keeps rendering normally after a sprite diagram', async () => {
      await render('@startuml\n!include <azure/AzureCommon>\nAlice -> Bob\n@enduml');
      const svg = await render('@startuml\nAlice -> Bob : Hello\n@enduml');

      expect(svg).toContain('Hello');
      expect(svg).not.toContain('data:image');
    });
  });
});

describe('the colours the picker edits (dist, re-check on every engine update)', () => {
  // Each position the picker shows a colour at, with the colour the engine
  // paints there: the fill or the stroke of the element.
  it.each([
    ['a skinparam', ['skinparam rectangleBackgroundColor #AABBCC', 'rectangle R'], 'fill'],
    ['a skinparam block', ['skinparam rectangle {', '  BackgroundColor #AABBCC', '}', 'rectangle R'], 'fill'],
    ['an element', ['rectangle R #AABBCC'], 'fill'],
    ['an element with an alias', ['rectangle "Named" as r #AABBCC'], 'fill'],
    ['a class', ['class Foo #AABBCC'], 'fill'],
    ['a participant', ['participant Alice #AABBCC', 'Alice -> Bob'], 'fill'],
    ['a state', ['state S #AABBCC'], 'fill'],
    ['a style background', ['<style>', 'rectangle {', '  BackgroundColor #AABBCC', '}', '</style>', 'rectangle R'], 'fill'],
    ['a style line', ['<style>', 'rectangle {', '  LineColor #AABBCC;', '}', '</style>', 'rectangle R'], 'stroke'],
  ])('paints %s with the colour the source sets, which the picker finds there', async (_what, lines, attribute) => {
    const source = ['@startuml', ...lines, '@enduml'].join('\n');
    const svg = await render(source);
    expect(recognizeEngineError(svg)).toBeNull();
    expect(svg).toMatch(new RegExp(`${attribute}="#AABBCC"`, 'i'));
    expect(findColors(source).map((use) => use.hex)).toEqual(['#AABBCC']);
  });

  it('reads three digits and a name in any case as the picker does', async () => {
    expect(await render('@startuml\nrectangle R #ABC\n@enduml')).toMatch(/fill="#AABBCC"/i);
    expect(await render('@startuml\nrectangle R #pink\n@enduml')).toMatch(/fill="#FFC0CB"/i);
    expect(await render('@startuml\nrectangle R #PINK\n@enduml')).toMatch(/fill="#FFC0CB"/i);
  });

  it('draws a name it does not know as an error, and a colour with an alpha as given, which the picker leaves alone', async () => {
    expect(recognizeEngineError(await render('@startuml\nrectangle R #notacolour\n@enduml'))).not.toBeNull();
    const alpha = '@startuml\nrectangle R #80AABBCC\n@enduml';
    expect(await render(alpha)).toMatch(/fill="#80AABBCC"/i);
    expect(findColors(alpha)).toEqual([]);
  });

  it.each(Object.entries(NAMED_COLORS))('draws #%s as %s, as the picker shows it', async (name, hex) => {
    const svg = await render(`@startuml\nrectangle R #${name}\n@enduml`);
    expect(recognizeEngineError(svg)).toBeNull();
    expect(svg.toUpperCase()).toContain(`FILL="${hex}"`);
  });
});

describe('diagram templates (dist)', () => {
  it.each(TEMPLATES.map((template) => [template.kind, template.diagram]))(
    'draws the %s template as it is, its placeholders at their defaults',
    async (_kind, diagram) => {
      // `${n:default}` -> `default`, as accepting the template without edits leaves it.
      const source = diagram.replace(/\$\{\d+:([^}]*)\}/g, '$1');
      // The names the template puts in: drawn as text, in a diagram of its kind.
      const names = [...diagram.matchAll(/\$\{\d+:([A-Za-z][A-Za-z ]+)\}/g)].map((match) => match[1] ?? '');
      expect(names.length).toBeGreaterThan(0);

      for (const dark of [false, true]) {
        const svg = await render(source, dark);
        expect(recognizeEngineError(svg)).toBeNull();
        expect(names.some((name) => svg.includes(name)), `${source}\n${svg.slice(0, 400)}`).toBe(true);
      }
    }
  );
});

// The snippets of syntax are offered in a diagram whose type its lines tell
// (src/language/diagram-kind.ts). That rests on how the bundled engine reads
// a @startuml diagram: it draws it as the first type that reads every line.
// So it is re-checked on every engine update: each snippet draws in its type
// only, and each marker line draws in its type and turns every other type
// into an error. Every source here is under ten lines: from ten on, the
// engine tries the type it drew last before the others.
describe('snippets and the lines that tell a diagram type (dist, re-check on every engine update)', () => {
  /** The diagram `lines` draw, or null when the engine draws an error. */
  const drawn = async (lines: readonly string[]): Promise<string | null> => {
    const source = ['@startuml', ...lines, '@enduml'];
    expect(source.length).toBeLessThan(10);
    try {
      const svg = await render(source.join('\n'));
      return recognizeEngineError(svg) === null ? svg : null;
    } catch {
      return null;
    }
  };
  const OTHER: Record<DiagramKind, DiagramKind> = { sequence: 'activity', activity: 'sequence' };
  /** The smallest diagram of each type, with `text` in it. */
  const SMALLEST: Record<DiagramKind, (text: string) => string[]> = {
    sequence: (text) => ['A -> B : request', ...text.split('\n')],
    activity: (text) => ['start', ...text.split('\n'), 'stop'],
  };
  /** Whether an SVG is drawn as a sequence diagram, the class family, or the old activity syntax. */
  const looksLike = (svg: string): string =>
    /participant-head/.test(svg)
      ? 'sequence'
      : /class="entity"/.test(svg)
        ? 'entity'
        : /start_entity/.test(svg)
          ? 'old activity'
          : 'other';

  it.each(
    (Object.entries(SNIPPETS) as [DiagramKind, (typeof SNIPPETS)[DiagramKind]][]).flatMap(([kind, snippets]) =>
      snippets.map(({ label, body }) => [kind, label, body] as const)
    )
  )('draws the %s snippet %s as inserted, in its type only', async (kind, _label, body) => {
    // At its defaults, and with each choice of a choice placeholder.
    const choices = /\$\{\d+\|([^}|]*)\|\}/.exec(body)?.[1]?.split(',') ?? [];
    const texts = [body, ...choices.map((choice) => body.replace(/\$\{\d+\|[^}|]*\|\}/, choice))].map(expandSnippet);
    const defaults = [...body.matchAll(/\$\{\d+:([^}]*)\}/g)].map((match) => match[1] ?? '');
    for (const text of texts) {
      const svg = await drawn(SMALLEST[kind](text));
      expect(svg, text).not.toBeNull();
      expect(looksLike(svg ?? ''), text).toBe(kind === 'sequence' ? 'sequence' : 'other');
      // As text of its own, or in the brackets a group's condition is drawn in.
      for (const value of defaults) {
        expect(svg, `${value} in\n${text}`).toMatch(new RegExp(`>\\[?${value}\\]?<`));
      }
    }
    expect(await drawn(SMALLEST[OTHER[kind]](expandSnippet(body))), expandSnippet(body)).toBeNull();
  });

  /** A line of each other type, which draws alone as that type. */
  const OTHERS: Record<string, readonly string[]> = {
    sequence: ['participant P'],
    activity: ['start'],
    class: ['class C'],
    'old activity': ['(*) --> "a"'],
    'use case': ['usecase U'],
    component: ['[K]'],
    state: ['state S'],
    timing: ['concise "T" as t', '@0', 't is On'],
  };

  it.each(Object.entries(OTHERS))('draws the %s line on its own', async (_name, lines) => {
    expect(await drawn(lines)).not.toBeNull();
  });

  // Each form of marker: its type, its line, and a diagram of that type it draws in.
  const sequence = (marker: string, ...closing: string[]): readonly [DiagramKind, string, readonly string[]] => [
    'sequence',
    marker,
    ['A -> B : m', marker, ...closing],
  ];
  const activity = (marker: string, ...closing: string[]): readonly [DiagramKind, string, readonly string[]] => [
    'activity',
    marker,
    [':a;', marker, ...closing],
  ];
  const MARKERS: readonly (readonly [DiagramKind, string, readonly string[]])[] = [
    sequence('participant A'),
    sequence('create participant C'),
    sequence('activate A'),
    sequence('deactivate A'),
    sequence('destroy A'),
    sequence('autonumber'),
    sequence('alt x', 'end'),
    sequence('alt#Gold #LightBlue x', 'end'),
    sequence('opt x', 'end'),
    sequence('loop x', 'end'),
    sequence('par x', 'end'),
    sequence('critical x', 'end'),
    sequence('ref over A : x'),
    sequence('note over A : x'),
    sequence('== x =='),
    sequence('return x'),
    sequence('box "x"', 'end box'),
    sequence('hnote over A : x'),
    sequence('rnote over A : x'),
    sequence('[-> A'),
    sequence('A ->]'),
    activity('start'),
    activity('stop'),
    activity(':b;'),
    activity('if (x) then (yes)', 'endif'),
    activity('while (x)', 'endwhile'),
    activity('repeat', 'repeat while (x)'),
    activity('fork', 'fork again', 'end fork'),
    activity('split', 'split again', 'end split'),
    activity('switch (x)', 'case (a)', 'endswitch'),
    // A swimlane comes before the first action.
    ['activity', '|L|', ['|L|', ':a;']],
    ['activity', '|#pink|L|', ['|#pink|L|', ':a;']],
    activity('detach'),
    activity('kill'),
  ];

  it.each(MARKERS)('reads the %s marker %s in that type only', async (kind, marker, lines) => {
    expect(diagramKind(protect([marker], false))).toBe(kind);
    const svg = await drawn(lines);
    expect(svg).not.toBeNull();
    expect(looksLike(svg ?? '')).toBe(kind === 'sequence' ? 'sequence' : 'other');
    for (const [name, lines] of Object.entries(OTHERS)) {
      if (name !== kind) {
        expect(await drawn([...lines, marker]), name).toBeNull();
      }
    }
  });

  it('reads the lines a group goes on with as markers, each in that type only', async () => {
    for (const marker of ['fork again', 'split again', 'repeat while (x)']) {
      expect(diagramKind(protect([marker], false))).toBe('activity');
      for (const [name, lines] of Object.entries(OTHERS)) {
        if (name !== 'activity') {
          expect(await drawn([...lines, marker]), `${marker} with ${name}`).toBeNull();
        }
      }
    }
  });
});

// The .puml preview names a diagram after the title the engine draws
// (src/render/title.ts). That rests on how the bundled engine draws a title:
// in a group of its own, as text with its markup applied. So it is
// re-checked on every engine update, in each type of diagram.
describe('the title a screen reader is told (dist, re-check on every engine update)', () => {
  /** A diagram of each type, its title in place of `{title}`. */
  const KINDS: Record<string, string> = {
    sequence: '@startuml\ntitle {title}\nA -> B\n@enduml',
    class: '@startuml\ntitle {title}\nclass Foo\n@enduml',
    activity: '@startuml\ntitle {title}\nstart\n:a;\nstop\n@enduml',
    'old activity': '@startuml\ntitle {title}\n(*) --> "a"\n@enduml',
    'use case': '@startuml\ntitle {title}\nactor U\nU --> (case)\n@enduml',
    component: '@startuml\ntitle {title}\n[Comp] --> [Other]\n@enduml',
    state: '@startuml\ntitle {title}\n[*] --> S1\n@enduml',
    object: '@startuml\ntitle {title}\nobject o1\n@enduml',
    deployment: '@startuml\ntitle {title}\nnode n1\n@enduml',
    timing: '@startuml\ntitle {title}\nrobust "R" as R\n@0\nR is idle\n@enduml',
    C4: '@startuml\n!include <C4/C4_Context>\ntitle {title}\nPerson(p, "P")\n@enduml',
    gantt: '@startgantt\ntitle {title}\n[Task] lasts 3 days\n@endgantt',
    mindmap: '@startmindmap\ntitle {title}\n* root\n@endmindmap',
    wbs: '@startwbs\ntitle {title}\n* root\n** a\n@endwbs',
    json: '@startjson\ntitle {title}\n{"a": 1}\n@endjson',
    yaml: '@startyaml\ntitle {title}\na: 1\n@endyaml',
    salt: '@startsalt\ntitle {title}\n{\n  Login | "x"\n}\n@endsalt',
    chart: '@startchart\ntitle {title}\nh-axis [a, b]\nv-axis 0 --> 10\nbar "S" [1, 2]\n@endchart',
    ebnf: '@startebnf\ntitle {title}\nrule = "a";\n@endebnf',
    regex: '@startregex\ntitle {title}\n/ab+/\n@endregex',
  };

  it.each(Object.entries(KINDS))('reads the title of a %s diagram as drawn', async (_kind, diagram) => {
    const titled = (title: string): Promise<string> => render(diagram.replace('{title}', title));
    expect(drawnTitle(await titled('Order flow'))).toBe('Order flow');
    // Its markup applied, and a line break between its lines.
    expect(drawnTitle(await titled('<u>Order</u> **flow** & <b>more</b>\\nsecond'))).toBe('Order flow & more second');
  });

  it('reads a title however it is written, and nothing that is not one', async () => {
    const read = async (lines: readonly string[]): Promise<string | null> => drawnTitle(await render(lines.join('\n')));
    expect(await read(['@startuml', 'title: After a colon', 'A -> B', '@enduml'])).toBe('After a colon');
    expect(await read(['@startuml', 'TITLE "In quotes"', 'A -> B', '@enduml'])).toBe('In quotes');
    expect(await read(['@startuml', 'title', '  Over <b>lines</b>', '  of its own', 'end title', 'A -> B', '@enduml'])).toBe(
      'Over lines of its own'
    );
    // The last title is the one drawn.
    expect(await read(['@startuml', 'title First', 'title Second', 'A -> B', '@enduml'])).toBe('Second');
    // Text of a note, a name the diagram is given, no title, and an error
    // the engine drew in place of the diagram.
    expect(await read(['@startuml', 'A -> B', 'note left of A', '  title not a title', 'end note', '@enduml'])).toBeNull();
    expect(await read(['@startuml(id=checkout)', 'A -> B', '@enduml'])).toBeNull();
    expect(await read(['@startuml', 'A -> B', '@enduml'])).toBeNull();
    const error = await render(['@startuml', 'title Has an error', 'A -> B : x', 'foo bar baz qux', '@enduml'].join('\n'));
    expect(recognizeEngineError(error)).not.toBeNull();
    expect(drawnTitle(error)).toBeNull();
  });
});
