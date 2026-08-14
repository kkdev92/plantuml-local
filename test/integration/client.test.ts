import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RendererClient } from '../../src/render/client';

/**
 * Exercises the extension-host worker client directly (it has no vscode
 * dependency): the timeout path against a worker that never answers, and
 * the recovery path against the real built worker.
 */

const hangWorkerPath = join(__dirname, 'helpers/hang-worker.cjs');
const realWorkerPath = join(__dirname, '../../dist/worker.js');

const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

let client: RendererClient | null = null;

afterEach(() => {
  client?.dispose();
  client = null;
});

describe('RendererClient', () => {
  it('rejects a hung render after the timeout instead of waiting forever', async () => {
    client = new RendererClient(hangWorkerPath, log, 250);

    await expect(client.render('@startuml\nA -> B\n@enduml', false)).rejects.toThrow(
      'Rendering timed out'
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('fails renders queued behind the hung one and restarts for the next request', async () => {
    client = new RendererClient(hangWorkerPath, log, 250);

    const first = client.render('@startuml\nA -> B\n@enduml', false);
    const second = client.render('@startuml\nC -> D\n@enduml', false);

    await expect(first).rejects.toThrow('Rendering timed out');
    await expect(second).rejects.toThrow('Rendering timed out');

    // The next request must not be wedged behind the dead queue: it gets
    // a fresh worker. (Still the hanging fixture, so it times out too —
    // what matters is that it reaches the timeout instead of hanging.)
    await expect(client.render('@startuml\nE -> F\n@enduml', false)).rejects.toThrow(
      'Rendering timed out'
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
          expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('idle'));
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
