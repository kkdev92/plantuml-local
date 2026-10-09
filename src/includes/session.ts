import { INCLUDE_LIMITS } from '../core/constants';
import { forEachCodeLine } from '../core/shape';
import type { IncludedFile, IncludeLoader } from '../core/types';
import { includesAzure, themeLines } from '../render/palette';
import { parseIncludePath, type PathRefusal } from './path-policy';
import { readIncludeFile, type ReadRefusal } from './reader';
import { includeCandidates, isWithin, type IncludeScope, type SearchFoldersProblem } from './resolver';

/**
 * Answers the local includes of one render.
 *
 * The engine asks for each file in the order it runs the diagram, so a
 * file behind a branch it does not take is never asked for. Each request
 * is checked from the path's text (path-policy.ts), looked for where it may
 * be (resolver.ts) and read (reader.ts); the first candidate that exists is
 * the answer, and one that may not be read stops the include rather than
 * letting a file of the same name elsewhere stand in for it.
 *
 * Every failure is kept, with why, so the preview, the Problems panel and
 * the export can say more than the engine's "cannot include". So is every
 * path looked at, the files read and the ones found missing: a later change
 * to any of them can change the diagram.
 */

/** Why a document's diagrams get no local includes at all. */
export type Unavailable =
  /** Restricted Mode: nothing is read until the workspace is trusted. */
  | { why: 'untrusted' }
  /** An untitled document has no folder to look in. */
  | { why: 'untitled' }
  /** A document that is not a file on disk (a virtual file system). */
  | { why: 'not-on-disk' }
  /** A document outside every workspace folder. */
  | { why: 'outside-workspace' }
  /** `plantumlLocal.includePaths` cannot be used. */
  | { why: 'setting'; problem: SearchFoldersProblem };

/** Whether a document's diagrams get their local includes, and where they are looked for. */
export type IncludeAccess = { available: true; scope: IncludeScope } | ({ available: false } & Unavailable);

/** Why one include failed. */
export type IncludeFailureReason =
  | ({ kind: 'unavailable' } & Unavailable)
  | { kind: 'path'; refusal: PathRefusal }
  /** It would leave the workspace folder. */
  | { kind: 'outside' }
  /** Not found next to the including file, nor in a search folder when `searched`. */
  | { kind: 'missing'; searched: boolean }
  | { kind: 'read'; refusal: Exclude<ReadRefusal, 'too-large'> }
  | { kind: 'limit'; limit: keyof typeof INCLUDE_LIMITS };

export interface IncludeFailure {
  /** The file the directive names, as the engine handed it over. */
  path: string;
  reason: IncludeFailureReason;
}

export class IncludeSession {
  /** Failed includes, in the order the engine asked. */
  readonly failures: IncludeFailure[] = [];
  /** Every path looked at: a later change to one of them can change the diagram. */
  readonly dependencies = new Set<string>();
  /**
   * What the files delivered set the palette with, in order
   * (src/render/palette.ts): their `!theme` lines, and the lines of a theme
   * read from a folder of the workspace.
   */
  readonly themes: string[] = [];
  /** Whether a file delivered includes the bundled Azure library. */
  azure = false;

  private files = 0;
  private bytes = 0;
  /** File id → how deep it was included: its own includes go one deeper. */
  private readonly depths = new Map<string, number>();

  constructor(
    private readonly access: IncludeAccess,
    private readonly openText: (path: string) => string | undefined,
    private readonly limits: typeof INCLUDE_LIMITS = INCLUDE_LIMITS
  ) {}

  readonly load: IncludeLoader = async (path, from, kind) => {
    const fail = (reason: IncludeFailureReason): never => {
      this.failures.push({ path, reason });
      // The engine writes this to the console; the failure above is what is shown.
      throw new Error(`${path}: ${reason.kind}`);
    };

    const access = this.access;
    if (!access.available) {
      return fail(
        access.why === 'setting'
          ? { kind: 'unavailable', why: 'setting', problem: access.problem }
          : { kind: 'unavailable', why: access.why }
      );
    }
    const scope = access.scope;
    // `from` is an id this session gave the engine, or null; anything else
    // did not come from it, and is not looked next to.
    const outer = from === null ? 0 : this.depths.get(from);
    if (outer === undefined) {
      return fail({ kind: 'outside' });
    }
    if (outer + 1 > this.limits.depth) {
      return fail({ kind: 'limit', limit: 'depth' });
    }
    if (this.files >= this.limits.files) {
      return fail({ kind: 'limit', limit: 'files' });
    }
    const parsed = parseIncludePath(path);
    if (!parsed.ok) {
      return fail({ kind: 'path', refusal: parsed.refusal });
    }

    for (const candidate of includeCandidates(parsed.path, from, scope)) {
      if (!isWithin(scope.root, candidate)) {
        return fail({ kind: 'outside' });
      }
      this.dependencies.add(candidate);
      const outcome = await readIncludeFile(scope.root, candidate, {
        openText: this.openText,
        maxBytes: this.limits.bytes - this.bytes,
      });
      if (outcome.kind === 'missing') {
        continue;
      }
      if (outcome.kind === 'refused') {
        return fail(
          outcome.refusal === 'too-large'
            ? { kind: 'limit', limit: 'bytes' }
            : { kind: 'read', refusal: outcome.refusal }
        );
      }
      this.files++;
      this.bytes += Buffer.byteLength(outcome.text, 'utf8');
      this.depths.set(outcome.id, outer + 1);
      this.dependencies.add(outcome.id);
      // A theme-shaped filename can also be an ordinary include. Only the
      // engine knows which operation requested it; selection stays there too.
      this.themes.push(...(kind === 'theme' ? themeContent(outcome.text) : themeLines(outcome.text)));
      this.azure ||= includesAzure(outcome.text);
      const file: IncludedFile = { id: outcome.id, text: outcome.text };
      return file;
    }
    return fail({ kind: 'missing', searched: !parsed.path.anchored && scope.searchFolders.length > 0 });
  };
}

/**
 * The lines a theme read from a folder sets the palette with: its code
 * lines, trimmed, without the YAML header that the engine skips when the
 * file's first line is `---`.
 */
function themeContent(text: string): string[] {
  const all = text.split(/\r?\n/);
  let start = 0;
  if (all[0] === '---') {
    const end = all.indexOf('---', 1);
    start = end === -1 ? all.length : end + 1;
  }
  const lines: string[] = [];
  forEachCodeLine(all.slice(start).join('\n'), (line) => {
    if (line.trim() !== '') {
      lines.push(line.trim());
    }
  });
  return lines;
}
