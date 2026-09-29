/**
 * Mind maps (@startmindmap) and work breakdown structures (@startwbs).
 *
 * Both are outlines: a run of markers gives the depth (`*`/`#` in org mode,
 * `+`/`-` for the right and left sides of a mind map, `*`/`+`/`-` in a
 * WBS), optionally followed by a colour, a boxless marker `_`, a side
 * (`<`/`>` in a WBS) or a code, then the text. `:` after the markers opens
 * a text that runs to the line ending with `;`.
 */

import { BOL, DQ, EOL, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';

const marker = named('punctuation.definition.list.begin');

/** A text that runs from `:` to the line ending with `;` (optionally `;<<stereotype>>`). */
function multiline(markers: string, prefix: string, prefixRule: string): Rule {
  return {
    begin: re`${BOL}\s*(${markers})(${prefix})(:)(.*)$`,
    end: endOr(re`${BOL}(.*?)(;)${SP}*(<<.+>>)?${SP}*$`),
    beginCaptures: {
      1: marker,
      2: nested(prefixRule),
      3: named('punctuation.separator.label'),
      4: nested('#text-block'),
    },
    endCaptures: {
      1: nested('#text-block'),
      2: named('punctuation.terminator.label'),
      3: nested('#stereotype'),
    },
    patterns: [include('text-block')],
  };
}

/** The text of an item: creole, with an optional trailing stereotype. */
const itemText = nested('#stereotype', '#label');

export const mindmapRepository: Record<string, Rule> = {
  'diagram-mindmap': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      include('mindmap-direction'),
      multiline(re`[*#]+`, re`(?:\[#\w+\])?_?`, '#mindmap-prefix'),
      {
        match: re`${BOL}\s*([*#]+|[+-]+|0)((?:\[#\w+\])?_?)${SP}*(.*?)${EOL}`,
        captures: { 1: marker, 2: nested('#mindmap-prefix'), 3: itemText },
      },
    ],
  },

  'mindmap-prefix': {
    patterns: [
      { name: scope('constant.other.color'), match: re`(?<=\[)#\w+(?=\])` },
      { name: scope('punctuation.section.brackets'), match: re`[\[\]]` },
      { name: scope('keyword.other.boxless'), match: re`_` },
    ],
  },

  /** `left side`, `right side`, `top to bottom direction`, `left to right direction`. */
  'mindmap-direction': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(left${SP}+to${SP}+right|top${SP}+to${SP}+bottom)${SP}+(direction)${SP}*$`,
        captures: { 1: named('keyword.other'), 2: named('keyword.other') },
      },
      {
        match: re`(?i)${BOL}\s*(?:[^*#+\-\s][^*#]*?)?\b(left|right|top|bottom)\b[^*#]*?\b(side|direction)${SP}*$`,
        captures: { 1: named('keyword.other'), 2: named('keyword.other') },
      },
    ],
  },

  'diagram-wbs': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      multiline(re`[*+-]+`, re`(?:_|[<>]|\[#\w+\]|\([\p{L}\p{N}_]+\))*`, '#wbs-prefix'),
      // * "Label" as CODE
      {
        match: re`${BOL}\s*([*+-]+)((?:_|[<>]|\[#\w+\])*)${SP}+(${DQ})(.*)(${DQ})${SP}+((?i:as))${SP}+([\p{L}\p{N}_]+)${SP}*$`,
        captures: {
          1: marker,
          2: nested('#wbs-prefix'),
          3: named('string.quoted.double punctuation.definition.string.begin'),
          4: { name: scope('string.quoted.double'), patterns: [include('label')] },
          5: named('string.quoted.double punctuation.definition.string.end'),
          6: named('keyword.other'),
          7: named('entity.name.type'),
        },
      },
      {
        match: re`${BOL}\s*([*+-]+)((?:_|[<>]|\[#\w+\]|\([\p{L}\p{N}_]+\))*)(?:${SP}+(.*?))?${EOL}`,
        captures: { 1: marker, 2: nested('#wbs-prefix'), 3: itemText },
      },
      // CODE1 -> CODE2 : label
      {
        match: re`${BOL}\s*([\p{L}\p{N}_]+)${SP}*([.-]+>)${SP}*([\p{L}\p{N}_]+)${SP}*(#\w+(?:[-\\|/]\w+)?)?(${SP}*<<.+?>>)?(?:${SP}*(:)${SP}*(.+?))?${EOL}`,
        captures: {
          1: named('entity.name.type'),
          2: named('keyword.operator.arrow'),
          3: named('entity.name.type'),
          4: named('constant.other.color'),
          5: nested('#stereotype'),
          6: named('punctuation.separator.label'),
          7: nested('#label'),
        },
      },
    ],
  },

  'wbs-prefix': {
    patterns: [
      { name: scope('constant.other.color'), match: re`(?<=\[)#\w+(?=\])` },
      { name: scope('punctuation.section.brackets'), match: re`[\[\]]` },
      {
        match: re`(\()([\p{L}\p{N}_]+)(\))`,
        captures: {
          1: named('punctuation.section.parens.begin'),
          2: named('entity.name.type'),
          3: named('punctuation.section.parens.end'),
        },
      },
      // Shape and direction after the colour or code: the older order, which
      // the engine accepts with a warning.
      { name: scope('keyword.other.boxless invalid.deprecated'), match: re`(?<=[\])]|[\])][<>])_` },
      { name: scope('keyword.operator.side invalid.deprecated'), match: re`(?<=[\])]|[\])]_)[<>]` },
      { name: scope('keyword.other.boxless'), match: re`_` },
      { name: scope('keyword.operator.side'), match: re`[<>]` },
    ],
  },
};
