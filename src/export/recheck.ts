import { createHash } from 'node:crypto';

import type { IncludeContext, InputRequest } from '../core/types';
import { contextOf, IncludeSession, inputRequestsOf, type IncludeAccess } from '../includes/session';
import { canonicalJson } from './manifest';

/**
 * Whether what an image was drawn from is still what it would be drawn from
 * now, told without drawing it: the diagram's text, where its local
 * includes are looked for, and each request its drawing made, answered
 * again as it would be now — the file delivered and its text, the places
 * found empty first, or why none was — in the order the engine asked.
 *
 * The requests are answered as a drawing answers them (src/includes/
 * session.ts), the limits on what one drawing may read included, and the
 * files are read as a drawing reads them: an open document as it is edited.
 * What the engine would ask for now only because a file it read has changed
 * cannot be told without drawing; the change found is reason enough to draw
 * again.
 *
 * Like the exporter, this module has no dependency on the `vscode` module.
 */

/**
 * What a drawing was drawn from, as far as it can be looked at again
 * without drawing: the diagram's text, by its SHA-256 — null for a diagram
 * without a name of its own, which cannot be found again in its document —
 * where its local includes were looked for, each request as answered, and
 * each file delivered, by the SHA-256 of its text. A record of what an
 * image was drawn from (src/export/manifest.ts) says each of them.
 */
export interface DrawnFrom {
  source: string | null;
  context: IncludeContext;
  /** In the order the engine asked. */
  requests: readonly InputRequest[];
  files: readonly { file: string; sha256: string }[];
}

/** Something an image was drawn from that is otherwise now. */
export type InputChange =
  /** The diagram's own text, or the diagram is gone. */
  | { change: 'diagram' }
  /** Where its local includes are looked for, or that none are read now. */
  | { change: 'context' }
  /** A request answered otherwise now: another file, none, or a place found empty before that holds a file now. */
  | { change: 'answer'; path: string }
  /** A file delivered, whose text is another now. */
  | { change: 'file'; file: string };

/** The SHA-256 of `text` as UTF-8, in hex. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Whether a request was answered the same both times: how it ended, the file delivered and the places looked at. */
function sameAnswer(was: InputRequest, now: InputRequest | undefined): boolean {
  return (
    now !== undefined &&
    was.outcome === now.outcome &&
    was.file === now.file &&
    was.looked.length === now.looked.length &&
    was.looked.every((path, index) => path === now.looked[index])
  );
}

/**
 * What of `drawn` is otherwise now, in the order found, for the diagram
 * whose text is `source` now — null once it is gone — its local includes
 * looked for as `access` says and an open document read as `openText` gives
 * it. Empty when nothing is.
 */
export async function recheckInputs(
  drawn: DrawnFrom,
  source: string | null,
  access: IncludeAccess,
  openText: (path: string) => string | undefined
): Promise<InputChange[]> {
  const changes: InputChange[] = [];
  if (drawn.source !== null && (source === null || sha256(source) !== drawn.source)) {
    changes.push({ change: 'diagram' });
  }
  // A drawing without a local include looked for none: wherever they would
  // be looked for now, it was drawn from its text alone.
  if (drawn.context === null) {
    return changes;
  }
  if (canonicalJson(contextOf(access)) !== canonicalJson(drawn.context)) {
    changes.push({ change: 'context' });
  }

  const session = new IncludeSession(access, openText);
  const texts = new Map<string, string>();
  for (const was of drawn.requests) {
    const asked = session.requests.length;
    try {
      const file = await session.load(was.path, was.from, was.kind ?? undefined);
      texts.set(file.id, sha256(file.text));
    } catch {
      // The session keeps why, with the request.
    }
    // A read that ended in an error the session gave no answer for is no answer.
    const [now] = inputRequestsOf(session.requests.slice(asked));
    if (!sameAnswer(was, now)) {
      changes.push({ change: 'answer', path: was.path });
    }
  }
  for (const { file, sha256: recorded } of drawn.files) {
    const now = texts.get(file);
    if (now !== undefined && now !== recorded) {
      changes.push({ change: 'file', file });
    }
  }
  return changes;
}
