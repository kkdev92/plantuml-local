import { Window } from 'happy-dom';
import MarkdownIt from 'markdown-it';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { remoteReferenceIn } from '../../src/core/constants';
import { englishMessages, type MessageLocalizer } from '../../src/core/messages';
import { SUPPORTED_DIAGRAMS } from '../../src/grammar/plantuml';
import { DIRECTIVES, type CompletionData } from '../../src/language/completion';
import {
  builtinAt,
  codeBlock,
  definitionSections,
  escapeMarkdown,
  HELP_ENGINE,
  helpFor,
  helpMarkdown,
  HOVER_COMMENT,
  HOVER_DEFINITIONS,
  type BuiltinTarget,
} from '../../src/language/hover';
import type { MacroDefinition } from '../../src/language/macro-help';

const DATA: CompletionData = { themes: ['cerulean', 'plain'], icons: ['heart', 'person', 'cloud-upload'] };
const anyName = (): boolean => true;
/** What the cursor at `column` of `text` is on that has help, any name read as written. */
const at = (text: string, column: number): BuiltinTarget | null => builtinAt(text, column, DATA, anyName);

/**
 * Markdown read back as HTML, the way most permissive: HTML let through and
 * bare links turned into links, so that anything the text could become
 * shows.
 */
const md = new MarkdownIt({ html: true, linkify: true });
const { document } = new Window();
/** The text of HTML as an HTML parser reads it: its tags dropped and its entities read. */
const textOf = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent;
};

describe('escapeMarkdown', () => {
  const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

  it('puts a backslash before each ASCII punctuation character, and leaves the rest', () => {
    expect(PUNCTUATION).toHaveLength(32);
    expect(escapeMarkdown(PUNCTUATION)).toBe([...PUNCTUATION].map((char) => `\\${char}`).join(''));
    expect(escapeMarkdown('Abc 123 日本語')).toBe('Abc 123 日本語');
  });

  it.each([
    PUNCTUATION,
    '<b>bold</b> <img src="https://example.com/x.png"> <script>alert(1)</script>',
    '[open](command:workbench.action.quit) ![image](https://example.com/x.png)',
    'https://example.com www.example.com someone@example.com',
    '*em* _em_ **strong** `code` ~~gone~~ # heading',
    '&amp; &#60; &lt;',
  ])('reads back as written, with no link, image or HTML: %s', (text) => {
    const html = md.renderInline(escapeMarkdown(text));
    expect(html).not.toMatch(/<(?:a|img|b|script|em|strong|code|s|del)\b/);
    expect(textOf(html)).toBe(text);
  });
});

describe('codeBlock', () => {
  it('fences the text with three backticks, or one more than its longest run of them', () => {
    expect(codeBlock('A -> B', 'plantuml')).toBe('```plantuml\nA -> B\n```');
    expect(codeBlock('a ``` b', '')).toBe('````\na ``` b\n````');
    expect(codeBlock('`````', 'text')).toBe('``````text\n`````\n``````');
  });

  it.each([
    '```',
    '   ```',
    '````',
    '~~~',
    '```js\nalert(1)\n```',
    'a\n```\n<img src="https://example.com/x.png">\n```\nb',
    '` `` ``` ````` `',
    '<b>bold</b> [link](command:workbench.action.quit)',
  ])('keeps every line of %j in the block, as written', (text) => {
    const html = md.render(codeBlock(text, 'text'));
    expect(html.match(/<pre>/g)).toHaveLength(1);
    const code = /^<pre><code class="language-text">([\s\S]*)<\/code><\/pre>\n$/.exec(html)?.[1];
    expect(textOf(code ?? '')).toBe(`${text}\n`);
  });
});

