import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { findFileDiagrams, findPlantUmlBlocks } from '../../src/export/blocks';
import { OUTPUT_BUFFER_LIMIT, OutputBuffer } from '../../src/export/buffer';
import {
  addBackground,
  drawDocument,
  exportAll,
  exportOne,
  isPngOfSize,
  planDocument,
  PNG_LIMITS,
  preparePng,
  prepareSvg,
  refuseSharedFiles,
  SVG_TEXT_LIMIT,
  svgSize,
  writeDocuments,
  type ExporterDeps,
  type ExportFormat,
  type ReplaceTarget,
} from '../../src/export/exporter';
import { ExportLedger, type RecordResult } from '../../src/export/history';
import { isInputManifest, type RendererIdentity } from '../../src/export/manifest';
import { sha256, type ExportRecords } from '../../src/export/ownership';
import type { DiagramRender } from '../../src/core/types';

/** What the renderer hands the exporter for `svg`: no local include failed. */
const rendered = (svg: string): DiagramRender => ({ svg, failedIncludes: new Map(), dependencies: [] });

/** The renderer the tests' images are drawn by. */
const RENDERER: RendererIdentity = { engine: '1.2026.9', build: 'b'.repeat(64), raster: 'c'.repeat(64) };

/** The start of a PNG of `width`×`height` pixels: its signature and IHDR chunk. */
function pngOf(width: number, height: number): Uint8Array {
  const png = new Uint8Array(33);
  const view = new DataView(png.buffer);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13);
  png.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  png.set([8, 6, 0, 0, 0], 24);
  return png;
}

/** A file the export asks about, as confirmReplace is told of it. */
const asked = (path: string, recorded = true, byEarlierVersion = false): ReplaceTarget => ({
  path,
  byEarlierVersion,
  recorded,
});

function makeDeps(
  overrides?: Partial<ExporterDeps>,
  files?: Record<string, string | Uint8Array>,
  earlier: ExportRecords = {}
): ExporterDeps & {
  writeFile: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  confirmReplace: ReturnType<typeof vi.fn>;
  toPng: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
  spool: ReturnType<typeof vi.fn>;
  deleteSpool: ReturnType<typeof vi.fn>;
  deleteFolder: ReturnType<typeof vi.fn>;
  ledger: ExportLedger;
  disk: Map<string, string | Uint8Array>;
  buffer: OutputBuffer;
} {
  // The files already there, by path: read back before writing.
  const disk = new Map<string, string | Uint8Array>(Object.entries(files ?? {}));
  let spooled = 0;
  // What the export wrote, kept as the extension keeps it; and what an earlier version recorded.
  let stored: unknown = null;
  const ledger = new ExportLedger(
    {
      get: () => stored,
      set: (value) => {
        stored = value;
        return Promise.resolve();
      },
    },
    () => earlier
  );
  const deps = {
    errorMessage: (message: string): string => message,
    render: vi.fn((source: string) => Promise.resolve(rendered(`<svg>${source}</svg>`))),
    isDark: (): boolean => false,
    resolvePalette: (_source: string, dark: boolean): Promise<boolean> => Promise.resolve(dark),
    readExisting: (path: string): Promise<Uint8Array | null> => {
      const content = disk.get(path);
      return Promise.resolve(typeof content === 'string' ? new TextEncoder().encode(content) : (content ?? null));
    },
    ownerOf: (path: string) => ledger.ownerOf(path),
    wroteBefore: (path: string, document: string, existing: Uint8Array): boolean => ledger.wroteBefore(path, document, existing),
    isDirty: (): boolean => false,
    record: vi.fn((...args: Parameters<ExporterDeps['record']>): Promise<RecordResult> => ledger.record(...args)),
    rendererIdentity: (): Promise<RendererIdentity | null> => Promise.resolve(RENDERER),
    lock: <T>(path: string, task: () => Promise<T>): Promise<T> => ledger.lock(path, task),
    ledger,
    // Declines, so a question no test expected writes nothing.
    confirmReplace: vi.fn((): Promise<'replace' | 'keep' | undefined> => Promise.resolve(undefined)),
    writeFile: vi.fn((path: string, content: string | Uint8Array) => {
      disk.set(path, content);
      return Promise.resolve();
    }),
    // A drawing past what is held in memory goes to a temporary file beside its own, named in turn.
    spool: vi.fn((path: string, bytes: Uint8Array) => {
      spooled += 1;
      const file = `${path.slice(0, path.lastIndexOf('/'))}/.${path.slice(path.lastIndexOf('/') + 1)}.${String(spooled)}.tmp`;
      disk.set(file, Uint8Array.from(bytes));
      return Promise.resolve({ file, made: [] as string[] });
    }),
    readSpool: (file: string): Promise<Uint8Array | null> => {
      const content = disk.get(file);
      return Promise.resolve(content === undefined ? null : typeof content === 'string' ? new TextEncoder().encode(content) : content);
    },
    deleteSpool: vi.fn((file: string) => {
      disk.delete(file);
      return Promise.resolve();
    }),
    deleteFolder: vi.fn(() => Promise.resolve()),
    disk,
    pngScale: (): number => 2,
    toPng: vi.fn((_svg: string, width: number, height: number) => Promise.resolve(pngOf(width, height))),
    // Mimics joining a document URI's folder with a relative path.
    resolve: (documentPath: string, relative: string): string =>
      `${documentPath.slice(0, documentPath.lastIndexOf('/'))}/${relative}`,
    remoteReferenceMessage: 'remote references are not supported',
    emojiUnavailableMessage: 'emoji are not available',
    invalidNameMessage: 'unusable name',
    severalDiagramsMessage: 'one diagram per block',
    pagesMessage: 'no pages',
    formulaMessage: (tag: string): string => `formula ${tag}`,
    embeddedDiagramMessage: 'embedded',
    imageMessage: 'image',
    engineErrorMessage: (message: string, line: number | null): string =>
      `engine: ${message} @ ${String(line)}`,
    pngTooLargeMessage: (width: number, height: number, fits: number | null): string =>
      `too large: ${String(width)}×${String(height)}, fits ${String(fits)}`,
    pngFailedMessage: 'no PNG',
    svgTooLargeMessage: (bytes: number): string => `too long: ${String(bytes)}`,
    sameFileMessage: 'same file',
    changedMessage: 'changed meanwhile',
    dirtyMessage: 'unsaved changes',
    spoolChangedMessage: 'held copy changed',
    ...overrides,
  };
  // What a test's draw and write calls share, as one export's.
  return Object.assign(deps, { buffer: new OutputBuffer(deps as ExporterDeps) }) as ExporterDeps & {
    writeFile: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    confirmReplace: ReturnType<typeof vi.fn>;
    toPng: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
    spool: ReturnType<typeof vi.fn>;
    deleteSpool: ReturnType<typeof vi.fn>;
    deleteFolder: ReturnType<typeof vi.fn>;
    ledger: ExportLedger;
    disk: Map<string, string | Uint8Array>;
    buffer: OutputBuffer;
  };
}

/** The temporary files drawings were held in, still there. */
const heldFiles = (deps: { disk: Map<string, string | Uint8Array> }): string[] =>
  [...deps.disk.keys()].filter((path) => path.endsWith('.tmp'));

/** Text written as bytes, read back. */
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : new TextDecoder().decode(content as Uint8Array);

/** What a document's named blocks are drawn as, planned as Export All plans them, held in `buffer`. */
function drawMarkdown(
  deps: ExporterDeps & { buffer: OutputBuffer },
  documentPath: string,
  text: string,
  format: ExportFormat = 'svg',
  buffer: OutputBuffer = deps.buffer
): ReturnType<typeof drawDocument> {
  return drawDocument(deps, buffer, planDocument(deps, documentPath, 'images', findPlantUmlBlocks(text), format));
}

const DOC = '/repo/docs/design.md';

/** Exports the diagram blocks of a Markdown text. */
function exportMarkdown(
  deps: ExporterDeps,
  documentPath: string,
  directory: string,
  text: string,
  onProgress?: (done: number, total: number, name: string) => void
): ReturnType<typeof exportAll> {
  return exportAll(deps, documentPath, directory, findPlantUmlBlocks(text), onProgress);
}

/** What the bundled engine returns for a source it cannot render (see engine-error.test.ts). */
function engineOutput(name: string): string {
  return readFileSync(join(__dirname, 'fixtures/engine-output', `${name}.svg`), 'utf8');
}

