/**
 * State diagrams (StateDiagramFactory): simple and composite states, the
 * initial / final / history pseudo-states, transitions in both directions,
 * concurrent regions and state descriptions. Notes come from notes.ts.
 */

import { BOL, DQ, EOL, NOT_DQ, SP, include, named, nested, re, scope, type Rule } from './rules';
import { LINE_STYLE } from './sequence';

const kw = named('keyword.other');

const CODE = re`[\p{L}\p{N}_.]+`;
const QUOTED = re`${DQ}${NOT_DQ}+${DQ}`;
/** A transition end: `State`, `State[H]`, `[*]`, `[H]`, `[H*]`, `==bar==`. */
const END = re`(?:[\p{L}\p{N}_.:]+\[H\*?\]|\[\*\]|\[H\*?\]|==+[\p{L}\p{N}_.:]+==+|[\p{L}\p{N}_.:]+)`;
const DIRECTION = re`(?i:left|right|up|down|le?|ri?|up?|do?)`;
const STYLE = re`(?:\[${LINE_STYLE}\])?`;
/** A --> B, with a cross at the start (`x-->`) or a circle at the end (`-->o `). */
const ARROW = re`x?-+${STYLE}${DIRECTION}?${STYLE}-*>(?:o${SP}+)?`;
/** B <-- A, the same arrow written backwards. */
const ARROW_REVERSE = re`(?:o${SP}+)?<-*${STYLE}${DIRECTION}?${STYLE}-+x?`;
const STEREOS = re`<<.+?>>(?:${SP}*<<.+?>>)*`;

const transitionCaptures = {
  1: nested('#state-end'),
  2: nested('#state-arrow-body'),
  3: nested('#state-end'),
  4: nested('#stereotype'),
  5: named('punctuation.separator.label'),
  6: nested('#label'),
};

export const stateRepository: Record<string, Rule> = {
  state: {
    patterns: [
      include('state-declaration'),
      include('state-transition'),
      include('state-structure'),
      include('state-description'),
    ],
  },

  'state-declaration': {
    patterns: [
      // state Name { / state "Long name" as Code begin / frame Name {
      {
        match: re`(?i)${BOL}\s*(state|frame)${SP}+(.*?)(?:${SP}*(\{)|${SP}+(begin))${SP}*$`,
        captures: {
          1: named('storage.type'),
          2: nested('#state-declaration-rest'),
          3: named('punctuation.section.block.begin'),
          4: kw,
        },
      },
      // state Code [as "Name"] [$tags] [<<stereotype>>] [[[url]]] [#color] [##[dashed]color] [: description]
      {
        match: re`(?i)${BOL}\s*(state)${SP}+(.*?)${EOL}`,
        captures: { 1: named('storage.type'), 2: nested('#state-declaration-rest') },
      },
    ],
  },

  'state-declaration-rest': {
    patterns: [
      include('comment-inline'),
      {
        match: re`(:)${SP}*(.*)$`,
        captures: { 1: named('punctuation.separator.label'), 2: nested('#label') },
      },
      { match: re`(?i)(?<![\w.])(as)(?![\w.])`, captures: { 1: kw } },
      {
        // ##[dashed]red: the border
        match: re`(##)(?:(\[)((?i:dotted|dashed|bold))(\]))?(\w+)?`,
        captures: {
          1: named('punctuation.definition.border'),
          2: named('punctuation.definition.style.begin'),
          3: named('keyword.other.line-style'),
          4: named('punctuation.definition.style.end'),
          5: named('constant.other.color'),
        },
      },
      include('stereotype'),
      include('color'),
      { include: '#creole-inline' },
      { name: scope('entity.name.tag'), match: re`\$[^\s{}"<>$]+` },
      include('string'),
      { name: scope('entity.name.type'), match: CODE },
    ],
  },

  /** A --> B : event, B <-- A, [*] -> A, A -down-> B, A -[#red,bold]-> B */
  'state-transition': {
    patterns: [
      {
        match: re`${BOL}\s*(${END})${SP}*(${ARROW})${SP}*(${END})${SP}*(${STEREOS})?${SP}*(?:(:)${SP}*(.+?))?${EOL}`,
        captures: transitionCaptures,
      },
      {
        match: re`${BOL}\s*(${END})${SP}*(${ARROW_REVERSE})${SP}*(${END})${SP}*(${STEREOS})?${SP}*(?:(:)${SP}*(.+?))?${EOL}`,
        captures: transitionCaptures,
      },
    ],
  },

  'state-end': {
    patterns: [
      { name: scope('constant.language.initial-final'), match: re`\[\*\]` },
      { name: scope('constant.language.history'), match: re`\[H\*?\]` },
      {
        match: re`(==+)([\p{L}\p{N}_.:]+)(==+)`,
        captures: {
          1: named('punctuation.definition.bar'),
          2: named('entity.name.type'),
          3: named('punctuation.definition.bar'),
        },
      },
      { name: scope('entity.name.type'), match: re`[\p{L}\p{N}_.:]+` },
    ],
  },

  'state-arrow-body': {
    patterns: [
      {
        match: re`(\[)(${LINE_STYLE})(\])`,
        captures: {
          1: named('keyword.operator.arrow punctuation.definition.style.begin'),
          2: nested('#line-style'),
          3: named('keyword.operator.arrow punctuation.definition.style.end'),
        },
      },
      { name: scope('keyword.operator.arrow'), match: re`[^\[\]\s]+` },
    ],
  },

  'state-structure': {
    patterns: [
      // end of a composite state
      {
        match: re`(?i)${BOL}\s*(end${SP}?state|\})${SP}*$`,
        captures: { 1: named('punctuation.section.block.end') },
      },
      // -- or || between concurrent regions (three or more bars are also the
      // spacing of a sequence diagram, which the engine tries first)
      {
        match: re`${BOL}\s*(--+|\|\|)${SP}*$`,
        captures: { 1: named('punctuation.separator.concurrent') },
      },
    ],
  },

  /** State1 : a line of its description */
  'state-description': {
    match: re`${BOL}\s*(${CODE}|${QUOTED})${SP}*(:)${SP}*(.*?)${EOL}`,
    captures: {
      1: nested('#string', '#state-end'),
      2: named('punctuation.separator.label'),
      3: nested('#label'),
    },
  },
};
