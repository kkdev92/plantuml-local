/**
 * Rules shared by several diagram types: the commands every factory
 * registers (title, legend, skinparam, styles, sprites, scale, hide …),
 * and the pieces commands are made of (colours, stereotypes, strings,
 * labels with creole markup).
 */

import { BOL, DQ, EOL, NOT_DQ, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';

const kw = named('keyword.other');
const control = named('keyword.control.directive');

/** `#name`, `#RRGGBB`, gradients (`#red/blue`, `#red-blue`, `#red|blue`, `#red\blue`). */
export const COLOR = re`#\w+(?:[-\\|/]\w+)?`;

/**
 * A colour, or the extended form `#back;line:red;line.dashed;text:blue`
 * (ColorParser upstream).
 */
export const COLORS = re`#(?:\w+(?:[-\\|/]\w+)?;)?(?:(?i:text|back|header|line|line\.dashed|line\.dotted|line\.bold|shadowing)(?::\w+(?:[-\\|/]\w+)?)?(?:;|(?![\w;:.])))+|${COLOR}`;

/** `<<stereotype>>`, possibly several in a row. */
export const STEREO = re`<<.+?>>(?:${SP}*<<.+?>>)*`;

/** Any single or double quote, straight or curly (`%q%g` upstream). */
const QUOTE = re`['"\x{2018}\x{2019}\x{201C}\x{201D}]`;

export const commonRepository: Record<string, Rule> = {
  color: {
    name: scope('constant.other.color'),
    match: re`(?i)${COLORS}`,
  },

  stereotype: {
    name: scope('entity.name.tag.stereotype'),
    match: re`(<<)(.+?)(>>)`,
    captures: {
      1: named('punctuation.definition.tag.begin'),
      2: {
        patterns: [
          {
            // A spot: << (C,#FF7700) Name >>
            match: re`\((\S)${SP}*,${SP}*(${COLOR})${SP}*\)`,
            captures: { 1: named('constant.character'), 2: named('constant.other.color') },
          },
          include('inline-preprocessor'),
        ],
      },
      3: named('punctuation.definition.tag.end'),
    },
  },

  string: {
    name: scope('string.quoted.double'),
    match: re`(${DQ})(${NOT_DQ}*)(${DQ})`,
    captures: {
      1: named('punctuation.definition.string.begin'),
      2: nested('#label'),
      3: named('punctuation.definition.string.end'),
    },
  },

  number: { name: scope('constant.numeric'), match: re`(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])` },

  /** Free text shown in the diagram: creole markup, escapes, substitutions. */
  label: {
    patterns: [include('comment-inline'), include('inline-preprocessor'), include('creole-inline')],
  },

  /** Lines of a multi-line text (notes, legends, multi-line titles). */
  'text-block': {
    patterns: [include('comment'), include('preprocessor'), include('creole-line'), include('label')],
  },

  // --- commands every diagram type accepts --------------------------------

  'common-commands': {
    patterns: [
      include('title-block'),
      include('title-line'),
      include('skinparam'),
      include('style'),
      include('sprite'),
      include('scale'),
      include('hide-show-common'),
      include('misc-common'),
    ],
  },

  /** title / caption / legend / header / footer spanning several lines. */
  'title-block': {
    patterns: [
      {
        begin: re`(?i)${BOL}\s*(title|caption)${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?(?:title|caption))${SP}*$`),
        beginCaptures: { 1: kw },
        endCaptures: { 1: kw },
        patterns: [include('text-block')],
      },
      {
        begin: re`(?i)${BOL}\s*(legend)(?:${SP}+(top|bottom))?(?:${SP}+(left|right|center))?${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?legend)${SP}*$`),
        beginCaptures: { 1: kw, 2: kw, 3: kw },
        endCaptures: { 1: kw },
        patterns: [include('text-block')],
      },
      {
        begin: re`(?i)${BOL}\s*(?:(left|right|center)${SP}*)?(header|footer)${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?(?:header|footer))${SP}*$`),
        beginCaptures: { 1: kw, 2: kw },
        endCaptures: { 1: kw },
        patterns: [include('text-block')],
      },
    ],
  },

  /** One-line title / caption / legend / header / footer / mainframe. */
  'title-line': {
    match: re`(?i)${BOL}\s*(?:(left|right|center)${SP}*)?(title|caption|legend|header|footer|mainframe)(?:${SP}*(:)${SP}*|${SP}+)(${DQ}.*${DQ}|.*?)${EOL}`,
    captures: {
      1: kw,
      2: kw,
      3: named('punctuation.separator.label'),
      4: nested('#string', '#label'),
    },
  },

  skinparam: {
    patterns: [
      {
        // skinparam [name] { … } — one name per line inside, possibly nested.
        begin: re`(?i)${BOL}\s*(skinparam)(?:${SP}+([\w.]*(?:<<.*>>)?[\w.]*))?${SP}*(\{)${SP}*$`,
        end: endOr(re`${BOL}\s*(\})${SP}*$`),
        beginCaptures: {
          1: kw,
          2: nested('#skinparam-name'),
          3: named('punctuation.section.block.begin'),
        },
        endCaptures: { 1: named('punctuation.section.block.end') },
        patterns: [include('comment'), include('preprocessor'), include('skinparam-block-line')],
      },
      {
        // skinparam name value — several can share a line, separated by \n.
        match: re`(?i)${BOL}\s*(skinparam(?:locked)?)${SP}+([\w.]*(?:<<[^<>]*>>)?[\w.]*)${SP}+([^{}]*?)${EOL}`,
        captures: { 1: kw, 2: nested('#skinparam-name'), 3: nested('#skinparam-value') },
      },
    ],
  },

  'skinparam-name': {
    patterns: [include('stereotype'), { name: scope('support.type.property-name'), match: re`[\w.]+` }],
  },

  'skinparam-value': {
    patterns: [
      {
        match: re`(?i)(\\n)${SP}*(skinparam(?:locked)?)${SP}+([\w.]*(?:<<[^<>]*>>)?[\w.]*)`,
        captures: {
          1: named('constant.character.escape'),
          2: kw,
          3: nested('#skinparam-name'),
        },
      },
      include('color'),
      include('number'),
      include('string'),
      include('inline-preprocessor'),
      { name: scope('constant.language'), match: re`(?i)\b(?:true|false|none)\b` },
    ],
  },

  'skinparam-block-line': {
    patterns: [
      {
        begin: re`${BOL}\s*([\w.]+(?:<<[^<>]*>>)?)${SP}*(\{)${SP}*$`,
        end: endOr(re`${BOL}\s*(\})${SP}*$`),
        beginCaptures: { 1: nested('#skinparam-name'), 2: named('punctuation.section.block.begin') },
        endCaptures: { 1: named('punctuation.section.block.end') },
        patterns: [include('comment'), include('preprocessor'), include('skinparam-block-line')],
      },
      {
        match: re`${BOL}\s*([\w.]+(?:<<[^<>]*>>)?)${SP}+(.*?)${EOL}`,
        captures: { 1: nested('#skinparam-name'), 2: nested('#skinparam-value') },
      },
      include('comment-inline'),
    ],
  },

  /** <style> blocks (CSS-like), one-line styles and style imports. */
  style: {
    patterns: [
      {
        match: re`(?i)${BOL}\s*((<)style(>))(.*)((</)style(>))${SP}*$`,
        captures: {
          1: named('entity.name.tag.style'),
          2: named('punctuation.definition.tag.begin'),
          3: named('punctuation.definition.tag.end'),
          4: nested('#style-body'),
          5: named('entity.name.tag.style'),
          6: named('punctuation.definition.tag.begin'),
          7: named('punctuation.definition.tag.end'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(<)(style)${SP}*(\w+)${SP}*(=)${SP}*(${QUOTE}?[^'"\x{2018}\x{2019}\x{201C}\x{201D}>]*${QUOTE}?)(>)${SP}*$`,
        captures: {
          1: named('punctuation.definition.tag.begin'),
          2: named('entity.name.tag.style'),
          3: named('entity.other.attribute-name'),
          4: named('punctuation.separator.key-value'),
          5: named('string.unquoted.path'),
          6: named('punctuation.definition.tag.end'),
        },
      },
      {
        begin: re`(?i)${BOL}\s*((<)style(>))${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*((</?)style(>))${SP}*$`),
        beginCaptures: {
          1: named('entity.name.tag.style'),
          2: named('punctuation.definition.tag.begin'),
          3: named('punctuation.definition.tag.end'),
        },
        endCaptures: {
          1: named('entity.name.tag.style'),
          2: named('punctuation.definition.tag.begin'),
          3: named('punctuation.definition.tag.end'),
        },
        contentName: scope('meta.embedded.style'),
        patterns: [include('comment'), include('preprocessor'), include('style-body')],
      },
    ],
  },

  'style-body': {
    patterns: [
      { name: scope('comment.line.double-slash'), match: re`//.*$` },
      include('comment-inline'),
      { name: scope('keyword.control.at-rule'), match: re`(?i)@media\b` },
      {
        // property: value or property value, up to ; or } or the line end
        match: re`(--[\w-]+|[A-Za-z][\w.-]*)${SP}*(:)?${SP}+([^;{}]+?)${SP}*(?=;|\}|$)`,
        captures: {
          1: named('support.type.property-name'),
          2: named('punctuation.separator.key-value'),
          3: nested('#style-value'),
        },
      },
      {
        match: re`(--[\w-]+)${SP}*(:)${SP}*([^;{}]+?)${SP}*(?=;|\}|$)`,
        captures: {
          1: named('variable.other.custom-property'),
          2: named('punctuation.separator.key-value'),
          3: nested('#style-value'),
        },
      },
      { name: scope('punctuation.section.block.begin'), match: re`\{` },
      { name: scope('punctuation.section.block.end'), match: re`\}` },
      { name: scope('punctuation.terminator.rule'), match: re`;` },
      { name: scope('punctuation.separator.list'), match: re`,` },
      include('stereotype'),
      // selectors: element names, .classes, *, :depth(1) and the like
      { name: scope('entity.other.attribute-name.class'), match: re`\.[\w-]+` },
      { name: scope('entity.other.attribute-name.pseudo-class'), match: re`:[\w-]+(?:\([^)]*\))?` },
      { name: scope('entity.name.tag.selector'), match: re`[\w-]+|\*` },
    ],
  },

  'style-value': {
    patterns: [
      include('color'),
      include('number'),
      include('string'),
      { name: scope('variable.other.custom-property'), match: re`--[\w-]+` },
      include('inline-preprocessor'),
      { name: scope('support.constant.property-value'), match: re`[\w-]+` },
    ],
  },

  /** Sprite definitions: hex rows, one-line data, base64, md5, SVG, file. */
  sprite: {
    patterns: [
      {
        begin: re`(?i)${BOL}\s*(sprite)${SP}+(\$?)([-.\p{L}\p{N}_]+)${SP}*(\[\d+x\d+/(?:\d+z?|color)\])?${SP}*(\{)${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?sprite|\})${SP}*$`),
        beginCaptures: {
          1: kw,
          2: named('entity.name.type.sprite punctuation.definition.variable'),
          3: named('entity.name.type.sprite'),
          4: named('constant.numeric.dimension'),
          5: named('punctuation.section.block.begin'),
        },
        endCaptures: { 1: named('punctuation.section.block.end') },
        patterns: [include('comment'), { name: scope('constant.other.sprite-data'), match: re`\S+` }],
      },
      {
        begin: re`(?i)${BOL}\s*(sprite)${SP}+(\$?)([-\p{L}\p{N}_]+)${SP}+(<svg\b)(?!.*</svg>)`,
        end: endOr(re`(</svg>)${SP}*$`),
        beginCaptures: {
          1: kw,
          2: named('entity.name.type.sprite punctuation.definition.variable'),
          3: named('entity.name.type.sprite'),
          4: named('meta.embedded.svg'),
        },
        endCaptures: { 1: named('meta.embedded.svg') },
        contentName: scope('meta.embedded.svg'),
      },
      {
        match: re`(?i)${BOL}\s*(sprite)${SP}+(\$?)([-.\p{L}\p{N}_]+)${SP}*(?:(\[\d+x\d+/(?:\d+z|color)\])${SP}*)?(?:(data:image/png;(?:base64|md5),)?([-_A-Za-z0-9+/=]+)|(<svg\b.*</svg>)|([^<>"\x{201C}\x{201D}#\s][^<>"\x{201C}\x{201D}#]*?))${SP}*$`,
        captures: {
          1: kw,
          2: named('entity.name.type.sprite punctuation.definition.variable'),
          3: named('entity.name.type.sprite'),
          4: named('constant.numeric.dimension'),
          5: named('keyword.other.data-uri'),
          6: named('constant.other.sprite-data'),
          7: named('meta.embedded.svg'),
          8: named('string.unquoted.path'),
        },
      },
    ],
  },

  scale: {
    match: re`(?i)${BOL}\s*(scale)${SP}+(?:(max)${SP}+)?([0-9.]+)(?:${SP}*([/*x])${SP}*([0-9.]+)|${SP}+(width|height))?${SP}*$`,
    captures: {
      1: kw,
      2: kw,
      3: named('constant.numeric'),
      4: named('keyword.operator'),
      5: named('constant.numeric'),
      6: kw,
    },
  },

  /** hide/show that every factory accepts: empty descriptions, members by visibility or kind, footbox. */
  'hide-show-common': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(hide|show)${SP}+(empty)${SP}+(description)${SP}*$`,
        captures: { 1: kw, 2: kw, 3: kw },
      },
      {
        match: re`(?i)${BOL}\s*(hide|show)${SP}+((?:public|private|protected|package)?(?:[,${SP}]+(?:public|private|protected|package))*)${SP}+(members?|attributes?|fields?|methods?)${SP}*$`,
        captures: { 1: kw, 2: named('storage.modifier'), 3: kw },
      },
      {
        match: re`(?i)${BOL}\s*(hide|show)${SP}+((?:(?:class|object|interface|enum|annotation|dataclass|record|abstract|[\p{L}\p{N}_.]+|${DQ}${NOT_DQ}+${DQ}|<<.*>>)${SP}+)*?)(?:(empty)${SP}+)?(members?|attributes?|fields?|methods?|circles?|circled?|stereotypes?)${SP}*$`,
        captures: { 1: kw, 2: nested('#hide-show-target'), 3: kw, 4: kw },
      },
      {
        match: re`(?i)${BOL}\s*(?:(hide|show)${SP}*)?(footbox)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
    ],
  },

  'hide-show-target': {
    patterns: [
      include('stereotype'),
      include('string'),
      {
        name: scope('storage.type'),
        match: re`(?i)\b(?:class|object|interface|enum|annotation|dataclass|record|abstract)\b`,
      },
    ],
  },

  'misc-common': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(!pragma)${SP}+([A-Za-z_]\w*)(?:${SP}+(.*?))?${EOL}`,
        captures: { 1: control, 2: named('variable.other.option'), 3: nested('#skinparam-value') },
      },
      {
        match: re`(?i)${BOL}\s*(!assume)${SP}+(transparent)${SP}+(dark|light)${SP}*$`,
        captures: { 1: control, 2: kw, 3: kw },
      },
      {
        match: re`(?i)${BOL}\s*(skin)${SP}+([\w.]+)${SP}*$`,
        captures: { 1: kw, 2: named('support.constant.skin') },
      },
      {
        match: re`(?i)${BOL}\s*(minwidth)${SP}+(\d+)${SP}*$`,
        captures: { 1: kw, 2: named('constant.numeric') },
      },
      {
        match: re`(?i)${BOL}\s*(page)${SP}+(\d+)${SP}*(x*)${SP}*(\d+)${SP}*$`,
        captures: { 1: kw, 2: named('constant.numeric'), 3: named('keyword.operator'), 4: named('constant.numeric') },
      },
      { match: re`(?i)${BOL}\s*(rotate)${SP}*$`, captures: { 1: kw } },
      {
        match: re`(?i)${BOL}\s*(set)${SP}+(separator|namespaceseparator)${SP}+(\S+)${SP}*$`,
        captures: { 1: kw, 2: kw, 3: named('constant.character.separator') },
      },
    ],
  },
};