describe('addBackground', () => {
  it('spans the viewBox with an opaque rect, first in paint order', () => {
    const svg = '<svg xmlns="x" viewBox="0 0 413 141" width="413" height="141"><g/></svg>';

    expect(addBackground(svg, false)).toBe(
      '<svg xmlns="x" viewBox="0 0 413 141" width="413" height="141">' +
        '<rect x="0" y="0" width="413" height="141" fill="#FFFFFF"/><g/></svg>'
    );
  });

  it('uses the dark backdrop the preview stylesheet uses', () => {
    const svg = '<svg viewBox="0 0 10 10"><g/></svg>';
    expect(addBackground(svg, true)).toContain('fill="#1b1b1b"');
  });

  it('falls back to percentage sizing without a viewBox', () => {
    expect(addBackground('<svg><g/></svg>', false)).toBe(
      '<svg><rect width="100%" height="100%" fill="#FFFFFF"/><g/></svg>'
    );
  });

  it('covers a viewBox with a negative origin', () => {
    const out = addBackground('<svg viewBox="-5 -7 20 30"><g/></svg>', false);
    expect(out).toContain('<rect x="-5" y="-7" width="20" height="30"');
  });

  it('leaves non-SVG input untouched', () => {
    expect(addBackground('not svg', false)).toBe('not svg');
  });
});

