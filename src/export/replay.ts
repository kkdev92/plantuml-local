import { forEachCodeLine } from '../core/shape';
import type { LibraryRead, ReplayFinding } from '../core/types';
import { BUILTINS } from '../grammar/preprocessor';
import { engineLineType, type EngineLineType } from '../language/declarations';
import { AUDITED_LIBRARIES, AUDITED_THEMES, VOLATILE_FUNCTIONS } from './audit';

/**
 * Whether an exported image is drawn from what its export recorded alone,
 * so that drawing the same recorded inputs again draws the same image.
 *
 * The same text does not always draw the same image: the preprocessor can
 * read the time (`%date`, `%now`), a random number (`%random`) and the
 * environment (`%getenv`), and run what the text itself puts together as it
 * runs. A diagram is told to draw the same only when its text and every
 * file delivered for it hold nothing the engine runs but what is checked
 * here, read the way the engine reads its lines (TLineType): comments,
 * plain lines, includes and themes written out in full, and the bundled C4
 * and Azure, which were read for this (src/export/audit.ts). Anything else
 * of the preprocessor — a variable, a procedure, a function, `!define`, a
 * condition, a loop, an include whose path holds a variable, a call of any
 * `%` function — the text may well draw the same with, but proving it would
 * take running it, and nothing is run here. Such a diagram is
 * `unclassified`; one that reads the time, a random number or the
 * environment is `volatile`, as is one that picks a theme that does.
 *
 * Nothing here stops a diagram from being drawn or exported: what it says
 * is recorded with the export, for checking later whether the image is
 * still the export of its inputs.
 */

/** The version of these rules, recorded with what they found. */
export const REPLAY_RULES = 1;

export type ReplayClass = 'stable-inputs' | 'volatile' | 'unclassified';

/** Why a diagram is not `stable-inputs`: a finding, and the file it is in, or null for the diagram's own text. */
export interface ReplayReason extends ReplayFinding {
  file: string | null;
}

/** The most findings a text keeps of each kind, and the most reasons recorded. */
export const MAX_REPLAY_REASONS = 20;

/** The `%` functions of the engine, by name. */
const FUNCTIONS: ReadonlySet<string> = new Set(BUILTINS.map((name) => name.slice(1)));

/** A call: a function's name and its `(`, white space between them or not, as in an expression. */
const CALL = /%([\p{L}_][\p{L}_0-9]*)[ \t]*\(/gu;

/** Lines of the preprocessor that run nothing but what they name, written out in full. */
const STATIC: ReadonlySet<EngineLineType> = new Set<EngineLineType>([
  'comment',
  'comment-start',
  'plain',
  'include',
  'includesub',
  'startsub',
  'endsub',
  'theme',
]);

/** The name a `!theme` line picks; from the library shipped beside the engine when the line has no `from`. */
const THEME_NAME = /^\s*!theme\s+(\S+)/;
const FROM = /[ \t]from[ \t]/i;

/**
 * What `text` holds that may draw it differently another time, or that is
 * not told apart from that: at most {@link MAX_REPLAY_REASONS} of each kind.
 */
export function scanText(text: string): ReplayFinding[] {
  const volatile: ReplayFinding[] = [];
  const unclassified: ReplayFinding[] = [];
  const add = (finding: ReplayFinding): void => {
    const kept = finding.replay === 'volatile' ? volatile : unclassified;
    if (kept.length < MAX_REPLAY_REASONS) {
      kept.push(finding);
    }
  };
  forEachCodeLine(text, (line, index) => {
    const type = engineLineType(line);
    if (!STATIC.has(type)) {
      add({ replay: 'unclassified', what: `directive:${type}`, line: index });
    } else if (type !== 'plain' && type !== 'comment' && type !== 'comment-start') {
      if (/[$%]/.test(line)) {
        // The engine puts values in the path or the name before it reads it.
        add({ replay: 'unclassified', what: `dynamic:${type}`, line: index });
      } else if (type === 'include' && /^\s*!include\s*url\b/.test(line)) {
        add({ replay: 'unclassified', what: 'directive:includeurl', line: index });
      }
      const theme = type === 'theme' && !FROM.test(line) ? THEME_NAME.exec(line)?.[1]?.toLowerCase() : undefined;
      if (theme !== undefined && Object.hasOwn(AUDITED_THEMES.volatile, theme)) {
        add({ replay: 'volatile', what: `theme:${theme}`, line: index });
      }
    }
    for (const [, name = ''] of line.matchAll(CALL)) {
      if (FUNCTIONS.has(name)) {
        add({ replay: Object.hasOwn(VOLATILE_FUNCTIONS, name) ? 'volatile' : 'unclassified', what: `function:${name}`, line: index });
      }
    }
  });
  return [...volatile, ...unclassified];
}

/**
 * Whether a diagram is drawn from its inputs alone, from what its own text
 * holds (`diagram`), what each file delivered for it holds, and the files of
 * the bundled libraries it read; and why not, volatile reasons first, at
 * most {@link MAX_REPLAY_REASONS}.
 */
export function classifyReplay(
  diagram: readonly ReplayFinding[],
  files: readonly { file: string; findings: readonly ReplayFinding[] }[],
  libraries: readonly LibraryRead[]
): { class: ReplayClass; reasons: ReplayReason[] } {
  const reasons: ReplayReason[] = [
    ...diagram.map((finding) => ({ ...finding, file: null })),
    ...files.flatMap(({ file, findings }) => findings.map((finding) => ({ ...finding, file }))),
    ...[...new Set(libraries.map(({ library }) => library))]
      .filter((library) => !Object.hasOwn(AUDITED_LIBRARIES, library))
      .map((library): ReplayReason => ({ replay: 'unclassified', what: `library:${library}`, line: 0, file: null })),
  ];
  const volatile = reasons.filter(({ replay }) => replay === 'volatile');
  const unclassified = reasons.filter(({ replay }) => replay === 'unclassified');
  return {
    class: volatile.length > 0 ? 'volatile' : unclassified.length > 0 ? 'unclassified' : 'stable-inputs',
    reasons: [...volatile, ...unclassified].slice(0, MAX_REPLAY_REASONS),
  };
}
