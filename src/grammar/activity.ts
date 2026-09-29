/**
 * Activity diagrams, both syntaxes the engine accepts inside @startuml:
 *
 * - the current one (ActivityDiagramFactory3): actions `:text;`, if / elseif
 *   / else / endif, while, repeat, switch, fork, split, swimlanes,
 *   partitions, arrows `-> label;`, backward, goto / label, connectors;
 * - the legacy one (ActivityDiagramFactory): links between `(*)`, quoted
 *   activities and synchronisation bars, `if "…" then`, partitions.
 *
 * In this engine an action ends with `;` only: the old endings `|`, `<`,
 * `>`, `/`, `]`, `}` are syntax errors, and the box shape is chosen with a
 * stereotype after the `;` (`:read; <<input>>`).
 *
 * These rules run before the sequence diagram ones, so they leave alone
 * the lines a sequence diagram reads differently: a legacy link target
 * never contains a colon (`Alice -> Bob : hello` is a message), `group`
 * without `{` is a sequence group, `hide unlinked` is a sequence command.
 */

import { COLOR, COLORS } from './common';
import { BOL, DQ, EOL, NOT_DQ, SP, endOr, include, named, nested, re, scope, type Captures, type Rule } from './rules';
import { LINE_STYLE } from './sequence';

const control = named('keyword.control');
const kw = named('keyword.other');
const parenBegin = named('punctuation.section.parens.begin');
const parenEnd = named('punctuation.section.parens.end');
const actionBegin = named('punctuation.definition.action.begin');
const actionEnd = named('punctuation.definition.action.end');

/** `#color:` in front of if, while, repeat, switch and connectors. */
const COLOR_PREFIX = re`(?:(${COLOR})(:))?`;
/** Box styles after an action or a keyword: <<input>>, <<output>>, <<procedure>> … */
const STEREOGROUP = re`<<[^<>]+>>(?:${SP}*<<[^<>]+>>)*`;
const URL = re`\[\[.*?\]\]`;
/** Arrows of the current syntax: -> or -[#red,dashed;#blue]-> */
const ARROW3 = re`->|-\[(?:${LINE_STYLE}(?:;${LINE_STYLE})*)?\]->`;
/** Names of goto targets and labels. */
const CODE = re`[\p{L}\p{N}_.]+`;

/** The last line of an action on several lines (CommandActivityLong3). */
const ACTION_END = re`${BOL}(.*)(;)${SP}*(${STEREOGROUP})?${SP}*(${URL})?${EOL}`;
const ACTION_END_CAPTURES: Captures = {
  1: nested('#label'),
  2: actionEnd,
  3: nested('#stereotype'),
  4: nested('#creole-inline'),
};

/** `(text)`: a condition, a branch label, an incoming arrow label. */
function parens(first: number): Record<number, Rule> {
  return { [first]: parenBegin, [first + 1]: nested('#label'), [first + 2]: parenEnd };
}

// --- legacy syntax -------------------------------------------------------------

const L_STAR = re`\(\*(?:top|\d+)?\)`;
const L_CODE = re`[\p{L}\p{N}][\p{L}\p{N}_.]*`;
const L_BAR = re`==+${SP}*[\p{L}\p{N}_.]+${SP}*==+`;
const L_QUOTED = re`${DQ}${NOT_DQ}+${DQ}(?:${SP}+(?i:as)${SP}+[\p{L}\p{N}_.]+)?`;
const L_SOURCE = re`(?:${L_STAR}|${L_BAR}|${L_QUOTED}|${L_CODE})`;
/**
 * A target may also be unquoted text (`--> Next step`) or `{`. Text that
 * reads as something else is left to the other rules: a state transition
 * (`-->o Next`, `--> Next[H]`), a message (`: text`), an arrow label of the
 * current syntax (`-> label;`).
 */
const L_TARGET = re`(?:${L_STAR}|\{|${L_BAR}|${L_QUOTED}|(?!o${SP})\w[^:\[\n]*?(?<!;))`;
const L_DIRECTION = re`(?:\*|(?i:left|right|up|down|le?|ri?|up?|do?))`;
const L_ARROW = re`[-.]+(?:\[${LINE_STYLE}\])?${L_DIRECTION}?(?:\[${LINE_STYLE}\])?[-.]*>`;
/** `[label]` right after a legacy arrow. */
const L_BRACKET = re`\[[^\]*]+[^\]]*\]`;