describe('exportOne', () => {
  it('renders the block and writes it beside the document, background baked in', async () => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B\n@enduml\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.error).toBeNull();
    expect(result?.path).toBe('/repo/docs/images/orders.svg');
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>@startuml\nA -> B\n@enduml</svg>',
      false
    );
    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('notes');
  });

  it('notes what the engine drew the diagram without, for the report', async () => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks(
      '```plantuml\n@startuml\nA -> B : <math>x</math>\nnote left\n{{\nC -> D\n}}\nend note\nA -> B : <img:pic.png>\n@enduml\n```'
    );

    const result = await exportOne(deps, DOC, 'images', block!, 'maths');

    expect(result).toMatchObject({ error: null, path: '/repo/docs/images/maths.svg', notes: ['formula <math>', 'embedded', 'image'] });
  });

  it('asks before replacing a file that holds something else, and leaves it when declined', async () => {
    // A file someone put there by hand, or the export of another diagram.
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': '<svg>hand-made</svg>' });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toBeNull();
    // With one diagram, there is nothing else to write: replace it or stop.
    // Exported under a name asked for, the file would not be the diagram's to replace next time.
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.svg', false)], false);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('replaces such a file once that is confirmed', async () => {
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('replace' as const)) },
      { '/repo/docs/images/orders.svg': '<svg>hand-made</svg>' }
    );
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.path).toBe('/repo/docs/images/orders.svg');
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      expect.stringContaining('x</svg>'),
      true
    );
  });

  it('leaves a file that changed while the question was open, whatever the answer', async () => {
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': '<svg>hand-made</svg>' });
    deps.confirmReplace.mockImplementation(async () => {
      await deps.writeFile('/repo/docs/images/orders.svg', '<svg>changed meanwhile</svg>', true);
      return 'replace';
    });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: null, error: 'changed meanwhile', cause: 'file' });
    expect(deps.writeFile).toHaveBeenCalledOnce();
    const now = await deps.readExisting('/repo/docs/images/orders.svg');
    expect(new TextDecoder().decode(now!)).toBe('<svg>changed meanwhile</svg>');
  });

  it('leaves a file that changed to as many bytes while the question was open', async () => {
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': '<svg>hand-made</svg>' });
    deps.confirmReplace.mockImplementation(async () => {
      await deps.writeFile('/repo/docs/images/orders.svg', '<svg>hand-mode</svg>', true);
      return 'replace';
    });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: null, error: 'changed meanwhile', cause: 'file' });
    expect(textOf(deps.disk.get('/repo/docs/images/orders.svg'))).toBe('<svg>hand-mode</svg>');
  });

  it('writes a file that was removed while the question was open, as a new one', async () => {
    const deps = makeDeps({
      readExisting: vi
        .fn()
        .mockResolvedValueOnce(new TextEncoder().encode('<svg>hand-made</svg>'))
        .mockResolvedValueOnce(null),
      confirmReplace: vi.fn(() => Promise.resolve('replace' as const)),
    });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.path).toBe('/repo/docs/images/orders.svg');
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      expect.stringContaining('x</svg>'),
      false
    );
  });

  it('leaves a file that already holds the diagram alone, without asking', async () => {
    const svg = '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>x</svg>';
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': svg });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: '/repo/docs/images/orders.svg', error: null, unchanged: true });
    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('replaces the file it exported, unchanged since, without asking', async () => {
    const deps = makeDeps();
    const [first] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [second] = findPlantUmlBlocks('```plantuml orders\ny\n```');

    await exportOne(deps, DOC, 'images', first!, 'orders');
    const result = await exportOne(deps, DOC, 'images', second!, 'orders');

    expect(result?.path).toBe('/repo/docs/images/orders.svg');
    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(deps.writeFile).toHaveBeenLastCalledWith(
      '/repo/docs/images/orders.svg',
      expect.stringContaining('y</svg>'),
      true
    );
  });

  it("asks about that file once it has changed, and about another document's", async () => {
    const deps = makeDeps();
    const [first] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [second] = findPlantUmlBlocks('```plantuml orders\ny\n```');
    await exportOne(deps, DOC, 'images', first!, 'orders');

    // A document beside it naming a diagram alike.
    expect(await exportOne(deps, '/repo/docs/other.md', 'images', second!, 'orders')).toBeNull();
    // Edited by hand since.
    await deps.writeFile('/repo/docs/images/orders.svg', '<svg>edited</svg>', true);
    expect(await exportOne(deps, DOC, 'images', second!, 'orders')).toBeNull();

    expect(deps.confirmReplace).toHaveBeenCalledTimes(2);
  });

  it('does not take a file that holds the diagram already as its export', async () => {
    // Someone else's file, which happens to be what the export would write.
    const svg = '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>x</svg>';
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': svg });
    const [first] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [second] = findPlantUmlBlocks('```plantuml orders\ny\n```');

    expect(await exportOne(deps, DOC, 'images', first!, 'orders')).toMatchObject({ unchanged: true });
    expect(deps.record).not.toHaveBeenCalled();
    expect(await exportOne(deps, DOC, 'images', second!, 'orders')).toBeNull();

    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.svg')], false);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('records the file it writes for a named diagram, and not for a name asked for', async () => {
    const deps = makeDeps();
    const [named] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [unnamed] = findPlantUmlBlocks('```plantuml\ny\n```');

    await exportOne(deps, DOC, 'images', named!, 'orders');
    await exportOne(deps, DOC, 'images', unnamed!, 'billing');

    expect(deps.record).toHaveBeenCalledOnce();
    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')).toMatchObject({
      key: { documentUri: DOC, container: 'markdown', nameBasis: 'fence', name: 'orders', childId: null, page: null, format: 'svg' },
      output: '/repo/docs/images/orders.svg',
    });
    expect(deps.ledger.ownerOf('/repo/docs/images/billing.svg')).toBeNull();
  });

  it("asks before replacing another diagram's file, and replaces its own once that is confirmed", async () => {
    const deps = makeDeps({ confirmReplace: vi.fn(() => Promise.resolve('replace' as const)) });
    const [mine] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [theirs] = findPlantUmlBlocks('```plantuml orders\ny\n```');
    const [again] = findPlantUmlBlocks('```plantuml orders\nz\n```');
    await exportOne(deps, '/repo/docs/other.md', 'images', theirs!, 'orders');

    await exportOne(deps, DOC, 'images', mine!, 'orders');
    await exportOne(deps, DOC, 'images', again!, 'orders');

    // Asked once, saying the file becomes the diagram's own; then its own.
    expect(deps.confirmReplace).toHaveBeenCalledOnce();
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.svg')], false);
    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.key.documentUri).toBe(DOC);
    expect(deps.writeFile).toHaveBeenLastCalledWith('/repo/docs/images/orders.svg', expect.stringContaining('z</svg>'), true);
  });

  it('asks once, saying why, before replacing a file an earlier version exported', async () => {
    const old = '<svg>exported by an earlier version</svg>';
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('replace' as const)) },
      { '/repo/docs/images/orders.svg': old },
      { '/repo/docs/images/orders.svg': { document: DOC, sha256: sha256(new TextEncoder().encode(old)) } }
    );
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [changed] = findPlantUmlBlocks('```plantuml orders\ny\n```');

    await exportOne(deps, DOC, 'images', block!, 'orders');
    await exportOne(deps, DOC, 'images', changed!, 'orders');

    expect(deps.confirmReplace).toHaveBeenCalledOnce();
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.svg', true, true)], false);
    expect(deps.writeFile).toHaveBeenCalledTimes(2);
  });

  it('asks about a file an earlier version exported from another document as about any other', async () => {
    const old = '<svg>exported by an earlier version</svg>';
    const deps = makeDeps(
      {},
      { '/repo/docs/images/orders.svg': old },
      { '/repo/docs/images/orders.svg': { document: '/repo/docs/other.md', sha256: sha256(new TextEncoder().encode(old)) } }
    );
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');

    expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toBeNull();
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.svg')], false);
  });

  it('leaves a file an earlier version exported that holds the diagram, without taking it', async () => {
    const svg = '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>x</svg>';
    const deps = makeDeps(
      {},
      { '/repo/docs/images/orders.svg': svg },
      { '/repo/docs/images/orders.svg': { document: DOC, sha256: sha256(new TextEncoder().encode(svg)) } }
    );
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');

    expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toMatchObject({ error: null, unchanged: true });
    expect(deps.record).not.toHaveBeenCalled();
    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a file open with unsaved changes, without asking', async () => {
    const deps = makeDeps({ isDirty: (path) => path === '/repo/docs/images/orders.svg' }, { '/repo/docs/images/orders.svg': 'edited' });
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: null, error: 'unsaved changes', cause: 'file' });
    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a file opened with unsaved changes while the question was open', async () => {
    let dirty = false;
    const deps = makeDeps(
      { isDirty: () => dirty, confirmReplace: vi.fn(() => ((dirty = true), Promise.resolve('replace' as const))) },
      { '/repo/docs/images/orders.svg': 'hand-made' }
    );
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: null, error: 'unsaved changes', cause: 'file' });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('leaves a file recorded as another diagram\'s while the question was open', async () => {
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': 'hand-made' });
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    deps.confirmReplace.mockImplementation(async () => {
      // Another export takes the file meanwhile, its bytes as they were.
      const key = { documentUri: '/repo/docs/other.md', container: 'markdown', nameBasis: 'fence', name: 'orders', childId: null, page: null, format: 'svg' } as const;
      await deps.ledger.record(key, '/repo/docs/images/orders.svg', new TextEncoder().encode('hand-made'));
      return 'replace';
    });

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: null, error: 'changed meanwhile', cause: 'file' });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('writes a file one export at a time, so the second finds what the first wrote', async () => {
    const deps = makeDeps();
    const [mine] = findPlantUmlBlocks('```plantuml orders\nx\n```');
    const [theirs] = findPlantUmlBlocks('```plantuml orders\ny\n```');

    // Two documents beside each other, exporting at once to the file neither found there.
    const results = await Promise.all([
      exportOne(deps, DOC, 'images', mine!, 'orders'),
      exportOne(deps, '/repo/docs/other.md', 'images', theirs!, 'orders'),
    ]);

    expect(results.map((result) => result?.error ?? null)).toEqual([null, 'changed meanwhile']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('fails a diagram that another of its document is headed for the same file as, whatever the case', async () => {
    const deps = makeDeps();
    const blocks = findPlantUmlBlocks('```plantuml orders\nx\n```\n\n```plantuml Orders\ny\n```\n\n```plantuml\nz\n```');

    const named = await exportOne(deps, DOC, 'images', blocks[0]!, 'orders', 'svg', blocks);
    const asking = await exportOne(deps, DOC, 'images', blocks[2]!, 'orders', 'svg', blocks);
    const other = await exportOne(deps, DOC, 'images', blocks[2]!, 'billing', 'svg', blocks);

    expect(named).toEqual({ name: 'orders', path: null, error: 'same file', cause: 'source' });
    expect(asking).toEqual({ name: 'orders', path: null, error: 'same file', cause: 'source' });
    expect(other?.path).toBe('/repo/docs/images/billing.svg');
    expect(deps.render).toHaveBeenCalledOnce();
  });

  it.each(['full', 'later-version', 'not-saved'] as const)('reports a file written but not recorded (%s)', async (why) => {
    const deps = makeDeps({ record: vi.fn(() => Promise.resolve(why)) });
    const [block] = findPlantUmlBlocks('```plantuml orders\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: '/repo/docs/images/orders.svg', error: null, untracked: why });
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('reports a target it cannot check, such as a folder, without writing', async () => {
    const deps = makeDeps({
      readExisting: () => Promise.reject(new Error('images/orders.svg is a folder, not a file.')),
    });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.error).toBe('images/orders.svg is a folder, not a file.');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('exports in the palette the theme can be read in, with the background of that palette', async () => {
    // A theme made for a dark page, exported with the light palette.
    const deps = makeDeps({ resolvePalette: () => Promise.resolve(true) });
    const [block] = findPlantUmlBlocks('```plantuml\n@startuml\n!theme cyborg\n@enduml\n```');

    await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(deps.render).toHaveBeenCalledWith('@startuml\n!theme cyborg\n@enduml', true);
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      expect.stringContaining('fill="#1b1b1b"'),
      false
    );
  });

  it('honours a directory of "." by writing next to the document', async () => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, '.', block!, 'orders');

    expect(result?.path).toBe('/repo/docs/./orders.svg');
  });

  it('reports a render failure instead of throwing', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.reject(new Error('syntax error'))) });
    const [block] = findPlantUmlBlocks('```plantuml\nbroken\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.error).toBe('syntax error');
    expect(result?.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses the error diagram the engine draws for a broken source, naming the document line', async () => {
    // The engine reports syntax errors through its success path, as a
    // drawing; writing that out would replace the diagram with it.
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('syntax-error')))) });
    const document = [
      '# Design',
      '',
      '```plantuml orders',
      '',
      '@startuml',
      'Alice -> Bob',
      'this is not valid ;;; [[[',
      '@enduml',
      '```',
    ].join('\n');
    const [block] = findPlantUmlBlocks(document);

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    // The engine blames line 3 of the source. With a blank line after the
    // fence, that is line 7 of the document.
    expect(result?.error).toBe('engine: Syntax Error? (Assumed diagram type: sequence) @ 7');
    // Kept apart too, for a caller that moves the block afterwards.
    expect(result?.engineError).toEqual({
      message: 'Syntax Error? (Assumed diagram type: sequence)',
      line: 7,
    });
    // A problem of the source, which the Problems panel lists too.
    expect(result?.cause).toBe('source');
    expect(result?.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a lone error message, which names no line', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('ebnf-error')))) });
    const [block] = findPlantUmlBlocks('```plantuml grammar\n@startebnf\nrule = "a" | ;;;\n@endebnf\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'grammar');

    expect(result?.error).toBe('engine: Syntax error! @ null');
    expect(result?.engineError).toEqual({ message: 'Syntax error!', line: null });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses the report the engine draws when Graphviz crashed', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('graphviz-crash')))) });
    const [block] = findPlantUmlBlocks('```plantuml nested\n@startuml\npackage p0 {\nclass Leaf\n}\n@enduml\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'nested');

    expect(result?.error).toBe('engine: For some reason, dot/GraphViz has crashed. @ null');
    expect(result?.engineError).toEqual({ message: 'For some reason, dot/GraphViz has crashed.', line: null });
    expect(result?.cause).toBe('source');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('still writes a diagram the engine drew with a warning', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('warning')))) });
    const [block] = findPlantUmlBlocks('```plantuml flow\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'flow');

    expect(result?.error).toBeNull();
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('explains a diagram that uses an emoji instead of passing on the engine error', async () => {
    const deps = makeDeps({
      render: vi.fn(() => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js'))),
    });
    const [block] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B : <:smile:>\n@enduml\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result?.error).toBe('emoji are not available');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a block name that would escape the export directory', async () => {
    // The name comes from the document, so it is attacker-controlled when
    // the document is: `deps.resolve` collapses `..` the way Uri.joinPath
    // does, and a bare name would write wherever the block asked.
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml ../../evil\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, block!.name!);

    expect(result?.path).toBeNull();
    expect(result?.error).toBeTruthy();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it.each(['a/b', 'a\\b', '..', 'C:evil', 'x.svg'])('refuses the unusable name %j', async (name) => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, name);

    expect(result?.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('reports a write failure', async () => {
    const deps = makeDeps({ writeFile: vi.fn(() => Promise.reject(new Error('EACCES'))) });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');
    expect(result?.error).toBe('EACCES');
  });
});

describe('svgSize', () => {
  it('reads the width and height the engine gives, which `scale` sets', () => {
    // A `scale 2` diagram: the viewBox keeps the size it is drawn at.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 113" width="210" height="226"><g/></svg>';
    expect(svgSize(svg)).toEqual({ width: 210, height: 226 });
  });

  it('falls back to the viewBox, and gives null without either', () => {
    expect(svgSize('<svg viewBox="0 0 120.5 40"><g/></svg>')).toEqual({ width: 120.5, height: 40 });
    expect(svgSize('<svg width="100%" height="100%"><g/></svg>')).toBeNull();
    expect(svgSize('not svg')).toBeNull();
  });
});

describe('isPngOfSize', () => {
  it('reads the size from the IHDR chunk, wherever the bytes sit in their buffer', () => {
    expect(isPngOfSize(pngOf(300, 200), 300, 200)).toBe(true);
    expect(isPngOfSize(pngOf(300, 200), 200, 300)).toBe(false);
    const pooled = new Uint8Array(40);
    pooled.set(pngOf(3, 2), 5);
    expect(isPngOfSize(pooled.subarray(5), 3, 2)).toBe(true);
  });

  it('refuses what is not a PNG', () => {
    expect(isPngOfSize(new Uint8Array(33), 0, 0)).toBe(false);
    expect(isPngOfSize(pngOf(300, 200).subarray(0, 23), 300, 200)).toBe(false);
    const other = pngOf(300, 200);
    other.set(new TextEncoder().encode('IDAT'), 12);
    expect(isPngOfSize(other, 300, 200)).toBe(false);
  });
});

describe('exportOne as a PNG', () => {
  const [block] = findPlantUmlBlocks('```plantuml\nx\n```');
  /** A render whose SVG gives itself this size, as the engine's does. */
  const sized = (width: number, height: number): ExporterDeps['render'] =>
    vi.fn(() =>
      Promise.resolve(rendered(`<svg viewBox="0 0 10 10" width="${String(width)}" height="${String(height)}"><g/></svg>`))
    );

  it('draws the diagram at the scale set, on its backdrop, and writes the PNG beside the document', async () => {
    const deps = makeDeps({ render: sized(100.5, 50) });

    const result = await exportOne(deps, DOC, 'images', block!, 'orders', 'png');

    expect(result).toEqual({ name: 'orders', path: '/repo/docs/images/orders.png', error: null });
    // Twice the size, rounded up to whole pixels.
    expect(deps.toPng).toHaveBeenCalledWith(expect.stringContaining('fill="#FFFFFF"'), 201, 100, '#FFFFFF');
    expect(deps.writeFile).toHaveBeenCalledWith('/repo/docs/images/orders.png', pngOf(201, 100), false);
  });

  it('draws a diagram exported in the dark palette on the dark backdrop', async () => {
    const deps = makeDeps({ render: sized(10, 10), resolvePalette: () => Promise.resolve(true) });

    await exportOne(deps, DOC, 'images', block!, 'orders', 'png');

    expect(deps.toPng).toHaveBeenCalledWith(expect.any(String), 20, 20, '#1b1b1b');
  });

  it('refuses a PNG past the limits without drawing it, naming the largest scale it fits at', async () => {
    // 12000×8000 at 4, 24 million pixels at 2, and within both at 1.
    const deps = makeDeps({ render: sized(3000, 2000), pngScale: () => 4 });
    // Wider than a side can be at any scale.
    const wide = makeDeps({ render: sized(9000, 10), pngScale: () => 1 });

    expect(await exportOne(deps, DOC, 'images', block!, 'orders', 'png')).toMatchObject({
      path: null,
      error: 'too large: 12000×8000, fits 1',
      cause: 'png',
      fitsAt: 1,
    });
    const tooWide = await exportOne(wide, DOC, 'images', block!, 'orders', 'png');
    expect(tooWide?.error).toBe('too large: 9000×10, fits null');
    expect(tooWide).toMatchObject({ cause: 'png' });
    expect(tooWide).not.toHaveProperty('fitsAt');
    expect(deps.toPng).not.toHaveBeenCalled();
    expect(wide.toPng).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('allows a PNG right at the limits', async () => {
    // 8192 a side, and 16 million pixels in all.
    for (const [width, height] of [
      [4096, 10],
      [2000, 2000],
    ] as const) {
      const deps = makeDeps({ render: sized(width, height) });
      expect((await exportOne(deps, DOC, 'images', block!, 'orders', 'png'))?.error).toBeNull();
    }
    const deps = makeDeps({ render: sized(4096.25, 10) });
    expect((await exportOne(deps, DOC, 'images', block!, 'orders', 'png'))?.error).toBe(
      'too large: 8193×20, fits 1'
    );
  });

  it('refuses a PNG that is not the size asked for, or is too many bytes', async () => {
    // A canvas past what the browser can draw comes back blank or small.
    const small = makeDeps({ render: sized(100, 50), toPng: vi.fn(() => Promise.resolve(pngOf(100, 50))) });
    const huge = new Uint8Array(PNG_LIMITS.bytes + 1);
    huge.set(pngOf(200, 100));
    const heavy = makeDeps({ render: sized(100, 50), toPng: vi.fn(() => Promise.resolve(huge)) });

    for (const deps of [small, heavy]) {
      expect(await exportOne(deps, DOC, 'images', block!, 'orders', 'png')).toMatchObject({
        path: null,
        error: 'no PNG',
      });
      expect(deps.writeFile).not.toHaveBeenCalled();
    }
  });

  it('refuses an SVG that gives no size, and reports a drawing that failed', async () => {
    const unsized = makeDeps({ render: vi.fn(() => Promise.resolve(rendered('<svg><g/></svg>'))) });
    const failing = makeDeps({
      render: sized(10, 10),
      toPng: vi.fn(() => Promise.reject(new Error('The PNG could not be drawn: x'))),
    });

    expect((await exportOne(unsized, DOC, 'images', block!, 'orders', 'png'))?.error).toBe('no PNG');
    expect(unsized.toPng).not.toHaveBeenCalled();
    // A failure of the PNG, which an SVG may not share.
    expect(await exportOne(failing, DOC, 'images', block!, 'orders', 'png')).toMatchObject({
      error: 'The PNG could not be drawn: x',
      cause: 'png',
    });
    expect(failing.writeFile).not.toHaveBeenCalled();
  });

  it('leaves a PNG that already holds the diagram alone, and asks before replacing another', async () => {
    const same = makeDeps({ render: sized(10, 10) }, { '/repo/docs/images/orders.png': pngOf(20, 20) });
    const other = makeDeps({ render: sized(10, 10) }, { '/repo/docs/images/orders.png': pngOf(30, 30) });

    expect((await exportOne(same, DOC, 'images', block!, 'orders', 'png'))?.error).toBeNull();
    expect(same.confirmReplace).not.toHaveBeenCalled();
    expect(same.writeFile).not.toHaveBeenCalled();
    expect(await exportOne(other, DOC, 'images', block!, 'orders', 'png')).toBeNull();
    expect(other.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/orders.png', false)], false);
    expect(other.writeFile).not.toHaveBeenCalled();
  });
});

describe('preparePng', () => {
  // No name: a copy needs none.
  const [block] = findPlantUmlBlocks('```plantuml\nx\n```');
  const sized = (width: number, height: number): ExporterDeps['render'] =>
    vi.fn(() =>
      Promise.resolve(rendered(`<svg viewBox="0 0 10 10" width="${String(width)}" height="${String(height)}"><g/></svg>`))
    );

  it('gives what a PNG export would be drawn from, without drawing or writing it', async () => {
    const deps = makeDeps({ render: sized(100.5, 50) });

    expect(await preparePng(deps, block!)).toEqual({
      svg: expect.stringContaining('<rect x="0" y="0" width="10" height="10" fill="#FFFFFF"/>') as unknown,
      width: 201,
      height: 100,
      background: '#FFFFFF',
    });
    expect(deps.render).toHaveBeenCalledWith('x', false);
    expect(deps.toPng).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('uses the export palette and scale, and the other palette for a diagram unreadable in it', async () => {
    const dark = makeDeps({ render: sized(10, 10), isDark: () => true, pngScale: () => 4 });
    const turned = makeDeps({ render: sized(10, 10), resolvePalette: () => Promise.resolve(true) });

    expect(await preparePng(dark, block!)).toMatchObject({ width: 40, height: 40, background: '#1b1b1b' });
    expect(dark.render).toHaveBeenCalledWith('x', true);
    expect(await preparePng(turned, block!)).toMatchObject({ background: '#1b1b1b' });
  });

  it('refuses what a PNG export refuses, for the same reasons', async () => {
    const [remote] = findPlantUmlBlocks('```plantuml\n@startuml\n!include https://example.com/x.puml\n@enduml\n```');
    const [pages] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B\nnewpage\nC -> D\n@enduml\n```');
    const [several] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml\n```');
    const [broken] = findPlantUmlBlocks('```plantuml\n@startuml\nAlice -> Bob\nthis is not valid ;;; [[[\n@enduml\n```');
    const engineError = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('syntax-error')))) });
    const emoji = makeDeps({
      render: vi.fn(() => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js'))),
    });

    expect(await preparePng(makeDeps(), remote!)).toMatchObject({ error: 'remote references are not supported' });
    expect(await preparePng(makeDeps(), pages!)).toMatchObject({ error: 'no pages' });
    expect(await preparePng(makeDeps(), several!)).toMatchObject({ error: 'one diagram per block' });
    expect(await preparePng(engineError, broken!)).toMatchObject({
      error: 'engine: Syntax Error? (Assumed diagram type: sequence) @ 4',
      cause: 'source',
    });
    expect(await preparePng(emoji, block!)).toMatchObject({ error: 'emoji are not available', cause: 'source' });
    expect(await preparePng(makeDeps({ render: sized(3000, 2000), pngScale: () => 4 }), block!)).toMatchObject({
      error: 'too large: 12000×8000, fits 1',
      fitsAt: 1,
    });
    expect(await preparePng(makeDeps({ render: vi.fn(() => Promise.resolve(rendered('<svg><g/></svg>'))) }), block!)).toMatchObject({
      error: 'no PNG',
    });
  });
});

describe('prepareSvg', () => {
  // No name: a copy needs none.
  const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

  it('gives the SVG an export would write, with its background, without writing it', async () => {
    const deps = makeDeps();

    expect(await prepareSvg(deps, block!)).toEqual({
      svg: '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>x</svg>',
      notes: [],
    });
    expect(deps.render).toHaveBeenCalledWith('x', false);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.toPng).not.toHaveBeenCalled();
  });

  it('uses the export palette, and notes what the engine draws the diagram without', async () => {
    const dark = makeDeps({ isDark: () => true });
    expect(await prepareSvg(dark, block!)).toMatchObject({ svg: expect.stringContaining('fill="#1b1b1b"') as unknown });
    expect(dark.render).toHaveBeenCalledWith('x', true);

    const [formula] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B : <math>x</math>\n@enduml\n```');
    expect(await prepareSvg(makeDeps(), formula!)).toMatchObject({ notes: ['formula <math>'] });
  });

  it('refuses what an SVG export refuses, and text past what the clipboard is given', async () => {
    const [remote] = findPlantUmlBlocks('```plantuml\n@startuml\n!include https://example.com/x.puml\n@enduml\n```');
    const [broken] = findPlantUmlBlocks('```plantuml\n@startuml\nAlice -> Bob\nthis is not valid ;;; [[[\n@enduml\n```');
    const engineError = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(engineOutput('syntax-error')))) });

    expect(await prepareSvg(makeDeps(), remote!)).toMatchObject({ error: 'remote references are not supported', cause: 'source' });
    expect(await prepareSvg(engineError, broken!)).toMatchObject({
      error: 'engine: Syntax Error? (Assumed diagram type: sequence) @ 4',
      cause: 'source',
    });
    // The size of a PNG is no condition; the text is what counts, in UTF-8
    // bytes: two per character here.
    const huge = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(`<svg>${'é'.repeat(SVG_TEXT_LIMIT / 2)}</svg>`))), pngScale: () => 4 });
    expect(await prepareSvg(huge, block!)).toMatchObject({ error: expect.stringMatching(/^too long: 3355\d{4}$/) as unknown, cause: 'text' });
    const fits = makeDeps({ render: vi.fn(() => Promise.resolve(rendered(`<svg>${'a'.repeat(SVG_TEXT_LIMIT - 64)}</svg>`))) });
    expect(await prepareSvg(fits, block!)).toMatchObject({ notes: [] });
  });
});

