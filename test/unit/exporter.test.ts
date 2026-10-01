import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { findFileDiagrams, findPlantUmlBlocks } from '../../src/export/blocks';
import {
  addBackground,
  exportAll,
  exportOne,
  isValidExportDirectory,
  type ExporterDeps,
} from '../../src/export/exporter';

function makeDeps(
  overrides?: Partial<ExporterDeps>,
  files?: Record<string, string>
): ExporterDeps & {
  writeFile: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  confirmReplace: ReturnType<typeof vi.fn>;
} {
  // The files already there, by path: read back before writing.
  const disk = new Map(Object.entries(files ?? {}));
  const deps = {
    render: vi.fn((source: string) => Promise.resolve(`<svg>${source}</svg>`)),
    isDark: (): boolean => false,
    resolvePalette: (_source: string, dark: boolean): Promise<boolean> => Promise.resolve(dark),
    readExisting: (path: string): Promise<string | null> => Promise.resolve(disk.get(path) ?? null),
    // Declines, so a question no test expected writes nothing.
    confirmReplace: vi.fn((): Promise<'replace' | 'keep' | undefined> => Promise.resolve(undefined)),
    writeFile: vi.fn((path: string, content: string) => {
      disk.set(path, content);
      return Promise.resolve();
    }),
    // Mimics joining a document URI's folder with a relative path.
    resolve: (documentPath: string, relative: string): string =>
      `${documentPath.slice(0, documentPath.lastIndexOf('/'))}/${relative}`,
    remoteReferenceMessage: 'remote references are not supported',
    emojiUnavailableMessage: 'emoji are not available',
    invalidNameMessage: 'unusable name',
    severalDiagramsMessage: 'one diagram per block',
    pagesMessage: 'no pages',
    engineErrorMessage: (message: string, line: number | null): string =>
      `engine: ${message} @ ${String(line)}`,
    ...overrides,
  };
  return deps as ExporterDeps & {
    writeFile: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    confirmReplace: ReturnType<typeof vi.fn>;
  };
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

describe('isValidExportDirectory', () => {
  it('accepts a relative directory', () => {
    for (const value of ['images', '.', 'assets/diagrams', 'a/b/c']) {
      expect(isValidExportDirectory(value), value).toBe(true);
    }
  });

  it('rejects absolute paths and traversal', () => {
    // The value comes from settings; a mistyped one must not scatter
    // files outside the document's folder.
    for (const value of ['', '/etc', 'C:/temp', '\\\\server\\share', '../images', 'a/../../b']) {
      expect(isValidExportDirectory(value), value).toBe(false);
    }
  });
});

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
  });

  it('asks before replacing a file that holds something else, and leaves it when declined', async () => {
    // A file someone put there by hand, or the export of another diagram.
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': '<svg>hand-made</svg>' });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toBeNull();
    // With one diagram, there is nothing else to write: replace it or stop.
    expect(deps.confirmReplace).toHaveBeenCalledWith(['/repo/docs/images/orders.svg'], false);
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

  it('leaves a file that already holds the diagram alone, without asking', async () => {
    const svg = '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>x</svg>';
    const deps = makeDeps({}, { '/repo/docs/images/orders.svg': svg });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result).toEqual({ name: 'orders', path: '/repo/docs/images/orders.svg', error: null });
    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
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
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(engineOutput('syntax-error'))) });
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
    expect(result?.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a lone error message, which names no line', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(engineOutput('ebnf-error'))) });
    const [block] = findPlantUmlBlocks('```plantuml grammar\n@startebnf\nrule = "a" | ;;;\n@endebnf\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'grammar');

    expect(result?.error).toBe('engine: Syntax error! @ null');
    expect(result?.engineError).toEqual({ message: 'Syntax error!', line: null });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('still writes a diagram the engine drew with a warning', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(engineOutput('warning'))) });
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
        source === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve('<svg/>')
      ),
    });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
  });

  it('counts an error diagram as a failure and writes the rest', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        Promise.resolve(source === 'a' ? engineOutput('include-failure') : engineOutput('sequence'))
      ),
    });

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(outcome?.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome?.failed[0]?.error).toBe('engine: cannot include shared.puml @ 3');
    expect(outcome?.written.map((r) => r.name)).toEqual(['two']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
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
      ['/repo/docs/images/one.svg', '/repo/docs/images/two.svg'],
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
    expect(deps.confirmReplace).toHaveBeenCalledWith(['/repo/docs/images/one.svg'], true);
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

  it('does not ask about a file that already holds its diagram', async () => {
    const deps = makeDeps(
      {},
      { '/repo/docs/images/one.svg': '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>a</svg>' }
    );

    const outcome = await exportMarkdown(deps, DOC, 'images', document);

    expect(deps.confirmReplace).not.toHaveBeenCalled();
    expect(outcome?.written.map((r) => r.name)).toEqual(['one', 'two']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('returns an empty outcome for a document with no diagrams', async () => {
    const outcome = await exportMarkdown(makeDeps(), DOC, 'images', '# Title\n\nProse only.');
    expect(outcome).toEqual({ written: [], failed: [], unnamed: 0, kept: 0 });
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
        Promise.resolve(source.includes('broken') ? engineOutput('syntax-error') : '<svg/>')
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
