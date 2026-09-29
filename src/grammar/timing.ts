/**
 * Timing diagrams (TimingDiagramFactory, inside @startuml): players
 * (robust, concise, rectangle, clock, analog, binary), their states, time
 * marks (`@100`, `@:start`, `@WU`), state changes, messages between
 * players, constraints, highlights and the time-axis settings. Notes on
 * players (`note top of WU : …`) are the shared note rules.
 */

import { COLORS } from './common';
import { afterLeadingComment } from './plantuml';
import { BOL, DIAGRAM_END_AHEAD, DQ, EOL, NOT_DQ, SP, include, named, nested, re, scope, type Rule } from './rules';
import { LINE_STYLE } from './sequence';

const kw = named('keyword.other');
const type = named('storage.type');
const name = named('entity.name.type');

/** A player referenced in a timing line (letters, digits, `_` and `.`). */
const PLAYER = re`[\p{L}_][\p{L}\p{N}_.]*`;
/** A player or state name in declarations (`@` allowed). */
const CODE = re`[\p{L}\p{N}_.@]+`;
const QUOTED = re`${DQ}${NOT_DQ}+${DQ}`;
const STEREO = re`(?:${SP}*<<.+>>)?${SP}*`;
const NUMBER = re`-?[0-9]*\.?[0-9]+`;

/**
 * A point in time: `:code` (optionally shifted, `:start+5`), a date
 * `2026/10/01`, an hour `10:30:00`, a number (`+50` is relative), or a
 * clock tick `clk*2`.
 */
const TIME = re`(?::[\p{L}\p{N}_.]+(?:[-+][.\d]+)?|\d+/\d+/\d+|\d+:\d+:\d+|\+?-?\d+\.?\d*|[\p{L}\p{N}_.@]+\*\d+)`;

/** A state value: a name, a quoted label, or {hidden}, {...}, {-}, {?}, {a,b}. */
const STATE_CODE = re`[-\p{L}\p{N}_][-\p{L}\p{N}_.]*`;
const STATE = re`(?:${DQ}${NOT_DQ}*${DQ}|\{hidden\}|\{\.\.\.\}|\{-\}|\{\?\}|\{${STATE_CODE},${STATE_CODE}\}|${STATE_CODE})`;

/** Line style inside an arrow: -[#red,dashed]> */
const STYLE = re`(?:\[${LINE_STYLE}\])?`;

const timeCapture = nested('#timing-time');

function labelTail(index: number): Record<number, Rule> {
  return { [index]: named('punctuation.separator.label'), [index + 1]: nested('#label') };
}

/** A message between players: WU -> WB, WB@+50 -[#red]> WU@+100 */
function message(timeBefore: boolean, timeAfter: boolean): Rule {
  const time = (required: boolean): string => (required ? re`(@${TIME})` : re`(@${TIME})?`);
  return {
    match: re`${BOL}\s*(${PLAYER})${time(timeBefore)}${SP}*(-+${STYLE}>)${SP}*(${PLAYER})${time(timeAfter)}${SP}*(?:(:)${SP}*(.*?))?${EOL}`,
    captures: {
      1: name,
      2: nested('#timing-at-time'),
      3: nested('#timing-arrow'),
      4: name,
      5: nested('#timing-at-time'),
      ...labelTail(6),
    },
  };
}

