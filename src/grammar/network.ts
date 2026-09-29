/**
 * Network diagrams (@startnwdiag) and packet diagrams (@startpacketdiag),
 * both in the nwdiag/packetdiag block syntax:
 *
 *   nwdiag {                      packetdiag {
 *     network dmz {                 colwidth = 32
 *       address = "210.x.x.x/24"    0-15: Source Port
 *       web01 [address = "…"];      16-31: Destination Port [color = red]
 *     }                           }
 *     group { web01; db01; }
 *     web01 -- db01;
 *   }
 */

import { BOL, SP, include, named, nested, re, scope, type Rule } from './rules';

const brace = named('punctuation.section.block');
const NAME = re`[-.\p{L}\p{N}_]+`;

export const networkRepository: Record<string, Rule> = {
  'diagram-nwdiag': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      { name: scope('comment.line.double-slash'), match: re`${BOL}\s*//.*$` },
      // `nwdiag {`, `nwdiag` or `{` alone. Not an empty line: a match of
      // nothing would make the tokenizer drop the diagram.
      {
        match: re`(?i)${BOL}\s*(?:(nwdiag)${SP}*(\{)?|(\{))${SP}*$`,
        captures: { 1: named('storage.type'), 2: brace, 3: brace },
      },
      {
        match: re`(?i)${BOL}\s*(network|group)${SP}*(${NAME})?${SP}*(\{)${SP}*$`,
        captures: { 1: named('storage.type'), 2: named('entity.name.type'), 3: brace },
      },
      {
        match: re`(?i)${BOL}\s*(address|color|width|description)${SP}*(=)${SP}*("?)([^"]*)("?)${SP}*(;)?${SP}*$`,
        captures: {
          1: named('support.type.property-name'),
          2: named('keyword.operator.assignment'),
          3: named('string.quoted.double punctuation.definition.string.begin'),
          4: { name: scope('string.quoted.double'), patterns: [include('color'), include('label')] },
          5: named('string.quoted.double punctuation.definition.string.end'),
          6: named('punctuation.terminator'),
        },
      },
      {
        match: re`${BOL}\s*([\p{L}\p{N}_]+)${SP}*(--)${SP}*([\p{L}\p{N}_]+)${SP}*(;)?${SP}*$`,
        captures: {
          1: named('entity.name.type'),
          2: named('keyword.operator.arrow'),
          3: named('entity.name.type'),
          4: named('punctuation.terminator'),
        },
      },
      {
        match: re`${BOL}\s*(${NAME})${SP}*(?:(\[)(.*)(\]))?(;)?${SP}*$`,
        captures: {
          1: named('entity.name.type'),
          2: named('punctuation.section.brackets.begin'),
          3: nested('#network-attributes'),
          4: named('punctuation.section.brackets.end'),
          5: named('punctuation.terminator'),
        },
      },
      { match: re`${BOL}\s*(\})${SP}*$`, captures: { 1: brace } },
    ],
  },

  /** `key = value` pairs inside brackets. */
  'network-attributes': {
    patterns: [
      {
        match: re`([\p{L}_][\p{L}\p{N}_]*)${SP}*(=)`,
        captures: { 1: named('support.type.property-name'), 2: named('keyword.operator.assignment') },
      },
      include('string'),
      include('color'),
      include('number'),
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('support.constant.property-value'), match: re`[^\s,="]+` },
    ],
  },

  'diagram-packetdiag': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      // `packetdiag {`, `packetdiag` or `{` alone, never an empty line (see nwdiag).
      {
        match: re`(?i)${BOL}\s*(?:(packetdiag)${SP}*(\{)?|(\{))${SP}*$`,
        captures: { 1: named('storage.type'), 2: brace, 3: brace },
      },
      {
        match: re`(?i)${BOL}\s*(colwidth|node_height|scale_direction|scale_interval|same_height)${SP}*(=)${SP}*(\d{1,3}|ltr|rtl|true|false|\d+)(;)?${SP}*$`,
        captures: {
          1: named('support.type.property-name'),
          2: named('keyword.operator.assignment'),
          3: { patterns: [include('number'), { name: scope('constant.language'), match: re`\w+` }] },
          4: named('punctuation.terminator'),
        },
      },
      // 0-15: Source Port [attributes], 16: flag, * reserved
      {
        match: re`${BOL}\s*(?:(\d{1,7})(?:(-)(\d{1,7}))?(:)?|(\*))${SP}+(.*?)(?:${SP}*(\[)(.*?)(\]))?${SP}*$`,
        captures: {
          1: named('constant.numeric'),
          2: named('keyword.operator.range'),
          3: named('constant.numeric'),
          4: named('punctuation.separator.label'),
          5: named('keyword.operator'),
          6: nested('#label'),
          7: named('punctuation.section.brackets.begin'),
          8: nested('#network-attributes'),
          9: named('punctuation.section.brackets.end'),
        },
      },
      { match: re`${BOL}\s*(\})${SP}*$`, captures: { 1: brace } },
    ],
  },
};
