import { describe, expect, it } from 'vitest';

import type { ReplayFinding } from '../../src/core/types';
import { classifyReplay, MAX_REPLAY_REASONS, REPLAY_RULES, scanText } from '../../src/export/replay';

const lines = (...text: string[]): string => text.join('\n');

/** What `scanText` finds, as `replay what @line`. */
const found = (text: string): string[] => scanText(text).map(({ replay, what, line }) => `${replay} ${what} @${String(line)}`);

describe('scanText', () => {
  it('finds nothing in plain lines, comments, includes and themes written out in full, and a percent that calls nothing', () => {
    expect(
      scanText(
        lines(
          '@startuml',
          "' %date() in a comment",
          "/' %random()",
          "   %getenv(\"HOME\") '/",
          '!include parts/a.puml',
          '!include_once <C4/C4_Container>',
          '!include_many parts/a.puml',
          '!includesub parts/a.puml!PART',
          '!startsub PART',
          '!endsub',
          '!theme cerulean',
          '!theme carbon-gray from ./themes',
          'Alice -> Bob : 100% done, %date without brackets, %unknown(1)',
          '@enduml'
        )
      )
    ).toEqual([]);
  });

  it('takes a call that reads the time, a random number or the environment as volatile, space before the bracket or not', () => {
    expect(
      found(
        lines(
          'title Drawn %date("yyyy-MM-dd")',
          'Alice -> Bob : %now ( )',
          'note: %random(10) and %getenv("USER")',
          '!$when = %filedate()'
        )
      )
    ).toEqual([
      'volatile function:date @0',
      'volatile function:now @1',
      'volatile function:random @2',
      'volatile function:getenv @2',
      'volatile function:filedate @3',
      'unclassified directive:affectation @3',
    ]);
  });

  it('takes a call of any other function of the engine as unclassified', () => {
    expect(found(lines('Alice -> Bob : %strlen("abc")', 'Alice -> Bob : %invoke_procedure("$p")'))).toEqual([
      'unclassified function:strlen @0',
      'unclassified function:invoke_procedure @1',
    ]);
  });

  it('takes every other line of the preprocessor as unclassified, by the type the engine reads it as', () => {
    const read: [string, string][] = [
      ['!define SHOW 1', 'affectation-define'],
      ['!define BOX(x) x', 'legacy-define'],
      ['!definelong LONG', 'legacy-definelong'],
      ['!$name = "Bob"', 'affectation'],
      ['!ifdef SHOW', 'ifdef'],
      ['!ifndef SHOW', 'ifndef'],
      ['!if $name == "Bob"', 'if'],
      ['!elseif 1', 'elseif'],
      ['!else', 'else'],
      ['!endif', 'endif'],
      ['!procedure $box($x)', 'procedure'],
      ['!endprocedure', 'end-function'],
      ['!function $twice($x)', 'function'],
      ['!return $x + $x', 'return'],
      ['!while 0', 'while'],
      ['!endwhile', 'endwhile'],
      ['!foreach $item in [1]', 'foreach'],
      ['!endfor', 'endforeach'],
      ['!undef SHOW', 'undef'],
      ['!assert 1', 'assert'],
      ['!log hello', 'log'],
      ['!dump_memory', 'dump-memory'],
      ['!option handwritten true', 'option'],
      ['!import lib.zip', 'import'],
      ['!includedef parts/a.puml', 'includedef'],
    ];

    // In two texts, as each keeps at most MAX_REPLAY_REASONS of a kind.
    for (const part of [read.slice(0, 13), read.slice(13)]) {
      expect(found(lines(...part.map(([line]) => line)))).toEqual(
        part.map(([, type], line) => `unclassified directive:${type} @${String(line)}`)
      );
    }
  });

  it('takes an include or a theme whose path or name the text puts together, or a URL, as unclassified', () => {
    expect(
      found(
        lines(
          '!include $base/a.puml',
          '!includesub %get_variable_value("$f")!PART',
          '!theme $theme',
          '!includeurl https://example.com/a.puml'
        )
      )
    ).toEqual([
      'unclassified dynamic:include @0',
      'unclassified dynamic:includesub @1',
      'unclassified function:get_variable_value @1',
      'unclassified dynamic:theme @2',
      'unclassified directive:includeurl @3',
    ]);
  });

  it('takes a bundled theme that reads the environment as volatile, in any case, but not a theme of the same name read from a folder', () => {
    expect(found(lines('!theme carbon-gray', '!theme Cerulean-Outline', '!theme carbon-gray from themes', '!theme cerulean'))).toEqual([
      'volatile theme:carbon-gray @0',
      'volatile theme:cerulean-outline @1',
    ]);
  });

  it(`keeps at most ${String(MAX_REPLAY_REASONS)} findings of each kind, the volatile ones first`, () => {
    const text = lines(...Array.from({ length: 25 }, (_, index) => `!$v${String(index)} = %date()`));
    const findings = scanText(text);

    expect(findings).toHaveLength(2 * MAX_REPLAY_REASONS);
    expect(findings.slice(0, MAX_REPLAY_REASONS).every(({ replay }) => replay === 'volatile')).toBe(true);
    expect(findings.slice(MAX_REPLAY_REASONS).every(({ replay }) => replay === 'unclassified')).toBe(true);
    expect(findings[MAX_REPLAY_REASONS - 1]?.line).toBe(MAX_REPLAY_REASONS - 1);
  });
});

describe('classifyReplay', () => {
  const volatile: ReplayFinding = { replay: 'volatile', what: 'function:date', line: 2 };
  const unclassified: ReplayFinding = { replay: 'unclassified', what: 'directive:procedure', line: 5 };
  const read = (library: string, key: string): { library: string; key: string; found: boolean } => ({ library, key, found: true });

  it('says a diagram is drawn from its inputs alone when nothing it or its files hold says otherwise, the bundled C4 and Azure included', () => {
    expect(classifyReplay([], [{ file: '/repo/a.puml', findings: [] }], [read('c4', 'c4_container'), read('azure', 'azurecommon')])).toEqual({
      class: 'stable-inputs',
      reasons: [],
    });
    expect(REPLAY_RULES).toBe(1);
  });

  it('says volatile over unclassified, and gives the reasons, the volatile ones first, with the file each is in', () => {
    expect(classifyReplay([unclassified], [{ file: '/repo/a.puml', findings: [volatile] }], [])).toEqual({
      class: 'volatile',
      reasons: [
        { ...volatile, file: '/repo/a.puml' },
        { ...unclassified, file: null },
      ],
    });
    expect(classifyReplay([], [{ file: '/repo/a.puml', findings: [unclassified] }], []).class).toBe('unclassified');
  });

  it('takes a library no one has audited as unclassified, once however many of its files were read', () => {
    expect(classifyReplay([], [], [read('other', 'a'), read('other', 'b'), read('c4', 'c4')])).toEqual({
      class: 'unclassified',
      reasons: [{ replay: 'unclassified', what: 'library:other', line: 0, file: null }],
    });
  });

  it(`gives at most ${String(MAX_REPLAY_REASONS)} reasons`, () => {
    const many = Array.from({ length: 15 }, (_, line): ReplayFinding => ({ ...unclassified, line }));
    const { reasons } = classifyReplay(many, [{ file: '/repo/a.puml', findings: [...many, volatile] }], []);

    expect(reasons).toHaveLength(MAX_REPLAY_REASONS);
    expect(reasons[0]).toEqual({ ...volatile, file: '/repo/a.puml' });
  });
});
