import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DIAGRAM_BACKDROP } from '../../src/core/constants';
import type { DiagramRender, DrawnInputs } from '../../src/core/types';
import { addBackground } from '../../src/export/exporter';
import type { ArtifactKey } from '../../src/export/history';
import {
  canonicalJson,
  INPUT_SCHEMA,
  inputFingerprint,
  inputManifest,
  isInputManifest,
  RENDER_CONTRACT,
  shippedRenderer,
  type InputManifest,
  type ManifestSource,
  type RendererIdentity,
} from '../../src/export/manifest';
import {
  choosePalette,
  DARK_LINK,
  drawReadable,
  includesWhitePageLibrary,
  lightenLinks,
  MIN_DRAWN_CONTRAST,
  MIN_TEXT_CONTRAST,
  weakestTextContrast,
} from '../../src/render/palette';

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const KEY: ArtifactKey = {
  documentUri: 'file:///repo/docs/guide.md',
  container: 'markdown',
  nameBasis: 'fence',
  name: 'orders',
  childId: null,
  page: null,
  format: 'svg',
};

const RENDERER: RendererIdentity = { engine: '1.2026.9', build: 'b'.repeat(64), raster: 'c'.repeat(64) };

/** A diagram that includes a file next to it, which includes one from a search folder after looking next to itself. */
const INPUTS: DrawnInputs = {
  context: { root: '/repo', folder: '/repo/docs', searchFolders: ['/repo/lib', '/repo/shared'] },
  requests: [
    { path: 'parts/b.puml', from: null, kind: 'include', outcome: 'read', file: '/repo/docs/parts/b.puml', looked: [] },
    {
      path: 'common.puml',
      from: '/repo/docs/parts/b.puml',
      kind: 'include',
      outcome: 'read',
      file: '/repo/lib/common.puml',
      looked: ['/repo/docs/parts/common.puml'],
    },
  ],
  files: [
    { file: '/repo/lib/common.puml', sha256: hash('A -> B'), origin: 'disk', findings: [] },
    { file: '/repo/docs/parts/b.puml', sha256: hash('!include common.puml'), origin: 'editor', findings: [] },
  ],
};

const drawn = (inputs: DrawnInputs | undefined, libraries: DiagramRender['log'] = { requests: [], libraries: [] }): DiagramRender => ({
  svg: '<svg/>',
  failedIncludes: new Map(),
  dependencies: [],
  log: libraries,
  ...(inputs === undefined ? {} : { inputs }),
});

const made = (overrides: Partial<ManifestSource> = {}): ManifestSource => ({
  key: KEY,
  source: '@startuml\r\n!include parts/b.puml\r\n@enduml\r\n',
  render: '@startuml\n!include parts/b.puml\n@enduml',
  drawn: drawn(INPUTS),
  dark: { asked: false, drawn: false },
  format: 'svg',
  pngScale: null,
  renderer: RENDERER,
  losses: 0,
  ...overrides,
});

/** The manifest of `source`, which a test expects there to be. */
const manifestOf = (source: ManifestSource): InputManifest => {
  const manifest = inputManifest(source);
  if (manifest === null) {
    throw new Error('expected a manifest');
  }
  return manifest;
};

