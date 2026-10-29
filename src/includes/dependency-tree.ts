import type { DrawingLog, DrawnRequest, LibraryRead } from '../core/types';
import type { IncludeDirective } from './directives';

/**
 * What a diagram depends on, as its last drawing found it: each request of
 * the engine under the file it was asked from, the diagram's own at the
 * top, in the order asked; the include lines of the diagram's text that no
 * request matches; and the files of the bundled libraries read.
 *
 * A request says what the engine asked for and what it was given, not what
 * the diagram used: a file read a second time, or again in a cycle, is
 * delivered and skipped, and a selector keeps only part of one. The line
 * that asked is known only for a request of the diagram that a line
 * written as it asked matches: the lines of a theme read from a folder ask
 * from where the theme was asked from, and a path worked out when drawn is
 * matched to no line.
 *
 * Like the completion, this has no dependency on the `vscode` module.
 */

/** The most requests shown under one file; the rest are counted. */
export const MOST_SHOWN = 200;

/** A request, with the requests of the file it delivered under it. */
export interface RequestNode {
  type: 'request';
  request: DrawnRequest;
  /**
   * Why the requests of the file it delivered are not under it: the file is
   * one of those above it (`cycle`), or its requests are under another
   * request for it (`again`).
   */
  repeat?: 'cycle' | 'again';
  /** For a request of the diagram, the lines of its text written as it asked; empty otherwise. */
  lines: readonly number[];
  /** The file a drawing before read for the same request, when this one found none. */
  readBefore?: string;
  children: readonly DependencyNode[];
}

/** An include line of the diagram's text that no request matches. */
export interface LineNode {
  type: 'line';
  directive: IncludeDirective;
  /**
   * Why: its path is worked out when drawn, so which request it made is not
   * known (`worked-out`); it is read when the procedure or function it is
   * written in runs (`in-body`); or the drawing did not ask for it.
   */
  why: 'worked-out' | 'in-body' | 'not-asked';
}

/** The include lines no request matches. */
export interface LinesNode {
  type: 'lines';
  lines: readonly LineNode[];
}

/** The files of the bundled libraries the drawing read. */
export interface LibrariesNode {
  type: 'libraries';
  libraries: readonly LibraryRead[];
}

/** Requests left out under one file, past {@link MOST_SHOWN}. */
export interface MoreNode {
  type: 'more';
  count: number;
}

export type DependencyNode = RequestNode | LinesNode | LibrariesNode | MoreNode;

/** Whether a line written as `directive` asks for what `request` asked for. */
function asks(directive: IncludeDirective, request: DrawnRequest): boolean {
  return directive.literal && directive.path === request.path && (request.kind ?? directive.kind) === directive.kind;
}

/**
 * The tree of `log`, a drawing of a diagram whose text has `directives`.
 * `readBefore` gives the file an earlier drawing read for a request that
 * found none now.
 */
export function dependencyTree(
  log: DrawingLog,
  directives: readonly IncludeDirective[],
  readBefore: (request: DrawnRequest) => string | undefined = () => undefined,
  most = MOST_SHOWN
): DependencyNode[] {
  // A theme read from a folder is two directives on one line.
  const written = new Map<number, IncludeDirective>();
  for (const directive of directives) {
    if (!written.has(directive.line)) {
      written.set(directive.line, directive);
    }
  }
  const asked = new Map<string | null, DrawnRequest[]>();
  for (const request of log.requests) {
    const from = asked.get(request.from);
    if (from === undefined) {
      asked.set(request.from, [request]);
    } else {
      from.push(request);
    }
  }

  // The requests in the tree, or counted in it.
  const placed = new Set<DrawnRequest>();
  const opened = new Set<string>();
  const under = (requests: readonly DrawnRequest[], above: ReadonlySet<string>): DependencyNode[] => {
    const nodes: DependencyNode[] = requests.slice(0, most).map((request): RequestNode => {
      placed.add(request);
      const lines =
        request.from === null
          ? [...written.values()].filter((directive) => asks(directive, request)).map((directive) => directive.line)
          : [];
      const before = request.state === 'missing' ? readBefore(request) : undefined;
      const node = { type: 'request' as const, request, lines, ...(before === undefined ? {} : { readBefore: before }) };
      const { id } = request;
      if (request.state !== 'read' || id === undefined) {
        return { ...node, children: [] };
      }
      if (above.has(id)) {
        return { ...node, repeat: 'cycle', children: [] };
      }
      if (opened.has(id)) {
        return { ...node, repeat: 'again', children: [] };
      }
      opened.add(id);
      return { ...node, children: under(asked.get(id) ?? [], new Set([...above, id])) };
    });
    if (requests.length > most) {
      for (const request of requests.slice(most)) {
        placed.add(request);
      }
      nodes.push({ type: 'more', count: requests.length - most });
    }
    return nodes;
  };

  const tree = under(asked.get(null) ?? [], new Set());
  // Asked from a file no request delivered: kept, at the top. Any other
  // request left is under a request counted rather than listed.
  const delivered = new Set(log.requests.map((request) => (request.state === 'read' ? request.id : undefined)));
  for (const request of log.requests) {
    if (!placed.has(request) && request.from !== null && !delivered.has(request.from)) {
      tree.push(...under([request], new Set()));
    }
  }
  const lines = [...written.values()]
    .filter((directive) => !log.requests.some((request) => request.from === null && asks(directive, request)))
    .map((directive): LineNode => ({
      type: 'line',
      directive,
      why: directive.inBody ? 'in-body' : directive.literal ? 'not-asked' : 'worked-out',
    }));
  if (lines.length > 0) {
    tree.push({ type: 'lines', lines });
  }
  if (log.libraries.length > 0) {
    tree.push({ type: 'libraries', libraries: log.libraries });
  }
  return tree;
}
