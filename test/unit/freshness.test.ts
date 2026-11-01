import { describe, expect, it, vi } from 'vitest';

import type { DiagramRender } from '../../src/core/types';
import { findFileDiagrams, findPlantUmlBlocks, type PlantUmlBlock } from '../../src/export/blocks';
import {
  checkFreshness,
  FRESHNESS_LIMITS,
  stateOf,
  type FreshnessDeps,
  type FreshnessReason,
  type FreshnessReport,
  type OutputRead,
} from '../../src/export/freshness';
import { artifactKey, type ArtifactKey, type ArtifactRecord } from '../../src/export/history';
import { inputManifest, RENDER_CONTRACT, type InputManifest, type RendererIdentity } from '../../src/export/manifest';
import { sha256 } from '../../src/export/ownership';
import { recheckInputs, type DrawnFrom, type InputChange } from '../../src/export/recheck';

const DOC = 'file:///repo/docs/design.md';
const RENDERER: RendererIdentity = { engine: '1.2026.9', build: 'b'.repeat(64), raster: 'c'.repeat(64) };
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const resolve = (document: string, relative: string): string => new URL(relative, document).toString();
const output = (name: string, format: 'svg' | 'png' = 'svg', directory = 'images'): string =>
  resolve(DOC, `${directory}/${name}.${format}`);

const fence = (name: string | null, body = 'A -> B'): string =>
  [`\`\`\`plantuml${name === null ? '' : ` ${name}`}`, '@startuml', body, '@enduml', '```'].join('\n');

/** The blocks of a Markdown document of `text`. */
const blocksOf = (text: string): PlantUmlBlock[] => findPlantUmlBlocks(text);

/** The first block named `name` of `text`. */
function blockOf(text: string, name: string): PlantUmlBlock {
  const block = blocksOf(text).find((each) => each.name === name);
  if (block === undefined) {
    throw new Error(`no block ${name}`);
  }
  return block;
}

/** What drawing `block` as `format` recorded it was drawn from: its text alone, unless `render` says it used more. */
function manifestOf(
  block: PlantUmlBlock,
  format: 'svg' | 'png',
  overrides: {
    render?: string;
    dark?: boolean;
    /** The palette drawn in, when not the one asked for. */
    drawnDark?: boolean;
    pngScale?: number;
    libraries?: NonNullable<DiagramRender['log']>['libraries'];
    unread?: boolean;
  } = {}
): InputManifest {
  const key = artifactKey(DOC, block, block.name ?? '', format);
  if (key === null) {
    throw new Error('no key');
  }
  const manifest = inputManifest({
    key,
    source: block.raw,
    render: overrides.render ?? block.source,
    drawn: {
      svg: '<svg/>',
      failedIncludes: new Map(),
      dependencies: [],
      log: { requests: [], libraries: overrides.libraries ?? [] },
      inputs: {
        context: null,
        requests:
          overrides.unread === true
            ? [{ path: 'gone.puml', from: null, kind: 'include', outcome: 'not-found', file: null, looked: [] }]
            : [],
        files: [],
      },
    },
    dark: { asked: overrides.dark ?? false, drawn: overrides.drawnDark ?? overrides.dark ?? false },
    format,
    pngScale: format === 'png' ? (overrides.pngScale ?? 2) : null,
    renderer: RENDERER,
    losses: 0,
  });
  if (manifest === null) {
    throw new Error('expected a manifest');
  }
  return manifest;
}

/** The record of `block` exported as `format` with `content`, drawn as `manifestOf` says unless `input` says otherwise. */
function recordOf(
  block: PlantUmlBlock,
  format: 'svg' | 'png',
  content: Uint8Array,
  input: InputManifest | null = manifestOf(block, format),
  where = output(block.name ?? '', format)
): ArtifactRecord {
  const key = artifactKey(DOC, block, block.name ?? '', format);
  if (key === null) {
    throw new Error('no key');
  }
  return { key, output: where, sha256: sha256(content), ...(input === null ? {} : { input }) };
}