describe('builtinAt', () => {
  it('finds a directive from its `!` to the end of its name, the cursor at either end', () => {
    const include: BuiltinTarget = { kind: 'directive', name: 'include', start: 0, end: 8 };
    expect(at('!include file.puml', 0)).toEqual(include);
    expect(at('!include file.puml', 8)).toEqual(include);
    expect(at('!include file.puml', 9)).toBeNull();
    expect(at('  !if $x == 1', 3)).toEqual({ kind: 'directive', name: 'if', start: 2, end: 5 });
    expect(at('!ifdef X', 2)?.name).toBe('ifdef');
    expect(at('!elseif $x', 2)?.name).toBe('elseif');
    expect(at('!include_many a.puml', 9)?.name).toBe('include_many');
    expect(at('!definelong M()', 4)?.name).toBe('definelong');
  });

  it('finds each word of a declaration, and what a function on one line returns', () => {
    const line = '!final unquoted function $f($a) !return $a';
    expect(at(line, 0)).toEqual({ kind: 'directive', name: 'final', start: 0, end: 6 });
    expect(at(line, 7)).toEqual({ kind: 'directive', name: 'unquoted', start: 7, end: 15 });
    expect(at(line, 20)).toEqual({ kind: 'directive', name: 'function', start: 16, end: 24 });
    expect(at(line, 35)).toEqual({ kind: 'directive', name: 'return', start: 32, end: 39 });
    expect(at(line, 27)).toBeNull();
    expect(at(line, 41)).toBeNull();
    expect(at('!function $f($a) return $a', 20)).toEqual({ kind: 'directive', name: 'return', start: 17, end: 23 });
    expect(at('!unquoted\tprocedure $p()', 12)).toEqual({ kind: 'directive', name: 'procedure', start: 10, end: 19 });
    // A procedure returns nothing on its line.
    expect(at('!procedure $p() return', 18)).toBeNull();
  });

  it('finds the kind of a diagram after its start, as the engine tells it, from the start mark', () => {
    expect(at('@startuml', 3)).toEqual({ kind: 'diagram', name: 'uml', start: 0, end: 9 });
    expect(at('  @startgantt', 13)).toEqual({ kind: 'diagram', name: 'gantt', start: 2, end: 13 });
    expect(at('@startUML', 8)?.name).toBe('uml');
    expect(at('@startproject', 1)?.name).toBe('project');
    expect(at('\\startjson', 0)?.name).toBe('json');
    expect(at('@startuml name', 11)).toBeNull();
  });

  it('finds a bundled theme read from no folder, and an icon, with its scale or colour', () => {
    expect(at('!theme cerulean', 10)).toEqual({ kind: 'theme', name: 'cerulean', start: 7, end: 15 });
    expect(at('!theme cerulean', 3)?.kind).toBe('directive');
    const line = 'Alice -> Bob : <&heart> and <#red&person{scale=2,color=#00ff00}>';
    expect(at(line, 16)).toEqual({ kind: 'icon', name: 'heart', start: 15, end: 23 });
    expect(at(line, 40)).toEqual({ kind: 'icon', name: 'person', start: 28, end: 64 });
    expect(at(line, 25)).toBeNull();
    for (const icon of ['<&heart*2>', '<&heart,color=red>', '<&cloud-upload{scale=1.5}>']) {
      expect(at(`A -> B : ${icon}`, 10)?.kind, icon).toBe('icon');
    }
  });

  it.each([
    ['!Include file.puml', 2],
    ['!INCLUDE file.puml', 2],
    ['!endforeach', 2],
    ['!includeurl https://example.com/x.puml', 2],
    ['!includedef x.puml', 2],
    ['!import x.zip', 2],
    ['!pragma layout smetana', 2],
    ['!end function', 2],
    ['!$x = 1', 2],
    ['@enduml', 3],
    ['@StartUml', 3],
    ['@startditaa', 3],
    ['participant Alice', 3],
    ['skinparam monochrome true', 3],
    ['skinparam', 3],
    ["' !include file.puml", 3],
    ['!theme Cerulean', 9],
    ['!theme nosuchtheme', 9],
    ['!theme cerulean from themes', 9],
    ['A -> B : <&Heart>', 11],
    ['A -> B : <&nosuchicon>', 11],
    ['A -> B : <&heart', 11],
  ])('gives nothing on %j', (text, column) => {
    expect(at(text, column)).toBeNull();
  });

  it('gives nothing on a theme or an icon whose name holds a word the text defines', () => {
    const defined = (name: string): boolean => name !== 'heart' && name !== 'plain';
    expect(builtinAt('A -> B : <&heart>', 11, DATA, defined)).toBeNull();
    expect(builtinAt('A -> B : <&person>', 11, DATA, defined)?.name).toBe('person');
    expect(builtinAt('!theme plain', 9, DATA, defined)).toBeNull();
    expect(builtinAt('!theme cerulean', 9, DATA, defined)?.name).toBe('cerulean');
  });
});

