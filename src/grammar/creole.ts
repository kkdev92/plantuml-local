/**
 * Creole: the markup allowed in labels, notes, titles and legends.
 *
 * Inline markup follows the engine's creole commands (CommandCreoleBuilder
 * in the browser build: no <math>, <latex> or SVG attributes). Line markup
 * (headings, lists, tables, trees, separators, code blocks) only applies to
 * texts that span several lines.
 */

import { BOL, SP, endOr, include, named, re, scope, type Rule } from './rules';

const tagBegin = named('punctuation.definition.tag.begin');
const tagEnd = named('punctuation.definition.tag.end');
const tagName = named('entity.name.tag.creole');

/**
 * The argument part of a tag (`:red`, `{scale=2}`). A capture that is
 * tokenized again does not inherit the scope of capture 0, so it names the
 * tag scope itself.
 */
function tagArgument(tagScope: string): Rule {
  return { name: scope(tagScope), patterns: [include('creole-tag-argument')] };
}

/** `**bold**`-style markup: only starts when the closing marker follows on the line. */
function marker(mark: string, content: string): Rule {
  const m = mark.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return {
    begin: re`${m}(?=.+?${m})`,
    end: m,
    beginCaptures: { 0: named('punctuation.definition.markup') },
    endCaptures: { 0: named('punctuation.definition.markup') },
    contentName: scope(content),
    patterns: [include('creole-inline')],
  };
}

/**
 * `<b>text</b>`, or `<b>text` to the end of the line. `extra` matches an
 * optional argument after the tag name (`<u:red>`, `<size:12>`).
 */
function htmlStyle(names: string, extra: string, content?: string): Rule {
  return {
    begin: re`(?i)(<)(${names})(${extra})(>)`,
    end: re`(?i)(</)(${names})(>)|(?=$)`,
    beginCaptures: { 0: tagName, 1: tagBegin, 3: tagArgument('entity.name.tag.creole'), 4: tagEnd },
    endCaptures: { 0: tagName, 1: tagBegin, 3: tagEnd },
    ...(content === undefined ? {} : { contentName: scope(content) }),
    patterns: [include('creole-inline')],
  };
}

/** `{scale=…}`, `*1.5`, `,color=red` after an icon, emoji or sprite. */
const SCALE_OR_COLOR = re`(?:[{,]?(?:(?:scale=|\*)[0-9.]+)?(?:,?color[= :](?:#[0-9a-fA-F]{1,8}|\w+))?\}?)?`;