interface World {
  /** What is at each file: its bytes, or how reading it ends. */
  files: Map<string, Uint8Array | OutputRead>;
  records: ArtifactRecord[];
  /** Files an earlier version recorded exporting from the document, with the bytes it wrote. */
  earlier: Map<string, Uint8Array>;
  dirty: Set<string>;
  renderer: RendererIdentity | null;
  dark: boolean;
  scale: number;
  /** What looking again finds; by default, the diagram's text compared as an export compares it. */
  recheck: (drawn: DrawnFrom, source: string | null) => Promise<InputChange[]>;
  unsaved: boolean;
  /** How many images are checked before the check is cancelled. */
  cancelAfter: number;
}

/** A check's reads, of `world`, and what they were asked. */
function depsOf(world: Partial<World> = {}): FreshnessDeps & { reads: string[]; identities: number } {
  const files = world.files ?? new Map<string, Uint8Array | OutputRead>();
  const records = world.records ?? [];
  let checked = 0;
  const deps = {
    reads: [] as string[],
    identities: 0,
    resolve,
    recordsOf: (document: string) => records.filter((record) => record.key.documentUri === document),
    ownerOf: (path: string) => records.find((record) => record.output === path) ?? null,
    wroteBefore: (path: string, document: string, existing: Uint8Array) => {
      const wrote = world.earlier?.get(path);
      return document === DOC && wrote !== undefined && sha256(wrote) === sha256(existing);
    },
    isDirty: (path: string) => world.dirty?.has(path) === true,
    readOutput: (path: string, limit: number): Promise<OutputRead> => {
      deps.reads.push(path);
      checked += 1;
      const there = files.get(path);
      if (there === undefined) {
        return Promise.resolve({ kind: 'none' });
      }
      if (there instanceof Uint8Array) {
        return Promise.resolve(there.byteLength > limit ? { kind: 'too-large' } : { kind: 'bytes', bytes: there });
      }
      return Promise.resolve(there);
    },
    rendererIdentity: () => {
      deps.identities += 1;
      return Promise.resolve(world.renderer === undefined ? RENDERER : world.renderer);
    },
    isDark: () => world.dark ?? false,
    pngScale: () => world.scale ?? 2,
    recheck: async (drawn: DrawnFrom, source: string | null) => ({
      changes: await (world.recheck ?? ((was, now) => recheckInputs(was, now, { available: false, why: 'untrusted' }, () => undefined)))(
        drawn,
        source
      ),
      unsaved: world.unsaved ?? false,
    }),
    cancelled: () => world.cancelAfter !== undefined && checked >= world.cancelAfter,
  };
  return deps;
}

/** Checks the Markdown document of `text`, exported to `directory`. */
async function check(deps: FreshnessDeps, text: string, directory = 'images'): Promise<FreshnessReport> {
  const found = await checkFreshness(deps, DOC, text, blocksOf(text), directory, true);
  if (found === 'cancelled') {
    throw new Error('cancelled');
  }
  return found;
}

const why = (reasons: readonly FreshnessReason[]): string[] => reasons.map((reason) => `${reason.state}:${reason.why}`);

const TEXT = ['# Design', '', fence('orders'), '', 'Prose.', '', fence('billing', 'C -> D')].join('\n');
const ORDERS = blockOf(TEXT, 'orders');
const BILLING = blockOf(TEXT, 'billing');
const SVG = bytes('<svg>orders</svg>');

describe('stateOf', () => {
  it('puts an image not recorded apart, then takes the most pressing state a reason calls for', () => {
    const reasons: FreshnessReason[] = [
      { state: 'stale', why: 'renderer' },
      { state: 'unknown', why: 'no-inputs' },
      { state: 'missing', why: 'deleted' },
      { state: 'conflict', why: 'edited' },
      { state: 'unsupported', why: 'link' },
    ];

    expect(stateOf([...reasons, { state: 'unmanaged', why: 'unrecorded' }])).toBe('unmanaged');
    expect([5, 4, 3, 2, 1, 0].map((count) => stateOf(reasons.slice(0, count)))).toEqual([
      'unsupported',
      'conflict',
      'missing',
      'unknown',
      'stale',
      'current',
    ]);
  });
});

