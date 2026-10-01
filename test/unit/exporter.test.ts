import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { findPlantUmlBlocks } from '../../src/export/blocks';
import {
  addBackground,
  exportAll,
  exportOne,
  isValidExportDirectory,
  type ExporterDeps,
} from '../../src/export/exporter';

function makeDeps(overrides?: Partial<ExporterDeps>): ExporterDeps & {
  writeFile: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
} {
  const written = new Map<string, string>();
  const deps = {
    render: vi.fn((source: string) => Promise.resolve(`<svg>${source}</svg>`)),
    isDark: (): boolean => false,
    resolvePalette: (_source: string, dark: boolean): Promise<boolean> => Promise.resolve(dark),
    writeFile: vi.fn((path: string, content: string) => {
      written.set(path, content);
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
  };
}

const DOC = '/repo/docs/design.md';

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

    expect(result.error).toBeNull();
    expect(result.path).toBe('/repo/docs/images/orders.svg');
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      '<svg><rect width="100%" height="100%" fill="#FFFFFF"/>@startuml\nA -> B\n@enduml</svg>'
    );
  });

  it('exports in the palette the theme can be read in, with the background of that palette', async () => {
    // A theme made for a dark page, exported with the light palette.
    const deps = makeDeps({ resolvePalette: () => Promise.resolve(true) });
    const [block] = findPlantUmlBlocks('```plantuml\n@startuml\n!theme cyborg\n@enduml\n```');

    await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(deps.render).toHaveBeenCalledWith('@startuml\n!theme cyborg\n@enduml', true);
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/repo/docs/images/orders.svg',
      expect.stringContaining('fill="#1b1b1b"')
    );
  });

  it('honours a directory of "." by writing next to the document', async () => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, '.', block!, 'orders');

    expect(result.path).toBe('/repo/docs/./orders.svg');
  });

  it('reports a render failure instead of throwing', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.reject(new Error('syntax error'))) });
    const [block] = findPlantUmlBlocks('```plantuml\nbroken\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result.error).toBe('syntax error');
    expect(result.path).toBeNull();
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
    expect(result.error).toBe('engine: Syntax Error? (Assumed diagram type: sequence) @ 7');
    // Kept apart too, for a caller that moves the block afterwards.
    expect(result.engineError).toEqual({
      message: 'Syntax Error? (Assumed diagram type: sequence)',
      line: 7,
    });
    expect(result.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a lone error message, which names no line', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(engineOutput('ebnf-error'))) });
    const [block] = findPlantUmlBlocks('```plantuml grammar\n@startebnf\nrule = "a" | ;;;\n@endebnf\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'grammar');

    expect(result.error).toBe('engine: Syntax error! @ null');
    expect(result.engineError).toEqual({ message: 'Syntax error!', line: null });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('still writes a diagram the engine drew with a warning', async () => {
    const deps = makeDeps({ render: vi.fn(() => Promise.resolve(engineOutput('warning'))) });
    const [block] = findPlantUmlBlocks('```plantuml flow\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'flow');

    expect(result.error).toBeNull();
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('explains a diagram that uses an emoji instead of passing on the engine error', async () => {
    const deps = makeDeps({
      render: vi.fn(() => Promise.reject(new Error('java.lang.RuntimeException: Failed to load emoji.js'))),
    });
    const [block] = findPlantUmlBlocks('```plantuml\n@startuml\nA -> B : <:smile:>\n@enduml\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');

    expect(result.error).toBe('emoji are not available');
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a block name that would escape the export directory', async () => {
    // The name comes from the document, so it is attacker-controlled when
    // the document is: `deps.resolve` collapses `..` the way Uri.joinPath
    // does, and a bare name would write wherever the block asked.
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml ../../evil\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, block!.name!);

    expect(result.path).toBeNull();
    expect(result.error).toBeTruthy();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it.each(['a/b', 'a\\b', '..', 'C:evil', 'x.svg'])('refuses the unusable name %j', async (name) => {
    const deps = makeDeps();
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, name);

    expect(result.path).toBeNull();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('reports a write failure', async () => {
    const deps = makeDeps({ writeFile: vi.fn(() => Promise.reject(new Error('EACCES'))) });
    const [block] = findPlantUmlBlocks('```plantuml\nx\n```');

    const result = await exportOne(deps, DOC, 'images', block!, 'orders');
    expect(result.error).toBe('EACCES');
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

    const outcome = await exportAll(deps, DOC, 'images', document);

    expect(outcome.written.map((r) => r.name)).toEqual(['one', 'two']);
    expect(outcome.failed).toHaveLength(0);
    // Unnamed blocks are skipped rather than given a positional name,
    // which would move whenever a block is inserted above them.
    expect(outcome.unnamed).toBe(1);
    expect(deps.render).toHaveBeenCalledTimes(2);
  });

  it('keeps going after one diagram fails', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        source === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve('<svg/>')
      ),
    });

    const outcome = await exportAll(deps, DOC, 'images', document);

    expect(outcome.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome.written.map((r) => r.name)).toEqual(['two']);
  });

  it('counts an error diagram as a failure and writes the rest', async () => {
    const deps = makeDeps({
      render: vi.fn((source: string) =>
        Promise.resolve(source === 'a' ? engineOutput('include-failure') : engineOutput('sequence'))
      ),
    });

    const outcome = await exportAll(deps, DOC, 'images', document);

    expect(outcome.failed.map((r) => r.name)).toEqual(['one']);
    expect(outcome.failed[0]?.error).toBe('engine: cannot include shared.puml @ 3');
    expect(outcome.written.map((r) => r.name)).toEqual(['two']);
    expect(deps.writeFile).toHaveBeenCalledOnce();
  });

  it('reports progress for each diagram', async () => {
    const seen: string[] = [];
    await exportAll(makeDeps(), DOC, 'images', document, (done, total, name) => {
      seen.push(`${String(done)}/${String(total)} ${name}`);
    });

    expect(seen).toEqual(['0/2 one', '1/2 two']);
  });

  it('skips a name that could escape the export directory', async () => {
    const deps = makeDeps();
    const outcome = await exportAll(deps, DOC, 'images', '```plantuml ../evil\nx\n```');

    expect(outcome.written).toHaveLength(0);
    expect(outcome.unnamed).toBe(1);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('returns an empty outcome for a document with no diagrams', async () => {
    const outcome = await exportAll(makeDeps(), DOC, 'images', '# Title\n\nProse only.');
    expect(outcome).toEqual({ written: [], failed: [], unnamed: 0 });
  });

  it('refuses a URL-based include without rendering it', async () => {
    // The preview rejects these before the engine sees them; export has to
    // agree, or the same block would write out an error diagram as a file.
    const deps = makeDeps();
    const outcome = await exportAll(
      deps,
      DOC,
      'images',
      '```plantuml remote\n!include https://evil.example/x.puml\n```'
    );

    expect(outcome.failed.map((r) => r.error)).toEqual(['remote references are not supported']);
    // Not the engine's error: there is no engine message or line to restate.
    expect(outcome.failed[0]?.engineError).toBeUndefined();
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a block with two diagrams or with pages, rather than writing part of it', async () => {
    const deps = makeDeps();
    const outcome = await exportAll(
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

    expect(outcome.failed.map((r) => [r.name, r.error])).toEqual([
      ['two', 'one diagram per block'],
      ['paged', 'no pages'],
    ]);
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('exports a diagram missing its end line with the line added', async () => {
    const deps = makeDeps();
    const outcome = await exportAll(deps, DOC, 'images', '```plantuml open\n@startuml\nA -> B\n```');

    expect(outcome.written.map((r) => r.name)).toEqual(['open']);
    expect(deps.render).toHaveBeenCalledWith('@startuml\nA -> B\n@enduml', false);
  });
});
