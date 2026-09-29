import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RenderResponseMessage } from '../../src/core/types';
import { caseGroups } from '../unit/grammar/cases';
import checklist from '../unit/grammar/checklist.json';

/**
 * Every grammar test case is a real diagram: the bundled engine must render
 * it (or fail the way the case says, for syntax that needs files or the
 * network). This is what makes the grammar cases evidence of what the
 * engine accepts, rather than of what the grammar author believed.
 */
const workerPath = join(__dirname, '../../dist/worker.js');

let worker: Worker;
let nextId = 1;
const pending = new Map<number, (message: RenderResponseMessage) => void>();

function render(source: string): Promise<RenderResponseMessage> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    worker.postMessage({ id, source, dark: false });
  });
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Text drawn in the SVG, where the engine puts its error messages. */
function svgText(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescapeXml(m[1] ?? '')).join(' ');
}

const ERROR_MARKERS = /Syntax Error|not supported by this release|\[From textarea \(line \d+\) \]/;

/**
 * Messages of the banner the engine draws above a diagram it accepted with
 * warnings: a yellow box (DiagramChromeFactory upstream) holding one line
 * of 10-point monospace text per message.
 */
function warnings(svg: string): string[] {
  if (!/<rect [^>]*fill="#FFFFCC" stroke="#FFDD88" stroke-width="3"/.test(svg)) return [];
  return [...svg.matchAll(/<text [^>]*font-size="10"[^>]*font-family="monospace">([^<]*)<\/text>/g)].map((m) =>
    unescapeXml(m[1] ?? '')
  );
}

function outcome(message: RenderResponseMessage): { ok: boolean; text: string; warnings: string[] } {
  if (message.error !== undefined) {
    return { ok: false, text: message.error, warnings: [] };
  }
  const text = svgText(message.svg ?? '');
  return { ok: !ERROR_MARKERS.test(text), text, warnings: warnings(message.svg ?? '') };
}

beforeAll(() => {
  expect(existsSync(workerPath), 'dist/worker.js missing — run `npm run bundle` first').toBe(true);
  worker = new Worker(workerPath);
  worker.on('message', (message: RenderResponseMessage) => {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
});

afterAll(async () => {
  await worker.terminate();
});

describe('grammar cases render with the bundled engine', () => {
  it('recognises an engine error (positive control)', async () => {
    const result = outcome(await render('@startuml\n@@@ not valid @@@\n@enduml'));
    expect(result.ok).toBe(false);
  });

  it('recognises an engine warning (positive control)', async () => {
    const result = outcome(await render('@startuml\nstart\n#pink:deprecated colour\nsecond line;\nstop\n@enduml'));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/deprecated/);
  });

  // The grammar marks these as unsupported. If an engine update starts
  // rendering one, this fails: the grammar and the checklist need it too.
  for (const directive of checklist.directives.filter((d) => !d.supported)) {
    it(`@start${directive.name} is not rendered by the engine`, async () => {
      const result = outcome(await render(`@start${directive.name}\nx\n@end${directive.name}`));
      expect(result.ok).toBe(false);
      expect(result.text).toMatch(/not supported by this release|Unsupported diagram type/);
    });
  }

  for (const [file, cases] of Object.entries(caseGroups)) {
    for (const c of cases) {
      it(`${file}: ${c.name}`, async () => {
        const result = outcome(await render(c.source));
        if (c.render === undefined || c.render === 'ok') {
          expect(result.ok, result.text.slice(0, 400)).toBe(true);
          if (c.warns === undefined) {
            expect(result.warnings, 'the engine warned').toEqual([]);
          } else {
            expect(result.warnings.join(' ')).toMatch(c.warns);
          }
        } else {
          expect(result.ok, `expected an error, got: ${result.text.slice(0, 200)}`).toBe(false);
          expect(result.text).toMatch(c.render);
        }
      });
    }
  }
});
