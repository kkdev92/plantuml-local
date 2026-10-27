/**
 * Whether a `@startuml` diagram is a sequence diagram or an activity
 * diagram, told from lines only one of the two reads.
 *
 * The bundled engine tries one diagram type after another on the lines of
 * a `@startuml` diagram and draws it as the first type that reads them all,
 * the sequence diagram among the first. So a diagram's type cannot be told
 * from any one line, but some lines are read by one type alone: a marker
 * here is a line that the engine drew as its type, and that turned every
 * other type it was added to (class, use case, component, state, timing,
 * the old activity syntax, and the other of the two) into an error. Lines
 * the types share (a message, `actor`, `...`, `partition`) decide nothing. test/integration/worker.test.ts draws each marker both
 * ways with the bundled engine, so a new engine that reads them otherwise
 * fails it.
 *
 * Markers are looked for in code only: not in comments, quoted text or
 * notes, nor in a `{ … }` body, where a class's member may read `start` or
 * `loop count`. Keywords are matched regardless of case, as the engine
 * matches them.
 */

import type { CodeLine } from './protected';

export type DiagramKind = 'sequence' | 'activity';

/**
 * What follows a keyword: a space and an argument, or nothing. Not an
 * arrow, so that `loop --> idle` relates an element named `loop`.
 */
const ARGUMENT = String.raw`(?:\s+(?![-.=<>~])|\s*$)`;
const keyword = (words: string): RegExp => new RegExp(String.raw`^\s*(?:${words})${ARGUMENT}`, 'i');

const MARKERS: readonly (readonly [DiagramKind, readonly RegExp[]])[] = [
  [
    'sequence',
    [
      keyword(String.raw`(?:create\s+)?participant|activate|deactivate|destroy|autonumber|return|box|[hr]note`),
      // A group, coloured or not: `alt#Gold #LightBlue x`.
      keyword(String.raw`(?:alt|opt|loop|par|critical)(?:#\w+)?`),
      // A reference or a note over participants, which only the sequence diagram has.
      /^\s*(?:ref|note)\s+over\b/i,
      /^\s*==.*==\s*$/,
      // Messages from or to outside the diagram: `[-> A`, `A ->]`.
      /^\s*\[[ox]?[-<]/,
      /-+>{1,2}[ox]?\s*\](?:\s*:|\s*$)/,
    ],
  ],
  [
    'activity',
    [
      /^\s*(?:start|stop|detach|kill)\s*$/i,
      /^\s*:.*;\s*$/,
      /^\s*(?:if|while|switch)\s*\(/i,
      keyword('repeat|fork|split'),
      // A swimlane, coloured or not: `|Lane|`, `|#pink|Lane|`.
      /^\s*\|[^|]+\|/,
    ],
  ],
];

const BODY_OPEN = /\{\s*$/;
const BODY_CLOSE = /^\s*\}/;
/** A partition of an activity diagram, whose `{ … }` holds activity lines. */
const PARTITION = /^\s*partition\b/i;

/**
 * Which of `lines` lie in a `{ … }` body, its closing line included: a
 * class's members, a skinparam block, a package's contents. The body of
 * an activity partition is not one.
 */
export function inBodies(lines: readonly CodeLine[]): boolean[] {
  // Each open brace, and whether it opens a body.
  const open: boolean[] = [];
  return lines.map(({ code, whole }) => {
    const inside = open.includes(true);
    if (whole) {
      return inside;
    }
    if (BODY_CLOSE.test(code)) {
      open.pop();
    } else if (BODY_OPEN.test(code)) {
      open.push(!PARTITION.test(code));
    }
    return inside;
  });
}

/**
 * The type the markers among `lines` settle on, or null when they settle
 * on none: no marker, or markers of both. The line `skip` is left out:
 * the one being typed.
 */
export function diagramKind(lines: readonly CodeLine[], skip?: number): DiagramKind | null {
  const bodies = inBodies(lines);
  const found = new Set<DiagramKind>();
  lines.forEach(({ code, whole }, index) => {
    if (whole || bodies[index] === true || index === skip) {
      return;
    }
    for (const [kind, markers] of MARKERS) {
      if (markers.some((marker) => marker.test(code))) {
        found.add(kind);
      }
    }
  });
  return found.size === 1 ? ([...found][0] ?? null) : null;
}
