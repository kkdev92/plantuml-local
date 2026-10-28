import { describe, expect, it } from 'vitest';

import {
  DIRECTIVES,
  expandSnippet,
  lineContext,
  mightSuggest,
  readCompletionData,
  SNIPPETS,
  suggest,
  suggestNames,
  suggestTemplates,
  TEMPLATES,
  type CompletionData,
} from '../../src/language/completion';
import { checkScopes } from './grammar/harness';

const DATA: CompletionData = {
  themes: ['cerulean', 'cerulean-outline', 'plain'],
  icons: ['heart', 'person'],
};

const labels = (before: string, after = '', open: string | null = 'uml'): string[] | undefined =>
  suggest(before, after, open, DATA)?.items.map((item) => item.label);

describe('suggest', () => {
  it('offers the start line of each diagram type the engine draws, outside a diagram', () => {
    const found = suggest('@', '', null, DATA);

    expect(found?.items.map((item) => item.label).slice(0, 3)).toEqual([
      '@startuml',
      '@startgantt',
      '@startproject',
    ]);
    // A type the bundled engine cannot draw is not offered.
    expect(found?.items.map((item) => item.label)).not.toContain('@startditaa');
    expect(found).toMatchObject({ kind: 'keyword', start: 0, end: 1 });
  });

  it('offers the end line of the open diagram inside one, replacing what was typed', () => {
    expect(suggest('  @en', 'd', 'mindmap', DATA)).toEqual({
      items: [{ label: '@endmindmap', insert: '@endmindmap' }],
      kind: 'keyword',
      start: 2,
      end: 6,
    });
  });

  it('offers directives after a ! at the start of a line, not those the engine ignores', () => {
    const found = suggest('!inc', 'lude <azure/AzureCommon>', 'uml', DATA);
    const offered = found?.items.map((item) => item.label);

    expect(offered).toContain('!include');
    expect(offered).toContain('!includesub');
    expect(offered).toContain('!theme');
    for (const ignored of ['!includeurl', '!includedef', '!import']) {
      expect(offered).not.toContain(ignored);
    }
    // The directive is replaced, the path after it kept.
    expect(found).toMatchObject({ kind: 'keyword', start: 0, end: 8 });
  });

  it('offers the bundled themes after !theme', () => {
    expect(suggest('!theme cer', 'ulean', 'uml', DATA)).toEqual({
      items: DATA.themes.map((name) => ({ label: name, insert: name })),
      kind: 'name',
      start: 7,
      end: 15,
    });
  });

  it('offers icon names after <&, in labels and strings too, closing them only when needed', () => {
    expect(suggest('A -> B : <&he', '', 'uml', DATA)).toMatchObject({
      items: [
        { label: 'heart', insert: 'heart>' },
        { label: 'person', insert: 'person>' },
      ],
      start: 11,
      end: 13,
    });
    expect(suggest('rectangle "<&he', 'art> box"', 'uml', DATA)).toMatchObject({
      items: [
        { label: 'heart', insert: 'heart' },
        { label: 'person', insert: 'person' },
      ],
      start: 13,
      end: 18,
    });
  });

  it('offers nothing in the middle of a line or in ordinary text', () => {
    expect(labels('A -> B : @')).toBeUndefined();
    expect(labels('title Hello !inc')).toBeUndefined();
    expect(labels('Alice -> Bob')).toBeUndefined();
  });
});

