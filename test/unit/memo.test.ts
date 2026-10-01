import { describe, expect, it, vi } from 'vitest';

import { shareRenders } from '../../src/render/memo';

describe('shareRenders', () => {
  it('joins a render already running instead of starting it again', async () => {
    let finish: (svg: string) => void = () => undefined;
    const render = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const shared = shareRenders(render);

    const first = shared('@startuml\nA -> B\n@enduml', false);
    const second = shared('@startuml\nA -> B\n@enduml', false);
    finish('<svg/>');

    expect(await first).toBe('<svg/>');
    expect(await second).toBe('<svg/>');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps results by source and palette, until cleared', async () => {
    const render = vi.fn((source: string, dark: boolean) => Promise.resolve(`<svg>${source} ${String(dark)}</svg>`));
    const shared = shareRenders(render);

    await shared('A', false);
    await shared('A', false);
    await shared('A', true);
    expect(render).toHaveBeenCalledTimes(2);

    shared.clear();
    await shared('A', false);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failure, so the next request tries again', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('Rendering timed out')).mockResolvedValueOnce('<svg/>');
    const shared = shareRenders(render);

    await expect(shared('A', false)).rejects.toThrow('Rendering timed out');
    expect(await shared('A', false)).toBe('<svg/>');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest result beyond its bound', async () => {
    const render = vi.fn((source: string) => Promise.resolve(source));
    const shared = shareRenders(render, 2);

    await shared('A', false);
    await shared('B', false);
    await shared('C', false);
    await shared('A', false);
    expect(render).toHaveBeenCalledTimes(4);
  });
});