describe('helpFor', () => {
  const marked: MessageLocalizer = { t: (message) => `«${message}»` };

  it.each(DIRECTIVES)('has help for !%s, how it is written and its words localised', (name) => {
    const help = helpFor({ kind: 'directive', name, start: 0, end: 0 }, marked);
    expect(help?.title).toBe(`!${name}`);
    expect(help?.text).toMatch(/^«.+»$/);
    expect(help?.syntax).toContain(`!${name}`);
    expect(help?.example === undefined).toBe(name.startsWith('include'));
  });

  it.each(SUPPORTED_DIAGRAMS.flatMap(({ names }) => names))('has help for @start%s, a whole diagram for its syntax', (name) => {
    const help = helpFor({ kind: 'diagram', name, start: 0, end: 0 }, marked);
    expect(help?.title).toBe(`@start${name}`);
    expect(help?.text).toMatch(/^«.+»$/);
    const lines = help?.syntax.split('\n') ?? [];
    expect(lines[0]).toBe(`@start${name}`);
    expect(lines.at(-1)).toBe(`@end${name}`);
    expect(lines.length).toBeGreaterThan(2);
  });

  it('describes a theme and an icon by their names, and nothing it has no help for', () => {
    expect(helpFor({ kind: 'theme', name: 'plain', start: 0, end: 0 }, englishMessages)).toMatchObject({
      title: 'plain',
      syntax: '!theme plain',
    });
    expect(helpFor({ kind: 'icon', name: 'heart', start: 0, end: 0 }, englishMessages)).toMatchObject({
      title: 'heart',
      syntax: '<&heart>\n<&heart{scale=2,color=red}>',
    });
    expect(helpFor({ kind: 'directive', name: 'pragma', start: 0, end: 0 }, englishMessages)).toBeNull();
    expect(helpFor({ kind: 'diagram', name: 'ditaa', start: 0, end: 0 }, englishMessages)).toBeNull();
  });

  it('is written for the bundled engine', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('@plantuml/core/package.json') as { version: string };
    expect(HELP_ENGINE, 'read the help again against the new engine, then update HELP_ENGINE').toBe(version);
  });
});

describe('helpMarkdown', () => {
  const help = (name: string): string =>
    helpMarkdown(helpFor({ kind: 'directive', name, start: 0, end: 0 }, englishMessages) ?? { title: '', text: '', syntax: '' }, englishMessages);

  it('shows the title, what it does, how it is written and an example, in that order', () => {
    const sections = help('while').split('\n\n');
    expect(sections[0]).toBe('**\\!while**');
    expect(sections[1]).toBe(escapeMarkdown('Repeats the lines up to !endwhile as long as the expression is true.'));
    expect(sections[2]).toBe('```plantuml\n!while expression\n…\n!endwhile\n```');
    expect(sections[3]).toBe('Example');
    expect(sections[4]).toMatch(/^```plantuml\n!\$step = 1\n/);
    const html = md.render(help('while'));
    expect(html.match(/<pre>/g)).toHaveLength(2);
    expect(html).not.toMatch(/<(?:a|img)\b/);
  });

  it('shows no example where there is none', () => {
    expect(help('include')).not.toContain('Example');
    expect(help('include').match(/```plantuml/g)).toHaveLength(1);
  });
});