describe('writeDocuments', () => {
  it('writes what several documents drew, asking once before replacing their files', async () => {
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('replace' as const)) },
      { '/repo/a/images/one.svg': 'old one', '/repo/b/images/two.svg': 'old two' }
    );
    const drawn = [
      await drawMarkdown(deps, '/repo/a/doc.md', '```plantuml one\na\n```\n\n```plantuml\nx\n```'),
      await drawMarkdown(deps, '/repo/b/doc.md', '```plantuml two\nb\n```'),
    ];

    const outcome = await writeDocuments(deps, deps.buffer, drawn);

    expect(deps.confirmReplace).toHaveBeenCalledOnce();
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/a/images/one.svg'), asked('/repo/b/images/two.svg')], true);
    expect(outcome?.written.map((r) => r.path)).toEqual(['/repo/a/images/one.svg', '/repo/b/images/two.svg']);
    expect(outcome?.unnamed).toBe(1);
  });

  it('fails every diagram headed for the same file, whatever the case, before drawing any of them', async () => {
    const deps = makeDeps();
    const plans = refuseSharedFiles(deps, [
      planDocument(deps, '/repo/docs/a.md', 'images', findPlantUmlBlocks('```plantuml orders\na\n```\n\n```plantuml billing\nc\n```')),
      planDocument(deps, '/repo/docs/b.md', 'images', findPlantUmlBlocks('```plantuml Orders\nb\n```')),
    ]);
    const drawn = [await drawDocument(deps, deps.buffer, plans[0]!), await drawDocument(deps, deps.buffer, plans[1]!)];

    const outcome = await writeDocuments(deps, deps.buffer, drawn);

    expect(outcome?.written.map((r) => r.path)).toEqual(['/repo/docs/images/billing.svg']);
    expect(outcome?.failed).toEqual([
      { name: 'orders', path: null, error: 'same file', cause: 'source' },
      { name: 'Orders', path: null, error: 'same file', cause: 'source' },
    ]);
    expect(deps.render).toHaveBeenCalledOnce();
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('stops writing once told to, and counts what it did not write', async () => {
    const deps = makeDeps();
    const drawn = [await drawMarkdown(deps, DOC, '```plantuml one\na\n```\n\n```plantuml two\nb\n```\n\n```plantuml three\nc\n```')];
    let written = 0;

    const outcome = await writeDocuments(deps, deps.buffer, drawn, () => (written += 1) > 1);

    expect(outcome?.written.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.stopped).toBe(2);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('stops writing once what it wrote cannot be recorded, and keeps writing past a full record', async () => {
    const text = '```plantuml one\na\n```\n\n```plantuml two\nb\n```\n\n```plantuml three\nc\n```';
    const unsaved = makeDeps({ record: vi.fn(() => Promise.resolve('not-saved' as const)) });
    const full = makeDeps({ record: vi.fn(() => Promise.resolve('full' as const)) });

    const stopped = await writeDocuments(unsaved, unsaved.buffer, [await drawMarkdown(unsaved, DOC, text)]);
    const going = await writeDocuments(full, full.buffer, [await drawMarkdown(full, DOC, text)]);

    expect(stopped?.untracked.map((r) => [r.name, r.untracked])).toEqual([['one', 'not-saved']]);
    expect(stopped?.written).toEqual([]);
    expect(stopped?.stopped).toBe(2);
    expect(unsaved.writeFile).toHaveBeenCalledOnce();
    expect(going?.untracked.map((r) => r.name)).toEqual(['one', 'two', 'three']);
    expect(going?.stopped).toBe(0);
  });

  it('draws and writes PNGs when asked to', async () => {
    const deps = makeDeps({
      render: vi.fn(() => Promise.resolve(rendered('<svg viewBox="0 0 10 10" width="30" height="20"><g/></svg>'))),
    });
    const drawn = [
      await drawMarkdown(deps, '/repo/a/doc.md', '```plantuml one\na\n```\n\n```plantuml\nx\n```', 'png'),
      await drawMarkdown(deps, '/repo/b/doc.md', '```plantuml two\nb\n```', 'png'),
    ];

    const outcome = await writeDocuments(deps, deps.buffer, drawn);

    expect(deps.toPng).toHaveBeenCalledTimes(2);
    expect(outcome?.written.map((r) => r.path)).toEqual(['/repo/a/images/one.png', '/repo/b/images/two.png']);
    expect(outcome?.unnamed).toBe(1);
    expect(deps.writeFile).toHaveBeenCalledWith('/repo/a/images/one.png', pngOf(60, 40), false);
  });
});

describe('holding what is drawn', () => {
  const THREE = '```plantuml one\na\n```\n\n```plantuml two\nb\n```\n\n```plantuml three\nc\n```';
  /** What a block of `source` is written as. */
  const svgOf = (source: string): string => `<svg><rect width="100%" height="100%" fill="#FFFFFF"/>${source}</svg>`;

  it('holds drawings past the limit in files beside their own, writes them from there, and deletes those files', async () => {
    const deps = makeDeps();
    // Room for one drawing of the three.
    const buffer = new OutputBuffer(deps, svgOf('a').length + 1);

    const outcome = await writeDocuments(deps, buffer, [await drawMarkdown(deps, DOC, THREE, 'svg', buffer)]);

    expect(deps.spool.mock.calls.map(([path]) => path as string)).toEqual(['/repo/docs/images/two.svg', '/repo/docs/images/three.svg']);
    expect(outcome?.written.map((r) => r.name)).toEqual(['one', 'two', 'three']);
    expect(deps.writeFile.mock.calls.map(([path, content]) => [path as string, textOf(content)])).toEqual([
      ['/repo/docs/images/one.svg', svgOf('a')],
      ['/repo/docs/images/two.svg', svgOf('b')],
      ['/repo/docs/images/three.svg', svgOf('c')],
    ]);
    // Each recorded as what was written, wherever it waited.
    expect(deps.ledger.ownerOf('/repo/docs/images/three.svg')?.sha256).toBe(sha256(new TextEncoder().encode(svgOf('c'))));
    expect(deps.deleteSpool).toHaveBeenCalledTimes(2);
    expect(heldFiles(deps)).toEqual([]);
  });

  it('writes nothing from a file changed or gone while it waited, and writes the rest', async () => {
    const deps = makeDeps();
    const buffer = new OutputBuffer(deps, svgOf('a').length + 1);
    const drawn = await drawMarkdown(deps, DOC, THREE, 'svg', buffer);
    const [two, three] = heldFiles(deps);
    deps.disk.set(two!, new TextEncoder().encode(svgOf('B')));
    deps.disk.delete(three!);

    const outcome = await writeDocuments(deps, buffer, [drawn]);

    expect(outcome?.written.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.failed).toEqual([
      { name: 'two', path: null, error: 'held copy changed', cause: 'file' },
      { name: 'three', path: null, error: 'held copy changed', cause: 'file' },
    ]);
    expect(deps.writeFile).toHaveBeenCalledOnce();
    expect(deps.disk.has('/repo/docs/images/two.svg')).toBe(false);
  });

  it('deletes what it held in files when replacing is declined, and writes nothing', async () => {
    const deps = makeDeps({}, { '/repo/docs/images/one.svg': 'by hand' });
    const buffer = new OutputBuffer(deps, svgOf('a').length + 1);
    const drawn = await drawMarkdown(deps, DOC, THREE, 'svg', buffer);
    expect(heldFiles(deps)).toHaveLength(2);

    const outcome = await writeDocuments(deps, buffer, [drawn]);
    await buffer.dispose();

    expect(outcome).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(heldFiles(deps)).toEqual([]);
    expect(deps.disk.get('/repo/docs/images/one.svg')).toBe('by hand');
  });

  it('deletes the file of each drawing it does not write as it goes: kept, up to date, refused or stopped', async () => {
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('keep' as const)), isDirty: (path: string) => path.endsWith('/four.svg') },
      { '/repo/docs/images/two.svg': 'by hand', '/repo/docs/images/three.svg': svgOf('c') }
    );
    const buffer = new OutputBuffer(deps, 0);
    const drawn = await drawMarkdown(deps, DOC, `${THREE}\n\n\`\`\`plantuml four\nd\n\`\`\`\n\n\`\`\`plantuml five\ne\n\`\`\``, 'svg', buffer);
    expect(heldFiles(deps)).toHaveLength(5);
    let turns = 0;

    const outcome = await writeDocuments(deps, buffer, [drawn], () => (turns += 1) > 1);

    expect(outcome).toMatchObject({ kept: 1, stopped: 1 });
    expect(outcome?.written.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.unchanged.map((r) => r.name)).toEqual(['three']);
    expect(outcome?.failed.map((r) => [r.name, r.error])).toEqual([['four', 'unsaved changes']]);
    // Before the export lets go of what is left.
    expect(heldFiles(deps)).toEqual([]);
  });

  it('fails a drawing it cannot hold, and draws the rest', async () => {
    const deps = makeDeps({
      spool: vi.fn((path: string) =>
        path.endsWith('/two.svg') ? Promise.reject(new Error('EACCES')) : Promise.resolve({ file: `${path}.held`, made: [] })
      ),
    });
    const buffer = new OutputBuffer(deps, svgOf('a').length + 1);

    const drawn = await drawMarkdown(deps, DOC, THREE, 'svg', buffer);

    expect(drawn.drawings.map((drawing) => drawing.name)).toEqual(['one', 'three']);
    expect(drawn.failed).toEqual([{ name: 'two', path: null, error: 'EACCES', cause: 'file' }]);
  });

  it('lets go of what it holds however Export All and Export Diagram end', async () => {
    const dispose = vi.spyOn(OutputBuffer.prototype, 'dispose');
    try {
      const [block] = findPlantUmlBlocks('```plantuml one\na\n```');
      // Declined.
      const declined = makeDeps({}, { '/repo/docs/images/one.svg': 'by hand' });
      expect(await exportMarkdown(declined, DOC, 'images', THREE)).toBeNull();
      expect(await exportOne(declined, DOC, 'images', block!, 'one')).toBeNull();
      // The question failing.
      const failing = makeDeps({ confirmReplace: vi.fn(() => Promise.reject(new Error('gone'))) }, { '/repo/docs/images/one.svg': 'by hand' });
      await expect(exportMarkdown(failing, DOC, 'images', THREE)).rejects.toThrow('gone');
      await expect(exportOne(failing, DOC, 'images', block!, 'one')).rejects.toThrow('gone');

      expect(dispose).toHaveBeenCalledTimes(4);
    } finally {
      dispose.mockRestore();
    }
  });

  // Drawing past the limit takes seconds under coverage.
  const LARGE = { timeout: 30_000 };

  it(`holds at most ${String(OUTPUT_BUFFER_LIMIT / 1024 / 1024)} MiB of drawings in memory, and Export Diagram its one drawing`, LARGE, async () => {
    // Four drawings of 17 MiB: the fourth would take the total past 64 MiB.
    const large = (source: string): string => `<svg>${source.repeat(17 * 1024 * 1024)}</svg>`;
    const deps = makeDeps({ render: vi.fn((source: string) => Promise.resolve(rendered(large(source)))) });
    const document = ['a', 'b', 'c', 'd'].map((source, index) => `\`\`\`plantuml d${String(index)}\n${source}\n\`\`\``).join('\n\n');

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(deps.spool.mock.calls.map(([path]) => path as string)).toEqual(['/repo/docs/images/d3.svg']);
    expect(outcome?.written).toHaveLength(4);
    expect(sha256(deps.disk.get('/repo/docs/images/d3.svg') as Uint8Array)).toBe(
      sha256(new TextEncoder().encode(addBackground(large('d'), false)))
    );
    expect(heldFiles(deps)).toEqual([]);

    const [block] = findPlantUmlBlocks('```plantuml one\ne\n```');
    expect((await exportOne(deps, DOC, 'images', block!, 'one'))?.error).toBeNull();
    expect(deps.spool).toHaveBeenCalledOnce();
  });
});

