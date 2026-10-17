import { MAX_SEARCH_FOLDERS, type SearchFoldersProblem } from './resolver';
import type { IncludeFailure, IncludeFailureReason } from './session';

/**
 * Says why a local include failed, in words the caller localised
 * (vscode.l10n), and tells which diagrams can have one at all.
 */

/**
 * A line that may ask for a local file: `!include`, `!include_once` or
 * `!include_many` with anything but a library (`<…>`) or a URL, a variable
 * included. A source without one never makes the engine ask, so it is
 * drawn without a loader and shared between documents as before.
 */
const LOCAL_INCLUDE = /^[ \t]*!include(?:_once|_many)?\b(?![ \t]*(?:<|https?:\/\/))/im;

/** Whether `source` may include a local file. */
export function hasLocalInclude(source: string): boolean {
  return LOCAL_INCLUDE.test(source);
}

/** The line (from 0) of the first line of `source` that may include a local file, or -1. */
export function firstLocalIncludeLine(source: string): number {
  const line = /^[ \t]*!include(?:_once|_many)?\b(?![ \t]*(?:<|https?:\/\/))/i;
  return source.split(/\r?\n/).findIndex((text) => line.test(text));
}

export interface IncludeLabels {
  untrusted: string;
  untitled: string;
  notOnDisk: string;
  outsideWorkspace: string;
  /** `plantumlLocal.includePaths` is not a list of strings. */
  settingNotAList: string;
  settingTooMany(count: number, most: number): string;
  settingRefused(folder: string): string;
  /** Rooted, a drive, a share, a URI or `~`. */
  notRelative: string;
  /** A device name, a trailing dot or space, a `:` or a control character. */
  badName: string;
  versionControl: string;
  extension(extensions: string): string;
  outside: string;
  missing: string;
  missingAnywhere: string;
  link: string;
  notAFile: string;
  encoding: string;
  nul: string;
  unreadable: string;
  /** `line` counts from 1. */
  severalDiagrams(line: number): string;
  outsideDiagram(line: number): string;
  tooDeep(most: number): string;
  tooMany(most: number): string;
  tooLarge(mebibytes: number): string;
}

function describeSetting(problem: SearchFoldersProblem, labels: IncludeLabels): string {
  switch (problem.problem) {
    case 'not-a-list':
      return labels.settingNotAList;
    case 'too-many':
      return labels.settingTooMany(problem.count, MAX_SEARCH_FOLDERS);
    case 'refused':
      return labels.settingRefused(problem.folder);
  }
}

export function describeIncludeFailure(
  reason: IncludeFailureReason,
  labels: IncludeLabels,
  extensions: readonly string[],
  limits: { depth: number; files: number; bytes: number }
): string {
  switch (reason.kind) {
    case 'unavailable':
      switch (reason.why) {
        case 'untrusted':
          return labels.untrusted;
        case 'untitled':
          return labels.untitled;
        case 'not-on-disk':
          return labels.notOnDisk;
        case 'outside-workspace':
          return labels.outsideWorkspace;
        case 'setting':
          return describeSetting(reason.problem, labels);
      }
      break;
    case 'path':
      switch (reason.refusal) {
        case 'absolute':
        case 'uri':
        case 'home':
          return labels.notRelative;
        case 'vcs':
          return labels.versionControl;
        case 'extension':
          return labels.extension(extensions.join(', '));
        case 'empty':
        case 'control':
        case 'stream':
        case 'device':
        case 'trailing':
          return labels.badName;
      }
      break;
    case 'outside':
      return labels.outside;
    case 'missing':
      return reason.searched ? labels.missingAnywhere : labels.missing;
    case 'read':
      switch (reason.refusal) {
        case 'link':
          return labels.link;
        case 'outside':
          return labels.outside;
        case 'not-a-file':
          return labels.notAFile;
        case 'encoding':
          return labels.encoding;
        case 'nul':
          return labels.nul;
        case 'unreadable':
          return labels.unreadable;
      }
      break;
    case 'fragment':
      return reason.shape === 'several'
        ? labels.severalDiagrams(reason.line + 1)
        : labels.outsideDiagram(reason.line + 1);
    case 'limit':
      switch (reason.limit) {
        case 'depth':
          return labels.tooDeep(limits.depth);
        case 'files':
          return labels.tooMany(limits.files);
        case 'bytes':
          return labels.tooLarge(limits.bytes / (1024 * 1024));
      }
  }
  return labels.unreadable;
}

/**
 * The engine's message for a failed include, with why it failed when that is
 * known: "cannot include x" says nothing more.
 */
export function withIncludeReason(message: string, failedIncludes: ReadonlyMap<string, string>): string {
  const path = /^cannot include (.+)$/.exec(message)?.[1];
  const reason = path === undefined ? undefined : failedIncludes.get(path);
  return reason === undefined ? message : `${message}: ${reason}`;
}

/** The failed includes of a render, by the path each named, with why: the first failure of each path. */
export function describeIncludeFailures(
  failures: readonly IncludeFailure[],
  describe: (reason: IncludeFailureReason) => string
): Map<string, string> {
  const described = new Map<string, string>();
  for (const { path, reason } of failures) {
    if (!described.has(path)) {
      described.set(path, describe(reason));
    }
  }
  return described;
}
