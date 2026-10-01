/**
 * Lets the preview and the diagnostics share renders.
 *
 * Both draw the same blocks in the same palette, often at the same moment:
 * a document opened with its preview asks for every diagram twice. A render
 * already running is joined rather than started again, and the last results
 * are kept, so whichever asks second gets the first one's answer. Failures
 * are not kept: a timeout is worth trying again.
 */

export type Render = (source: string, dark: boolean) => Promise<string>;

export interface SharedRender extends Render {
  /** Forgets every kept result, for a re-render the user asked for. */
  clear(): void;
}

export function shareRenders(render: Render, maxEntries = 64, maxSize = 16 * 1024 * 1024): SharedRender {
  const running = new Map<string, Promise<string>>();
  /** Insertion order doubles as eviction order, as in the preview's cache. */
  const kept = new Map<string, string>();
  let size = 0;

  function keep(key: string, svg: string): void {
    kept.set(key, svg);
    size += svg.length;
    while (kept.size > maxEntries || (size > maxSize && kept.size > 1)) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      size -= kept.get(oldest)?.length ?? 0;
      kept.delete(oldest);
    }
  }

  const shared = (source: string, dark: boolean): Promise<string> => {
    const key = `${dark ? 'dark' : 'light'}\n${source}`;
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
    const started = render(source, dark).then(
      (svg) => {
        running.delete(key);
        keep(key, svg);
        return svg;
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
