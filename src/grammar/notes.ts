/**
 * Notes, in every form the UML diagrams accept:
 *
 *   note left of A : text              note "text" as N1
 *   note over A, B                     note as N1 … end note
 *   … end note                         note on link : text
 *   note right of Class::member { … }  hnote / rnote, & and / prefixes
 *   floating note left : text          note across : text
 *
 * One-line notes end at the colon; the others run to `end note` (`end
 * hnote`, `end rnote`), or to `}` when the header ends with `{`.
 */

import { DQ, EOL, NOT_DQ, SP, endOr, include, named, nested, re, scope, BOL, type Rule } from './rules';

const kw = named('keyword.other');

const NOTE = re`(?:(&)${SP}*)?(/)?${SP}*(?:((?i:floating))${SP}+)?((?i:note|hnote|rnote))\b`;
const noteCaptures = {
  1: named('keyword.operator.parallel'),
  2: named('keyword.operator.merge'),
  3: kw,
  4: named('keyword.other.note'),
};

export const notesRepository: Record<string, Rule> = {
  note: {
    patterns: [
      // note "text" as N1
      {
        match: re`(?i)${BOL}\s*(note)${SP}+(${DQ})(${NOT_DQ}+)(${DQ})${SP}+(as)${SP}+([\p{L}\p{N}_.]+)(.*?)${EOL}`,
        captures: {
          1: named('keyword.other.note'),
          2: named('string.quoted.double punctuation.definition.string.begin'),
          3: { name: scope('string.quoted.double'), patterns: [include('label')] },
          4: named('string.quoted.double punctuation.definition.string.end'),
          5: kw,
          6: named('entity.name.type'),
          7: nested('#note-header'),
        },
      },
      // One line: … : text (a lone colon; `::` belongs to member names)
      {
        match: re`${BOL}\s*${NOTE}((?:[^:]|::)*?)(?<!:)(:)(?!:)${SP}*(.*?)${EOL}`,
        captures: {
          ...noteCaptures,
          5: nested('#note-header'),
          6: named('punctuation.separator.label'),
          7: nested('#label'),
        },
      },
      // Several lines inside braces.
      {
        begin: re`${BOL}\s*${NOTE}(.*?)(\{)${SP}*$`,
        end: endOr(re`${BOL}\s*(\})${SP}*$`),
        beginCaptures: { ...noteCaptures, 5: nested('#note-header'), 6: named('punctuation.section.block.begin') },
        endCaptures: { 1: named('punctuation.section.block.end') },
        contentName: scope('meta.note'),
        patterns: [include('text-block')],
      },
      // Several lines up to end note.
      {
        begin: re`${BOL}\s*${NOTE}(.*?)${EOL}`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?(?:note|hnote|rnote))${SP}*$`),
        beginCaptures: { ...noteCaptures, 5: nested('#note-header') },
        endCaptures: { 1: named('keyword.other.note') },
        contentName: scope('meta.note'),
        patterns: [include('text-block')],
      },
    ],
  },

  'note-header': {
    patterns: [
      include('comment-inline'),
      {
        name: scope('keyword.other'),
        match: re`(?i)(?<![\w.])(?:left|right|top|bottom|over|across|accross|of|on|link|as)(?![\w.])`,
      },
      include('stereotype'),
      include('color'),
      { include: '#creole-inline' },
      include('inline-preprocessor'),
      include('string'),
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('entity.name.type'), match: re`[\p{L}\p{N}_.@]+(?:::[\p{L}\p{N}_.@()]+)*` },
    ],
  },
};
