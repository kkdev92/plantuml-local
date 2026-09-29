/**
 * Gantt diagrams (@startgantt, @startproject: GanttDiagramFactory).
 *
 * Most lines are sentences: a subject (`[Task]`, `{Resource}`, `project`,
 * `today`, a date or a weekday, `separator`, working hours) followed by one
 * or more verb phrases joined by `and` (`[Build] requires 5 days and starts
 * at [Design]'s end`). A line is a sentence only when a verb follows the
 * subject, as in the engine. The engine matches the whole vocabulary
 * without regard to case. The other commands (arrows, groups, separators,
 * print scale, hide/show …) come first.
 */

import { BOL, EOL, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';
import { LINE_STYLE } from './sequence';

const kw = named('keyword.other');
const deprecated = named('keyword.other invalid.deprecated');
const name = named('entity.name.type');

const TASK = re`\[[^\[\]]+\]`;
const RESOURCE = re`\{[^{}]+\}`;
const MONTH = re`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*`;
const WEEKDAY = re`(?:mon|tue|wed|thu|fri|sat|sun)\p{L}*`;

/** 2026-10-01, 2026/10/1 */
const DATE_YMD = re`\d{1,4}[^\d\s]{1,3}\d{1,2}[^\d\s]{1,3}\d{1,2}(?!\d)`;
/** 1 January 2026, 1st of january, 2026 */
const DATE_DMY = re`\d{1,2}[^\d\n]*?\b${MONTH}[^\d\n]+?\d{1,4}(?!\d)`;
/** January 1, 2026 */
const DATE_MDY = re`\b${MONTH}[^\d\n]+?\d{1,2}[^\d\n]+?\d{1,4}(?!\d)`;
/** A date with an optional time: 2026-10-01T10:30, 2026-10-01 10:30:15 */
const DATE_TIME = re`(?:${DATE_YMD}|${DATE_DMY}|${DATE_MDY})(?:[Tt ]\d{1,2}:\d{1,2}(?::\d{1,2})?)?`;

/**
 * Subjects of a sentence. The day subjects take numeric dates only
 * (SubjectDayAsDate, SubjectDaysAsDates).
 */
const SUBJECT = re`(?:(?:then${SP}+)?${TASK}(?:${SP}*<<.+?>>)?(?:${SP}+as${SP}+${TASK})?(?:${SP}+on${SP}+(?:${RESOURCE}${SP}*)+)?|it|${RESOURCE}|she|he|they|project|gantt|today|separator|from${SP}+\d+:\d+${SP}+to${SP}+\d+:\d+|${DATE_YMD}${SP}+to${SP}+${DATE_YMD}|[dD]\+\d+${SP}+to${SP}+[dD]\+\d+|${DATE_YMD}${SP}+and${SP}+\d+${SP}+days?|then${SP}+\d+${SP}+days?|${DATE_YMD}|[dDtTeE][-+]\d+|${WEEKDAY})`;

/**
 * A day counted from the project start: D+5 (the engine's `「dD」+` is a
 * D followed by a literal plus, not a repetition).
 */
const RELATIVE_DAY = re`\b[dDtTeE][-+]\d+\b`;

/** First word of a verb phrase (Verbs upstream). */
const VERB = re`(?:lasts|requires|starts|ends|happens|occurs|is|are|pauses|links|just|works|displays?)`;

/** A colour or a gradient: #red, red, #red/#blue */
const COLOR_WORD = re`#?\w+(?:/#?\w+)?`;

const DURATION_UNIT = re`(?:hour|minute|second|day|week|month)s?`;

const VOCABULARY = [
  'lasts',
  'requires',
  'starts',
  'ends',
  'happens',
  'occurs',
  'is',
  'are',
  'pauses',
  'links',
  'to',
  'just',
  'works',
  'on',
  'displays',
  'display',
  'same',
  'row',
  'as',
  'deleted',
  'off',
  'named',
  'opened',
  'opend',
  'open',
  'closed',
  'close',
  'completed',
  'complete',
  'working',
  'hours',
  'for',
  'completion',
  'from',
  'the',
  'at',
  'with',
  'after',
  'before',
  'and',
  'then',
  'start',
  'end',
  'link',
  'in',
  'it',
  'he',
  'she',
  'they',
  'project',
  'gantt',
  'today',
  'separator',
];

const taskRef: Rule = {
  match: re`(?i)(\[)([^\[\]]+)(\])(?:(.s)${SP}+(start|end)\b)?`,
  captures: {
    1: named('punctuation.definition.task.begin'),
    2: name,
    3: named('punctuation.definition.task.end'),
    4: named('keyword.other.possessive'),
    5: kw,
  },
};

const resourceRef: Rule = {
  match: re`(\{)([^{}]+)(\})`,
  captures: {
    1: named('punctuation.definition.resource.begin'),
    2: name,
    3: named('punctuation.definition.resource.end'),
  },
};

export const ganttRepository: Record<string, Rule> = {
  'diagram-gantt': {
    patterns: [
      include('preprocessor'),
      // GanttDiagramFactory registers the title, common and scale commands,
      // not the class-diagram hide/show forms.
      include('title-block'),
      include('title-line'),
      include('skinparam'),
      include('style'),
      include('sprite'),
      include('scale'),
      include('misc-common'),
      include('gantt-note'),
      include('gantt-command'),
      include('gantt-sentence'),
    ],
  },

  /** note bottom … end note, after a task. */
  'gantt-note': {
    begin: re`(?i)${BOL}\s*(note)${SP}*(bottom)${SP}*(\$[\p{L}\p{N}_]+(?:${SP}+\$[\p{L}\p{N}_]+)*)?${SP}*(<<.+>>)?${SP}*$`,
    end: endOr(re`(?i)${BOL}\s*(end${SP}*note)${SP}*$`),
    beginCaptures: {
      1: named('keyword.other.note'),
      2: kw,
      3: named('entity.name.tag'),
      4: nested('#stereotype'),
    },
    endCaptures: { 1: named('keyword.other.note') },
    contentName: scope('meta.note'),
    patterns: [include('text-block')],
  },

  'gantt-command': {
    patterns: [
      // [Design] -> [Build], T1 -[#red]-> T2
      {
        match: re`${BOL}\s*(\[)([^\[\]]+?)(\])${SP}*(-+(?:\[${LINE_STYLE}\])?-*>)${SP}*(\[)([^\[\]]+?)(\])${SP}*$`,
        captures: {
          1: named('punctuation.definition.task.begin'),
          2: name,
          3: named('punctuation.definition.task.end'),
          4: nested('#gantt-arrow'),
          5: named('punctuation.definition.task.begin'),
          6: name,
          7: named('punctuation.definition.task.end'),
        },
      },
      {
        match: re`${BOL}\s*([\p{L}\p{N}_.]+)${SP}*(-+(?:\[${LINE_STYLE}\])?-*>)${SP}*([\p{L}\p{N}_.]+)${SP}*$`,
        captures: { 1: name, 2: nested('#gantt-arrow'), 3: name },
      },
      // [Design] #red/Pink
      {
        match: re`${BOL}\s*(\[)([\p{L}\p{N}_.]+)(\])${SP}+(#\w+)(?:(/)(#?\w+))?${SP}*$`,
        captures: {
          1: named('punctuation.definition.task.begin'),
          2: name,
          3: named('punctuation.definition.task.end'),
          4: named('constant.other.color'),
          5: named('punctuation.separator.color'),
          6: nested('#gantt-color'),
        },
      },
      // -- Phase one --
      {
        match: re`${BOL}\s*(--)${SP}*(?:(.+?)${SP}*(--))?${SP}*$`,
        captures: {
          1: named('punctuation.separator.gantt'),
          2: nested('#label'),
          3: named('punctuation.separator.gantt'),
        },
      },
      // group [Name] … end group
      {
        match: re`(?i)${BOL}\s*(group)${SP}+(\[)([^\[\]]+)(\])${SP}*$`,
        captures: {
          1: named('keyword.control'),
          2: named('punctuation.definition.group.begin'),
          3: name,
          4: named('punctuation.definition.group.end'),
        },
      },
      { match: re`(?i)${BOL}\s*(end${SP}*group)${SP}*$`, captures: { 1: named('keyword.control') } },
      // weeks start on Monday and must have at least 4 days
      {
        match: re`(?i)${BOL}\s*(weeks?)${SP}+(starts?)([^0-9]*?)${SP}+(${WEEKDAY})${SP}+([^0-9]*?)([0-9]+)([^0-9]*?)$`,
        captures: {
          1: kw,
          2: kw,
          3: nested('#gantt-words'),
          4: named('constant.language.weekday'),
          5: nested('#gantt-words'),
          6: named('constant.numeric'),
          7: nested('#gantt-words'),
        },
      },
      { match: re`(?i)${BOL}\s*(language)${SP}+(\w+)$`, captures: { 1: kw, 2: named('support.constant.language') } },
      // printscale weekly with calendar date zoom 2
      {
        match: re`(?i)${BOL}\s*(projectscale|ganttscale|printscale)${SP}+(yearly|quarterly|monthly|daily|weekly)(?:${SP}+(with\s+calendar\s+date|with\s+week\s+numbering\s+from)(?:${SP}*(-?\d+))?)?(?:${SP}+(zoom)${SP}+([.\d]+))?$`,
        captures: {
          1: kw,
          2: named('support.constant.scale'),
          3: kw,
          4: named('constant.numeric'),
          5: kw,
          6: named('constant.numeric'),
        },
      },
      // print between 2026-10-01 and 2026-10-31
      {
        match: re`(?i)${BOL}\s*(print)${SP}+(between)${SP}+(.+?)${SP}+(and)${SP}+(.+?)${SP}*$`,
        captures: { 1: kw, 2: kw, 3: nested('#gantt-date'), 4: kw, 5: nested('#gantt-date') },
      },
      // [hide|show] footbox
      {
        match: re`(?i)${BOL}\s*(?:(hide|show)${SP}*)?(footbox)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      // label on first column and left aligned: the engine only warns that it is deprecated
      {
        match: re`(?i)${BOL}\s*(labels?)${SP}+(on)${SP}*(first|last)${SP}*(column)(?:${SP}*(and)${SP}*(left|right)${SP}*(aligned))?$`,
        captures: { 1: deprecated, 2: deprecated, 3: deprecated, 4: deprecated, 5: deprecated, 6: deprecated, 7: deprecated },
      },
      // hide resources names, hide resources footbox
      {
        match: re`(?i)${BOL}\s*(hide)${SP}+(ress?ources?)${SP}+(names?|footbox)$`,
        captures: { 1: kw, 2: kw, 3: kw },
      },
      // hide column start, show column duration
      {
        match: re`(?i)${BOL}\s*(hide|show)${SP}+(column)${SP}+(task|start|end|duration)$`,
        captures: { 1: kw, 2: kw, 3: named('support.constant.column') },
      },
      { match: re`(?i)${BOL}\s*(hide)${SP}+(closed)$`, captures: { 1: kw, 2: kw } },
      // task default completion to 50
      {
        match: re`(?i)${BOL}\s*(task)${SP}+(default${SP}+completion|completion${SP}+default)${SP}+(to)${SP}+(\d+)(.*)$`,
        captures: { 1: kw, 2: kw, 3: kw, 4: named('constant.numeric'), 5: nested('#gantt-predicate') },
      },
    ],
  },

  'gantt-arrow': {
    patterns: [
      {
        match: re`(\[)(.*?)(\])`,
        captures: {
          1: named('keyword.operator.arrow punctuation.definition.style.begin'),
          2: nested('#line-style'),
          3: named('keyword.operator.arrow punctuation.definition.style.end'),
        },
      },
      { name: scope('keyword.operator.arrow'), match: re`[^\[\]]+` },
    ],
  },

  /** Subject, then one or more verb phrases. */
  'gantt-sentence': {
    match: re`(?i)${BOL}\s*(${SUBJECT})(${SP}+${VERB}\b.*?)${EOL}`,
    captures: { 1: nested('#gantt-subject'), 2: nested('#gantt-predicate') },
  },

  'gantt-subject': {
    patterns: [
      include('stereotype'),
      taskRef,
      resourceRef,
      include('gantt-date'),
      { name: scope('constant.numeric.time'), match: re`\b\d+:\d+\b` },
      {
        match: re`(?i)\b(\d+)${SP}+(days?)\b`,
        captures: { 1: named('constant.numeric'), 2: named('constant.numeric') },
      },
      { name: scope('constant.numeric'), match: RELATIVE_DAY },
      { name: scope('constant.language.weekday'), match: re`(?i)\b${WEEKDAY}` },
      {
        name: scope('keyword.other'),
        match: re`(?i)\b(?:then|as|on|it|she|he|they|project|gantt|today|separator|from|to|and)\b`,
      },
    ],
  },

  'gantt-predicate': {
    patterns: [
      // is displayed as <text>
      {
        match: re`(?i)\b(displayed)${SP}+(as)\b${SP}*(.*)$`,
        captures: { 1: kw, 2: kw, 3: nested('#label') },
      },
      include('creole-inline'),
      taskRef,
      resourceRef,
      // is colored in red/blue, are colored salmon, is colored for completion from red to green
      {
        match: re`(?i)\b(colou?red)\b(?:${SP}+(for)${SP}+(completion)${SP}+(from)${SP}+(${COLOR_WORD})${SP}+(to)${SP}+(${COLOR_WORD})|${SP}+(?:(in)${SP}+)?(${COLOR_WORD}))?`,
        captures: {
          1: kw,
          2: kw,
          3: kw,
          4: kw,
          5: nested('#gantt-color'),
          6: kw,
          7: nested('#gantt-color'),
          8: kw,
          9: nested('#gantt-color'),
        },
      },
      // with [dotted|bold|dashed] red [dotted|bold|dashed] link
      {
        match: re`(?i)\b(with)${SP}+(?:(dotted|bold|dashed)${SP}+)?(#?\w+)${SP}+(?:(dotted|bold|dashed)${SP}+)?(link)\b`,
        captures: {
          1: kw,
          2: named('keyword.other.line-style'),
          3: nested('#gantt-color'),
          4: named('keyword.other.line-style'),
          5: kw,
        },
      },
      include('gantt-date'),
      // 5 days, 2 weeks and 3 days, 3 working days
      {
        match: re`(?i)\b(\d+)${SP}+(?:(working)${SP}+)?(${DURATION_UNIT})\b`,
        captures: { 1: named('constant.numeric'), 2: kw, 3: named('constant.numeric') },
      },
      { name: scope('constant.numeric'), match: re`\b\d+%` },
      { name: scope('constant.numeric'), match: RELATIVE_DAY },
      { name: scope('constant.language.weekday'), match: re`(?i)\b${WEEKDAY}` },
      { name: scope('keyword.other'), match: re`(?i)\b(?:${VOCABULARY.join('|')})\b` },
      { name: scope('constant.numeric'), match: re`\b\d+(?:\.\d+)?\b` },
    ],
  },

  /** The free words of `weeks start on Monday and must have at least 4 days`. */
  'gantt-words': {
    patterns: [{ name: scope('keyword.other'), match: re`\p{L}+` }],
  },

  'gantt-date': {
    patterns: [{ name: scope('constant.numeric.date'), match: re`(?i)${DATE_TIME}` }],
  },

  'gantt-color': {
    patterns: [
      { name: scope('constant.other.color'), match: re`#\w+` },
      { name: scope('punctuation.separator.color'), match: re`/` },
      { name: scope('support.constant.color'), match: re`\w+` },
    ],
  },
};