/**
 * Where a multi-line arrow label (`-> text` without `;`) stops besides its
 * `;`: a line that starts another command or holds a legacy link. The
 * legacy syntax reads `-> text` as a link to an activity named `text`, so
 * in a legacy diagram the label ends on the same line.
 */
const ACTIVITY_LINE_AHEAD = re`(?=${BOL}\s*(?:[:|}(]|${DQ}|==|->|-\[|(?i:if|else|elseif|endif|end|while|endwhile|repeat|fork|split|start|stop|kill|detach|break|note|floating|partition|group|package|rectangle|card|swimlane|switch|case|endswitch|backward|label|goto|link)\b)|${BOL}[^;]*[-.]>)`;

export const activityRepository: Record<string, Rule> = {
  activity: {
    patterns: [
      include('activity-swimlane'),
      include('activity-partition'),
      include('activity-arrow'),
      include('activity-arrow-long'),
      include('activity-legacy-link'),
      include('activity-control'),
      include('activity-action'),
      include('activity-legacy-control'),
      include('activity-list'),
    ],
  },

  /** |Lane|, |#color|Lane| label, swimlane Lane as label */
  'activity-swimlane': {
    patterns: [
      {
        match: re`${BOL}\s*(\|)(?:(${COLORS})(\|))?([^|]+)(\|)([^|]+)?${SP}*$`,
        captures: {
          1: named('punctuation.separator.swimlane'),
          2: named('constant.other.color'),
          3: named('punctuation.separator.swimlane'),
          4: named('entity.name.type'),
          5: named('punctuation.separator.swimlane'),
          6: nested('#label'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(swimlane)${SP}+(${COLORS})?${SP}*([^|]+?)(?:${SP}+(as)${SP}+([^|]+?))?${SP}*$`,
        captures: {
          1: named('storage.type'),
          2: named('constant.other.color'),
          3: named('entity.name.type'),
          4: kw,
          5: nested('#label'),
        },
      },
    ],
  },

  /**
   * partition / package / rectangle / card / group, opened with `{` and
   * closed by `}` / `end group` / `end partition`. A `group` without `{`
   * is left to the sequence diagram rules (`group label [secondary]`).
   */
  'activity-partition': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(partition|package|rectangle|card|group)${SP}+(?:(${COLORS})${SP}+)?(${DQ}${NOT_DQ}+${DQ}|.*?)(?:${SP}+(${COLORS}))?(${SP}*${STEREOGROUP})?${SP}*(\{)${SP}*$`,
        captures: {
          1: control,
          2: named('constant.other.color'),
          3: nested('#string', '#activity-name'),
          4: named('constant.other.color'),
          5: nested('#stereotype'),
          6: named('punctuation.section.block.begin'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(partition|package|rectangle|card)${SP}+(?:(${COLORS})${SP}+)?(${DQ}${NOT_DQ}+${DQ}|.*?)(?:${SP}+(${COLORS}))?(${SP}*${STEREOGROUP})?${SP}*$`,
        captures: {
          1: control,
          2: named('constant.other.color'),
          3: nested('#string', '#activity-name'),
          4: named('constant.other.color'),
          5: nested('#stereotype'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(end${SP}?group|group${SP}?end|end${SP}*partition)(;)?${SP}*$`,
        captures: { 1: control, 2: actionEnd },
      },
      { match: re`${BOL}\s*(\})${SP}*$`, captures: { 1: named('punctuation.section.block.end') } },
    ],
  },

  'activity-name': {
    patterns: [include('label'), { name: scope('entity.name.type'), match: re`\S+(?:${SP}+\S+)*` }],
  },

  /** -> and -[style]-> with an optional `label;` (CommandArrow3). */
  'activity-arrow': {
    match: re`${BOL}\s*(${ARROW3})${SP}*(?:(.*)(;))?${SP}*$`,
    captures: {
      1: nested('#activity-arrow-body'),
      2: nested('#label'),
      3: actionEnd,
    },
  },

  /** An arrow label on several lines, up to the line ending with `;`. */
  'activity-arrow-long': {
    begin: re`${BOL}\s*(${ARROW3})${SP}*(?!${DQ}|\(\*|==|\{|\[)(.*[^;\s])${SP}*$`,
    end: endOr(re`${BOL}(.*)(;)${SP}*$|${ACTIVITY_LINE_AHEAD}`),
    beginCaptures: { 1: nested('#activity-arrow-body'), 2: nested('#label') },
    endCaptures: { 1: nested('#label'), 2: actionEnd },
    patterns: [include('comment'), include('preprocessor'), include('label')],
  },

  'activity-arrow-body': {
    patterns: [
      {
        match: re`(\[)((?:${LINE_STYLE})(?:;${LINE_STYLE})*)?(\])`,
        captures: {
          1: named('keyword.operator.arrow punctuation.definition.style.begin'),
          2: { patterns: [{ name: scope('punctuation.separator'), match: ';' }, include('line-style')] },
          3: named('keyword.operator.arrow punctuation.definition.style.end'),
        },
      },
      { name: scope('keyword.operator.arrow'), match: re`[^\[\]\s]+` },
    ],
  },

  /**
   * :action; — on one line, or on several up to the line ending with `;`.
   * `:name:` is a use case actor, not the start of an action.
   *
   * Two older forms still render, with a warning in the diagram, and are
   * marked deprecated: a stereotype in front of a one-line action, and a
   * colour in front of the `:`. The engine ignores both. It reads the
   * colour form only as the start of an action on several lines, so its
   * first line never ends the action, even when it ends with `;`.
   */
  'activity-action': {
    patterns: [
      {
        name: scope('meta.action'),
        match: re`${BOL}\s*(?:(<<.+?>>)${SP}*)?(:)(.*?)(;)${SP}*(${STEREOGROUP})?${SP}*(${URL})?${EOL}`,
        captures: {
          1: named('entity.name.tag.stereotype invalid.deprecated'),
          2: actionBegin,
          3: nested('#label'),
          4: actionEnd,
          5: nested('#stereotype'),
          6: nested('#creole-inline'),
        },
      },
      {
        name: scope('meta.action'),
        begin: re`${BOL}\s*(${COLORS})(:)(.*)$`,
        end: endOr(ACTION_END),
        beginCaptures: {
          1: named('constant.other.color invalid.deprecated'),
          2: actionBegin,
          3: nested('#label'),
        },
        endCaptures: ACTION_END_CAPTURES,
        patterns: [include('comment'), include('preprocessor'), include('creole-line'), include('label')],
      },
      {
        name: scope('meta.action'),
        begin: re`${BOL}\s*(:)(?![^:;]*:(?:${SP}|$))(.*)$`,
        end: endOr(ACTION_END),
        beginCaptures: { 1: actionBegin, 2: nested('#label') },
        endCaptures: ACTION_END_CAPTURES,
        patterns: [include('comment'), include('preprocessor'), include('creole-line'), include('label')],
      },
    ],
  },

  'activity-control': {
    patterns: [
      // #color:if (test) is (value) then
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}(if)${SP}*(\()(.*?)(\))${SP}*(is|equals?)${SP}*(\()(.+?)(\))${SP}*(then)${SP}*(;)?${SP}*(${STEREOGROUP})?${EOL}`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: control,
          ...parens(4),
          7: control,
          ...parens(8),
          11: control,
          12: actionEnd,
          13: nested('#stereotype'),
        },
      },
      // [[url]] #color:if <<stereo>> (test) then (yes)
      {
        match: re`(?i)${BOL}\s*(${URL})?${SP}*${COLOR_PREFIX}(if)(${SP}*<<.+?>>${SP}*)?${SP}*(\()(.*?)(\))${SP}*(?:(then)${SP}*(?:(\()(.+?)(\)))?)?${SP}*(;)?${SP}*(${STEREOGROUP})?${EOL}`,
        captures: {
          1: nested('#creole-inline'),
          2: named('constant.other.color'),
          3: named('punctuation.separator'),
          4: control,
          5: nested('#stereotype'),
          ...parens(6),
          9: control,
          ...parens(10),
          13: actionEnd,
          14: nested('#stereotype'),
        },
      },
      // if (test) then when value — the oldest form
      {
        match: re`(?i)${BOL}\s*(if)${SP}*(\()(.+?)(\))${SP}*(then)${SP}+(when)${SP}+(.*?)(;)?${EOL}`,
        captures: { 1: control, ...parens(2), 5: control, 6: control, 7: nested('#label'), 8: actionEnd },
      },
      // if spanning several lines: the condition closes on a later line.
      {
        begin: re`(?i)${BOL}\s*(${URL})?${SP}*${COLOR_PREFIX}(if)(${SP}*<<.+?>>${SP}*)?${SP}*(\()(.*)$`,
        end: endOr(
          re`(?i)${BOL}(.*?)(\))${SP}*(?:(then)${SP}*(?:(\()(.+?)(\)))?)?${SP}*(;)?${SP}*(${STEREOGROUP})?${SP}*$`
        ),
        beginCaptures: {
          1: nested('#creole-inline'),
          2: named('constant.other.color'),
          3: named('punctuation.separator'),
          4: control,
          5: nested('#stereotype'),
          6: parenBegin,
          7: nested('#label'),
        },
        endCaptures: {
          1: nested('#label'),
          2: parenEnd,
          3: control,
          ...parens(4),
          7: actionEnd,
          8: nested('#stereotype'),
        },
        patterns: [include('comment'), include('label')],
      },
      // (incoming) elseif (test) is (value) then (->)
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*(else)${SP}*(if)${SP}*(\()(.*?)(\))${SP}*(is|equals?)${SP}*(\()(.+?)(\))${SP}*(?:(then)${SP}*(?:(\()(${ARROW3})?(\)))?)?${SP}*(;)?${EOL}`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: parenBegin,
          4: nested('#activity-arrow-body'),
          5: nested('#label'),
          6: parenEnd,
          7: control,
          8: control,
          ...parens(9),
          12: control,
          ...parens(13),
          16: control,
          17: parenBegin,
          18: nested('#activity-arrow-body'),
          19: parenEnd,
          20: actionEnd,
        },
      },
      // (incoming) elseif (test) then (label)
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*(else)${SP}*(if)${SP}*(\()(.*?)(\))${SP}*(?:(then)${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?)?${SP}*(;)?${SP}*(${STEREOGROUP})?${EOL}`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: parenBegin,
          4: nested('#activity-arrow-body'),
          5: nested('#label'),
          6: parenEnd,
          7: control,
          8: control,
          ...parens(9),
          12: control,
          13: parenBegin,
          14: nested('#activity-arrow-body'),
          15: nested('#label'),
          16: parenEnd,
          17: actionEnd,
          18: nested('#stereotype'),
        },
      },
      // elseif spanning several lines
      {
        begin: re`(?i)${BOL}\s*${COLOR_PREFIX}${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*(else)${SP}*(if)${SP}*(\()(.*)$`,
        end: endOr(
          re`(?i)${BOL}(.*?)(\))${SP}*(?:(then)${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?)?${SP}*(;)?${SP}*(${STEREOGROUP})?${SP}*$`
        ),
        beginCaptures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: parenBegin,
          4: nested('#activity-arrow-body'),
          5: nested('#label'),
          6: parenEnd,
          7: control,
          8: control,
          9: parenBegin,
          10: nested('#label'),
        },
        endCaptures: {
          1: nested('#label'),
          2: parenEnd,
          3: control,
          4: parenBegin,
          5: nested('#activity-arrow-body'),
          6: nested('#label'),
          7: parenEnd,
          8: actionEnd,
          9: nested('#stereotype'),
        },
        patterns: [include('comment'), include('label')],
      },
      // else when value — the oldest form
      {
        match: re`(?i)${BOL}\s*(else)${SP}+(when)${SP}+(.*?)(;)?${EOL}`,
        captures: { 1: control, 2: control, 3: nested('#label'), 4: actionEnd },
      },
      // else, else (label), else (-> label)
      {
        match: re`(?i)${BOL}\s*(else)${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*(;)?${SP}*$`,
        captures: {
          1: control,
          2: parenBegin,
          3: nested('#activity-arrow-body'),
          4: nested('#label'),
          5: parenEnd,
          6: actionEnd,
        },
      },
      // else ( label spanning several lines )
      {
        begin: re`(?i)${BOL}\s*(else)${SP}*(\()(${ARROW3})?(.*)$`,
        end: endOr(re`${BOL}(.*?)(\))${SP}*(;)?${SP}*$`),
        beginCaptures: {
          1: control,
          2: parenBegin,
          3: nested('#activity-arrow-body'),
          4: nested('#label'),
        },
        endCaptures: { 1: nested('#label'), 2: parenEnd, 3: actionEnd },
        patterns: [include('comment'), include('label')],
      },
      {
        match: re`(?i)${BOL}\s*(end${SP}*if)(;)?${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: { 1: control, 2: actionEnd, 3: nested('#stereotype') },
      },
      // switch (test) / case (value) / endswitch
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}(switch)${SP}*(\()(.*?)(\))${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: control,
          ...parens(4),
          7: nested('#stereotype'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(case)${SP}*(\()(.*?)(\))${SP}*$`,
        captures: { 1: control, ...parens(2) },
      },
      {
        match: re`(?i)${BOL}\s*(endswitch)${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: { 1: control, 2: nested('#stereotype') },
      },
      // repeat, repeat :label;
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}(repeat)${SP}*(?:(:)(.*?)(;)${SP}*)?(${STEREOGROUP})?${SP}*$`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: control,
          4: actionBegin,
          5: nested('#label'),
          6: actionEnd,
          7: nested('#stereotype'),
        },
      },
      // repeat while (test) is (yes) not (no) -> label; — the engine keeps
      // the `;` in the label when there is one
      {
        match: re`(?i)${BOL}\s*(repeat)${SP}*(while)${SP}*(?:(\()(.*?)(\))(?:${SP}*(is|equals?)${SP}*(\()(.+?)(\)))?(?:${SP}*(not)${SP}*(\()(.+?)(\)))?)?${SP}*(?:(${ARROW3})${SP}*(.*))?(;)?${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: {
          1: control,
          2: control,
          ...parens(3),
          6: control,
          ...parens(7),
          10: control,
          ...parens(11),
          14: nested('#activity-arrow-body'),
          15: nested('#label'),
          16: actionEnd,
          17: nested('#stereotype'),
        },
      },
      // repeat while (test spanning
      //   several lines);
      {
        begin: re`(?i)${BOL}\s*(repeat)${SP}*(while)${SP}*(\()(.*)$`,
        end: endOr(re`${BOL}(.*)(\))(;)?${SP}*$`),
        beginCaptures: { 1: control, 2: control, 3: parenBegin, 4: nested('#label') },
        endCaptures: { 1: nested('#label'), 2: parenEnd, 3: actionEnd },
        patterns: [include('comment'), include('label')],
      },
      // (incoming) backward :label; (outgoing), and its multi-line form
      {
        match: re`(?i)${BOL}\s*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*(backward)${SP}*(:)(.*?)(;)${SP}*(${STEREOGROUP})?${SP}*(?:(\()(${ARROW3})?(.*?)(\)))?${SP}*$`,
        captures: {
          1: parenBegin,
          2: nested('#activity-arrow-body'),
          3: nested('#label'),
          4: parenEnd,
          5: control,
          6: actionBegin,
          7: nested('#label'),
          8: actionEnd,
          9: nested('#stereotype'),
          10: parenBegin,
          11: nested('#activity-arrow-body'),
          12: nested('#label'),
          13: parenEnd,
        },
      },
      {
        begin: re`(?i)${BOL}\s*(backward)${SP}*(:)${SP}*(.*)$`,
        end: endOr(re`${BOL}(.*)(;)${SP}*(${STEREOGROUP})?${SP}*$`),
        beginCaptures: { 1: control, 2: actionBegin, 3: nested('#label') },
        endCaptures: { 1: nested('#label'), 2: actionEnd, 3: nested('#stereotype') },
        patterns: [include('comment'), include('label')],
      },
      // while (test) is (yes) / endwhile (no) / while end
      {
        match: re`(?i)${BOL}\s*${COLOR_PREFIX}(while)${SP}*(\()(.*?)(\))(?:${SP}*(is|equals?)${SP}*(\()(.+?)(\)))?(;)?${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: control,
          ...parens(4),
          7: control,
          ...parens(8),
          11: actionEnd,
          12: nested('#stereotype'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(end${SP}*while|while${SP}*end)${SP}*(?:(\()(.+?)(\)))?(;)?${SP}*$`,
        captures: { 1: control, ...parens(2), 5: actionEnd },
      },
      // fork again / end fork {and} / end merge, split again / end split
      {
        match: re`(?i)${BOL}\s*(fork${SP}*again|split${SP}*again|end${SP}*fork|fork${SP}*end|end${SP}*merge|end${SP}*split|split${SP}*end)${SP}*(\{.+\})?(;)?${SP}*$`,
        captures: { 1: control, 2: named('constant.other.join-specification'), 3: actionEnd },
      },
      {
        match: re`(?i)${BOL}\s*(fork|split)(;)?${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: { 1: control, 2: actionEnd, 3: nested('#stereotype') },
      },
      // start / stop / end (with a box style), kill / detach / break
      {
        match: re`(?i)${BOL}\s*(start|stop|end)(;)?${SP}*(${STEREOGROUP})?${SP}*$`,
        captures: { 1: control, 2: actionEnd, 3: nested('#stereotype') },
      },
      {
        match: re`(?i)${BOL}\s*(kill|detach|break)(;)?${SP}*$`,
        captures: { 1: control, 2: actionEnd },
      },
      // (A): a connector, optionally #color:(A)
      {
        match: re`${BOL}\s*${COLOR_PREFIX}(\()(\S)(\))(;)?${SP}*$`,
        captures: {
          1: named('constant.other.color'),
          2: named('punctuation.separator'),
          3: named('punctuation.definition.connector.begin'),
          4: named('constant.character.connector'),
          5: named('punctuation.definition.connector.end'),
          6: actionEnd,
        },
      },
      // link #color: the colour of the next arrow
      {
        match: re`(?i)${BOL}\s*(link)${SP}+(#\w+)(;)?${SP}*$`,
        captures: { 1: kw, 2: named('constant.other.color'), 3: actionEnd },
      },
      // label name / goto name
      {
        match: re`(?i)${BOL}\s*(label|goto)${SP}+(${CODE})(;)?${SP}*$`,
        captures: { 1: control, 2: named('entity.name.label'), 3: actionEnd },
      },
    ],
  },

  /** An activity list: `- step` or `* step`, one activity per line. */
  'activity-list': {
    match: re`${BOL}\s*([-*])${SP}?(?![-*]*${SP}*$)(.*?)${SP}*(${STEREOGROUP})?${SP}*(${URL})?${EOL}`,
    captures: {
      1: named('punctuation.definition.list.begin'),
      2: nested('#label'),
      3: nested('#stereotype'),
      4: nested('#creole-inline'),
    },
  },

  // --- legacy syntax -------------------------------------------------------------

  /**
   * The legacy syntax alone. The engine tries it before description
   * diagrams (and the current syntax after them), so this can be placed
   * ahead of the description rules: it does not take lines of the current
   * syntax.
   */
  'activity-legacy': {
    patterns: [include('activity-legacy-link'), include('activity-legacy-control')],
  },

  /** "A" --> "B", (*) -> Next, ===B1=== --> (*), with labels, directions, partitions. */
  'activity-legacy-link': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(${L_SOURCE})?(${SP}*<<.+?>>)?${SP}*(#\w+)?${SP}*(${URL})?(${L_ARROW})${SP}*(${L_BRACKET})?${SP}*(${L_TARGET})(${SP}*<<.+?>>)?(?:${SP}+(in)${SP}+(${DQ}${NOT_DQ}+${DQ}|\S+))?${SP}*(#\w+)?${SP}*$`,
        captures: {
          1: nested('#activity-legacy-endpoint'),
          2: nested('#stereotype'),
          3: named('constant.other.color'),
          4: nested('#creole-inline'),
          5: nested('#activity-arrow-body'),
          6: nested('#activity-bracket-label'),
          7: nested('#activity-legacy-endpoint'),
          8: nested('#stereotype'),
          9: kw,
          10: nested('#string', '#activity-name'),
          11: named('constant.other.color'),
        },
      },
      // --> "a description on
      //      several lines" as Code
      {
        begin: re`(?i)${BOL}\s*(${L_SOURCE})?(${SP}*<<.+?>>)?${SP}*(#\w+)?${SP}*(${URL})?(${L_ARROW})${SP}*(${L_BRACKET})?${SP}*(${DQ})([^"\x{201C}\x{201D}]*)$`,
        end: endOr(
          re`(?i)${BOL}\s*([^"\x{201C}\x{201D}]*)(${DQ})(?:${SP}+(as)${SP}+([\p{L}\p{N}][\p{L}\p{N}_.]*))?${SP}*(<<.*>>)?${SP}*(?:(in)${SP}+(${DQ}${NOT_DQ}+${DQ}|\S+))?${SP}*(#\w+)?${SP}*$`
        ),
        beginCaptures: {
          1: nested('#activity-legacy-endpoint'),
          2: nested('#stereotype'),
          3: named('constant.other.color'),
          4: nested('#creole-inline'),
          5: nested('#activity-arrow-body'),
          6: nested('#activity-bracket-label'),
          7: named('string.quoted.double punctuation.definition.string.begin'),
          8: { name: scope('string.quoted.double'), patterns: [include('label')] },
        },
        endCaptures: {
          1: { name: scope('string.quoted.double'), patterns: [include('label')] },
          2: named('string.quoted.double punctuation.definition.string.end'),
          3: kw,
          4: named('entity.name.type'),
          5: nested('#stereotype'),
          6: kw,
          7: nested('#string', '#activity-name'),
          8: named('constant.other.color'),
        },
        contentName: scope('string.quoted.double'),
        patterns: [include('label')],
      },
    ],
  },

  'activity-legacy-endpoint': {
    patterns: [
      {
        match: re`(?i)(\()(\*)(top|\d+)?(\))`,
        captures: {
          0: named('constant.language.initial-final'),
          1: named('punctuation.definition.node.begin'),
          4: named('punctuation.definition.node.end'),
        },
      },
      {
        match: re`(==+)${SP}*([\p{L}\p{N}_.]+)${SP}*(==+)`,
        captures: {
          1: named('punctuation.definition.bar'),
          2: named('entity.name.type'),
          3: named('punctuation.definition.bar'),
        },
      },
      {
        match: re`(${DQ})(${NOT_DQ}+)(${DQ})(?:${SP}+((?i:as))${SP}+([\p{L}\p{N}_.]+))?`,
        captures: {
          1: named('string.quoted.double punctuation.definition.string.begin'),
          2: { name: scope('string.quoted.double'), patterns: [include('label')] },
          3: named('string.quoted.double punctuation.definition.string.end'),
          4: kw,
          5: named('entity.name.type'),
        },
      },
      { name: scope('punctuation.section.block.begin'), match: re`\{` },
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: re`\S+(?:${SP}+\S+)*` },
    ],
  },

  'activity-bracket-label': {
    match: re`(\[)(.*)(\])`,
    captures: {
      1: named('punctuation.section.brackets.begin'),
      2: nested('#label'),
      3: named('punctuation.section.brackets.end'),
    },
  },

  'activity-legacy-control': {
    patterns: [
      // [(*)|"A"|===B===|Code] [--> [label]] if "test" [as X] then — a test
      // in parentheses is the current syntax
      {
        match: re`(?i)${BOL}\s*(${L_STAR}|${L_BAR}|${L_QUOTED}|${L_CODE})?${SP}*(${L_ARROW})?${SP}*(${L_BRACKET})?${SP}*(if)(?:${SP}*(${DQ})(${NOT_DQ}*)(${DQ})(?:${SP}*(as)${SP}+([\p{L}\p{N}_.]+))?|${SP}+(?!\()(.+?))(?:${SP}+(then))?${SP}*$`,
        captures: {
          1: nested('#activity-legacy-endpoint'),
          2: nested('#activity-arrow-body'),
          3: nested('#activity-bracket-label'),
          4: control,
          5: named('string.quoted.double punctuation.definition.string.begin'),
          6: { name: scope('string.quoted.double'), patterns: [include('label')] },
          7: named('string.quoted.double punctuation.definition.string.end'),
          8: kw,
          9: named('entity.name.type'),
          10: nested('#label'),
          11: control,
        },
      },
      // partition Name [#color] [<<stereo>>] [{] … end partition
      {
        match: re`(?i)${BOL}\s*(partition)${SP}+(${DQ}${NOT_DQ}+${DQ}|\S+)${SP}*(${COLORS})?(${SP}*<<.+?>>)?${SP}*(\{)?${SP}*$`,
        captures: {
          1: control,
          2: nested('#string', '#activity-name'),
          3: named('constant.other.color'),
          4: nested('#stereotype'),
          5: named('punctuation.section.block.begin'),
        },
      },
      // left to right direction / top to bottom direction
      {
        match: re`(?i)${BOL}\s*(left to right|top to bottom)${SP}+(direction)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      // hide-class / show-class <name>, hide / show <<stereotype>>
      {
        match: re`(?i)${BOL}\s*(?:(hide-class|show-class)${SP}+(<<[^<>]*>>|\S+)|(hide|show)${SP}+(<<[^<>]*>>))${SP}*$`,
        captures: {
          1: kw,
          2: nested('#stereotype', '#activity-name'),
          3: kw,
          4: nested('#stereotype'),
        },
      },
    ],
  },
};
