import { createHash } from 'node:crypto';

/**
 * The audit of what the bundled engine runs that no diagram's author wrote:
 * the files of the bundled libraries (assets/stdlib/) and the `!theme`
 * library shipped beside the engine.
 *
 * An export records whether the image it wrote is drawn from its inputs
 * alone (src/export/replay.ts). A diagram that calls C4 or Azure runs their
 * procedures, whose lines its text does not show. These were read for the
 * engine's `%` functions: none of them reads the time, a random number or
 * the environment, or calls a procedure or a function by a name put
 * together as the text runs. The variables C4 reads and writes by a name
 * put together (`%get_variable_value`, `%set_variable_value`) are its own,
 * and the JSON file Azure reads (`%load_json`) is one of its own files; all
 * of it is in the inputs an export records. So a diagram that only calls
 * them can still be drawn from its inputs alone. Two of the themes read an
 * environment variable (`%getenv`): a diagram that picks one cannot.
 *
 * What was read is pinned below, each library by the SHA-256 of its asset
 * and the themes by {@link themesDigest}, with the `%` functions each
 * calls. scripts/build.mjs holds what it ships to this: a library or a
 * theme that changes, or calls a function not listed, or one of those
 * never allowed, stops the build until it is read again.
 */

/** Functions whose value the diagram's text does not settle, and what they read. */
export const VOLATILE_FUNCTIONS: Readonly<Record<string, 'time' | 'random' | 'environment'>> = {
  date: 'time',
  now: 'time',
  random: 'random',
  getenv: 'environment',
  filedate: 'environment',
  file_exists: 'environment',
  dirpath: 'environment',
  filename: 'environment',
  filename_no_extension: 'environment',
};

/** Functions that call a procedure or a function by a name the text puts together, or read a text as an expression. */
export const DYNAMIC_FUNCTIONS: readonly string[] = ['invoke_procedure', 'call_user_func', 'retrieve_procedure', 'eval'];

/** Each bundled library read: its asset by SHA-256, and the `%` functions its files call. */
export const AUDITED_LIBRARIES: Readonly<Record<string, { sha256: string; functions: readonly string[] }>> = {
  azure: {
    sha256: '94aae9c9bb70b849f2707372b7fa20f4632c45ced27bc5331927e86b1e68a617',
    functions: ['load_json'],
  },
  c4: {
    sha256: 'ae791a65514c8ac1ffd3b1996ea6009446d3d1f56971f4190799ede5d0459203',
    functions: [
      'breakline',
      'chr',
      'darken',
      'false',
      'function_exists',
      'get_variable_value',
      'intval',
      'is_dark',
      'lower',
      'newline',
      'set_variable_value',
      'splitstr',
      'splitstr_regex',
      'strlen',
      'strpos',
      'substr',
      'true',
      'variable_exists',
      'version',
    ],
  },
};

/**
 * The themes read: their {@link themesDigest}, the `%` functions they call,
 * and the themes that call one of {@link VOLATILE_FUNCTIONS}, with those.
 */
export const AUDITED_THEMES: {
  readonly sha256: string;
  readonly functions: readonly string[];
  readonly volatile: Readonly<Record<string, readonly string[]>>;
} = {
  sha256: 'dffb09882b7a139652cd8b3e7900ef7ff3af5fd865ed863cc401be7ba24019b3',
  functions: ['darken', 'getenv', 'lighten', 'not', 'variable_exists'],
  volatile: {
    'carbon-gray': ['getenv'],
    'cerulean-outline': ['getenv'],
  },
};

/** The names of the `%` functions `text` names, called or not, without the `%`. */
export function percentNames(text: string): Set<string> {
  return new Set([...text.matchAll(/%([\p{L}_][\p{L}_0-9]*)/gu)].map(([, name]) => name ?? ''));
}

/** The SHA-256 of `themes`: each theme's name and text, in the order of their names. */
export function themesDigest(themes: Readonly<Record<string, string>>): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(themes).sort()) {
    hash.update(name).update('\0').update(themes[name] ?? '').update('\0');
  }
  return hash.digest('hex');
}

