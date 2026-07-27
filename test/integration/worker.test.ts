import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RenderResponseMessage } from '../../src/core/types';

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

  it('returns syntax errors as a diagram and keeps rendering afterwards', async () => {
    const broken = await render('@startuml\n@@@ not valid @@@\n@enduml');
    expect(broken).toMatch(/<svg/);
    expect(broken).toMatch(/Syntax Error|Error/i);

    const next = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(next).toMatch(/<svg/);
    expect(next).toContain('Hello');
  });

  it('strips scripts and event handlers from the SVG', async () => {
    const svg = await render('@startuml\nAlice -> Bob : Hello\n@enduml');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+=/i);
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
});
