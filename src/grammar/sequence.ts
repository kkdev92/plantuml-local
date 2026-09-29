/**
 * Sequence diagrams (SequenceDiagramFactory): participants, messages,
 * activations, groups, boxes, references, dividers, delays, spacing,
 * autonumbering, page breaks and the teoz extras (parallel `&`, anchors).
 */

import { COLORS } from './common';
import { BOL, DQ, EOL, NOT_DQ, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';

const kw = named('keyword.other');
const control = named('keyword.control');

/** A participant code, or a quoted display name. */
const CODE = re`[\p{L}\p{N}_.@]+`;
const QUOTED = re`${DQ}${NOT_DQ}+${DQ}`;
const WHO = re`(?:${CODE}|${QUOTED})`;
/** `"Long name" as code`, `code as "Long name"`, `"Long name"`, `code`. */
const PART = re`(?:${QUOTED}${SP}*(?i:as)${SP}+${CODE}|${CODE}${SP}+(?i:as)${SP}*${QUOTED}|${QUOTED}|${CODE})`;
const ANCHOR = re`(?:\{[\p{L}\p{N}_]+\}${SP}+)?`;

/**
 * Line styles inside an arrow: -[#red,dashed]->. Like every keyword of a
 * command, in any case: the engine compiles command patterns with
 * CASE_INSENSITIVE (Pattern2 upstream).
 */
const LINE_STYLE_KEY = re`(?i:dotted|dashed|plain|bold|hidden|norank|single|node|thickness=\d+)`;
export const LINE_STYLE = re`(?:#\w+|${LINE_STYLE_KEY})(?:,#\w+|,(?:${LINE_STYLE_KEY}))*`;
const STYLE = re`(?:\[${LINE_STYLE}\])?`;

/** Arrow heads and bodies (CommandArrow). */
const DRESSING1 = re`(?:${SP}[ox]|(?:${SP}[ox]|\(\d+\))?<<?_?|(?:${SP}[ox])?//?|(?:${SP}[ox])?\\\\?)`;
const BODY = re`(?:-+${STYLE}-*|-*${STYLE}-+)`;
const DRESSING2 = re`(?:_?>>?(?:[ox](?=${SP})|\(\d+\))?|//?(?:[ox](?=${SP}))?|\\\\?(?:[ox](?=${SP}))?|[ox](?=${SP}))`;
const ARROW = re`${DRESSING1}?${BODY}${DRESSING2}?`;

/** Arrows from or to the edge of the diagram: [-> A, A ->], ?-> A, A ->? */
const EXO_BODY = re`(?:(?:<<?|//?|\\\\?)?-+${STYLE}-*(?:>>?|//?|\\\\?)|(?:<<?|//?|\\\\?)-*${STYLE}-+)`;

/**
 * What may follow the target of a message: activation, lifeline colour,
 * stereotype, link, `: message`. Anything else means the line is not this
 * command (`A ->o] : x` is an arrow to the edge, not a message to `o`).
 */
const TAIL = re`${SP}*(?:\+\+--|--\+\+|\+\+|\*\*|!!|--)?${SP}*(?:#\w+)?(?:${SP}*<<.+?>>)?${SP}*(?:\[\[.*?\]\])?${SP}*(?::.*)?`;
const EXO_TAIL = re`${SP}*(?:[+*!-]+)?${SP}*(?:#\w+)?${SP}*(?:\[\[.*?\]\])?${SP}*(?::.*)?`;

const arrowTail: Rule = {
  patterns: [
    include('comment-inline'),
    {
      match: re`(:)${SP}*(.*)$`,
      captures: { 1: named('punctuation.separator.label'), 2: nested('#label') },
    },
    { name: scope('keyword.operator.activation'), match: re`\+\+--|--\+\+|\+\+|\*\*|!!|--|[+*!-]+` },
    include('color'),
    include('stereotype'),
    { include: '#creole-inline' },
    { name: scope('keyword.operator.parallel'), match: re`&` },
    { name: scope('entity.name.type'), match: CODE },
  ],
};

export const sequenceRepository: Record<string, Rule> = {
  sequence: {
    patterns: [
      include('sequence-participant'),
      include('sequence-arrow'),
      include('sequence-group'),
      include('sequence-misc'),
    ],
  },

  'sequence-participant': {
    patterns: [
      // participant code … [ multi-line display ]
      {
        begin: re`(?i)${BOL}\s*(participant)${SP}+(${CODE})(.*?)(\[)${SP}*$`,
        end: endOr(re`${BOL}([^\[\]]*)(\])${SP}*$`),
        beginCaptures: {
          1: named('storage.type'),
          2: named('entity.name.type'),
          3: nested('#sequence-participant-rest'),
          4: named('punctuation.section.brackets.begin'),
        },
        endCaptures: { 1: nested('#label'), 2: named('punctuation.section.brackets.end') },
        patterns: [include('text-block')],
      },
      {
        match: re`(?i)${BOL}\s*(?:(create)${SP}+)?(participant|actor|boundary|control|entity|queue|database|collections|create)${SP}+(.*?)${EOL}`,
        captures: {
          1: named('storage.type'),
          2: named('storage.type'),
          3: nested('#sequence-participant-rest'),
        },
      },
    ],
  },

  'sequence-participant-rest': {
    patterns: [
      include('comment-inline'),
      { match: re`(?i)(?<![\w.@])(as)(?![\w.@])`, captures: { 1: kw } },
      {
        match: re`(?i)(?<![\w.@])(order)${SP}+(-?\d{1,7})`,
        captures: { 1: kw, 2: named('constant.numeric') },
      },
      include('stereotype'),
      include('color'),
      { include: '#creole-inline' },
      {
        name: scope('string.quoted.double'),
        match: re`(${DQ})(${NOT_DQ}+)(${DQ})`,
        captures: {
          1: named('punctuation.definition.string.begin'),
          2: { name: scope('entity.name.type'), patterns: [include('label')] },
          3: named('punctuation.definition.string.end'),
        },
      },
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: CODE },
    ],
  },

  /**
   * Messages from or to the edge: `[-> A`, `A ->]`, and without the edge
   * mark `-> A`, `A ->` (CommandExoArrowLeft / Right). Also tried before the
   * activity rules: an arrow and a single name, alone or with `: message`,
   * is a message, where an activity arrow label ends with `;`.
   */
  'sequence-exo-arrow': {
    patterns: [
      // [-> A, ?-> A, -> A
      {
        match: re`${BOL}\s*(&${SP}*)?(${ANCHOR})((?:[?\[\]][ox]?)?)(${EXO_BODY})([ox]${SP}+)?${SP}*(${WHO})(${EXO_TAIL})${EOL}`,
        captures: {
          1: named('keyword.operator.parallel'),
          2: named('entity.name.label.anchor'),
          3: named('keyword.operator.arrow'),
          4: nested('#sequence-arrow-body'),
          5: named('keyword.operator.arrow'),
          6: nested('#sequence-participant-ref'),
          7: arrowTail,
        },
      },
      // A ->], A ->?, A ->
      {
        match: re`${BOL}\s*(&${SP}*)?(${ANCHOR})(${WHO})${SP}*(${SP}+[ox])?(${EXO_BODY})((?:[ox]?[?\]\[])?)(${EXO_TAIL})${EOL}`,
        captures: {
          1: named('keyword.operator.parallel'),
          2: named('entity.name.label.anchor'),
          3: nested('#sequence-participant-ref'),
          4: named('keyword.operator.arrow'),
          5: nested('#sequence-arrow-body'),
          6: named('keyword.operator.arrow'),
          7: arrowTail,
        },
      },
    ],
  },

  'sequence-arrow': {
    patterns: [
      // A -> B : message, with teoz anchors, multicast and activation.
      {
        match: re`${BOL}\s*(&${SP}*)?(${ANCHOR})(${PART})(${ANCHOR})${SP}*(${ARROW})${SP}*(${PART})((?:\s&\s${CODE})*)(${ANCHOR})(${TAIL})${EOL}`,
        captures: {
          1: named('keyword.operator.parallel'),
          2: named('entity.name.label.anchor'),
          3: nested('#sequence-participant-ref'),
          4: named('entity.name.label.anchor'),
          5: nested('#sequence-arrow-body'),
          6: nested('#sequence-participant-ref'),
          7: nested('#sequence-multicast'),
          8: named('entity.name.label.anchor'),
          9: arrowTail,
        },
      },
      include('sequence-exo-arrow'),
      // {start} <-> {end} : duration (teoz)
      {
        match: re`${BOL}\s*(\{[\p{L}\p{N}_]+\})${SP}*(<->)${SP}*(\{[\p{L}\p{N}_]+\})(.*?)${EOL}`,
        captures: {
          1: named('entity.name.label.anchor'),
          2: named('keyword.operator.arrow'),
          3: named('entity.name.label.anchor'),
          4: arrowTail,
        },
      },
    ],
  },

  'sequence-arrow-body': {
    patterns: [
      {
        match: re`(\[)(${LINE_STYLE})(\])`,
        captures: {
          1: named('keyword.operator.arrow punctuation.definition.style.begin'),
          2: nested('#line-style'),
          3: named('keyword.operator.arrow punctuation.definition.style.end'),
        },
      },
      { name: scope('keyword.operator.arrow'), match: re`\(\d+\)|[^\[\]\s]+` },
    ],
  },

  'line-style': {
    patterns: [
      include('color'),
      { name: scope('keyword.other.line-style'), match: re`(?i)\b(?:${LINE_STYLE_KEY})\b|thickness=\d+` },
      { name: scope('punctuation.separator.comma'), match: re`,` },
    ],
  },

  'sequence-participant-ref': {
    patterns: [
      { match: re`(?i)(?<![\w.@])(as)(?![\w.@])`, captures: { 1: kw } },
      include('string'),
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: CODE },
    ],
  },

  'sequence-multicast': {
    patterns: [
      { name: scope('keyword.operator.parallel'), match: re`&` },
      { name: scope('entity.name.type'), match: CODE },
    ],
  },

  'sequence-group': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(box)(?:${SP}+(${DQ}${NOT_DQ}+${DQ}|[^#]+?))?${SP}*(<<.+>>)?${SP}*(${COLORS})?${SP}*$`,
        captures: {
          1: control,
          2: nested('#string', '#label'),
          3: nested('#stereotype'),
          4: named('constant.other.color'),
        },
      },
      { match: re`(?i)${BOL}\s*(end${SP}*box)${SP}*$`, captures: { 1: control } },
      // alt / else / opt / loop / par / break / critical / group / end …
      {
        match: re`(?i)${BOL}\s*(&${SP}*)?(opt|alt|loop|par2|par|break|critical|else|end|also|group|partition)((?<!else)(?<!also)(?<!end)#\w+)?(?:${SP}+(#\w+))?(?:${SP}+(.*?))?${EOL}`,
        captures: {
          1: named('keyword.operator.parallel'),
          2: control,
          3: named('constant.other.color'),
          4: named('constant.other.color'),
          5: nested('#sequence-group-label'),
        },
      },
    ],
  },

  'sequence-group-label': {
    patterns: [
      {
        // group Label [secondary label]
        match: re`(\[)(.*)(\])${SP}*$`,
        captures: {
          1: named('punctuation.section.brackets.begin'),
          2: nested('#label'),
          3: named('punctuation.section.brackets.end'),
        },
      },
      include('label'),
    ],
  },

  'sequence-misc': {
    patterns: [
      // activate / deactivate / destroy / create A [#back] [#line]
      {
        match: re`(?i)${BOL}\s*(activate|deactivate|destroy|create)${SP}+(${WHO})${SP}*(#\w+)?(?:${SP}+(#\w+))?${SP}*$`,
        captures: {
          1: kw,
          2: nested('#sequence-participant-ref'),
          3: named('constant.other.color'),
          4: named('constant.other.color'),
        },
      },
      { match: re`(?i)${BOL}\s*(deactivate)${SP}*$`, captures: { 1: kw } },
      // A++ / A-- #color
      {
        match: re`${BOL}\s*(${CODE})${SP}*(\+\+|--)${SP}*(#\w+)?${SP}*$`,
        captures: { 1: named('entity.name.type'), 2: named('keyword.operator.activation'), 3: named('constant.other.color') },
      },
      {
        match: re`(?i)${BOL}\s*(&${SP}*)?(return)\b${SP}*(?:(#\w+)${SP}+)?(.*?)${EOL}`,
        captures: { 1: named('keyword.operator.parallel'), 2: control, 3: named('constant.other.color'), 4: nested('#label') },
      },
      // == divider ==
      {
        match: re`${BOL}\s*(==)${SP}*(.*?)${SP}*(==)${SP}*$`,
        captures: { 1: named('punctuation.separator.divider'), 2: nested('#label'), 3: named('punctuation.separator.divider') },
      },
      // ||| and ||45||
      {
        match: re`${BOL}\s*(\|\|)(\d+)?(\|+)${SP}*$`,
        captures: { 1: named('punctuation.separator.space'), 2: named('constant.numeric'), 3: named('punctuation.separator.space') },
      },
      // ... and ... delay text ...
      {
        match: re`${BOL}\s*(\.{3}|\x{2026})(?:(.*)(\.{3}|\x{2026}))?${SP}*$`,
        captures: { 1: named('punctuation.separator.delay'), 2: nested('#label'), 3: named('punctuation.separator.delay') },
      },
      // ref over A, B : text — and the multi-line form up to end ref
      {
        match: re`(?i)${BOL}\s*(ref)(#\w+)?${SP}+(over)${SP}+(${WHO}(?:${SP}*,${SP}*${WHO})*)${SP}*(\[\[.*?\]\])?${SP}*(:)${SP}*(.*?)${EOL}`,
        captures: {
          1: control,
          2: named('constant.other.color'),
          3: kw,
          4: nested('#sequence-ref-parts'),
          5: nested('#creole-inline'),
          6: named('punctuation.separator.label'),
          7: nested('#label'),
        },
      },
      {
        begin: re`(?i)${BOL}\s*(ref)(#\w+)?${SP}+(over)${SP}+(${WHO}(?:${SP}*,${SP}*${WHO})*)${SP}*(\[\[.*?\]\])?${SP}*(#\w+)?${SP}*$`,
        end: endOr(re`(?i)${BOL}\s*(end${SP}?(?:ref)?)${SP}*$`),
        beginCaptures: {
          1: control,
          2: named('constant.other.color'),
          3: kw,
          4: nested('#sequence-ref-parts'),
          5: nested('#creole-inline'),
          6: named('constant.other.color'),
        },
        endCaptures: { 1: control },
        patterns: [include('text-block')],
      },
      // autonumber [start] [step] ["format"], stop, resume, inc
      {
        match: re`(?i)${BOL}\s*(autonumber)(?:${SP}+(stop|resume|inc)\b)?(?:${SP}*(\d(?:(?:[^\p{L}\p{N}\s]+|\d+)*\d)?|[A-Za-z]\b))?(?:${SP}+(\d+))?(?:${SP}+(${DQ}${NOT_DQ}+${DQ}))?${SP}*$`,
        captures: {
          1: kw,
          2: kw,
          3: named('constant.numeric'),
          4: named('constant.numeric'),
          5: nested('#string'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(autoactivate)${SP}+(on|off)${SP}*$`,
        captures: { 1: kw, 2: named('constant.language') },
      },
      {
        match: re`(?i)${BOL}\s*(footbox)${SP}*(on|off)?${SP}*$`,
        captures: { 1: kw, 2: named('constant.language') },
      },
      {
        match: re`(?i)${BOL}\s*(@?newpage)(?:(?:${SP}*(:)${SP}*|${SP}+)(.*?))?${EOL}`,
        captures: { 1: kw, 2: named('punctuation.separator.label'), 3: nested('#label') },
      },
      {
        match: re`(?i)${BOL}\s*(ignore)${SP}*(newpage)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      {
        match: re`(?i)${BOL}\s*(autonewpage)${SP}+(\d+)${SP}*$`,
        captures: { 1: kw, 2: named('constant.numeric') },
      },
      {
        match: re`(?i)${BOL}\s*(hide|show)${SP}+(@?unlinked)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      // url of A is [[http://…]]
      {
        match: re`(?i)${BOL}\s*(url)${SP}*(?:(of|for)\b)?${SP}+(${WHO})${SP}+(?:(is)\b)?${SP}*(\[\[.*?\]\])${SP}*$`,
        captures: {
          1: kw,
          2: kw,
          3: nested('#sequence-participant-ref'),
          4: kw,
          5: nested('#creole-inline'),
        },
      },
    ],
  },

  'sequence-ref-parts': {
    patterns: [{ name: scope('punctuation.separator.comma'), match: re`,` }, include('sequence-participant-ref')],
  },
};
