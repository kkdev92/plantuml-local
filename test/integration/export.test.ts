import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RenderResponseMessage } from '../../src/core/types';
import { exportAll, type ExporterDeps } from '../../src/export/exporter';

/**
 * Exports through the built dist/worker.js, so what lands on disk is the
 * SVG the preview would show — sanitised, sprites rasterised and all.
 * Requires `npm run bundle` (the npm test script does this).
 */

const workerPath = join(__dirname, '../../dist/worker.js');

/**
 * Document-wide namespace check, strict-XML-parser stand-in: every prefix
 * in use as an element or attribute name must be declared somewhere.
 */
function hasUndeclaredPrefix(svg: string): boolean {
  const declared = new Set(['xml', 'xmlns']);
  for (const match of svg.matchAll(/xmlns:([A-Za-z_][\w.-]*)=/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of svg.matchAll(/[<\s]\/?([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*[=\s>/]/g)) {
    if (!declared.has(match[1] ?? '')) {
      return true;
    }
  }
  return false;
}

let worker: Worker;
let workspace: string;
let nextId = 1;
const pending = new Map<number, { resolve: (svg: string) => void; reject: (e: Error) => void }>();

function render(source: string): Promise<string> {
  return new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    worker.postMessage({ id, source, dark: false });
  });
}

/** Writes to real files, resolving relative paths against the document. */
const deps: ExporterDeps = {
  render,
  isDark: () => false,
  remoteReferenceMessage: 'URL-based external references are not supported.',
  invalidNameMessage: 'Use letters, digits, hyphens and underscores only.',
  resolve: (documentPath, relative) => resolve(dirname(documentPath), relative),
  writeFile: (path, content) =>
    import('node:fs/promises').then(async (fs) => {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, content, 'utf8');
    }),
};

beforeAll(() => {
  expect(existsSync(workerPath), 'dist/worker.js missing — run `npm run bundle` first').toBe(true);
  workspace = mkdtempSync(join(tmpdir(), 'plantuml-export-'));
  mkdirSync(join(workspace, 'docs'), { recursive: true });
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
  rmSync(workspace, { recursive: true, force: true });
});

describe('export (dist worker)', () => {
  it('writes real SVG files beside the document', async () => {
    const document = join(workspace, 'docs/design.md');
    const text = [
      '# Design',
      '',
      '```plantuml sequence',
      '@startuml',
      'actor "利用者" as U',
      'U -> B : 追加',
      '@enduml',
      '```',
      '',
      '```plantuml unnamed-is-skipped-because-it-has-no-name',
      '@startuml',
      'A -> B',
      '@enduml',
      '```',
    ].join('\n');

    const outcome = await exportAll(deps, document, 'images', text);

    expect(outcome.failed).toHaveLength(0);
    expect(outcome.written).toHaveLength(2);

    const svg = readFileSync(join(workspace, 'docs/images/sequence.svg'), 'utf8');
    expect(svg).toMatch(/^<svg/);
    // The exported file is the sanitised output, not the raw engine SVG.
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('利用者');
    // An opaque backdrop is baked in, first in paint order: the engine
    // leaves the canvas transparent, which reads as black-on-black on a
    // dark host page.
    expect(svg).toMatch(/^<svg[^>]*><rect [^>]*fill="#FFFFFF"\/>/);
  });

  it('exports a sprite diagram with its icon embedded', async () => {
    const document = join(workspace, 'docs/azure.md');
    const text = [
      '```plantuml orders-api',
      '@startuml',
      '!include <azure/AzureCommon>',
      '!include <azure/Compute/AzureFunction>',
      'AzureFunction(fn, "Orders", "Functions")',
      '@enduml',
      '```',
    ].join('\n');

    const outcome = await exportAll(deps, document, 'images', text);

    expect(outcome.written.map((r) => r.name)).toEqual(['orders-api']);
    const svg = readFileSync(join(workspace, 'docs/images/orders-api.svg'), 'utf8');
    // Survives export only because the sanitiser keeps sprite PNGs.
    expect(svg).toMatch(/<image[^>]*href="data:image\/png;base64,iVBORw0KGg/);
    // The engine emits xlink:href on sprites without declaring the prefix.
    // In the preview (HTML) nobody notices; a standalone .svg is strict
    // XML, and a browser shows a broken image for the whole file.
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(hasUndeclaredPrefix(svg)).toBe(false);
  });

  it('refuses a URL-based include instead of writing the engine error diagram', async () => {
    const document = join(workspace, 'docs/remote.md');
    const text = '```plantuml remote\n@startuml\n!include https://evil.example/x.puml\n@enduml\n```';

    const outcome = await exportAll(deps, document, 'images', text);

    // The preview refuses these before the engine sees them; export has to
    // agree, or the block that shows an explanation on screen would write
    // out PlantUML's "cannot include" error diagram as a real file.
    expect(outcome.written).toHaveLength(0);
    expect(outcome.failed.map((r) => r.name)).toEqual(['remote']);
    expect(existsSync(join(workspace, 'docs/images/remote.svg'))).toBe(false);
  });
});
