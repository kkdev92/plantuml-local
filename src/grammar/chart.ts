/**
 * Charts (@startchart: ChartDiagramFactory): axes, bar / line / area /
 * scatter series, legend position, stacking, orientation and annotations.
 *
 * The factory registers its own commands before the common ones, so
 * `legend right` here places the legend (it is not the start of a
 * multi-line legend as in other diagrams).
 */

import { BOL, DQ, NOT_DQ, SP, include, named, nested, re, scope, type Rule } from './rules';

const kw = named('keyword.other');

/** "Title" — charts take straight double quotes only. */
const TITLE = re`"[^"]+"`;
const RANGE = re`-?[0-9.]+\s*-?->\s*-?[0-9.]+`;
const SERIES_COLOR = re`#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}|\w+)`;

export const chartRepository: Record<string, Rule> = {
  'diagram-chart': {
    patterns: [include('preprocessor'), include('chart-command'), include('common-commands')],
  },

  'chart-command': {
    patterns: [
      // h-axis "Title" 0 --> 100 [a, b, c] spacing 20 label-right grid
      {
        match: re`(?i)${BOL}\s*([hx]-axis)${SP}*(${TITLE})?${SP}*(${RANGE})?${SP}*(\[.*\])?${SP}*(?:(spacing)${SP}+([0-9]+))?${SP}*(label-right)?${SP}*(grid)?${SP}*$`,
        captures: {
          1: kw,
          2: nested('#chart-string'),
          3: nested('#chart-range'),
          4: nested('#chart-list'),
          5: kw,
          6: named('constant.numeric'),
          7: kw,
          8: kw,
        },
      },
      // v-axis / y-axis / v2-axis / y2-axis "Title" 0 --> 100 [labels] ticks [..] spacing 10 label-top grid
      {
        match: re`(?i)${BOL}\s*([vy]2?-axis)${SP}*(${TITLE})?${SP}*(${RANGE})?${SP}*(\[[^\]]+\])?${SP}*(?:(ticks)${SP}+(\[.*\]))?${SP}*(?:(spacing)${SP}+([0-9.]+))?${SP}*(label-top)?${SP}*(grid)?${SP}*$`,
        captures: {
          1: kw,
          2: nested('#chart-string'),
          3: nested('#chart-range'),
          4: nested('#chart-list'),
          5: kw,
          6: nested('#chart-list'),
          7: kw,
          8: named('constant.numeric'),
          9: kw,
          10: kw,
        },
      },
      // bar|line|area|scatter <<stereo>> "Name" [1, 2, 3] #color v2 labels <<circle>>
      {
        match: re`(?i)${BOL}\s*(bar|line|area|scatter)${SP}*(<<.+?>>)?${SP}*(${TITLE})?${SP}*(\[.*\])${SP}*(${SERIES_COLOR})?(?:${SP}+([vy]2))?(?:${SP}+(labels))?(?:${SP}+(<<(?:circle|square|triangle)>>))?${SP}*$`,
        captures: {
          1: named('storage.type'),
          2: nested('#stereotype'),
          3: nested('#chart-string'),
          4: nested('#chart-list'),
          5: named('constant.other.color'),
          6: kw,
          7: kw,
          8: nested('#stereotype'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(legend)${SP}+(left|right|top|bottom)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      {
        match: re`(?i)${BOL}\s*(stackMode)${SP}+(grouped|stacked)${SP}*$`,
        captures: { 1: kw, 2: named('support.constant.mode') },
      },
      {
        match: re`(?i)${BOL}\s*(orientation)${SP}+(vertical|horizontal)${SP}*$`,
        captures: { 1: kw, 2: named('support.constant.mode') },
      },
      // annotation "Peak" at (Mar, 42) <<arrow>>
      {
        match: re`(?i)${BOL}\s*(annotation)${SP}+(${TITLE})${SP}+(at)${SP}*(\()${SP}*([^,]+?)${SP}*(,)${SP}*([^)]+?)${SP}*(\))${SP}*(<<arrow>>)?${SP}*$`,
        captures: {
          1: kw,
          2: nested('#chart-string'),
          3: kw,
          4: named('punctuation.section.parens.begin'),
          5: nested('#chart-value'),
          6: named('punctuation.separator.comma'),
          7: nested('#chart-value'),
          8: named('punctuation.section.parens.end'),
          9: nested('#stereotype'),
        },
      },
    ],
  },

  'chart-string': {
    name: scope('string.quoted.double'),
    match: re`(${DQ})(${NOT_DQ}*)(${DQ})`,
    captures: {
      1: named('punctuation.definition.string.begin'),
      2: nested('#label'),
      3: named('punctuation.definition.string.end'),
    },
  },

  'chart-range': {
    patterns: [
      { name: scope('keyword.operator.range'), match: re`-?->` },
      { name: scope('constant.numeric'), match: re`-?[0-9.]+` },
    ],
  },

  /** [10, 20, 30] or [Jan, Feb, Mar] */
  'chart-list': {
    patterns: [
      { name: scope('punctuation.section.brackets'), match: re`[\[\]]` },
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { include: '#chart-value' },
    ],
  },

  'chart-value': {
    patterns: [
      { include: '#chart-string' },
      // ticks [0:"none", 50:"half"]
      { name: scope('punctuation.separator.key-value'), match: re`:` },
      { name: scope('constant.numeric'), match: re`-?\d+(?:\.\d+)?(?![\w.])` },
      include('inline-preprocessor'),
      { name: scope('string.unquoted.category'), match: re`[^,\[\]\s][^,\[\]]*?(?=\s*(?:,|\]|$))` },
    ],
  },
};