describe('suggestTemplates', () => {
  const NAMES = { sequence: 'Sequence diagram' };

  it('offers each template as a whole block in the text of a Markdown document', () => {
    const found = suggestTemplates('puml-se', '', true, NAMES);

    expect(found?.items.map((item) => item.label)).toEqual(TEMPLATES.map((t) => `puml-${t.kind}`));
    expect(found?.items[0]).toMatchObject({ label: 'puml-sequence', detail: 'Sequence diagram' });
    expect(found?.items[0]?.insert.split('\n')).toEqual([
      '```plantuml ${1:sequence-diagram}',
      ...(TEMPLATES[0]?.diagram.split('\n') ?? []),
      '```',
    ]);
    expect(found).toMatchObject({ kind: 'template', start: 0, end: 7 });
  });

  it('keeps every line of a template in the quote it is typed in', () => {
    const found = suggestTemplates('> pu', '', true, NAMES);
    const lines = found?.items[0]?.insert.split('\n') ?? [];

    expect(lines[0]).toBe('```plantuml ${1:sequence-diagram}');
    expect(lines.slice(1).every((line) => line.startsWith('> '))).toBe(true);
    expect(found).toMatchObject({ start: 2, end: 4 });
  });

  it('offers the bare diagram where one can start without a block', () => {
    expect(suggestTemplates('p', '', false, NAMES)?.items[0]?.insert).toBe(TEMPLATES[0]?.diagram);
  });

  it('offers nothing with text after the cursor, or for another word', () => {
    expect(suggestTemplates('pu', 'ml', false, NAMES)).toBeNull();
    expect(suggestTemplates('participant', '', false, NAMES)).toBeNull();
    expect(suggestTemplates('A -> B pu', '', false, NAMES)).toBeNull();
  });
});

describe('mightSuggest', () => {
  it('passes the lines a suggestion could follow, and stops the rest before the document is read', () => {
    for (const before of ['@', '  @sta', '> @en', '!', '!inc', '!theme cer', 'A -> B : <&', 'x "<&he', 'p', '> puml-se']) {
      expect(mightSuggest(before), before).toBe(true);
    }
    for (const before of ['', 'Alice -> Bob', 'prose with a @', 'title !important', '<&heart> done']) {
      expect(mightSuggest(before), before).toBe(false);
    }
  });
});

describe('lineContext', () => {
  it('knows the diagram a line lies in', () => {
    const source = ['@startmindmap', '* root', '@endmindmap', '', '@startuml', 'A -> B'].join('\n');

    expect(lineContext(source, 1)).toEqual({ open: 'mindmap' });
    expect(lineContext(source, 3)).toEqual({ open: null });
    expect(lineContext(source, 5)).toEqual({ open: 'uml' });
  });

  it('takes a line in a comment for no diagram line at all', () => {
    const source = ['@startuml', "' @end", "/'", '!inc', "'/", 'A -> B'].join('\n');

    expect(lineContext(source, 1)).toBeNull();
    expect(lineContext(source, 3)).toBeNull();
    expect(lineContext(source, 5)).toEqual({ open: 'uml' });
  });
});

describe('readCompletionData', () => {
  it('reads the names out of the theme and icon scripts', () => {
    const themes = [
      'var g = globalThis;',
      'g.PLANTUML_THEMES["_none_"] = "---\\nname: _none_\\n---\\n";',
      'g.PLANTUML_THEMES["cerulean-outline"] = "---\\nname: x\\n---\\n";',
    ].join('\n');
    const icons = [
      'window.PLANTUML_OPENICONIC["account-login"]="<path d=\\"M3 0\\" />";',
      'window.PLANTUML_OPENICONIC["heart"]="<path />";',
    ].join('\n');

    expect(readCompletionData(themes, icons)).toEqual({
      themes: ['_none_', 'cerulean-outline'],
      icons: ['account-login', 'heart'],
    });
  });
});

