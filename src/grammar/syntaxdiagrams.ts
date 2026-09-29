/**
 * Syntax diagrams: EBNF grammars (@startebnf) and regular expressions
 * (@startregex).
 *
 * EBNF: `name = definition ;`, a definition may continue over several
 * lines up to `;`; comments are `(* … *)`, on one line or several, and
 * `(** … **)`. A regex diagram draws every line as a regular expression,
 * in the dialect the engine's regex diagram reads.
 */

import { BOL, EOL, SP, endOr, include, named, re, scope, type Rule } from './rules';

const RULE_NAME = re`[\p{L}\p{N}_][-\p{L}\p{N}_]*`;
const comment = scope('comment.block');

export const syntaxDiagramRepository: Record<string, Rule> = {
  'diagram-ebnf': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      // (* comment *) filling the line
      { name: comment, match: re`${BOL}\s*\(\*.*\*\)${SP}*$` },
      // name = definition ;  (possibly over several lines, with comments around the name)
      {
        begin: re`${BOL}\s*(?:(\(\*.*?\*\))${SP}*)?(${RULE_NAME})${SP}*(?:(\(\*.*?\*\))${SP}*)?(=)`,
        end: endOr(re`;`),
        beginCaptures: {
          1: named('comment.block'),
          2: named('entity.name.type.rule'),
          3: named('comment.block'),
          4: named('keyword.operator.definition'),
        },
        endCaptures: { 0: named('punctuation.terminator.rule') },
        patterns: [include('ebnf-expression')],
      },
      // (** note **) and (* comment *) over several lines
      {
        name: comment,
        begin: re`${BOL}\s*\(\*\*`,
        end: endOr(re`\*\*\)${SP}*$`),
      },
      {
        name: comment,
        begin: re`${BOL}\s*\(\*`,
        end: endOr(re`\*\)${SP}*$`),
      },
    ],
  },

  'ebnf-expression': {
    patterns: [
      include('comment-inline'),
      include('inline-preprocessor'),
      { name: comment, match: re`\(\*.*?\*\)` },
      {
        name: scope('string.quoted.double'),
        match: re`(")[^"]*(")`,
        captures: { 1: named('punctuation.definition.string.begin'), 2: named('punctuation.definition.string.end') },
      },
      {
        name: scope('string.quoted.single'),
        match: re`(')[^']*(')`,
        captures: { 1: named('punctuation.definition.string.begin'), 2: named('punctuation.definition.string.end') },
      },
      { name: scope('string.other.special'), match: re`\?[^?]*\?` },
      { name: scope('keyword.operator.repetition'), match: re`\}-` },
      { name: scope('punctuation.section.group'), match: re`[()]` },
      { name: scope('punctuation.section.optional'), match: re`[\[\]]` },
      { name: scope('punctuation.section.repetition'), match: re`[{}]` },
      { name: scope('keyword.operator.alternation'), match: re`\|` },
      { name: scope('keyword.operator.concatenation'), match: re`,` },
      { name: scope('keyword.operator.definition'), match: re`=` },
      { name: scope('keyword.operator.repetition'), match: re`\*` },
      { name: scope('keyword.operator.exception'), match: re`-` },
      { name: scope('constant.numeric'), match: re`\b\d+\b` },
      { name: scope('variable.other.rule'), match: RULE_NAME },
    ],
  },

  'diagram-regex': {
    patterns: [
      include('preprocessor'),
      include('common-commands'),
      // At least one character: a match of nothing on a blank line would
      // make the tokenizer drop the diagram.
      {
        match: re`${BOL}\s*(\S.*?)${EOL}`,
        captures: { 1: { name: scope('string.regexp'), patterns: [include('regex-pattern')] } },
      },
    ],
  },

  'regex-pattern': {
    patterns: [
      { name: scope('comment.block'), match: re`\(\?#[^)]*\)` },
      {
        match: re`(\(\?<)([\p{L}_][\p{L}\p{N}_]*)(>)`,
        captures: {
          1: named('punctuation.definition.group'),
          2: named('entity.name.tag.group'),
          3: named('punctuation.definition.group'),
        },
      },
      { name: scope('keyword.operator.lookaround'), match: re`\(\?<?[=!]` },
      { name: scope('punctuation.definition.group.no-capture'), match: re`\(\?:` },
      { name: scope('punctuation.definition.group'), match: re`[()]` },
      {
        name: scope('constant.other.character-class.set'),
        begin: re`(\[)(\^)?`,
        end: re`\]|$`,
        beginCaptures: { 1: named('punctuation.definition.character-class'), 2: named('keyword.operator.negation') },
        endCaptures: { 0: named('punctuation.definition.character-class') },
        patterns: [
          { name: scope('constant.other.character-class.posix'), match: re`\[:\w+:\]` },
          include('regex-escape'),
          { name: scope('keyword.operator.range'), match: re`(?<=[^\[^\\])-(?=[^\]])` },
        ],
      },
      // The engine accepts a lazy `?` after * + ? but not after {n,m}.
      { name: scope('keyword.operator.quantifier'), match: re`[*+?]\??|\{[0-9,]+\}` },
      { name: scope('keyword.control.anchor'), match: re`[$^]|\\[AZzGbB]` },
      include('regex-escape'),
      { name: scope('constant.character.character-class'), match: re`\.` },
      { name: scope('keyword.operator.or'), match: re`\|` },
    ],
  },

  'regex-escape': {
    patterns: [
      { name: scope('constant.character.character-class'), match: re`\\[pP]\{[^}]*\}|\\[dDwWsShHvV]` },
      { name: scope('constant.character.numeric'), match: re`\\x\{[0-9A-Fa-f]+\}|\\x[0-9A-Fa-f]{2}|\\u[0-9A-Fa-f]{4}|\\0[0-7]{0,3}` },
      { name: scope('constant.character.escape'), match: re`\\.` },
    ],
  },
};