export const timingRepository: Record<string, Rule> = {
  /**
   * A robust, concise, clock, analog or binary player makes the diagram a
   * timing diagram: the engine picks the diagram type from the whole text,
   * and a timing diagram only accepts timing commands. From the first such
   * declaration to the end of the diagram the other UML rules stop applying,
   * so that `:start is Idle` is a state change, not the start of an activity
   * action that would run to the end of the diagram. (`rectangle` players
   * are left out of this: rectangles are common in description diagrams.)
   */
  'timing-context': {
    begin: re`(?i)(?=${BOL}\s*(?:compact${SP}+)?(?:robust|concise|clock|analog|binary)${SP}+(?:${DQ}|${CODE}))`,
    end: DIAGRAM_END_AHEAD,
    patterns: [
      include('comment'),
      afterLeadingComment('timing-context-line'),
      include('timing-context-line'),
      include('inline'),
    ],
  },

  'timing-context-line': {
    patterns: [include('preprocessor'), include('common-commands'), include('note'), include('timing')],
  },

  timing: {
    patterns: [
      { include: '#timing-first' },
      { include: '#timing-declaration' },
      { include: '#timing-mark' },
      { include: '#timing-setting' },
      { include: '#timing-player-line' },
    ],
  },

  /**
   * Lines with a time on a player (`WB@0 <-> @50`, `WU@+10 -> WB`) exist
   * only in timing diagrams, but other UML diagrams would read them as
   * links between elements named `WB@0`. They are meant to be tried
   * before the other diagram types.
   */
  'timing-first': {
    patterns: [
      // hide time-axis (otherwise read as hiding an element named time-axis)
      {
        match: re`(?i)${BOL}\s*(hide|manual)${SP}+(time.?axis)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      // WB@0 <-> @50 : {50 ms lag}
      {
        match: re`${BOL}\s*(${PLAYER})?(@${TIME})${SP}*(<-+${STYLE}-*>)${SP}*(@${TIME})${SP}*(?:(:)${SP}*(.*?))?${EOL}`,
        captures: {
          1: name,
          2: nested('#timing-at-time'),
          3: nested('#timing-arrow'),
          4: nested('#timing-at-time'),
          ...labelTail(5),
        },
      },
      message(true, false),
      message(false, true),
    ],
  },

  'timing-declaration': {
    patterns: [
      // [compact] robust|concise|rectangle ["Full" [<<s>>] as] CODE [<<s>>] [#color]
      {
        match: re`(?i)${BOL}\s*(?:(compact)${SP}+)?(robust|concise|rectangle)${SP}+(?:(${QUOTED})(${STEREO})(as)${SP}+)?(${CODE})(${STEREO})(${COLORS})?${SP}*$`,
        captures: {
          1: kw,
          2: type,
          3: nested('#string'),
          4: nested('#stereotype'),
          5: kw,
          6: name,
          7: nested('#stereotype'),
          8: named('constant.other.color'),
        },
      },
      // [compact] clock ["Full" as] CODE with period N [pulse N] [offset N]
      {
        match: re`(?i)${BOL}\s*(?:(compact)${SP}+)?(clock)${SP}+(?:(${QUOTED})${SP}+(as)${SP}+)?(${CODE})${SP}+(with)${SP}+(period)${SP}+([0-9]+(?:\.[0-9]+)?)(?:${SP}+(pulse)${SP}+([0-9]+(?:\.[0-9]+)?))?(?:${SP}+(offset)${SP}+([0-9]+(?:\.[0-9]+)?))?(${STEREO})$`,
        captures: {
          1: kw,
          2: type,
          3: nested('#string'),
          4: kw,
          5: name,
          6: kw,
          7: kw,
          8: named('constant.numeric'),
          9: kw,
          10: named('constant.numeric'),
          11: kw,
          12: named('constant.numeric'),
          13: nested('#stereotype'),
        },
      },
      // [compact] analog "Full" [<<s>>] [between|from N and|to N] as CODE [<<s>>]
      {
        match: re`(?i)${BOL}\s*(?:(compact)${SP}+)?(analog)${SP}+(${QUOTED})(${STEREO})(?:(between|from)${SP}+(${NUMBER})${SP}+(and|to)${SP}+(${NUMBER})${SP}+)?(as)${SP}+(${CODE})(${STEREO})$`,
        captures: {
          1: kw,
          2: type,
          3: nested('#string'),
          4: nested('#stereotype'),
          5: kw,
          6: named('constant.numeric'),
          7: kw,
          8: named('constant.numeric'),
          9: kw,
          10: name,
          11: nested('#stereotype'),
        },
      },
      // [compact] binary ["Full" [<<s>>] as] CODE [<<s>>]
      {
        match: re`(?i)${BOL}\s*(?:(compact)${SP}+)?(binary)${SP}+(?:(${QUOTED})(${STEREO})(as)${SP}+)?(${CODE})(${STEREO})$`,
        captures: {
          1: kw,
          2: type,
          3: nested('#string'),
          4: nested('#stereotype'),
          5: kw,
          6: name,
          7: nested('#stereotype'),
        },
      },
    ],
  },

  /** @100, @+50, @:start, @2026/10/01, @10:00:00, @clk*2, @0 as :start, @WU */
  'timing-mark': {
    patterns: [
      {
        match: re`${BOL}\s*(@)(${TIME})(?:${SP}+((?i:as))${SP}+(:)([\p{L}\p{N}_.]+))?${SP}*$`,
        captures: {
          1: named('keyword.operator.time'),
          2: timeCapture,
          3: kw,
          4: named('entity.name.label punctuation.definition.label'),
          5: named('entity.name.label'),
        },
      },
      // `@newpage` is a sequence page break, not a player.
      {
        match: re`${BOL}\s*(@)(?!(?i:newpage)\b)(${PLAYER})${SP}*$`,
        captures: { 1: named('keyword.operator.time'), 2: name },
      },
    ],
  },

  'timing-setting': {
    patterns: [
      // scale 100 as 50 pixels, scale 5 s as 10 pixels
      {
        match: re`(?i)${BOL}\s*(scale)${SP}+(\d+)(?:${SP}?([smhdy]))?${SP}+(as)${SP}+(\d+)${SP}+(pixels?)${SP}*$`,
        captures: {
          1: kw,
          2: named('constant.numeric'),
          3: named('constant.numeric.unit'),
          4: kw,
          5: named('constant.numeric'),
          6: kw,
        },
      },
      // highlight 200 to 450 #Gold : caption
      {
        match: re`(?i)${BOL}\s*(highlight)${SP}+(${TIME})${SP}+(to)${SP}+(${TIME})${SP}*(${COLORS})?${SP}*(?:(:)${SP}*(.*?))?${EOL}`,
        captures: {
          1: kw,
          2: timeCapture,
          3: kw,
          4: timeCapture,
          5: named('constant.other.color'),
          ...labelTail(6),
        },
      },
      { match: re`(?i)${BOL}\s*(mode)${SP}+(compact)${SP}*$`, captures: { 1: kw, 2: kw } },
      {
        match: re`(?i)${BOL}\s*(use)${SP}*(date)${SP}*(format)${SP}*(${QUOTED})${SP}*$`,
        captures: { 1: kw, 2: kw, 3: kw, 4: nested('#string') },
      },
    ],
  },

  /** Lines that start with a player or a time. */
  'timing-player-line': {
    patterns: [
      // WU is 100 pixels height
      {
        match: re`(?i)${BOL}\s*(${CODE})${SP}+(is)${SP}+(\d+)${SP}+(pixels?)${SP}+(height)${SP}*$`,
        captures: { 1: name, 2: kw, 3: named('constant.numeric'), 4: kw, 5: kw },
      },
      // WU ticks every 50, WU ticks num on multiple 10
      {
        match: re`(?i)${BOL}\s*(${CODE})${SP}+(ticks)${SP}+(every|num${SP}+on${SP}+multiple)${SP}+([0-9]+)${SP}*$`,
        captures: { 1: name, 2: kw, 3: kw, 4: named('constant.numeric') },
      },
      // WU has "Long label" as Short
      {
        match: re`(?i)${BOL}\s*(${CODE})${SP}+(has)${SP}+(${QUOTED})${SP}+(as)${SP}+(${CODE})${SP}*$`,
        captures: { 1: name, 2: kw, 3: nested('#string'), 4: kw, 5: named('constant.other.state') },
      },
      // WU has Idle,Waiting,Busy
      {
        match: re`(?i)${BOL}\s*(${CODE})${SP}+(has)${SP}+([-\p{L}\p{N}_.@]+(?:,[-\p{L}\p{N}_.@]+)*)${SP}*$`,
        captures: { 1: name, 2: kw, 3: nested('#timing-state-list') },
      },
      // WU is Idle #color : comment. The engine also accepts `WUisIdle`; a
      // space is required before `is` here so that a line of another UML
      // diagram with "is" inside a word is not taken for a state change.
      {
        match: re`(?i)${BOL}\s*(${PLAYER})${SP}+(is)(?:${SP}+|(?=${DQ}|\{))(${STATE})${SP}*(${COLORS})?${SP}*(?:(:)${SP}*(.*?))?${EOL}`,
        captures: { 1: name, 2: kw, 3: nested('#timing-state'), 4: named('constant.other.color'), ...labelTail(5) },
      },
      // 100 is Idle — a state change at a time, inside an @player block
      {
        match: re`(?i)${BOL}\s*(${TIME})${SP}*(is)(?:${SP}+|(?=${DQ}|\{))(${STATE})${SP}*(${COLORS})?${SP}*(?:(:)${SP}*(.*?))?${EOL}`,
        captures: {
          1: timeCapture,
          2: kw,
          3: nested('#timing-state'),
          4: named('constant.other.color'),
          ...labelTail(5),
        },
      },
      // WU -> WB : message (the timed forms are in timing-first)
      message(false, false),
    ],
  },

  'timing-time': {
    patterns: [
      {
        match: re`(:)([\p{L}\p{N}_.]+)([-+][.\d]+)?`,
        captures: {
          1: named('entity.name.label punctuation.definition.label'),
          2: named('entity.name.label'),
          3: named('constant.numeric'),
        },
      },
      {
        match: re`([\p{L}\p{N}_.@]+)(\*)(\d+)`,
        captures: { 1: name, 2: named('keyword.operator'), 3: named('constant.numeric') },
      },
      { name: scope('constant.numeric'), match: re`[-+]?[\d./:]+` },
    ],
  },

  'timing-at-time': {
    patterns: [{ match: re`(@)(.*)`, captures: { 1: named('keyword.operator.time'), 2: timeCapture } }],
  },

  'timing-arrow': {
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

  'timing-state': {
    patterns: [
      { name: scope('keyword.other.state'), match: re`\{(?:hidden|\.\.\.|-|\?)\}` },
      {
        match: re`(\{)([^,{}]+)(,)([^,{}]+)(\})`,
        captures: {
          1: named('punctuation.section.braces.begin'),
          2: named('constant.other.state'),
          3: named('punctuation.separator.comma'),
          4: named('constant.other.state'),
          5: named('punctuation.section.braces.end'),
        },
      },
      {
        name: scope('string.quoted.double'),
        match: re`(${DQ})(${NOT_DQ}*)(${DQ})`,
        captures: {
          1: named('punctuation.definition.string.begin'),
          2: nested('#label'),
          3: named('punctuation.definition.string.end'),
        },
      },
      { name: scope('constant.other.state'), match: STATE_CODE },
    ],
  },

  'timing-state-list': {
    patterns: [
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('constant.other.state'), match: re`[^,]+` },
    ],
  },
};