describe('DIRECTIVES', () => {
  it('are all directives to the grammar', async () => {
    // One line each, with the arguments the directive takes.
    const lines: Record<string, string> = {
      include: '!include <azure/AzureCommon>',
      include_once: '!include_once <azure/AzureCommon>',
      include_many: '!include_many <azure/AzureCommon>',
      includesub: '!includesub common.puml!PART',
      startsub: '!startsub PART',
      endsub: '!endsub',
      theme: '!theme cerulean',
      define: '!define NAME value',
      definelong: '!definelong NAME(x)',
      enddefinelong: '!enddefinelong',
      undef: '!undef NAME',
      if: '!if 1',
      ifdef: '!ifdef NAME',
      ifndef: '!ifndef NAME',
      elseif: '!elseif 1',
      else: '!else',
      endif: '!endif',
      while: '!while 1',
      endwhile: '!endwhile',
      foreach: '!foreach $x in [1]',
      endfor: '!endfor',
      function: '!function $f()',
      endfunction: '!endfunction',
      procedure: '!procedure $p()',
      endprocedure: '!endprocedure',
      return: '!return 1',
      unquoted: '!unquoted procedure P()',
      final: '!final function $f()',
      local: '!local $x = 1',
      global: '!global $x = 1',
      assert: '!assert 1',
      log: '!log text',
      dump_memory: '!dump_memory',
      option: '!option key value',
    };
    expect(Object.keys(lines)).toEqual(DIRECTIVES);

    const source = ['@startuml', ...DIRECTIVES.map((name) => lines[name] ?? ''), '@enduml'].join('\n');
    const failures = await checkScopes(
      source,
      DIRECTIVES.map((name) => [`!${name}`, 'keyword.control.directive'] as const)
    );
    expect(failures).toEqual([]);
  });
});

