import { describe, expect, it, vi } from 'vitest';

import type { DiagramRender } from '../../src/core/types';
import { shareRenders } from '../../src/render/memo';

/** What the renderer gives for `svg`, with no include failed. */
const rendered = (svg: string): DiagramRender => ({ svg, failedIncludes: new Map(), dependencies: [] });

describe('shareRenders', () => {
  it('joins a render already running instead of starting it again', async () => {
    let finish: (result: DiagramRender) => void = () => undefined;
    const render = vi.fn(() => new Promise<DiagramRender>((resolve) => (finish = resolve)));
    const shared = shareRenders(render);

    const first = shared('@startuml\nA -> B\n@enduml', false);
    const second = shared('@startuml\nA -> B\n@enduml', false);
    finish(rendered('<svg/>'));

    expect((await first).svg).toBe('<svg/>');
    expect((await second).svg).toBe('<svg/>');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps results by source and palette, until cleared', async () => {
    const render = vi.fn((source: string, dark: boolean) =>
      Promise.resolve(rendered(`<svg>${source} ${String(dark)}</svg>`))
    );
    const shared = shareRenders(render);

    await shared('A', false);
    await shared('A', false);
    await shared('A', true);
    expect(render).toHaveBeenCalledTimes(2);

    shared.clear();
    await shared('A', false);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('shares a diagram without a local include between documents', async () => {
    const render = vi.fn(() => Promise.resolve(rendered('<svg/>')));
    const shared = shareRenders(render);

    await shared('A', false, 'file:///a.md');
    await shared('A', false, 'file:///b.md');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure, so the next request tries again', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rendering timed out'))
      .mockResolvedValueOnce(rendered('<svg/>'));
    const shared = shareRenders(render);

    await expect(shared('A', false)).rejects.toThrow('Rendering timed out');
    expect((await shared('A', false)).svg).toBe('<svg/>');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest result beyond its bound', async () => {
    const render = vi.fn((source: string) => Promise.resolve(rendered(source)));
    const shared = shareRenders(render, 2);

    await shared('A', false);
    await shared('B', false);
    await shared('C', false);
    await shared('A', false);
    expect(render).toHaveBeenCalledTimes(4);
  });
});

describe('shareRenders with a local include', () => {
  const SOURCE = '@startuml\n!include common.puml\nA -> B\n@enduml';

  it('joins a render running for the same document, and hands the renderer the document', async () => {
    let finish: (result: DiagramRender) => void = () => undefined;
    const render = vi.fn(() => new Promise<DiagramRender>((resolve) => (finish = resolve)));
    const shared = shareRenders(render);

    const first = shared(SOURCE, false, 'file:///docs/a.md');
    const second = shared(SOURCE, false, 'file:///docs/a.md');
    finish(rendered('<svg/>'));
    await Promise.all([first, second]);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(SOURCE, false, 'file:///docs/a.md');
  });

  it('draws the same source again for another document, whose includes are other files', async () => {
    const render = vi.fn(() => Promise.resolve(rendered('<svg/>')));
    const shared = shareRenders(render);

    await Promise.all([shared(SOURCE, false, 'file:///a/doc.md'), shared(SOURCE, false, 'file:///b/doc.md')]);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('does not keep the result, as the files it read may change', async () => {
    const render = vi.fn(() => Promise.resolve(rendered('<svg/>')));
    const shared = shareRenders(render);

    await shared(SOURCE, false, 'file:///docs/a.md');
    await shared(SOURCE, false, 'file:///docs/a.md');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('keeps a diagram that includes only a library or a URL', async () => {
    const render = vi.fn(() => Promise.resolve(rendered('<svg/>')));
    const shared = shareRenders(render);

    await shared('!include <azure/AzureCommon>\nA -> B', false, 'file:///a.md');
    await shared('!include <azure/AzureCommon>\nA -> B', false, 'file:///b.md');
    expect(render).toHaveBeenCalledTimes(1);
  });
});