describe('checkFreshness', () => {
  it('finds an image current when its file, its record and what it was drawn from are as they were, reading and writing nothing else', async () => {
    const deps = depsOf({ files: new Map([[output('orders'), SVG]]), records: [recordOf(ORDERS, 'svg', SVG)] });
    const found = await check(deps, TEXT);

    expect(found.rows).toEqual([
      {
        name: 'orders',
        line: ORDERS.openLine,
        format: 'svg',
        output: output('orders'),
        state: 'current',
        reasons: [],
        compared: true,
        unsaved: false,
      },
    ]);
    expect(found.references).toEqual([]);
    expect(found.orphans).toEqual([]);
    // Each diagram's file as each format, and nothing it draws or writes: the reads are all there are.
    expect(deps.reads).toEqual([output('orders'), output('orders', 'png'), output('billing'), output('billing', 'png')]);
  });

  it('lists no image of a diagram never exported as a format', async () => {
    const found = await check(depsOf(), TEXT);

    expect(found.rows).toEqual([]);
  });

  it('finds an image stale once its diagram changed, but not for a heading above it or the same text saved again', async () => {
    const records = [recordOf(ORDERS, 'svg', SVG)];
    const files = new Map([[output('orders'), SVG]]);
    const edited = TEXT.replace('A -> B', 'A -> C');
    const headed = `# Above\n\nMore prose.\n\n${TEXT}`;

    const changed = await check(depsOf({ files, records }), edited);
    const moved = await check(depsOf({ files, records }), headed);

    expect(changed.rows[0]).toMatchObject({ state: 'stale', compared: true });
    expect(changed.rows[0]?.reasons).toEqual([{ state: 'stale', why: 'input', change: { change: 'diagram' } }]);
    expect(moved.rows[0]).toMatchObject({ state: 'current', line: blockOf(headed, 'orders').openLine });
  });

  it('names what changed among what it was drawn from: a file, an include found elsewhere, where they are looked for', async () => {
    const changes: InputChange[] = [
      { change: 'context' },
      { change: 'answer', path: 'parts/a.puml' },
      { change: 'file', file: '/repo/docs/parts/b.puml' },
    ];
    const recheck = vi.fn(() => Promise.resolve(changes));
    const found = await check(depsOf({ files: new Map([[output('orders'), SVG]]), records: [recordOf(ORDERS, 'svg', SVG)], recheck }), TEXT);

    expect(found.rows[0]?.state).toBe('stale');
    expect(found.rows[0]?.reasons).toEqual(changes.map((change) => ({ state: 'stale', why: 'input', change })));
    // Looked at again from what was recorded, with the diagram's text as it is now.
    const record = recordOf(ORDERS, 'svg', SVG);
    expect(recheck).toHaveBeenCalledWith(
      {
        source: record.input?.input.source,
        context: record.input?.context,
        requests: record.input?.resources.requests,
        files: record.input?.resources.files,
      },
      ORDERS.raw
    );
  });

  it('says a file it includes was read with unsaved changes', async () => {
    const found = await check(
      depsOf({ files: new Map([[output('orders'), SVG]]), records: [recordOf(ORDERS, 'svg', SVG)], unsaved: true }),
      TEXT
    );

    expect(found.rows[0]).toMatchObject({ state: 'current', unsaved: true });
  });

  it('finds an image drawn by another engine, another build of the same engine or another drawing contract stale', async () => {
    const files = new Map([[output('orders'), SVG]]);
    const contract = manifestOf(ORDERS, 'svg');
    contract.renderer.contract = RENDER_CONTRACT - 1;
    const states = await Promise.all(
      [
        depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG)], renderer: { ...RENDERER, engine: '1.2026.10' } }),
        depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG)], renderer: { ...RENDERER, build: 'd'.repeat(64) } }),
        depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG, contract)] }),
      ].map(async (deps) => why((await check(deps, TEXT)).rows[0]?.reasons ?? []))
    );

    expect(states).toEqual([['stale:renderer'], ['stale:renderer'], ['stale:renderer']]);
  });

  it('finds a PNG stale for another scale or another rasteriser, and an SVG for neither', async () => {
    const png = bytes('png');
    const files = new Map([
      [output('orders'), SVG],
      [output('orders', 'png'), png],
    ]);
    const records = [recordOf(ORDERS, 'svg', SVG), recordOf(ORDERS, 'png', png)];

    const scaled = await check(depsOf({ files, records, scale: 4 }), TEXT);
    const rasterised = await check(depsOf({ files, records, renderer: { ...RENDERER, raster: 'e'.repeat(64) } }), TEXT);

    expect(scaled.rows.map((row) => [row.format, row.state])).toEqual([
      ['svg', 'current'],
      ['png', 'stale'],
    ]);
    expect(scaled.rows[1]?.reasons).toEqual([{ state: 'stale', why: 'scale', was: 2, now: 4 }]);
    expect(rasterised.rows.map((row) => [row.format, why(row.reasons)])).toEqual([
      ['svg', []],
      ['png', ['stale:renderer']],
    ]);
  });

  it('finds an image drawn in another palette than an export asks for now stale, going by the palette asked for', async () => {
    const files = new Map([[output('orders'), SVG]]);
    const found = await check(depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG)], dark: true }), TEXT);
    // A diagram that picks its palette itself is drawn in it, whichever an export asks for.
    const own = recordOf(ORDERS, 'svg', SVG, manifestOf(ORDERS, 'svg', { dark: true, drawnDark: false }));
    const kept = await check(depsOf({ files, records: [own], dark: true }), TEXT);

    expect(found.rows[0]?.reasons).toEqual([{ state: 'stale', why: 'palette', was: 'light', now: 'dark' }]);
    expect(kept.rows[0]?.state).toBe('current');
  });

  it('finds an image whose file is gone missing, edited since a conflict, and open with unsaved changes a conflict', async () => {
    const records = [recordOf(ORDERS, 'svg', SVG)];

    const gone = await check(depsOf({ records }), TEXT);
    const edited = await check(depsOf({ files: new Map([[output('orders'), bytes('<svg>edited</svg>')]]), records }), TEXT);
    const dirty = await check(depsOf({ files: new Map([[output('orders'), SVG]]), records, dirty: new Set([output('orders')]) }), TEXT);

    expect([gone, edited, dirty].map((found) => [found.rows[0]?.state, why(found.rows[0]?.reasons ?? [])])).toEqual([
      ['missing', ['missing:deleted']],
      ['conflict', ['conflict:edited']],
      ['conflict', ['conflict:dirty']],
    ]);
    // Nothing it was drawn from was looked at for any of them.
    expect([gone, edited, dirty].map((found) => found.rows[0]?.compared)).toEqual([false, false, false]);
  });

  it('takes no image the records do not say is its diagram\'s for current: one not recorded, and one only an earlier version recorded', async () => {
    const files = new Map([
      [output('orders'), SVG],
      [output('billing'), bytes('<svg>billing</svg>')],
    ]);

    const found = await check(depsOf({ files, earlier: new Map([[output('billing'), bytes('<svg>billing</svg>')]]) }), TEXT);

    expect(found.rows.map((row) => [row.name, row.state, why(row.reasons)])).toEqual([
      ['orders', 'unmanaged', ['unmanaged:unrecorded']],
      ['billing', 'unknown', ['unknown:earlier-version']],
    ]);
  });

  it('finds an image recorded as another diagram\'s a conflict', async () => {
    const other: ArtifactKey = { ...ORDERS_KEY(), documentUri: 'file:///repo/docs/other.md' };
    const found = await check(
      depsOf({
        files: new Map([[output('orders'), SVG]]),
        records: [{ key: other, output: output('orders'), sha256: sha256(SVG) }],
      }),
      TEXT
    );

    expect(found.rows[0]?.reasons).toEqual([{ state: 'conflict', why: 'owner', owner: other }]);
  });

  it('finds every diagram exported to the same file in conflict, whichever holds it and whatever the case of their names', async () => {
    const text = [fence('orders'), '', fence('Orders', 'B -> C'), '', fence('orders', 'C -> D')].join('\n');
    const [first, second] = blocksOf(text);
    // One file, by either name, as on a file system that does not tell case apart.
    const files = new Map([
      [output('orders'), SVG],
      [output('Orders'), SVG],
    ]);
    // Where one of them was exported before: not its image while the file it goes to is shared.
    const before = recordOf(second!, 'svg', SVG, undefined, output('Orders', 'svg', 'old'));
    const found = await check(depsOf({ files, records: [recordOf(first!, 'svg', SVG), before] }), text);

    expect(found.rows.map((row) => [row.name, row.state, row.reasons])).toEqual([
      ['orders', 'conflict', [{ state: 'conflict', why: 'shared', with: ['Orders', 'orders'] }]],
      ['Orders', 'conflict', [{ state: 'conflict', why: 'shared', with: ['orders', 'orders'] }]],
      ['orders', 'conflict', [{ state: 'conflict', why: 'shared', with: ['orders', 'Orders'] }]],
    ]);
    expect(found.orphans).toEqual([before]);
  });

  it('does not take what it cannot read or reach for current: a link, a folder, a file too large, one that cannot be read', async () => {
    const files = new Map<string, Uint8Array | OutputRead>([
      [output('orders'), { kind: 'link' }],
      [output('orders', 'png'), { kind: 'not-file' }],
      [output('billing'), new Uint8Array(FRESHNESS_LIMITS.bytes + 1)],
      [output('billing', 'png'), { kind: 'failed', message: 'EACCES' }],
    ]);
    const records = [recordOf(ORDERS, 'svg', SVG), recordOf(BILLING, 'svg', SVG)];

    const found = await check(depsOf({ files, records }), TEXT);

    expect(found.rows.map((row) => [row.name, row.format, row.state, row.reasons])).toEqual([
      ['orders', 'svg', 'unsupported', [{ state: 'unsupported', why: 'link' }]],
      ['orders', 'png', 'unsupported', [{ state: 'unsupported', why: 'not-file' }]],
      ['billing', 'svg', 'unknown', [{ state: 'unknown', why: 'too-large' }]],
      ['billing', 'png', 'unknown', [{ state: 'unknown', why: 'unreadable', message: 'EACCES' }]],
    ]);
  });

  it('cannot tell an image recorded without what it was drawn from, drawn from what it could not all read, or by a renderer it cannot tell', async () => {
    const files = new Map([
      [output('orders'), SVG],
      [output('billing'), SVG],
    ]);
    const records = [recordOf(ORDERS, 'svg', SVG, null), recordOf(BILLING, 'svg', SVG, manifestOf(BILLING, 'svg', { unread: true }))];

    const found = await check(depsOf({ files, records }), TEXT);
    const unidentified = await check(depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG)], renderer: null }), TEXT);

    expect(found.rows.map((row) => [row.state, why(row.reasons), row.compared])).toEqual([
      ['unknown', ['unknown:no-inputs'], false],
      ['unknown', ['unknown:incomplete'], true],
    ]);
    expect(why(unidentified.rows[0]?.reasons ?? [])).toEqual(['unknown:renderer-unknown']);
  });

  it('cannot tell an image drawn from text that draws otherwise another time, saying so apart from what changed', async () => {
    const volatile = manifestOf(ORDERS, 'svg', { render: '@startuml\ntitle %date()\nA -> B\n@enduml' });
    const unclassified = manifestOf(BILLING, 'svg', { render: '@startuml\n!procedure $p()\n!endprocedure\nC -> D\n@enduml' });
    const files = new Map([
      [output('orders'), SVG],
      [output('billing'), SVG],
    ]);
    const records = [recordOf(ORDERS, 'svg', SVG, volatile), recordOf(BILLING, 'svg', SVG, unclassified)];

    const same = await check(depsOf({ files, records }), TEXT);
    const changed = await check(depsOf({ files, records }), TEXT.replace('A -> B', 'A -> C'));

    expect(same.rows.map((row) => [row.state, why(row.reasons), row.compared])).toEqual([
      ['unknown', ['unknown:replay'], true],
      ['unknown', ['unknown:replay'], true],
    ]);
    expect(same.rows[0]?.reasons[0]).toMatchObject({ replay: 'volatile', reasons: [{ what: 'function:date' }] });
    expect(same.rows[1]?.reasons[0]).toMatchObject({ replay: 'unclassified' });
    expect(changed.rows[0]).toMatchObject({ state: 'unknown' });
    expect(why(changed.rows[0]?.reasons ?? [])).toEqual(['stale:input', 'unknown:replay']);
  });

  it('can tell an image of a diagram that only uses the bundled C4 library', async () => {
    const block = blockOf(TEXT, 'orders');
    const c4 = manifestOf(block, 'svg', {
      render: '@startuml\n!include <C4/C4_Container>\nPerson(a, "A")\n@enduml',
      libraries: [{ library: 'c4', key: 'c4_container', found: true }],
    });

    const found = await check(depsOf({ files: new Map([[output('orders'), SVG]]), records: [recordOf(block, 'svg', SVG, c4)] }), TEXT);

    expect(c4.replay.class).toBe('stable-inputs');
    expect(found.rows[0]?.state).toBe('current');
  });

  it('finds an image exported where its exports go no longer stale, and lists apart a record left behind once there is one where they go', async () => {
    const old = recordOf(ORDERS, 'svg', SVG, manifestOf(ORDERS, 'svg'), output('orders', 'svg', 'img'));
    const moved = await check(depsOf({ records: [old] }), TEXT);
    const since = await check(depsOf({ files: new Map([[output('orders'), SVG]]), records: [old, recordOf(ORDERS, 'svg', SVG)] }), TEXT);

    expect(moved.rows.map((row) => [row.state, row.reasons])).toEqual([
      ['stale', [{ state: 'stale', why: 'elsewhere', output: output('orders', 'svg', 'img') }]],
    ]);
    expect(moved.orphans).toEqual([]);
    expect(since.rows.map((row) => row.state)).toEqual(['current']);
    expect(since.orphans).toEqual([old]);
  });

  it('lists apart the records of diagrams the document has no longer, and does nothing to them', async () => {
    const gone = recordOf(blockOf(fence('gone'), 'gone'), 'png', bytes('png'));
    const deps = depsOf({ records: [gone] });

    const found = await check(deps, TEXT);

    expect(found.rows).toEqual([]);
    expect(found.orphans).toEqual([gone]);
    expect(deps.reads).not.toContain(gone.output);
  });

  it('counts the diagrams it does not check: without a name, or with one that cannot be a file name', async () => {
    const text = [TEXT, fence(null), fence('con'), fence('a.b')].join('\n\n');

    const found = await check(depsOf(), text);

    expect([found.unnamed, found.invalid]).toEqual([1, 2]);
  });

  it('asks for the renderer once, however many images it looks at', async () => {
    const files = new Map([
      [output('orders'), SVG],
      [output('billing'), SVG],
    ]);
    const deps = depsOf({ files, records: [recordOf(ORDERS, 'svg', SVG), recordOf(BILLING, 'svg', SVG)] });

    await check(deps, TEXT);

    expect(deps.identities).toBe(1);
  });

  it('stops between images once cancelled, saying so rather than what it found so far', async () => {
    const deps = depsOf({ files: new Map([[output('orders'), SVG]]), records: [recordOf(ORDERS, 'svg', SVG)], cancelAfter: 1 });

    const found = await checkFreshness(deps, DOC, TEXT, blocksOf(TEXT), 'images', true);

    expect(found).toBe('cancelled');
    expect(deps.reads).toEqual([output('orders')]);
  });

  it('checks the diagrams of a PlantUML file, which has no image links', async () => {
    const document = 'file:///repo/docs/flows.puml';
    const text = '@startuml\nA -> B\n@enduml\n\n![flows](images/flows.svg#plantuml-local)\n';
    const [block] = findFileDiagrams(text, 'flows');
    const key = artifactKey(document, block!, 'flows', 'svg');
    const record: ArtifactRecord = { key: key!, output: resolve(document, 'images/flows.svg'), sha256: sha256(SVG) };

    const found = await checkFreshness(depsOf({ records: [record] }), document, text, [block!], 'images', false);

    expect(found).toMatchObject({ rows: [{ name: 'flows', state: 'missing' }], references: [] });
  });
});

