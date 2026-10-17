import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { RENDER_TIMEOUT_MS, WORKER_IDLE_TIMEOUT_MS } from '../core/constants';
import type {
  IncludeLoader,
  IncludeRequestMessage,
  IncludeResponseMessage,
  RenderLog,
  RenderRequestMessage,
  RenderResponseMessage,
} from '../core/types';

/**
 * Extension-host side of the render worker.
 *
 * The rest of the extension only sees `render()`; the DOM shims and
 * engine loading quirks stay inside src/worker/. The worker is started
 * lazily on the first render and restarted transparently if it dies —
 * or if a render exceeds {@link RENDER_TIMEOUT_MS}, since renders are
 * serialised inside the worker and a hung one would wedge the queue.
 *
 * It is also shut down once it has been idle for
 * {@link WORKER_IDLE_TIMEOUT_MS}, which returns the engine and any
 * sprite libraries it loaded to the OS; the next render starts a fresh
 * one.
 *
 * A render given an {@link IncludeLoader} has its local includes answered
 * by it: the worker passes each file the engine asks for here, and the
 * answer goes back to the worker that asked.
 */
export class RendererClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<
    number,
    {
      resolve: (svg: string) => void;
      reject: (error: Error) => void;
      request: RenderRequestMessage;
      timer: NodeJS.Timeout;
      load: IncludeLoader | undefined;
    }
  >();

  constructor(
    private readonly workerPath: string,
    private readonly log: RenderLog,
    private readonly timeoutMs: number = RENDER_TIMEOUT_MS,
    private readonly idleTimeoutMs: number = WORKER_IDLE_TIMEOUT_MS
  ) {}

  /** Renders `source`; `load` answers its local includes, which fail without one. */
  render(source: string, dark: boolean, load?: IncludeLoader): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const id = this.nextId++;
      const request: RenderRequestMessage = { id, source, dark, includes: load !== undefined };
      this.pending.set(id, { resolve, reject, request, timer: this.startTimer(id), load });
      this.stopIdleTimer();
      this.getWorker().postMessage(request);
    });
  }

  dispose(): void {
    this.stopIdleTimer();
    this.failAll('Extension deactivated');
    void this.worker?.terminate();
    this.worker = null;
  }

  private startTimer(id: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.onRenderTimeout(id);
    }, this.timeoutMs);
    // Do not let a pending render keep the extension host alive.
    timer.unref();
    return timer;
  }

  private stopIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Arms the idle shutdown once nothing is in flight. */
  private restartIdleTimer(): void {
    this.stopIdleTimer();
    if (this.worker === null || this.pending.size > 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.worker === null || this.pending.size > 0) {
        return;
      }
      this.log.debug(`Render worker idle for ${String(this.idleTimeoutMs)} ms; shutting it down`);
      const idle = this.worker;
      // Clear first: the 'exit' handler must not read this as a crash.
      this.worker = null;
      void idle.terminate();
    }, this.idleTimeoutMs);
    // An idle worker waiting to be reaped must not hold the host open.
    this.idleTimer.unref();
  }

  private settle(id: number): { resolve: (svg: string) => void; reject: (error: Error) => void } | undefined {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return undefined;
    }
    this.pending.delete(id);
    clearTimeout(entry.timer);
    this.restartIdleTimer();
    return entry;
  }

  private failAll(reason: string): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(new Error(reason));
    }
  }

  private onRenderTimeout(id: number): void {
    if (!this.pending.has(id)) {
      return;
    }
    this.log.warn(`Render timed out after ${String(this.timeoutMs)} ms; restarting the worker`);
    this.settle(id)?.reject(new Error('Rendering timed out'));

    // The serial queue behind the hung render is wedged — replace the
    // worker. Requests still pending were queued behind the hung one and
    // never started: they go to the new worker, each with a time limit of
    // its own.
    void this.worker?.terminate();
    this.worker = null;
    this.stopIdleTimer();
    for (const [queued, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.timer = this.startTimer(queued);
      this.getWorker().postMessage(entry.request);
    }
  }

  private getWorker(): Worker {
    if (this.worker !== null) {
      return this.worker;
    }

    this.log.debug('Starting render worker');
    const created = new Worker(this.workerPath);

    created.on('message', (message: RenderResponseMessage | IncludeRequestMessage) => {
      if ('type' in message) {
        this.answerInclude(created, message);
        return;
      }
      const entry = this.settle(message.id);
      if (entry === undefined) {
        return;
      }
      if (message.error !== undefined) {
        entry.reject(new Error(message.error));
      } else {
        entry.resolve(message.svg ?? '');
      }
    });

    created.on('error', (error: Error) => {
      this.log.error(error);
      if (this.worker === created) {
        this.worker = null;
        this.failAll(error.message);
      }
    });

    created.on('exit', (code) => {
      this.log.debug(`Render worker exited (code=${String(code)})`);
      if (this.worker === created) {
        this.worker = null;
        this.failAll('Render worker exited');
      }
    });

    // Never keep the extension host process alive on our account.
    created.unref();

    this.worker = created;
    return created;
  }

  /**
   * Answers a file the engine asks for in `worker`, through the loader of
   * the render it belongs to. A render that has ended, by a timeout or a
   * replaced worker, gets an error; the worker that asked may be gone by
   * the time the answer is ready, and then nobody is waiting for it.
   */
  private answerInclude(worker: Worker, message: IncludeRequestMessage): void {
    const reply = (answer: Omit<IncludeResponseMessage, 'type' | 'request'>): void => {
      if (this.worker === worker) {
        const response: IncludeResponseMessage = { type: 'include', request: message.request, ...answer };
        worker.postMessage(response);
      }
    };
    const load = this.pending.get(message.render)?.load;
    if (load === undefined) {
      reply({ error: 'Local includes are not answered for this render' });
      return;
    }
    load(message.path, message.from, message.kind).then(
      (file) => {
        reply({ file });
      },
      (error: unknown) => {
        reply({ error: error instanceof Error ? error.message : String(error) });
      }
    );
  }
}

/** Resolves the worker bundle path relative to the compiled extension. */
export function defaultWorkerPath(): string {
  return join(__dirname, 'worker.js');
}
