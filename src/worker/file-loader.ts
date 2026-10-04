import type { IncludeRequestMessage, IncludeResponseMessage } from '../core/types';

/**
 * Hands the engine the files of local includes, from the extension host.
 *
 * The engine asks `PLANTUML_FILE_LOADER` for the file of each local
 * `!include`, `!include_once` and `!include_many`, and waits for the answer;
 * it reads nothing itself. Which file may be read is not the worker's to
 * decide — the host does that, with the workspace's trust, its folders and
 * the editor's open documents at hand (src/includes/) — so each request
 * goes to the host and the answer comes back.
 *
 * Renders run one at a time, so a request belongs to the render in
 * progress. One the host gives no include access to declines every
 * request, which fails the include as if there were no loader: the
 * engine's own "cannot include" error.
 */

type Ok = (id: string, text: string) => void;
type Fail = (reason: string) => void;

export interface FileLoaderBridge {
  /** The requests that follow belong to `render`; `answered` when the host will answer them. */
  begin(render: number, answered: boolean): void;
  /** The render is over: an answer still to come is not waited for. */
  end(): void;
  /** Delivers the host's answer to a request. */
  answer(message: IncludeResponseMessage): void;
}

export function installFileLoader(post: (message: IncludeRequestMessage) => void): FileLoaderBridge {
  let current: { render: number; answered: boolean } | null = null;
  let nextRequest = 1;
  const waiting = new Map<number, { ok: Ok; fail: Fail }>();

  (globalThis as Record<string, unknown>).PLANTUML_FILE_LOADER = (
    path: string,
    from: string | null,
    ok: Ok,
    fail: Fail
  ): false | undefined => {
    if (current === null || !current.answered) {
      return false;
    }
    const request = nextRequest++;
    waiting.set(request, { ok, fail });
    post({ type: 'include', render: current.render, request, path, from });
    return undefined;
  };

  return {
    begin(render, answered): void {
      current = { render, answered };
    },
    end(): void {
      current = null;
      for (const { fail } of waiting.values()) {
        fail('The render ended before the file arrived');
      }
      waiting.clear();
    },
    answer(message): void {
      const pending = waiting.get(message.request);
      if (pending === undefined) {
        return;
      }
      waiting.delete(message.request);
      if (message.file !== undefined) {
        pending.ok(message.file.id, message.file.text);
      } else {
        pending.fail(message.error ?? 'The file was not delivered');
      }
    },
  };
}