describe('the marked image links after the blocks', () => {
  const linked = (target: string, alt = 'orders', name = 'orders'): string =>
    [fence(name), '', `![${alt}](${target})`, '', 'After.'].join('\n');
  const problems = async (text: string, files = new Map([[output('orders'), SVG]]), directory = 'images'): Promise<string[]> =>
    (await check(depsOf({ files }), text, directory)).references.map((each) => `${each.name}:${String(each.line)}:${each.problem}`);

  it('finds no problem with a link to the image the diagram is exported to, there', async () => {
    expect(await problems(linked('images/orders.svg#plantuml-local'))).toEqual([]);
    // Written as the export writes it: in angle brackets when the folder has a space.
    const spaced = new Map([[output('orders', 'svg', 'my images'), SVG]]);
    expect(await problems(linked('<my images/orders.svg#plantuml-local>'), spaced, 'my images')).toEqual([]);
  });

  it('reads a link as a Markdown renderer leads to it: escapes decoded, a lone percent sign as it is, the path resolved', async () => {
    const percent = new Map([[output('orders', 'svg', '100%'), SVG]]);
    const escaped = new Map([[output('orders', 'svg', 'my images'), SVG]]);

    expect(await problems(linked('my%20images/orders.svg#plantuml-local'), escaped, 'my images')).toEqual([]);
    expect(await problems(linked('100%/orders.svg#plantuml-local'), percent, '100%')).toEqual([]);
    expect(await problems(linked('./images/../images/orders.svg#plantuml-local'))).toEqual([]);
    // The same path under another folder is another file.
    expect(await problems(linked('../images/orders.svg#plantuml-local'))).toEqual(['orders:6:elsewhere']);
  });

  it('finds a link to another file, by another name, not relative or not decodable, or to an image not there', async () => {
    expect(await problems(linked('images/old.svg#plantuml-local'))).toEqual(['orders:6:elsewhere']);
    expect(await problems(linked('images/orders.svg#plantuml-local', 'Orders diagram'))).toEqual(['orders:6:name']);
    expect(await problems(linked('/images/orders.svg#plantuml-local'))).toEqual(['orders:6:invalid']);
    expect(await problems(linked('file:///repo/docs/images/orders.svg#plantuml-local'))).toEqual(['orders:6:invalid']);
    expect(await problems(linked('images/%FF.svg#plantuml-local'))).toEqual(['orders:6:invalid']);
    expect(await problems(linked('images/orders.svg#plantuml-local'), new Map())).toEqual(['orders:6:no-image']);
  });

  it('leaves a link written by hand alone, and one after a block that is not the block\'s', async () => {
    expect(await problems(linked('images/old.svg'))).toEqual([]);
    expect(await problems([fence('orders'), '', 'Prose.', '', '![orders](images/old.svg#plantuml-local)'].join('\n'))).toEqual([]);
  });
});

/** The key of the diagram `orders` exported as SVG from the document. */
function ORDERS_KEY(): ArtifactKey {
  const key = artifactKey(DOC, ORDERS, 'orders', 'svg');
  if (key === null) {
    throw new Error('no key');
  }
  return key;
}