describe('canonicalJson', () => {
  it('orders the keys of every object by their UTF-16 code units, those that look like numbers too, and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, 10: 2, 2: 3, a: [3, 1, 2], nested: { y: true, x: null } })).toBe(
      '{"10":2,"2":3,"a":[3,1,2],"b":1,"nested":{"x":null,"y":true}}'
    );
    // U+1F600 is the code units D83D DE00, which come before FF21.
    expect(canonicalJson({ 'Ａ': 1, '\u{1F600}': 2 })).toBe('{"\u{1F600}":2,"Ａ":1}');
  });

  it('is the same for the same data put together in another order', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: [3, 4] } })).toBe(canonicalJson({ b: { d: [3, 4], c: 2 }, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('escapes strings as JSON.stringify does, a lone surrogate too, and normalises no text', () => {
    expect(canonicalJson(['a"b\\c\n', '\ud800'])).toBe('["a\\"b\\\\c\\n","\\ud800"]');
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
    expect(canonicalJson('a\r\nb')).not.toBe(canonicalJson('a\nb'));
  });

  it('takes an object without a prototype, and an object met twice that does not hold itself', () => {
    const shared = { a: 1 };

    expect(canonicalJson(Object.assign(Object.create(null) as object, { b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
    expect(canonicalJson([shared, { shared }])).toBe('[{"a":1},{"shared":{"a":1}}]');
  });

  it('refuses what JSON cannot say as it is, rather than leaving it out or writing null', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const loop: unknown[] = [];
    loop.push([loop]);
    class Point {
      x = 1;
    }
    // eslint-disable-next-line no-sparse-arrays
    const holed = [1, , 3];

    for (const value of [
      undefined,
      { a: undefined },
      [undefined],
      NaN,
      Infinity,
      -Infinity,
      { n: NaN },
      () => 1,
      1n,
      Symbol('x'),
      new Map(),
      new Date(0),
      new Point(),
      holed,
      cycle,
      loop,
    ]) {
      expect(() => canonicalJson(value), String(typeof value)).toThrow(TypeError);
    }
  });
});

describe('inputManifest', () => {
  it('is null for a drawing not drawn with the reads of an export, which alone say what it was drawn from', () => {
    expect(inputManifest(made({ drawn: drawn(undefined) }))).toBeNull();
  });

  it('records the SHA-256 of the diagram as the document holds it and of what the engine was given, and no text', () => {
    const manifest = manifestOf(made());
    const json = JSON.stringify(manifest);

    expect(manifest.schema).toBe(INPUT_SCHEMA);
    expect(manifest.input).toEqual({ source: hash(made().source), render: hash(made().render) });
    expect(json).not.toContain('@startuml');
    expect(json).not.toContain('A -> B');
  });

  it('keeps the requests in the order the engine asked, and each file and library file once, in order', () => {
    const libraries = [
      { library: 'c4', key: 'c4_container', found: true },
      { library: 'azure', key: 'azurecommon', found: true },
      { library: 'c4', key: 'c4_container', found: true },
      { library: 'c4', key: 'c4', found: true },
    ];
    const manifest = manifestOf(made({ drawn: drawn(INPUTS, { requests: [], libraries }) }));

    expect(manifest.context).toEqual(INPUTS.context);
    expect(manifest.resources.requests.map(({ path }) => path)).toEqual(['parts/b.puml', 'common.puml']);
    expect(manifest.resources.requests[1]?.looked).toEqual(['/repo/docs/parts/common.puml']);
    expect(manifest.resources.files).toEqual([
      { file: '/repo/docs/parts/b.puml', sha256: hash('!include common.puml'), origin: 'editor' },
      { file: '/repo/lib/common.puml', sha256: hash('A -> B'), origin: 'disk' },
    ]);
    expect(manifest.resources.libraries).toEqual([
      { library: 'azure', key: 'azurecommon', found: true },
      { library: 'c4', key: 'c4', found: true },
      { library: 'c4', key: 'c4_container', found: true },
    ]);
  });

  it('says the image is complete, drawn without some notation, or drawn though something asked for was not there', () => {
    const missing: DrawnInputs = {
      ...INPUTS,
      requests: [...INPUTS.requests, { path: 'gone.puml', from: null, kind: 'include', outcome: 'missing', file: null, looked: ['/repo/docs/gone.puml'] }],
    };
    const notFound = { requests: [], libraries: [{ library: 'c4', key: 'c4_nothing', found: false }] };

    expect(manifestOf(made()).completeness).toBe('complete');
    expect(manifestOf(made({ losses: 1 })).completeness).toBe('known-loss');
    expect(manifestOf(made({ drawn: drawn(missing), losses: 1 })).completeness).toBe('unknown');
    expect(manifestOf(made({ drawn: drawn(INPUTS, notFound) })).completeness).toBe('unknown');
  });

  it('records the palette asked for and the one drawn in, and the scale and what drew the PNG for a PNG only', () => {
    const svg = manifestOf(made({ dark: { asked: true, drawn: false } }));
    const png = manifestOf(made({ key: { ...KEY, format: 'png' }, format: 'png', pngScale: 4 }));

    expect(svg.options).toEqual({ format: 'svg', palette: { asked: 'dark', drawn: 'light' }, pngScale: null });
    expect(svg.renderer).toEqual({ engine: '1.2026.9', build: RENDERER.build, raster: null, contract: RENDER_CONTRACT });
    expect(png.options).toEqual({ format: 'png', palette: { asked: 'light', drawn: 'light' }, pngScale: 4 });
    expect(png.renderer.raster).toBe(RENDERER.raster);
  });

  it('says whether drawing the same inputs again draws the same image, and why not', () => {
    const volatile = manifestOf(made({ render: '@startuml\nAlice -> Bob : %date("yyyy")\n@enduml' }));
    const holding: DrawnInputs = {
      ...INPUTS,
      files: INPUTS.files.map((file, index) =>
        index === 0 ? { ...file, findings: [{ replay: 'unclassified', what: 'directive:procedure', line: 3 }] } : file
      ),
    };
    const unclassified = manifestOf(made({ drawn: drawn(holding) }));

    expect(manifestOf(made()).replay).toEqual({ class: 'stable-inputs', rules: 1, reasons: [] });
    expect(volatile.replay).toEqual({
      class: 'volatile',
      rules: 1,
      reasons: [{ replay: 'volatile', what: 'function:date', line: 1, file: null }],
    });
    expect(unclassified.replay.class).toBe('unclassified');
    expect(unclassified.replay.reasons).toEqual([
      { replay: 'unclassified', what: 'directive:procedure', line: 3, file: '/repo/lib/common.puml' },
    ]);
  });
});

describe('inputFingerprint', () => {
  const fingerprint = (source: ManifestSource): string => manifestOf(source).fingerprint;
  const base = fingerprint(made());

  it('is the same for the same inputs, however they were put together and wherever a file was read from', () => {
    const shuffled: DrawnInputs = {
      ...INPUTS,
      files: [...INPUTS.files].reverse().map((file) => ({ ...file, origin: file.origin === 'disk' ? 'editor' : 'disk' })),
    };
    const manifest = manifestOf(made());

    expect(fingerprint(made({ drawn: drawn(shuffled) }))).toBe(base);
    // Worked out from the rest, so not part of it.
    expect(inputFingerprint({ ...manifest, completeness: 'unknown', replay: { class: 'volatile', rules: 9, reasons: [] } }, KEY)).toBe(base);
    expect(fingerprint(made({ losses: 2 }))).toBe(base);
  });

  it('changes with the diagram, its line breaks, the files, the order asked, where they were looked for, the renderer, the options and the diagram it is for', () => {
    const changed = [
      made({ source: made().source.replaceAll('\r\n', '\n') }),
      made({ render: `${made().render}\n` }),
      made({ drawn: drawn({ ...INPUTS, files: INPUTS.files.map((file) => ({ ...file, sha256: hash(file.file) })) }) }),
      made({ drawn: drawn({ ...INPUTS, requests: [...INPUTS.requests].reverse() }) }),
      made({ drawn: drawn({ ...INPUTS, context: { root: '/repo', folder: '/repo/docs', searchFolders: ['/repo/shared', '/repo/lib'] } }) }),
      made({ drawn: drawn({ ...INPUTS, context: { unavailable: 'untrusted' } }) }),
      made({ drawn: drawn(INPUTS, { requests: [], libraries: [{ library: 'c4', key: 'c4', found: true }] }) }),
      made({ renderer: { ...RENDERER, build: 'd'.repeat(64) } }),
      made({ renderer: { ...RENDERER, engine: '1.2026.10' } }),
      made({ dark: { asked: true, drawn: false } }),
      made({ dark: { asked: false, drawn: true } }),
      made({ key: { ...KEY, name: 'billing' } }),
      made({ key: { ...KEY, documentUri: 'file:///repo/docs/other.md' } }),
    ].map(fingerprint);

    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });

  it('changes with the scale of a PNG, and with what drew it', () => {
    const png = (overrides: Partial<ManifestSource>): string =>
      fingerprint(made({ key: { ...KEY, format: 'png' }, format: 'png', pngScale: 2, ...overrides }));

    expect(new Set([png({}), png({ pngScale: 4 }), png({ renderer: { ...RENDERER, raster: 'e'.repeat(64) } })]).size).toBe(3);
    // An SVG is not drawn by it.
    expect(fingerprint(made({ renderer: { ...RENDERER, raster: 'e'.repeat(64) } }))).toBe(base);
  });
});

describe('isInputManifest', () => {
  const written = manifestOf(made());
  /** As the state gives it back: stored as JSON. */
  const readBack = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

  it('takes a manifest as written, stored and read back, for the diagram it was written for', () => {
    expect(isInputManifest(readBack(written), KEY)).toBe(true);
    expect(isInputManifest(readBack(manifestOf(made({ drawn: drawn({ context: null, requests: [], files: [] }) }))), KEY)).toBe(true);
  });

  it('refuses one for another diagram, or whose fields were changed after it was fingerprinted', () => {
    const tampered = readBack(written) as InputManifest;
    tampered.input.source = hash('another diagram');

    expect(isInputManifest(readBack(written), { ...KEY, name: 'billing' })).toBe(false);
    expect(isInputManifest(tampered, KEY)).toBe(false);
  });

  it('refuses one of another schema, though fingerprinted as it was written', () => {
    // Of the same shape, written by a later version.
    const later = readBack(written) as Record<string, unknown>;
    later['schema'] = 'plantuml-local-input-v2';
    delete later['fingerprint'];
    later['fingerprint'] = inputFingerprint(later as unknown as InputManifest, KEY);

    expect(isInputManifest(later, KEY)).toBe(false);
  });

  it('refuses one with a field more or less, or of another shape, anywhere in it', () => {
    const variants: ((manifest: Record<string, any>) => void)[] = [
      (manifest) => (manifest['extra'] = 1),
      (manifest) => delete manifest['replay'],
      (manifest) => (manifest['schema'] = 'plantuml-local-input-v2'),
      (manifest) => (manifest['options']['extra'] = 1),
      (manifest) => (manifest['options']['palette'] = { asked: 'light' }),
      (manifest) => (manifest['options']['pngScale'] = '2'),
      (manifest) => (manifest['renderer']['contract'] = '1'),
      (manifest) => (manifest['renderer']['build'] = 'B'.repeat(64)),
      (manifest) => (manifest['fingerprint'] = written.fingerprint.toUpperCase()),
      (manifest) => (manifest['context'] = { unavailable: 'elsewhere' }),
      (manifest) => (manifest['context'] = { root: '/repo', folder: '/repo/docs' }),
      (manifest) => (manifest['resources']['requests'][0]['kind'] = 'import'),
      (manifest) => (manifest['resources']['requests'][0]['looked'] = [1]),
      (manifest) => (manifest['resources']['files'][0]['origin'] = 'cache'),
      (manifest) => (manifest['resources']['libraries'] = [{ library: 'c4', key: 'c4' }]),
      (manifest) => (manifest['completeness'] = 'partial'),
      (manifest) => (manifest['replay']['class'] = 'stable'),
      (manifest) => (manifest['replay']['reasons'] = [{ replay: 'volatile', what: 'function:date', line: -1, file: null }]),
    ];

    for (const [index, change] of variants.entries()) {
      const manifest = readBack(written) as Record<string, any>;
      change(manifest);
      expect(isInputManifest(manifest, KEY), `variant ${String(index)}`).toBe(false);
    }
    for (const value of [null, [], 'manifest', 1]) {
      expect(isInputManifest(value, KEY)).toBe(false);
    }
  });
});

describe('RENDER_CONTRACT', () => {
  /** A drawing as the engine might give it: a text, a link, and a note. */
  const drawing = (text: string): string =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" width="160px" height="40px">' +
    '<rect x="100" y="5" width="50" height="30" fill="#FEFFDD"/>' +
    `<text fill="${text}" font-size="14" x="5" y="20">Alice</text>` +
    '<text fill="#0000FF" font-size="14" text-decoration="underline" x="50" y="20">link</text>' +
    '<text fill="#000000" font-size="14" x="105" y="20">note</text></svg>';

  /** What the extension makes of fixed drawings of the engine's: what the number stands for. */
  async function madeOfDrawings(): Promise<unknown> {
    const scripted = async (
      dark: boolean,
      chosen: readonly boolean[],
      drawings: Readonly<Record<'light' | 'dark', DiagramRender>>
    ): Promise<unknown> => {
      const answers = [...chosen];
      const { palette, result } = await drawReadable(
        '@startuml\n!theme example\n@enduml',
        dark,
        () => Promise.resolve(answers.shift() ?? dark),
        (palette) => Promise.resolve(drawings[palette ? 'dark' : 'light'])
      );
      return { palette, svg: result.svg };
    };
    const plain = (svg: string): DiagramRender => ({ svg, failedIncludes: new Map(), dependencies: [] });
    const styled = (svg: string): DiagramRender => ({ ...plain(svg), includedStyle: { themes: ['!theme example'], whitePageLibrary: false } });
    const grid = [1, 3, 4.4, 4.5, 7];
    return {
      constants: { DIAGRAM_BACKDROP, DARK_LINK, MIN_TEXT_CONTRAST, MIN_DRAWN_CONTRAST },
      background: [addBackground(drawing('#000000'), false), addBackground(drawing('#EEEEEE'), true), addBackground('<g/>', true)],
      links: lightenLinks(drawing('#EEEEEE')),
      weakest: [weakestTextContrast(drawing('#000000'), false), weakestTextContrast(drawing('#333333'), true)],
      chosen: grid.flatMap((light) => grid.flatMap((dark) => [choosePalette(false, { light, dark }), choosePalette(true, { light, dark })])),
      whitePage: ['!include <C4/C4_Container>', '!include <azure/AzureCommon>', '!include local.puml'].map(includesWhitePageLibrary),
      drawn: [
        await scripted(false, [false], { light: plain(drawing('#000000')), dark: plain(drawing('#EEEEEE')) }),
        await scripted(true, [true], { light: plain(drawing('#000000')), dark: plain(drawing('#EEEEEE')) }),
        await scripted(true, [true], { light: plain(drawing('#000000')), dark: plain(drawing('#333333')) }),
        await scripted(true, [true, false], { light: plain(drawing('#000000')), dark: styled(drawing('#EEEEEE')) }),
      ],
    };
  }

  it('holds what the extension makes of the engine\'s drawings to the number recorded with each image', async () => {
    const digest = hash(canonicalJson(await madeOfDrawings()));

    // When this fails, the images exported for the same inputs are drawn
    // differently: raise RENDER_CONTRACT, and record the new digest with it.
    expect({ contract: RENDER_CONTRACT, digest }).toEqual({
      contract: 1,
      digest: 'f440055ba8e943e26834d1d73200eff24ccacaf9543c0b16261e1ac929f88db9',
    });
  });
});

describe('shippedRenderer', () => {
  let temp: string;
  const files: Record<string, string> = {
    'worker.js': 'worker',
    'engine/plantuml.js': 'engine',
    'engine/viz-global.cjs': 'graphviz',
    'engine/themes.cjs': 'themes',
    'engine/openiconic.cjs': 'icons',
    'engine/style-names.json': 'not drawn with',
    'stdlib/c4.json': '{"c4":1}',
    'stdlib/azure.json': '{"azure":1}',
  };

  /** A folder laid out as the extension ships its code, with `changed` in place of some files and without `left`. */
  const ship = async (name: string, changed: Record<string, string> = {}, left: readonly string[] = []): Promise<string> => {
    const dist = join(temp, name, 'dist');
    for (const [file, text] of Object.entries({ ...files, ...changed })) {
      if (!left.includes(file)) {
        await mkdir(dirname(join(dist, file)), { recursive: true });
        await writeFile(join(dist, file), text);
      }
    }
    await mkdir(join(temp, name, 'media'), { recursive: true });
    await writeFile(join(temp, name, 'media', 'png.js'), 'raster');
    return dist;
  };
  const rasterOf = (dist: string): string => join(dist, '..', 'media', 'png.js');

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'plantuml-local-renderer-'));
  });

  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('hashes the worker, the engine and the bundled libraries, by path and in order, and what draws a PNG apart', async () => {
    const dist = await ship('one');
    const build = createHash('sha256');
    for (const file of [
      'worker.js',
      'engine/plantuml.js',
      'engine/viz-global.cjs',
      'engine/themes.cjs',
      'engine/openiconic.cjs',
      'stdlib/azure.json',
      'stdlib/c4.json',
    ]) {
      build.update(`${file}\0${hash(files[file] ?? '')}\n`);
    }

    expect(await shippedRenderer(dist, rasterOf(dist), '1.2026.9')).toEqual({
      engine: '1.2026.9',
      build: build.digest('hex'),
      raster: hash('raster'),
    });
  });

  it('hashes once, as nothing shipped changes while the extension runs', async () => {
    const dist = await ship('once');

    expect(shippedRenderer(dist, rasterOf(dist), '1.2026.9')).toBe(shippedRenderer(dist, rasterOf(dist), '1.2026.9'));
  });

  it('tells apart a build with any file drawn with changed, but not one with a file the worker does not draw with', async () => {
    const builds = await Promise.all(
      [
        ['base', {}],
        ['worker', { 'worker.js': 'worker 2' }],
        ['themes', { 'engine/themes.cjs': 'themes 2' }],
        ['library', { 'stdlib/c4.json': '{"c4":2}' }],
        ['more', { 'stdlib/other.json': '{}' }],
        ['names', { 'engine/style-names.json': 'other names' }],
      ].map(async ([name, changed]) => {
        const dist = await ship(name as string, changed as Record<string, string>);
        return (await shippedRenderer(dist, rasterOf(dist), '1.2026.9'))?.build;
      })
    );

    expect(new Set(builds.slice(0, 5)).size).toBe(5);
    expect(builds[5]).toBe(builds[0]);
  });

  it('is null when a file cannot be read, and an image is recorded without', async () => {
    const dist = await ship('broken', {}, ['engine/plantuml.js']);

    expect(await shippedRenderer(dist, rasterOf(dist), '1.2026.9')).toBeNull();
    expect(await shippedRenderer(await ship('no-raster'), join(temp, 'nowhere.js'), '1.2026.9')).toBeNull();
  });
});
