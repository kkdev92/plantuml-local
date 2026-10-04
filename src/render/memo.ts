import type { DiagramRender } from '../core/types';
import { hasLocalInclude } from '../includes/describe';

/**
 * Lets the preview and the diagnostics share renders.
 *
 * Both draw the same blocks in the same palette, often at the same moment:
 * a document opened with its preview asks for every diagram twice. A render
 * already running is joined rather than started again, and the last results
 * are kept, so whichever asks second gets the first one's answer. Failures
 * are not kept: a timeout is worth trying again.
 *
 * A diagram with a local include draws what the files hold at the time,
 * which the next change to one of them makes stale: it is shared while it
 * runs, but not kept. Its document is part of what it is shared by, as its
 * includes are looked for next to the document.
 */

/** Draws `source`, written in `document` (a URI). */
export type Render = (source: string, dark: boolean, document?: string) => Promise<DiagramRender>;

export interface SharedRender extends Render {
  /** Forgets every kept result, for a re-render the user asked for. */
  clear(): void;
}

export function shareRenders(render: Render, maxEntries = 64, maxSize = 16 * 1024 * 1024): SharedRender {
  const running = new Map<string, Promise<DiagramRender>>();
  /** Insertion order doubles as eviction order, as in the preview's cache. */
  const kept = new Map<string, DiagramRender>();
  let size = 0;

  function keep(key: string, result: DiagramRender): void {
    kept.set(key, result);
    size += result.svg.length;
    while (kept.size > maxEntries || (size > maxSize && kept.size > 1)) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      size -= kept.get(oldest)?.svg.length ?? 0;
      kept.delete(oldest);
    }
  }

  const shared = (source: string, dark: boolean, document?: string): Promise<DiagramRender> => {
    const local = hasLocalInclude(source);
    const key = `${dark ? 'dark' : 'light'}\n${local ? (document ?? '') : ''}\n${source}`;
    const done = kept.get(key);
    if (done !== undefined) {
      // Re-insert so a result in use counts as the newest.
      kept.delete(key);
      kept.set(key, done);
      return Promise.resolve(done);
    }
    const pending = running.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const started = render(source, dark, document).then(
      (result) => {
        running.delete(key);
        if (!local) {
          keep(key, result);
        }
        return result;
      },
      (error: unknown) => {
        running.delete(key);
        throw error;
      }
    );
    running.set(key, started);
    return started;
  };

  return Object.assign(shared, {
    clear(): void {
      kept.clear();
      size = 0;
    },
  });
}