describe('suggestNames', () => {
  const D01 = ['@startuml', 'participant "注文係" as A', 'participant Server as B', 'A -> B : hello', '', '@enduml'];
  const at = (
    lines: readonly string[],
    line: number,
    column = (lines[line] ?? '').length,
    options: { bare?: boolean; words?: 'always' | 'beside' | 'never' } = {}
  ): ReturnType<typeof suggestNames> =>
    suggestNames(lines.join('\n'), line, column, { bare: options.bare ?? true, words: options.words ?? 'always' });
  const labels = (found: ReturnType<typeof suggestNames>): string[] => found?.snippets.map((snippet) => snippet.label) ?? [];

  it("offers the diagram's unique aliases, its words, and the snippets of a diagram type its markers settle", () => {
    const found = at(D01, 4);

    expect(found?.aliases).toEqual([{ name: 'A', display: '注文係' }]);
    // The alias once, as an alias; neither the quoted name nor the start and end lines.
    expect(found?.words).toEqual(['participant', 'as', 'Server', 'B', 'hello']);
    expect(labels(found)).toEqual(['alt', 'opt', 'loop', 'par', 'ref', 'note']);
    expect(found).toMatchObject({ start: 0, end: 0, lead: '' });
  });

  it('leaves the words out when they are turned off, the aliases and snippets in', () => {
    const found = at(D01, 4, 0, { words: 'never' });

    expect(found?.words).toEqual([]);
    expect(found?.aliases).toHaveLength(1);
    expect(labels(found)).toHaveLength(6);
    expect(at(['@startuml', 'A -> B', '', '@enduml'], 2, 0, { words: 'never' })).toBeNull();
  });

  it('offers the words beside aliases or snippets only, when asked to', () => {
    expect(at(D01, 4, 0, { words: 'beside' })?.words).toEqual(['participant', 'as', 'Server', 'B', 'hello']);
    // Snippets without aliases.
    expect(at(['@startuml', 'start', ':pay;', '', '@enduml'], 3, 0, { words: 'beside' })?.words).toEqual([
      'start',
      'pay',
    ]);
    // Words alone: nothing.
    expect(at(['@startuml', 'A -> B', '', '@enduml'], 2, 0, { words: 'beside' })).toBeNull();
    expect(at(['@startuml', 'A -> B', '', '@enduml'], 2, 0)?.words).toEqual(['A', 'B']);
  });

  it('takes nothing from another diagram of the same source, whether or not the first one ends', () => {
    const two = ['@startuml(id=alpha)', 'participant "Alpha" as a1', 'a1 -> a2', '@enduml', '@startuml(id=beta)', 'participant "Beta" as b1', 'b1 -> ', '@enduml'];
    expect(at(two, 6)).toMatchObject({ aliases: [{ name: 'b1', display: 'Beta' }], words: ['participant', 'as'] });

    const unended = ['@startuml(id=alpha)', 'participant "Alpha" as a1', '@startuml(id=beta)', 'b1 -> '];
    expect(at(unended, 3)).toMatchObject({ aliases: [], words: ['b1'] });
  });

  it('leaves out the word being typed, and replaces all of it', () => {
    const found = at(['@startuml', 'A -> Server', 'Ser', '@enduml'], 2, 2);

    expect(found?.words).toEqual(['A', 'Server']);
    expect(found).toMatchObject({ start: 0, end: 3 });
  });

  it('offers nothing in protected text, on a directive, on the start or end line, or outside a diagram', () => {
    const lines = ['@startuml', 'participant "注文係" as A', 'note left', 'text', 'end note', "' x", '!include fo', 'A -> B : "x', '@enduml', 'after'];

    expect(at(lines, 1, 15)).toBeNull();
    expect(at(lines, 3)).toBeNull();
    expect(at(lines, 5)).toBeNull();
    expect(at(lines, 6)).toBeNull();
    expect(at(lines, 7)).toBeNull();
    expect(at(lines, 0)).toBeNull();
    expect(at(lines, 8)).toBeNull();
    expect(at(lines, 9)).toBeNull();
    // Lines above the start line, which the engine leaves out.
    expect(at(['x', '@startuml', 'A', '@enduml'], 0)).toBeNull();
  });

  it('takes a source without a start line for one diagram only where it is drawn as one', () => {
    expect(at(['A -> B', ''], 1)?.words).toEqual(['A', 'B']);
    expect(at(['A -> B', ''], 1, 0, { bare: false })).toBeNull();
  });

  it('offers nothing in a JSON or YAML diagram, and nothing when there is nothing to offer', () => {
    expect(at(['@startjson', '{', '  "a": 1', '}', '@endjson'], 2)).toBeNull();
    expect(at(['@startuml', '', '@enduml'], 1)).toBeNull();
  });

  it('offers the snippets only on a line of their own, with the indentation their lines go on with', () => {
    expect(labels(at(['@startuml', 'participant A', 'A -> B : al', '@enduml'], 2))).toEqual([]);
    expect(at(['@startuml', 'participant A', '  al', '@enduml'], 2)).toMatchObject({ start: 2, end: 4, lead: '  ' });
    expect(labels(at(['@startuml', 'participant A', '  al', '@enduml'], 2))).toHaveLength(6);
  });

  it('offers no snippets where the markers settle no type, or in a type that has none', () => {
    expect(labels(at(['@startuml', 'A -> B', '', '@enduml'], 2))).toEqual([]);
    expect(labels(at(['@startmindmap', '* root', '', '@endmindmap'], 2))).toEqual([]);
    expect(at(['@startmindmap', '* root', '** child', '@endmindmap'], 2)?.words).toEqual(['root']);
  });

  it('offers the activity snippets in an activity diagram, in a partition but not in a skinparam block', () => {
    expect(labels(at(['@startuml', 'start', ':a;', '', 'stop', '@enduml'], 3))).toEqual(['if', 'while', 'repeat', 'fork']);
    expect(labels(at(['@startuml', 'start', 'partition P {', '  ', '}', 'stop', '@enduml'], 3))).toHaveLength(4);
    expect(labels(at(['@startuml', 'start', 'skinparam activity {', '  ', '}', 'stop', '@enduml'], 3))).toEqual([]);
  });
});

describe('SNIPPETS', () => {
  const all = Object.values(SNIPPETS).flat();

  it('are the sequence and activity snippets, each label once', () => {
    expect(Object.keys(SNIPPETS)).toEqual(['sequence', 'activity']);
    expect(new Set(all.map((snippet) => snippet.label)).size).toBe(all.length);
  });

  it('use only placeholders whose text needs no escaping, numbered from 1 without gaps', () => {
    for (const { label, body } of all) {
      const stops = [...body.matchAll(/\$\{?(\d+)/g)].map((match) => Number(match[1]));
      expect(Math.min(...stops), label).toBe(1);
      expect(new Set(stops).size, label).toBe(Math.max(...stops));
      for (const [, text = ''] of body.matchAll(/\$\{\d+[:|]([^}]*)\}/g)) {
        expect(text, label).not.toMatch(/[$\{]/);
      }
      expect(expandSnippet(body), label).not.toMatch(/[$\{}]/);
    }
  });
});