/** What is shipped: each bundled library's asset, by library, and the themes, by name. */
export interface Shipped {
  libraries: Readonly<Record<string, Uint8Array>>;
  themes: Readonly<Record<string, string>>;
}

/** The names in `found` and not in `listed`, and those in `listed` and not in `found`. */
function differences(found: ReadonlySet<string>, listed: readonly string[]): { unlisted: string[]; unused: string[] } {
  return {
    unlisted: [...found].filter((name) => !listed.includes(name)).sort(),
    unused: listed.filter((name) => !found.has(name)),
  };
}

/** Whether `name` is never allowed in what is shipped. */
function forbidden(name: string): boolean {
  return Object.hasOwn(VOLATILE_FUNCTIONS, name) || DYNAMIC_FUNCTIONS.includes(name);
}

/** Why what is shipped is not what was read, one line each; none when it is. */
export function auditProblems(shipped: Shipped): string[] {
  const problems: string[] = [];
  for (const [library, asset] of Object.entries(shipped.libraries)) {
    const audited = Object.hasOwn(AUDITED_LIBRARIES, library) ? AUDITED_LIBRARIES[library] : undefined;
    if (audited === undefined) {
      problems.push(`${library}: not audited`);
      continue;
    }
    const sha256 = createHash('sha256').update(asset).digest('hex');
    if (sha256 !== audited.sha256) {
      problems.push(`${library}: the asset has SHA-256 ${sha256}, not the audited ${audited.sha256}`);
    }
    const { entries } = JSON.parse(new TextDecoder().decode(asset)) as { entries: Record<string, string> };
    const found = percentNames(Object.values(entries).join('\n'));
    for (const name of [...found].filter(forbidden).sort()) {
      problems.push(`${library}: calls %${name}, which an audited library may not`);
    }
    const { unlisted, unused } = differences(found, audited.functions);
    for (const name of unlisted.filter((name) => !forbidden(name))) {
      problems.push(`${library}: calls %${name}, which the audit does not list`);
    }
    for (const name of unused) {
      problems.push(`${library}: no longer calls %${name}, which the audit lists`);
    }
  }
  for (const library of Object.keys(AUDITED_LIBRARIES)) {
    if (!Object.hasOwn(shipped.libraries, library)) {
      problems.push(`${library}: audited, but not shipped`);
    }
  }

  const digest = themesDigest(shipped.themes);
  if (digest !== AUDITED_THEMES.sha256) {
    problems.push(`themes: their digest is ${digest}, not the audited ${AUDITED_THEMES.sha256}`);
  }
  const found = new Set<string>();
  const volatile = new Map<string, string[]>();
  for (const [theme, text] of Object.entries(shipped.themes)) {
    const names = percentNames(text);
    for (const name of names) {
      found.add(name);
    }
    for (const name of [...names].filter((name) => DYNAMIC_FUNCTIONS.includes(name)).sort()) {
      problems.push(`theme ${theme}: calls %${name}, which a theme may not`);
    }
    const reads = [...names].filter((name) => Object.hasOwn(VOLATILE_FUNCTIONS, name)).sort();
    if (reads.length > 0) {
      volatile.set(theme, reads);
    }
  }
  const { unlisted, unused } = differences(found, AUDITED_THEMES.functions);
  for (const name of unlisted.filter((name) => !DYNAMIC_FUNCTIONS.includes(name))) {
    problems.push(`themes: call %${name}, which the audit does not list`);
  }
  for (const name of unused) {
    problems.push(`themes: no longer call %${name}, which the audit lists`);
  }
  for (const theme of new Set([...volatile.keys(), ...Object.keys(AUDITED_THEMES.volatile)])) {
    const listed = Object.hasOwn(AUDITED_THEMES.volatile, theme) ? AUDITED_THEMES.volatile[theme] : undefined;
    const reads = volatile.get(theme) ?? [];
    if ((listed ?? []).join() !== reads.join()) {
      problems.push(
        `theme ${theme}: calls ${reads.map((name) => `%${name}`).join(', ') || 'none'} of the volatile functions, not as the audit lists`
      );
    }
  }
  return problems;
}
