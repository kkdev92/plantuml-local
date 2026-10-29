import { describe, expect, it } from 'vitest';

import type { DiagramRender, DrawingLog, DrawnRequest } from '../../src/core/types';
import { DrawingFailure, DrawingRecords, requestKey } from '../../src/includes/drawings';

const read = (path: string, file: string): DrawnRequest => ({
  path,
  from: null,
  kind: 'include',
  state: 'read',
  id: file,
  file,
  looked: [],
});
const missing = (path: string): DrawnRequest => ({ path, from: null, kind: 'include', state: 'missing', looked: [] });

const drawn = (log: DrawingLog, dependencies: string[] = []): DiagramRender => ({
  svg: '<svg/>',
  failedIncludes: new Map(),
  dependencies,
  log,
});

/** A render whose drawings finish when the test says, in any order. */
function deferred(): {
  render: (source: string, dark: boolean, document?: string) => Promise<DiagramRender>;
  finish(index: number, result: DiagramRender | Error): Promise<void>;
} {
  const waiting: { resolve: (value: DiagramRender) => void; reject: (error: unknown) => void }[] = [];
  return {
    render: () =>
      new Promise<DiagramRender>((resolve, reject) => {
        waiting.push({ resolve, reject });
      }),
    finish: async (index, result) => {
      const entry = waiting[index];
      if (result instanceof Error) {
        entry?.reject(result);
      } else {
        entry?.resolve(result);
      }
      // Lets the wrapper keep the drawing before the test looks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('DrawingRecords', () => {
  it('keeps the last drawing of each diagram drawn for a document, and none drawn for no document', async () => {
    const records = new DrawingRecords();
    const log: DrawingLog = { requests: [read('a.puml', '/ws/a.puml')], libraries: [] };
    const render = records.around(async () => drawn(log, ['/ws/a.puml']));
    await render('A', false, 'file:///ws/doc.md');
    await render('B', false);
    expect(records.get('file:///ws/doc.md', 'A')).toMatchObject({ document: 'file:///ws/doc.md', source: 'A', log, stale: false });
    expect(records.get('file:///ws/doc.md', 'B')).toBeUndefined();
  });

  it('keeps a drawing with no log as having asked for nothing', async () => {
    const records = new DrawingRecords();
    const render = records.around(async () => ({ svg: '<svg/>', failedIncludes: new Map(), dependencies: [] }));
    await render('A', false, 'file:///ws/doc.md');
    expect(records.get('file:///ws/doc.md', 'A')?.log).toEqual({ requests: [], libraries: [] });
  });

  it('does not let a drawing replace one that started after it', async () => {
    const records = new DrawingRecords();
    const { render, finish } = deferred();
    const wrapped = records.around(render);
    const first = wrapped('A', false, 'file:///ws/doc.md');
    const second = wrapped('A', false, 'file:///ws/doc.md');
    const later: DrawingLog = { requests: [read('new.puml', '/ws/new.puml')], libraries: [] };
    await finish(1, drawn(later));
    await finish(0, drawn({ requests: [read('old.puml', '/ws/old.puml')], libraries: [] }));
    await Promise.all([first, second]);
    expect(records.get('file:///ws/doc.md', 'A')?.log).toBe(later);
  });

  it('keeps a failed drawing with what it asked for, and why it failed', async () => {
    const records = new DrawingRecords();
    const log: DrawingLog = { requests: [read('a.puml', '/ws/a.puml')], libraries: [] };
    const failing = records.around(async () => {
      throw new DrawingFailure('timed out', log, ['/ws/a.puml']);
    });
    await expect(failing('A', false, 'file:///ws/doc.md')).rejects.toThrow('timed out');
    expect(records.get('file:///ws/doc.md', 'A')).toMatchObject({ log, error: 'timed out', stale: false });

    const crashing = records.around(async () => {
      throw new Error('worker gone');
    });
    await expect(crashing('B', false, 'file:///ws/doc.md')).rejects.toThrow('worker gone');
    expect(records.get('file:///ws/doc.md', 'B')).toMatchObject({ log: { requests: [], libraries: [] }, error: 'worker gone' });
  });

  it('puts out of date a drawing whose files change, and says so', async () => {
    const records = new DrawingRecords();
    const changed: string[] = [];
    records.onDidChange((document) => changed.push(document));
    const render = records.around(async (source) => drawn({ requests: [], libraries: [] }, [`/ws/${source}.puml`]));
    await render('a', false, 'file:///ws/one.md');
    await render('b', false, 'file:///ws/two.md');
    changed.length = 0;

    records.changed(new Map([['/ws/b.puml', true]]));
    expect(records.get('file:///ws/one.md', 'a')?.stale).toBe(false);
    expect(records.get('file:///ws/two.md', 'b')?.stale).toBe(true);
    expect(changed).toEqual(['file:///ws/two.md']);

    // Already out of date: nothing more to say.
    records.changed(new Map([['/ws/b.puml', false]]));
    expect(changed).toEqual(['file:///ws/two.md']);

    records.outdateAll();
    expect(records.get('file:///ws/one.md', 'a')?.stale).toBe(true);
    expect(changed).toEqual(['file:///ws/two.md', 'file:///ws/one.md']);
  });

  it('puts out of date a drawing whose file changed while it was drawn, and not one started after the change', async () => {
    const records = new DrawingRecords();
    const { render, finish } = deferred();
    const wrapped = records.around(render);
    const during = wrapped('A', false, 'file:///ws/one.md');
    records.changed(new Map([['/ws/a.puml', true]]));
    const after = wrapped('B', false, 'file:///ws/two.md');
    const unrelated = wrapped('C', false, 'file:///ws/three.md');
    await finish(0, drawn({ requests: [], libraries: [] }, ['/ws/a.puml']));
    await finish(1, drawn({ requests: [], libraries: [] }, ['/ws/a.puml']));
    await finish(2, drawn({ requests: [], libraries: [] }, ['/ws/c.puml']));
    await Promise.all([during, after, unrelated]);
    expect(records.get('file:///ws/one.md', 'A')?.stale).toBe(true);
    expect(records.get('file:///ws/two.md', 'B')?.stale).toBe(false);
    expect(records.get('file:///ws/three.md', 'C')?.stale).toBe(false);

    // With nothing being drawn, a change is not kept for later drawings.
    records.changed(new Map([['/ws/c.puml', true]]));
    const next = records.around(async () => drawn({ requests: [], libraries: [] }, ['/ws/c.puml']));
    await next('D', false, 'file:///ws/four.md');
    expect(records.get('file:///ws/four.md', 'D')?.stale).toBe(false);
  });

  it('says which file a drawing before read for a request that now finds none, until one finds it again', async () => {
    const records = new DrawingRecords();
    let log: DrawingLog = { requests: [read('common.puml', '/ws/common.puml')], libraries: [] };
    const render = records.around(async () => drawn(log));
    await render('A', false, 'file:///ws/doc.md');
    expect(records.get('file:///ws/doc.md', 'A')?.readBefore.size).toBe(0);

    log = { requests: [missing('common.puml'), missing('other.puml')], libraries: [] };
    await render('A', false, 'file:///ws/doc.md');
    expect([...(records.get('file:///ws/doc.md', 'A')?.readBefore ?? [])]).toEqual([
      [requestKey(missing('common.puml')), '/ws/common.puml'],
    ]);

    // Drawn again, still missing: still said.
    await render('A', false, 'file:///ws/doc.md');
    expect(records.get('file:///ws/doc.md', 'A')?.readBefore.get(requestKey(missing('common.puml')))).toBe('/ws/common.puml');

    log = { requests: [read('common.puml', '/ws/common.puml')], libraries: [] };
    await render('A', false, 'file:///ws/doc.md');
    log = { requests: [missing('common.puml')], libraries: [] };
    await render('B', false, 'file:///ws/doc.md');
    // Another diagram: what A read is not said of B.
    expect(records.get('file:///ws/doc.md', 'B')?.readBefore.size).toBe(0);
  });

  it('finds the drawings that read a file, by its key', async () => {
    const records = new DrawingRecords();
    const render = records.around(async (source) =>
      drawn({ requests: source === 'A' ? [read('c.puml', '/WS/Common.puml')] : [missing('c.puml')], libraries: [] })
    );
    await render('A', false, 'file:///ws/one.md');
    await render('B', false, 'file:///ws/two.md');
    const lower = (path: string): string => path.toLowerCase();
    expect(records.readers('/ws/common.puml', lower).map((record) => record.source)).toEqual(['A']);
    expect(records.readers('/ws/other.puml', lower)).toEqual([]);
  });

  it('does not keep a drawing for a document closed while it was drawn, and keeps one started after', async () => {
    const records = new DrawingRecords();
    const { render, finish } = deferred();
    const wrapped = records.around(render);
    const during = wrapped('A', false, 'file:///ws/one.md');
    const failing = wrapped('B', false, 'file:///ws/one.md').then(
      () => undefined,
      (error: unknown) => error
    );
    const other = wrapped('C', false, 'file:///ws/two.md');
    records.forget('file:///ws/one.md');
    const after = wrapped('A', false, 'file:///ws/one.md');
    await finish(0, drawn({ requests: [read('a.puml', '/ws/a.puml')], libraries: [] }));
    await finish(1, new DrawingFailure('timed out', { requests: [], libraries: [] }, []));
    await finish(2, drawn({ requests: [], libraries: [] }));
    await during;
    expect(await failing).toBeInstanceOf(DrawingFailure);
    await other;
    expect(records.get('file:///ws/one.md', 'A')).toBeUndefined();
    expect(records.get('file:///ws/one.md', 'B')).toBeUndefined();
    expect(records.get('file:///ws/two.md', 'C')).toBeDefined();

    await finish(3, drawn({ requests: [], libraries: [] }));
    await after;
    expect(records.get('file:///ws/one.md', 'A')?.log).toEqual({ requests: [], libraries: [] });
  });

  it('forgets the drawings for a document closed, and the oldest past the most kept', async () => {
    const records = new DrawingRecords(2);
    const changed: string[] = [];
    const listening = records.onDidChange((document) => changed.push(document));
    const render = records.around(async () => drawn({ requests: [], libraries: [] }));
    await render('A', false, 'file:///ws/one.md');
    await render('B', false, 'file:///ws/one.md');
    await render('C', false, 'file:///ws/two.md');
    expect(records.get('file:///ws/one.md', 'A')).toBeUndefined();
    expect(records.get('file:///ws/one.md', 'B')).toBeDefined();

    changed.length = 0;
    records.forget('file:///ws/one.md');
    expect(records.get('file:///ws/one.md', 'B')).toBeUndefined();
    expect(records.get('file:///ws/two.md', 'C')).toBeDefined();
    expect(changed).toEqual(['file:///ws/one.md']);
    records.forget('file:///ws/none.md');
    expect(changed).toEqual(['file:///ws/one.md']);

    listening.dispose();
    records.forget('file:///ws/two.md');
    expect(changed).toEqual(['file:///ws/one.md']);
  });
});
