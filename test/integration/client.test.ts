import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RendererClient } from '../../src/render/client';
import { recognizeGraphvizCrash } from '../../src/render/engine-error';

/**
 * Exercises the extension-host worker client directly (it has no vscode
 * dependency): the timeout path against a worker that never answers, and
 * the recovery path against the real built worker.
 */

const hangWorkerPath = join(__dirname, 'helpers/hang-worker.cjs');
const wedgeWorkerPath = join(__dirname, 'helpers/wedge-worker.cjs');
const graphvizCrashWorkerPath = join(__dirname, 'helpers/graphviz-crash-worker.cjs');
const realWorkerPath = join(__dirname, '../../dist/worker.js');

const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

let client: RendererClient | null = null;

afterEach(() => {
  client?.dispose();
  client = null;
  vi.useRealTimers();
});

describe('RendererClient', () => {
  it('rejects a hung render after the timeout instead of waiting forever', async () => {
    client = new RendererClient(hangWorkerPath, log, 250);

    await expect(client.render('@startuml\nA -> B\n@enduml', false)).rejects.toThrow(
      'Rendering timed out'
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('logs timeouts in Japanese without changing the renderer error used by callers', async () => {
    const japanese = JSON.parse(readFileSync(join(__dirname, '../../l10n/bundle.l10n.ja.json'), 'utf8')) as Record<string, string>;
    client = new RendererClient(hangWorkerPath, log, 250, undefined, {
      t: (message, ...args) => (japanese[message] ?? message).replace(/\{(\d+)\}/g,
        (placeholder, index: string) => args[Number(index)] ?? placeholder),
    });
    await expect(client.render('@startuml\nA -> B\n@enduml', false)).rejects.toThrow('Rendering timed out');
    expect(log.warn).toHaveBeenCalledWith('描画が 250 ミリ秒以内に完了しなかったため、描画用ワーカーを再起動します。');
  });

  it('sends the renders queued behind a hung one to a fresh worker', async () => {
    // Only the client's time limits are faked. They then expire when the
    // test moves the clock, never while the new worker is still starting,
    // which on a busy machine can take longer than the limit itself.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    client = new RendererClient(wedgeWorkerPath, log, 250);

    const hung = client.render('@startuml\nHANG\n@enduml', false);
    const queued = client.render('@startuml\nA -> B\n@enduml', false);

    const timedOut = expect(hung).rejects.toThrow('Rendering timed out');
    await vi.advanceTimersByTimeAsync(250);
    await timedOut;
    // It never started, so it is not failed with the hung one: the new
    // worker draws it, within a time limit of its own.
    await expect(queued).resolves.toBe('<svg>@startuml\nA -> B\n@enduml</svg>');
    // And so does the next request.
    await expect(client.render('@startuml\nC -> D\n@enduml', false)).resolves.toBe(
      '<svg>@startuml\nC -> D\n@enduml</svg>'
    );
  });

  it('renders through the real worker within the default timeout', async () => {
    expect(existsSync(realWorkerPath), 'dist/worker.js missing — run `npm run bundle` first').toBe(
      true
    );
    client = new RendererClient(realWorkerPath, log);

    const svg = await client.render('@startuml\nAlice -> Bob : Hello\n@enduml', false);
    expect(svg).toMatch(/<svg/);
    expect(svg).toContain('Hello');
  });

  describe('after Graphviz crashes', () => {
    // The bundled Graphviz (WebAssembly) runs out of bounds of its memory
    // laying out 100 nested packages, and then fails every later layout in
    // the same worker with the same report.
    const crashing = [
      '@startuml',
      ...Array.from({ length: 100 }, (_, i) => `package p${String(i)} {`),
      'class Leaf',
      ...Array.from({ length: 100 }, () => '}'),
      '@enduml',
    ].join('\n');
    const classes = '@startuml\nclass Alpha\nclass Beta\nAlpha --> Beta\n@enduml';

    it('lays out the next diagram with a fresh Graphviz', async () => {
      client = new RendererClient(realWorkerPath, log);

      // The diagram must still crash the bundled Graphviz for this to test
      // anything. If an engine update stops that, find one that does.
      expect(recognizeGraphvizCrash(await client.render(crashing, false))).toBe(true);

      const next = await client.render(classes, false);
      expect(recognizeGraphvizCrash(next)).toBe(false);
      expect(next).toContain('Alpha');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Graphviz crashed'));
    });

    it('sends the renders queued behind the crash to a fresh worker', async () => {
      client = new RendererClient(realWorkerPath, log);

      const crashed = client.render(crashing, false);
      const queued = client.render(classes, false);

      expect(recognizeGraphvizCrash(await crashed)).toBe(true);
      const drawn = await queued;
      expect(recognizeGraphvizCrash(drawn)).toBe(false);
      expect(drawn).toContain('Alpha');
    });

    it('ignores what the replaced worker drew after the crash', async () => {
      // This worker answers the request queued behind the crash at once,
      // with the crash report, before the client has replaced it. That
      // answer must not settle the request; the new worker's does.
      client = new RendererClient(graphvizCrashWorkerPath, log);

      const crashed = client.render('CRASH', false);
      const queued = client.render('A -> B', false);

      expect(recognizeGraphvizCrash(await crashed)).toBe(true);
      await expect(queued).resolves.toBe('<svg>A -> B</svg>');
    });
  });

  it('rejects everything outstanding on dispose', async () => {
    client = new RendererClient(hangWorkerPath, log, 60_000);
    const pending = client.render('@startuml\nA -> B\n@enduml', false);

    client.dispose();
    await expect(pending).rejects.toThrow('Extension deactivated');
    client = null;
  });

  describe('idle shutdown', () => {
    it('shuts the worker down once it has been idle, and restarts on demand', async () => {
      // The worker holds the engine, the WASM and any sprite library a
      // diagram pulled in; that should not outlive the editing session.
      client = new RendererClient(realWorkerPath, log, 30_000, 150);

      const first = await client.render('@startuml\nAlice -> Bob : Hello\n@enduml', false);
      expect(first).toContain('Hello');

      await vi.waitFor(
        () => {
          expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('inactivity'));
        },
        { timeout: 5_000 }
      );

      // A fresh worker serves the next request transparently.
      const second = await client.render('@startuml\nCarol -> Dave : Bye\n@enduml', false);
      expect(second).toContain('Bye');
    });

    it('does not shut down while a render is still in flight', async () => {
      // Idle window far shorter than the render it must not interrupt.
      client = new RendererClient(hangWorkerPath, log, 800, 100);

      await expect(client.render('@startuml\nA -> B\n@enduml', false)).rejects.toThrow(
        'Rendering timed out'
      );
      // Reaching the render timeout proves the idle timer did not fire
      // underneath it and reject the request early with another message.
    });
  });
});