export const creoleRepository: Record<string, Rule> = {
  'creole-inline': {
    patterns: [
      // Links: [[url]], [[url label]], [[url{tooltip} label]], [["quoted url" label]]
      {
        name: scope('meta.link'),
        match: re`(\[\[)${SP}*(?:(["\x{201C}\x{201D}][^"\x{201C}\x{201D}]*["\x{201C}\x{201D}])|([^\s{}\[\]]+))?(\{[^}]*\})?(.*?)(\]\])`,
        captures: {
          1: named('punctuation.definition.link.begin'),
          2: named('string.quoted.double'),
          3: named('markup.underline.link'),
          4: named('string.unquoted.tooltip'),
          5: { patterns: [include('creole-inline')] },
          6: named('punctuation.definition.link.end'),
        },
      },
      // Escapes: \n \l \r \t \\ and the creole tilde.
      { name: scope('constant.character.escape'), match: re`\\[nlrt\\]` },
      marker('**', 'markup.bold'),
      marker('//', 'markup.italic'),
      marker('""', 'markup.inline.raw'),
      marker('__', 'markup.underline'),
      marker('--', 'markup.strikethrough'),
      marker('~~', 'markup.underline.wave'),
      { name: scope('constant.character.escape'), match: re`~.` },
      htmlStyle('b', '', 'markup.bold'),
      htmlStyle('i', '', 'markup.italic'),
      htmlStyle('u', re`(?::(?:#[0-9a-fA-F]{6}|\w+))?`, 'markup.underline'),
      htmlStyle('w', re`(?::(?:#[0-9a-fA-F]{6}|\w+))?`, 'markup.underline.wave'),
      htmlStyle('strike|s|del', re`(?::(?:#[0-9a-fA-F]{6}|\w+))?`, 'markup.strikethrough'),
      htmlStyle('plain', ''),
      htmlStyle('back', re`(?::#?\w+(?:[-\\|/]#?\w+)?)?`),
      htmlStyle('size', re`[\s:]+\d+${SP}*`),
      htmlStyle('color', re`[\s:]+(?:#[0-9a-fA-F]{1,6}|#?\w+)${SP}*`),
      htmlStyle(
        'font',
        re`(?:(?:${SP}+size${SP}*=${SP}*["\x{201C}\x{201D}]?\d+["\x{201C}\x{201D}]?|${SP}+color${SP}*=${SP}*["\x{201C}\x{201D}]?(?:#[0-9a-fA-F]{1,6}|\w+)["\x{201C}\x{201D}]?)+${SP}*|[\s:]+[^>/]+/?)`
      ),
      htmlStyle('sup', ''),
      htmlStyle('sub', ''),
      // <img:path{scale=…}>, <qrcode:data{scale=…}>
      {
        match: re`(?i)(<)(img|qrcode)([\s:]+)([^>{}]+)(\{scale=[0-9.]+\})?(>)`,
        captures: {
          0: tagName,
          1: tagBegin,
          4: named('string.unquoted.path'),
          5: named('constant.numeric.scale'),
          6: tagEnd,
        },
      },
      // <&icon>, <:emoji:>, <$sprite>, each with an optional colour and scale.
      {
        match: re`(<)(#\w+)?(&)([-\w]+)(${SCALE_OR_COLOR})(>)`,
        captures: {
          0: named('constant.other.symbol.openiconic'),
          1: tagBegin,
          2: named('constant.other.color'),
          3: named('constant.other.symbol.openiconic punctuation.definition.symbol'),
          4: named('constant.other.symbol.openiconic'),
          5: tagArgument('constant.other.symbol.openiconic'),
          6: tagEnd,
        },
      },
      {
        match: re`(<)(#\w+)?(:)([0-9a-z][0-9_a-z]*)(:)(${SCALE_OR_COLOR})(>)`,
        captures: {
          0: named('constant.other.symbol.emoji'),
          1: tagBegin,
          2: named('constant.other.color'),
          3: named('constant.other.symbol.emoji punctuation.definition.symbol'),
          4: named('constant.other.symbol.emoji'),
          5: named('constant.other.symbol.emoji punctuation.definition.symbol'),
          6: tagArgument('constant.other.symbol.emoji'),
          7: tagEnd,
        },
      },
      {
        match: re`(<)(#\w+)?(\$)([-\p{L}0-9_/]+)(${SCALE_OR_COLOR})(>)`,
        captures: {
          0: named('constant.other.symbol.sprite'),
          1: tagBegin,
          2: named('constant.other.color'),
          3: named('constant.other.symbol.sprite punctuation.definition.symbol'),
          4: named('constant.other.symbol.sprite'),
          5: tagArgument('constant.other.symbol.sprite'),
          6: tagEnd,
        },
      },
      // <space:12>
      {
        match: re`(?i)(<)(space)(:)(\d+)(/?)(>)`,
        captures: { 0: tagName, 1: tagBegin, 4: named('constant.numeric'), 5: tagEnd, 6: tagEnd },
      },
    ],
  },

  'creole-tag-argument': {
    patterns: [
      { name: scope('constant.other.color'), match: re`#[0-9a-fA-F]{1,8}\b|#\w+` },
      { name: scope('constant.numeric'), match: re`\d+(?:\.\d+)?` },
      { name: scope('entity.other.attribute-name'), match: re`(?i)\b(?:size|color|scale)\b` },
      { name: scope('support.constant.color'), match: re`\w+` },
    ],
  },

  /** @startcreole: every line is creole text; there are no commands. */
  'diagram-creole': {
    patterns: [include('preprocessor'), include('creole-line'), include('label')],
  },

  /**
   * An embedded diagram: `{{`, or `{{` and a diagram type, alone on a line,
   * up to the matching `}}` line. The engine reads everything in between as
   * one block, counting nested ones (EmbeddedDiagram upstream), so no line
   * inside ends the note, legend or class body around it. The browser build
   * it ships draws nothing for such a block, so its content stays plain.
   */
  'embedded-diagram': {
    name: scope('meta.embedded-diagram'),
    begin: re`${BOL}\s*(\{\{)(board|creole|chronology|chen|chart|ditaa|ebnf|files|gantt|json|mindmap|nwdiag|packetdiag|regex|salt|uml|wbs|wire|yaml)?\s*$`,
    end: endOr(re`${BOL}\s*(\}\})\s*$`),
    beginCaptures: { 1: named('punctuation.section.embedded.begin'), 2: named('keyword.control.diagram') },
    endCaptures: { 1: named('punctuation.section.embedded.end') },
    patterns: [include('embedded-diagram')],
  },

  /** Line markup inside multi-line texts. */
  'creole-line': {
    patterns: [
      include('embedded-diagram'),
      {
        begin: re`(?i)${BOL}\s*(<code>)${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(</code>)${SP}*$`),
        beginCaptures: { 1: named('entity.name.tag.creole') },
        endCaptures: { 1: named('entity.name.tag.creole') },
        contentName: scope('markup.raw.block'),
      },
      // Separators: ----, ====, ____, .... and the titled forms ==x==, --x--, ..x..
      {
        name: scope('meta.separator'),
        match: re`${BOL}\s*(?:(==|--|\.\.|__)([^=\-._]*)(\1)|(-{4,}|={4,}|_{4,}|\.{4,}))${SP}*$`,
        captures: {
          1: named('punctuation.separator'),
          2: named('markup.heading'),
          3: named('punctuation.separator'),
          4: named('punctuation.separator'),
        },
      },
      {
        match: re`${BOL}\s*(=+)(.+)$`,
        captures: { 1: named('punctuation.definition.heading'), 2: named('markup.heading') },
      },
      {
        match: re`${BOL}\s*(\*+|#+)(?=.)`,
        captures: { 1: named('punctuation.definition.list.begin') },
      },
      // Tables: |= header | cell | with an optional <#color> in front.
      {
        match: re`${BOL}\s*(<#\w+(?:,#?\w+)?>)?(\|.*\|)${SP}*$`,
        captures: {
          1: named('constant.other.color'),
          2: {
            patterns: [{ name: scope('punctuation.separator.table'), match: re`\|=?` }, include('creole-inline')],
          },
        },
      },
      // Trees: |_ item
      { name: scope('punctuation.definition.list.begin'), match: re`${BOL}\s*(?:\|${SP}*)*\|_` },
    ],
  },
};