describe('exportAll', () => {
  const document = [
    '```plantuml one',
    'a',
    '```',
    '',
    '```plantuml two',
    'b',
    '```',
    '',
    '```plantuml',
    'unnamed',
    '```',
  ].join('\n');

  it('exports every named block and counts the unnamed ones', async () => {
    const deps = makeDeps();

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.written.map((r) => r.name)).toEqual(['one', 'two']);
    expect(outcome?.failed).toHaveLength(0);
    // Unnamed blocks are skipped rather than given a positional name,
    // which would move whenever a block is inserted above them.
    expect(outcome?.unnamed).toBe(1);
    expect(deps.render).toHaveBeenCalledTimes(2);
  });

  it('keeps going after one diagram fails', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        source === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(rendered('<svg/>'))
      ),
    });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
  });

  it('counts an error diagram as a failure and writes the rest', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        Promise.resolve(rendered(source === 'a' ? engineOutput('include-failure') : engineOutput('sequence')))
      ),
    });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.failed[0]?.error).toBe('engine: cannot include shared.puml @ 3');
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('says why an include failed, for the file the engine asked for', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        Promise.resolve(
          source === 'a'
            ? { ...rendered(engineOutput('include-failure')), failedIncludes: new Map([['shared.puml', 'not found']]) }
            : rendered(engineOutput('sequence'))
        )
      ),
    });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.failed[0]?.error).toBe('engine: cannot include shared.puml: not found @ 3');
    expect(outcome?.failed[0]?.engineError).toEqual({ message: 'cannot include shared.puml: not found', line: 3 });
  });

  it('reports progress for each diagram', async () => {
    const seen: string[] = [];
    await exportMarkdown(makeDeps(), DOC, 'images', document, (done, total, name) => {
      seen.push(`${String(done)}/${String(total)} ${name}`);
    });

    expect(seen).toEqual(['0/2 one', '1/2 two']);
  });

  it('refuses a name that could escape the export directory, rather than counting it as no name', async () => {
    const deps = makeDeps();
    const outcome = await exportMarkdown(
      deps,
      DOC,
      'images',
      `\`\`\`plantuml ../evil\nx\n\`\`\`\n\n\`\`\`plantuml ${'a'.repeat(129)}\ny\n\`\`\``
    );

    expect(outcome?.written).toHaveLength(0);
    expect(outcome?.failed.map((r) => r.error)).toEqual(['unusable name', 'unusable name']);
    expect(outcome?.unnamed).toBe(0);
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('asks once before replacing the files that hold something else', async () => {
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('replace' as const)) },
      { '/repo/docs/images/one.svg': 'old one', '/repo/docs/images/two.svg': 'old two' }
    );

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(deps.confirmReplace).toHaveBeenCalledOnce();
    expect(deps.confirmReplace).toHaveBeenCalledWith(
      [asked('/repo/docs/images/one.svg'), asked('/repo/docs/images/two.svg')],
      true
    );
    expect(outcome?.written.map((r) => r.name)).toEqual(['one', 'two']);
    expect(deps.writeFile.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['/repo/docs/images/one.svg', true],
      ['/repo/docs/images/two.svg', true],
    ]);
  });

  it('keeps the existing files when told to, and writes the rest', async () => {
    const deps = makeDeps(
      { confirmReplace: vi.fn(() => Promise.resolve('keep' as const)) },
      { '/repo/docs/images/one.svg': 'old one' }
    );

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    // One file to replace, but another diagram to write: keeping is a choice.
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/one.svg')], true);
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
    expect(outcome?.kept).toBe(1);
    expect(deps.writeFile).toHaveBeenCalledOnce();
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/two.svg',
      '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>b</svg>',
      false
    );
  });

  it('writes nothing at all when replacing is declined', async () => {
    const deps = makeDeps({}, { '/repo/docs/images/two.svg': 'old two' });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('asks only about the files it did not write, and replaces its own whatever the answer', async () => {
    const deps = makeDeps({ confirmReplace: vi.fn(() => Promise.resolve('keep' as const)) });
    await exportMarkdown(deps, DOC, 'images', document);
    await deps.writeFile('/repo/docs/images/two.svg', 'edited', true);
    deps.writeFile.mockClear();

    const changed = document.replace('\na\n', '\nA\n').replace('\nb\n', '\nB\n');
    const outcome = await exportMarkdown(deps, DOC, 'images', changed);

    expect(deps.confirmReplace).toHaveBeenCalledOnce();
    expect(deps.confirmReplace).toHaveBeenCalledWith([asked('/repo/docs/images/two.svg')], true);
    expect(outcome?.written.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.kept).toBe(1);
    expect(deps.writeFile.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['/repo/docs/images/one.svg', true],
    ]);
  });

  it('leaves its own file when it changed while the question about another was open', async () => {
    const deps = makeDeps();
    await exportMarkdown(deps, DOC, 'images', document);
    await deps.writeFile('/repo/docs/images/two.svg', 'edited', true);
    deps.confirmReplace.mockImplementation(async () => {
      await deps.writeFile('/repo/docs/images/one.svg', 'edited meanwhile', true);
      return 'keep';
    });

    const changed = document.replace('\na\n', '\nA\n').replace('\nb\n', '\nB\n');
    const outcome = await exportMarkdown(deps, DOC, 'images', changed);

    expect(outcome?.written).toEqual([]);
    expect(outcome?.failed).toEqual([{ name: 'one', path: null, error: 'changed meanwhile', cause: 'file' }]);
    expect(outcome?.kept).toBe(1);
    const now = await deps.readExisting('/repo/docs/images/one.svg');
    expect(new TextDecoder().decode(now!)).toBe('edited meanwhile');
  });

  it('does not ask about a file that already holds its diagram', async () => {
    const deps = makeDeps(
      {},
      { '/repo/docs/images/one.svg': '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>a</svg>' }
    );

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
    expect(outcome?.unchanged.map((r) => r.name)).toEqual(['one']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('fails every block of the same name, rather than writing one of them', async () => {
    const deps = makeDeps();
    const outcome = await exportMarkdown(deps, DOC, 'images', '```plantuml one\na\n```\n\n```plantuml one\nb\n```\n\n```plantuml two\nc\n```');

    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
    expect(outcome?.failed.map((r) => [r.name, r.error])).toEqual([
      ['one', 'same file'],
      ['one', 'same file'],
    ]);
    expect(deps.render).toHaveBeenCalledOnce();
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('returns an empty outcome for a document with no diagrams', async () => {
    const outcome = await exportMarkdown(makeDeps(), DOC, 'images', '# Title\n\nProse only.');
    expect(outcome).toEqual({ written: [], unchanged: [], untracked: [], failed: [], unnamed: 0, kept: 0, stopped: 0 });
  });

  it('refuses a URL-based include without rendering it', async () => {
    // The preview rejects these before the engine sees them; export has to
    // agree, or the same block would write out an error diagram as a file.
    const deps = makeDeps();
    const outcome = await exportMarkdown(
      deps,
      DOC,
      'images',
      '```plantuml remote\n!include https://evil.example/x.puml\n```'
    );

    expect(outcome?.failed.map((r) => r.error)).toEqual(['remote references are not supported']);
    // Not the engine's error: there is no engine message or line to restate.
    expect(outcome?.failed[0]?.engineError).toBeUndefined();
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a block with two diagrams or with pages, rather than writing part of it', async () => {
    const deps = makeDeps();
    const outcome = await exportMarkdown(
      deps,
      DOC,
      'images',
      [
        '```plantuml two',
        '@startuml',
        'A -> B',
        '@enduml',
        '@startuml',
        'C -> D',
        '@enduml',
        '```',
        '',
        '```plantuml paged',
        '@startuml',
        'A -> B',
        'newpage',
        'C -> D',
        '@enduml',
        '```',
      ].join('\n')
    );

    expect(outcome?.failed.map((r) => [r.name, r.error])).toEqual([
      ['two', 'one diagram per block'],
      ['paged', 'no pages'],
    ]);
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('exports a diagram missing its end line with the line added', async () => {
    const deps = makeDeps();
    const outcome = await exportMarkdown(deps, DOC, 'images', '```plantuml open\n@startuml\nA -> B\n```');

    expect(outcome?.written.map((r) => r.name)).toEqual(['open']);
    expect(deps.render).toHaveBeenCalledWith('@startuml\nA -> B\n@enduml', false);
  });

  it('exports each diagram of a PlantUML file on its own, under its id', async () => {
    const file = [
      "' the order flow",
      '@startuml(id=orders)',
      'A -> B',
      '@enduml',
      '',
      '@startuml',
      'C -> D',
      '@enduml',
      '',
      '@startuml(id=billing)',
      'E -> F',
      '@enduml',
    ].join('\n');
    const deps = makeDeps();

    const outcome = await exportAll(deps, '/repo/docs/flows.puml', 'images', findFileDiagrams(file, 'flows'));

    // One diagram at a time: given the whole file, the engine draws the first only.
    expect(deps.render.mock.calls.map((call) => call[0])).toEqual([
      '@startuml(id=orders)\nA -> B\n@enduml',
      '@startuml(id=billing)\nE -> F\n@enduml',
    ]);
    expect(outcome?.written.map((r) => r.path)).toEqual([
      '/repo/docs/images/orders.svg',
      '/repo/docs/images/billing.svg',
    ]);
    expect(outcome?.unnamed).toBe(1);
    // Named by their ids, which the file's own name does not share.
    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.key).toMatchObject({
      documentUri: '/repo/docs/flows.puml',
      container: 'plantuml-file',
      nameBasis: 'explicit-id',
      name: 'orders',
    });
  });

  it('names the line of the PlantUML file an engine error points to', async () => {
    const file = [
      '@startuml(id=first)',
      'A -> B',
      '@enduml',
      '',
      '@startuml(id=broken)',
      'Alice -> Bob',
      'this is not valid ;;; [[[',
      '@enduml',
    ].join('\n');
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        Promise.resolve(rendered(source.includes('broken') ? engineOutput('syntax-error') : '<svg/>'))
      ),
    });

    const outcome = await exportAll(deps, '/repo/docs/flows.puml', 'images', findFileDiagrams(file, 'flows'));

    // The engine blames line 3 of the diagram, which is line 7 of the file.
    expect(outcome?.failed.map((r) => [r.name, r.error])).toEqual([
      ['broken', 'engine: Syntax Error? (Assumed diagram type: sequence) @ 7'],
    ]);
    expect(outcome?.written.map((r) => r.name)).toEqual(['first']);
  });
});

describe('the record of what an image was drawn from', () => {
  /** A drawing taken with the reads of an export, which says what it was drawn from: no local include. */
  const withInputs = (svg: string): DiagramRender => ({
    ...rendered(svg),
    log: { requests: [], libraries: [] },
    inputs: { context: null, requests: [], files: [] },
  });
  const drawing = (): Partial<ExporterDeps> => ({
    render: vi.fn((source: string) => Promise.resolve(withInputs(`<svg width="40" height="20" viewBox="0 0 40 20">${source}</svg>`))),
  });
  const hashed = (text: string): string => sha256(new TextEncoder().encode(text));

  it('records with each file written what it was drawn from, as recorded for its diagram', async () => {
    const deps = makeDeps(drawing());
    const text = '# Guide\r\n\r\n```plantuml orders\r\nAlice -> Bob\r\n```\r\n';
    const [block] = findPlantUmlBlocks(text);

    await exportOne(deps, DOC, 'images', block!, 'orders');

    const input = deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.input;
    expect(input).toMatchObject({
      schema: 'plantuml-local-input-v1',
      // The diagram as the document holds it, and as the engine was given it.
      input: { source: hashed('Alice -> Bob\r\n'), render: hashed('Alice -> Bob') },
      context: null,
      resources: { requests: [], files: [], libraries: [] },
      renderer: { ...RENDERER, raster: null, contract: 1 },
      options: { format: 'svg', palette: { asked: 'light', drawn: 'light' }, pngScale: null },
      completeness: 'complete',
      replay: { class: 'stable-inputs', rules: 1, reasons: [] },
    });
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders' }), '/repo/docs/images/orders.svg', expect.anything(), input);
    expect(isInputManifest(JSON.parse(JSON.stringify(input)), deps.ledger.ownerOf('/repo/docs/images/orders.svg')!.key)).toBe(true);
  });

  it('records the palette asked for and the one drawn in, and for a PNG its scale and what drew it', async () => {
    const deps = makeDeps({ ...drawing(), isDark: () => true, resolvePalette: () => Promise.resolve(false) });
    const [block] = findPlantUmlBlocks('```plantuml orders\nAlice -> Bob : <math>x^2</math>\n```');

    await exportOne(deps, DOC, 'images', block!, 'orders', 'png');

    expect(deps.ledger.ownerOf('/repo/docs/images/orders.png')?.input).toMatchObject({
      renderer: { raster: RENDERER.raster },
      options: { format: 'png', palette: { asked: 'dark', drawn: 'light' }, pngScale: 2 },
      // Drawn without its formula.
      completeness: 'known-loss',
    });
  });

  it('records none for a name asked for, a drawing that does not say what it was drawn from, or a renderer that cannot be told', async () => {
    const asked = makeDeps(drawing());
    const silent = makeDeps();
    const untold = makeDeps({ ...drawing(), rendererIdentity: () => Promise.resolve(null) });
    const [named] = findPlantUmlBlocks('```plantuml orders\nAlice -> Bob\n```');
    const [unnamed] = findPlantUmlBlocks('```plantuml\nAlice -> Bob\n```');

    await exportOne(asked, DOC, 'images', unnamed!, 'billing');
    await exportOne(silent, DOC, 'images', named!, 'orders');
    await exportOne(untold, DOC, 'images', named!, 'orders');

    expect(asked.record).not.toHaveBeenCalled();
    for (const deps of [silent, untold]) {
      expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')).not.toBeNull();
      expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')).not.toHaveProperty('input');
    }
  });

  it('records again what a diagram was drawn from when its file is written again', async () => {
    const deps = makeDeps(drawing());
    const [first] = findPlantUmlBlocks('```plantuml orders\nAlice -> Bob\n```');
    const [second] = findPlantUmlBlocks('```plantuml orders\nAlice -> Carol\n```');

    await exportOne(deps, DOC, 'images', first!, 'orders');
    const before = deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.input?.fingerprint;
    await exportOne(deps, DOC, 'images', second!, 'orders');

    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.input?.input.source).toBe(hashed('Alice -> Carol\n'));
    expect(deps.ledger.ownerOf('/repo/docs/images/orders.svg')?.input?.fingerprint).not.toBe(before);
  });

  describe('a file that holds its image already', () => {
    const target = '/repo/docs/images/orders.svg';
    const [block] = findPlantUmlBlocks('```plantuml orders\nAlice -> Bob\n```');
    /** The same image each time, drawn from the text the included file has then, by its SHA-256. */
    const including = (): { deps: ReturnType<typeof makeDeps>; edit: (sha256: string) => void; included: () => string | undefined } => {
      let part = 'a'.repeat(64);
      const deps = makeDeps({
        render: vi.fn(() =>
          Promise.resolve({
            ...withInputs('<svg width="40" height="20" viewBox="0 0 40 20">same</svg>'),
            inputs: { context: null, requests: [], files: [{ file: '/repo/docs/part.iuml', sha256: part, origin: 'disk' as const, findings: [] }] },
          })
        ),
      });
      return {
        deps,
        edit: (sha256) => {
          part = sha256;
        },
        included: () => deps.ledger.ownerOf(target)?.input?.resources.files[0]?.sha256,
      };
    };

    it('records what it was drawn from this time when it is the diagram\'s own export, and writes nothing', async () => {
      const { deps, edit, included } = including();
      await exportOne(deps, DOC, 'images', block!, 'orders');
      // A comment changed in the included file: the image is the same.
      edit('b'.repeat(64));

      expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toMatchObject({ unchanged: true });
      expect(included()).toBe('b'.repeat(64));
      expect(deps.writeFile).toHaveBeenCalledTimes(1);
      // Drawn from the same again, the record is not touched.
      deps.record.mockClear();
      await exportOne(deps, DOC, 'images', block!, 'orders');
      expect(deps.record).not.toHaveBeenCalled();
    });

    it('takes no file for the diagram\'s own that it did not export', async () => {
      const exported = including().deps;
      await exportOne(exported, DOC, 'images', block!, 'orders');
      const { deps } = including();
      // The same image, put there by another workspace's export, say.
      deps.disk.set(target, exported.disk.get(target)!);

      expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toMatchObject({ unchanged: true });
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.ledger.ownerOf(target)).toBeNull();
    });

    it('records nothing when the file changed after it was looked at, and says why it could not be read', async () => {
      const { deps, edit, included } = including();
      await exportOne(deps, DOC, 'images', block!, 'orders');
      const image = deps.disk.get(target)!;
      edit('b'.repeat(64));
      const lock = deps.lock;
      deps.lock = (path, task) => {
        deps.disk.set(path, 'edited by hand meanwhile');
        return lock(path, task);
      };

      expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toMatchObject({ unchanged: true });
      expect(included()).toBe('a'.repeat(64));

      deps.disk.set(target, image);
      deps.lock = (path, task) => {
        deps.readExisting = () => Promise.reject(new Error('the file is locked'));
        return lock(path, task);
      };
      expect(await exportOne(deps, DOC, 'images', block!, 'orders')).toMatchObject({ error: 'the file is locked' });
      expect(included()).toBe('a'.repeat(64));
    });

    it('records nothing once the export stops, told to or as the state took no record', async () => {
      const { deps, edit, included } = including();
      await exportOne(deps, DOC, 'images', block!, 'orders');
      edit('b'.repeat(64));
      const text = '```plantuml orders\nAlice -> Bob\n```';

      const told = await writeDocuments(deps, deps.buffer, [await drawMarkdown(deps, DOC, text)], () => true);
      expect(told?.unchanged.map((r) => r.name)).toEqual(['orders']);
      expect(included()).toBe('a'.repeat(64));

      // A new file first, whose record is not taken.
      deps.record.mockClear();
      deps.record.mockImplementation(() => Promise.resolve('not-saved' as const));
      const halted = await writeDocuments(deps, deps.buffer, [await drawMarkdown(deps, DOC, `\`\`\`plantuml first\nA\n\`\`\`\n\n${text}`)]);
      expect(halted?.untracked.map((r) => r.name)).toEqual(['first']);
      expect(halted?.unchanged.map((r) => r.name)).toEqual(['orders']);
      expect(deps.record).toHaveBeenCalledOnce();
    });
  });
});
