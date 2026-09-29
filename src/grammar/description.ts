/**
 * Description diagrams (DescriptionDiagramFactory): use case, component,
 * deployment and ArchiMate elements — with a shape keyword or the short
 * forms `:actor:`, `(use case)`, `[component]`, `() interface` — their
 * multi-line descriptions, requirements and domains, and links between
 * elements. The containers and commands shared with class diagrams live in
 * classes.ts, which the engine and this grammar try first.
 */

import {
  DIRECTION,
  EL_NAME,
  ELEMENT_FORMS,
  ELEMENT_TAIL,
  ELEMENT_TYPES,
  GENERIC,
  HEAD1,
  HEAD2,
  INSIDE,
  LINE_STYLE,
  QUOTED,
} from './classes';
import { COLORS } from './common';
import { BOL, DQ, EOL, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';

const kw = named('keyword.other');
const decl = named('storage.type');
const typeName = named('entity.name.type');

const STEREO_OPT = re`${SP}*(?:<<.+?>>)?${SP}*`;
const ARCHIMATE_STEREO = re`${SP}*(?:<<[-\w]+?>>)?${SP}*`;
/** Stereotype, link and colour, each optional, before a multi-line description. */
const MULTILINE_HEAD_TAIL = re`${STEREO_OPT}(?:\[\[.*?\]\])?${SP}*(?:${COLORS})?${SP}*`;

/**
 * A link end (CommandLinkElement): a name, or a short form. Not `[*]` or
 * `(*)` (start and end of state and activity diagrams), and not `[H]` or
 * `[H*]` (state history), which the engine reads in those diagrams.
 */
const END = re`(?:${EL_NAME}|${QUOTED}|\(\)${SP}*${EL_NAME}|\(\)${SP}*${QUOTED}|:[^:]+:/?|(?!\[(?:\*|H\*?)\])\[[^\[\]]+\]|\((?!\*\))[^)]+\)/?)`;

const ELEMENT_ARROW = re`${HEAD1}?[-=.~]+(?:\[${LINE_STYLE}(?:;${LINE_STYLE})*\])?(?:${DIRECTION}(?=[-=.~0()\[]))?${INSIDE}?(?:\[${LINE_STYLE}\])?[-=.~]*${HEAD2}?`;

/** `archimate #Color` with its forms (CommandArchimate…). */
const ARCHIMATE_FORMS = ELEMENT_FORMS.replace(/<<\.\+\?>>/g, re`<<[-\w]+?>>`);

export const descriptionRepository: Record<string, Rule> = {
  description: {
    patterns: [
      include('description-multiline'),
      include('description-archimate'),
      include('description-domain'),
      include('description-element'),
      include('description-link'),
    ],
  },

  /**
   * An element whose description spans several lines
   * (CommandCreateElementMultilines): type, code, then optionally a
   * stereotype, a link and a colour before `as "` or `[`.
   */
  'description-multiline': {
    patterns: [
      // usecase UC as "first line … last line"
      {
        begin: re`(?i)${BOL}\s*(${ELEMENT_TYPES})${SP}+([\p{L}\p{N}_.]+)(${MULTILINE_HEAD_TAIL})(as)${SP}*(${DQ})([^"\x{201C}\x{201D}]*)$`,
        end: endOr(re`${BOL}(.*?)(${DQ})${SP}*$`),
        beginCaptures: {
          1: decl,
          2: typeName,
          3: nested('#multiline-head-tail'),
          4: kw,
          5: named('string.quoted.double punctuation.definition.string.begin'),
          6: { name: scope('string.quoted.double'), patterns: [include('label')] },
        },
        endCaptures: {
          1: { name: scope('string.quoted.double'), patterns: [include('label')] },
          2: named('string.quoted.double punctuation.definition.string.end'),
        },
        contentName: scope('string.quoted.double'),
        patterns: [include('text-block')],
      },
      // component C [ first line … last line ]
      {
        begin: re`(?i)${BOL}\s*(${ELEMENT_TYPES})${SP}+([\p{L}\p{N}_.]+)(${MULTILINE_HEAD_TAIL})(\[)(?!.*\]${SP}*$)(.*)$`,
        end: endOr(re`${BOL}([^\[\]]*)(\])${SP}*$`),
        beginCaptures: {
          1: decl,
          2: typeName,
          3: nested('#multiline-head-tail'),
          4: named('punctuation.section.brackets.begin'),
          5: nested('#label'),
        },
        endCaptures: { 1: nested('#label'), 2: named('punctuation.section.brackets.end') },
        patterns: [include('text-block')],
      },
    ],
  },

  /** Stereotype, link and colour between an element's code and its multi-line description. */
  'multiline-head-tail': {
    patterns: [
      include('stereotype'),
      { name: scope('markup.underline.link'), match: re`\[\[.*?\]\]` },
      include('color'),
    ],
  },

  'description-archimate': {
    patterns: [
      // archimate #Business Code <<business-actor>> [ several lines ]
      {
        begin: re`(?i)${BOL}\s*(archimate)${SP}+(?:(${COLORS})${SP}+)?([\p{L}\p{N}_.]+)(${ARCHIMATE_STEREO})(\[\[.*?\]\])?${SP}*(${COLORS})?${SP}*(\[)(?!.*\]${SP}*$)(.*)$`,
        end: endOr(re`${BOL}(.*)(\])${SP}*$`),
        beginCaptures: {
          1: decl,
          2: named('constant.other.color'),
          3: typeName,
          4: nested('#stereotype'),
          5: nested('#creole-inline'),
          6: named('constant.other.color'),
          7: named('punctuation.section.brackets.begin'),
          8: nested('#label'),
        },
        endCaptures: { 1: nested('#label'), 2: named('punctuation.section.brackets.end') },
        patterns: [include('text-block')],
      },
      // archimate #Technology "VPN Server" as vpn <<technology-device>> [{]
      {
        match: re`(?i)${BOL}\s*(archimate)${SP}+(?:(${COLORS})${SP}+)?(${ARCHIMATE_FORMS})(${ARCHIMATE_STEREO})(\{)?${SP}*$`,
        captures: {
          1: decl,
          2: named('constant.other.color'),
          3: nested('#class-element-name'),
          4: nested('#stereotype'),
          5: named('punctuation.section.block.begin'),
        },
      },
    ],
  },

  // requirement "Display" as R1 <<stereo>> [{]
  'description-domain': {
    match: re`(?i)${BOL}\s*(requirement|domain)${SP}+(${DQ})(.+?)(${GENERIC})?(${DQ})${SP}+(as)${SP}+([a-zA-Z0-9]+)(${STEREO_OPT})(\{)?${SP}*$`,
    captures: {
      1: decl,
      2: named('string.quoted.double punctuation.definition.string.begin'),
      3: { name: scope('string.quoted.double entity.name.type'), patterns: [include('label')] },
      4: nested('#class-generic'),
      5: named('string.quoted.double punctuation.definition.string.end'),
      6: kw,
      7: typeName,
      8: nested('#stereotype'),
      9: named('punctuation.section.block.begin'),
    },
  },

  /**
   * An element: an optional shape keyword (or `()`), then a name in any of
   * its forms, then tags, stereotype, link and colour. A bare word alone is
   * not an element (the engine forbids it).
   */
  'description-element': {
    // (?=\S) pins the check after the indentation: without it, giving back
    // a space would let a single word such as `  break` through.
    match: re`(?i)${BOL}\s*(?=\S)(?![\p{L}0-9_.]+${SP}*$)(?:(${ELEMENT_TYPES}|\(\))${SP}+)?(${COLORS})?${SP}*(${ELEMENT_FORMS})(${ELEMENT_TAIL})${SP}*$`,
    captures: {
      1: decl,
      2: named('constant.other.color'),
      3: nested('#class-element-name'),
      4: nested('#class-element-tail'),
    },
  },

  /** A link between elements: A --> (use case), :actor: -> [component] : label */
  'description-link': {
    match: re`${BOL}\s*(${END})${SP}*(${QUOTED})?${SP}*(${ELEMENT_ARROW})${SP}*(${QUOTED})?${SP}*(${END})(${SP}*(?:${COLORS})?${STEREO_OPT}(?::.*)?)${EOL}`,
    captures: {
      1: nested('#class-element-name'),
      2: nested('#string'),
      3: nested('#class-arrow'),
      4: nested('#string'),
      5: nested('#class-element-name'),
      6: nested('#class-link-tail'),
    },
  },
};
