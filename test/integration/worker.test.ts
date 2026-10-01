import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMOJI_UNAVAILABLE } from '../../src/core/constants';
import type { RenderResponseMessage } from '../../src/core/types';
import {
  choosePalette,
  labelContrast,
  MIN_TEXT_CONTRAST,
  probeSource,
  ThemePalettes,
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
  // engine update. The next engine (upstream's TextareaSource) changes the
  // last two: it ignores lines before @startuml and closes a diagram that has
  // no @enduml. When an update fails here, take the new behaviour on purpose:
  // adjust these and the export tests that expect "Diagram not supported",
  // and say what changes for users in the changelog.
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

    it('does not draw a source with a line before @startuml', async () => {
      const svg = await render('title Before\n@startuml\nAlice -> Bob : x\n@enduml');
      expect(svg).toContain('Diagram not supported by this release of PlantUML');
    });

    it('fails a source that has no @enduml', async () => {
      await expect(render('@startuml\nAlice -> Bob : open')).rejects.toThrow(/IndexOutOfBoundsException/);
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