describe('definitionSections', () => {
  const hostile = [
    "<img src='https://example.com/x.png'> <b>bold</b> <script>alert(1)</script>",
    '[run](command:workbench.action.quit) ![image](https://example.com/y.png)',
    '```',
    'https://example.com www.example.com',
  ].join('\n');

  it('shows the summary, then each definition as declared, where, and the comment above it, as written', () => {
    const sections = definitionSections(
      'this diagram · procedure',
      [{ declaration: '!procedure $p($a)', where: 'docs/a.puml, line 3', comment: hostile }],
      englishMessages
    );
    expect(sections).toEqual([
      escapeMarkdown('this diagram · procedure'),
      [codeBlock('!procedure $p($a)', 'plantuml'), escapeMarkdown('docs/a.puml, line 3'), codeBlock(hostile, 'text')].join(
        '\n\n'
      ),
    ]);
    const html = md.render(sections.join('\n\n'));
    expect(html).not.toMatch(/<(?:a|img|b|script)\b/);
    expect(html).toContain(md.utils.escapeHtml(hostile));
  });

  it('leaves out the comment of a definition that has none', () => {
    const [, section] = definitionSections('s', [{ declaration: '!$x = 1', where: 'w' }], englishMessages);
    expect(section).toBe('```plantuml\n!$x = 1\n```\n\nw');
  });

  it(`shows ${String(HOVER_DEFINITIONS)} definitions, and says how many more there are`, () => {
    const definitions: MacroDefinition[] = Array.from({ length: HOVER_DEFINITIONS + 2 }, (_, index) => ({
      declaration: `!procedure P${String(index)}()`,
      where: `line ${String(index)}`,
    }));
    const sections = definitionSections('s', definitions, englishMessages);
    expect(sections).toHaveLength(HOVER_DEFINITIONS + 2);
    expect(sections.at(-2)).toContain(`P${String(HOVER_DEFINITIONS - 1)}()`);
    expect(sections.at(-1)).toBe(escapeMarkdown('2 more definitions are not shown.'));
    expect(definitionSections('s', definitions.slice(0, HOVER_DEFINITIONS), englishMessages)).toHaveLength(
      HOVER_DEFINITIONS + 1
    );
  });

  it('cuts a long comment by lines, then by characters, never between the halves of a character', () => {
    const commentOf = (comment: string): string =>
      definitionSections('s', [{ declaration: 'd', where: 'w', comment }], englishMessages)[1]?.split('\n\n')[2] ?? '';
    const lines = Array.from({ length: HOVER_COMMENT.lines + 5 }, (_, index) => `line ${String(index)}`);
    expect(commentOf(lines.join('\n'))).toBe(codeBlock(`${lines.slice(0, HOVER_COMMENT.lines).join('\n')}\n…`, 'text'));
    expect(commentOf(lines.slice(0, HOVER_COMMENT.lines).join('\n'))).toBe(
      codeBlock(lines.slice(0, HOVER_COMMENT.lines).join('\n'), 'text')
    );
    const long = 'a'.repeat(HOVER_COMMENT.characters + 10);
    expect(commentOf(long)).toBe(codeBlock(`${'a'.repeat(HOVER_COMMENT.characters)}\n…`, 'text'));
    const face = String.fromCodePoint(0x1f600);
    const straddling = `${'a'.repeat(HOVER_COMMENT.characters - 1)}${face}b`;
    expect(commentOf(straddling)).toBe(codeBlock(`${'a'.repeat(HOVER_COMMENT.characters - 1)}\n…`, 'text'));
    const fitting = `${'a'.repeat(HOVER_COMMENT.characters - 2)}${face}b`;
    expect(commentOf(fitting)).toBe(codeBlock(`${'a'.repeat(HOVER_COMMENT.characters - 2)}${face}\n…`, 'text'));
  });
});

describe('remoteReferenceIn', () => {
  it.each([
    ['!include https://example.com/x.puml', 9],
    ['  !include http://example.com/x.puml  ', 11],
    ['!includeurl https://example.com/x.puml', 12],
    ['!include_once https://example.com/x.puml', 14],
    ['!includesub https://example.com/x.puml!PART', 12],
    ['!import https://example.com/x.zip', 8],
    ['!theme sunlust from https://example.com/themes', 20],
    ['!theme sunlust FROM https://example.com/themes', 20],
  ])('finds the URL %j reads, from its scheme to the end of the line', (line, start) => {
    expect(remoteReferenceIn(line)).toEqual({ start, end: line.trimEnd().length });
  });

  it.each(['title see https://example.com', '!$url = "https://example.com"', '!include <C4/C4_Context>', '!theme plain'])(
    'finds none in %j',
    (line) => {
      expect(remoteReferenceIn(line)).toBeNull();
    }
  );
});
