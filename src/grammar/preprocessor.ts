/**
 * Comments and the preprocessor.
 *
 * The preprocessor runs before any diagram is parsed, on every line of
 * every diagram type, so these rules are included first in every diagram
 * body. The line classes follow the engine's preprocessor (TLineType):
 * a line is a comment, a directive (`!if`, `!function`, `!$x = …`), or
 * plain text in which variables and function calls are substituted.
 *
 * Directives are matched in lower case only. The engine classifies `!IF`
 * as a directive but then reads the keyword case-sensitively and reports
 * an error, so an upper-case directive is not highlighted as one.
 */

import { BOL, IDENT, SP, include, named, nested, re, scope, type Rule } from './rules';

/** Builtin functions of the preprocessor in the browser engine (TContext). */
export const BUILTINS = [
  '%false',
  '%true',
  '%backslash',
  '%boolval',
  '%breakline',
  '%call_user_func',
  '%chr',
  '%darken',
  '%date',
  '%dec2hex',
  '%dirpath',
  '%dollar',
  '%eval',
  '%feature',
  '%filedate',
  '%file_exists',
  '%filename',
  '%filename_no_extension',
  '%function_exists',
  '%get_all_theme',
  '%get_current_theme',
  '%get_json_keys',
  '%get_json_type',
  '%get_variable_value',
  '%version',
  '%getenv',
  '%hex2dec',
  '%hsl_color',
  '%intval',
  '%invoke_procedure',
  '%is_dark',
  '%is_light',
  '%json_add',
  '%json_key_exists',
  '%json_merge',
  '%json_remove',
  '%json_set',
  '%left_align',
  '%lighten',
  '%load_json',
  '%and',
  '%nand',
  '%nor',
  '%not',
  '%nxor',
  '%or',
  '%xor',
  '%lower',
  '%mod',
  '%newline',
  '%n',
  '%now',
  '%ord',
  '%percent',
  '%random',
  '%retrieve_procedure',
  '%reverse_color',
  '%reverse_hsluv_color',
  '%right_align',
  '%set_variable_value',
  '%size',
  '%splitstr',
  '%splitstr_regex',
  '%str2json',
  '%string',
  '%strlen',
  '%strpos',
  '%substr',
  '%tab',
  '%upper',
  '%variable_exists',
  '%xargs',
] as const;

const directive = named('keyword.control.directive');
const REST = re`(.*)$`;

export const preprocessorRepository: Record<string, Rule> = {
  /**
   * Comments that the preprocessor removes whole: a line starting with a
   * single quote, a line that is one block comment, and a block comment
   * opening a line without closing on it (it runs to the first line that
   * ends with the closing marker, as in the engine).
   */
  comment: {
    patterns: [
      {
        name: scope('comment.line.single-quote'),
        match: re`${BOL}\s*(').*$`,
        captures: { 1: named('punctuation.definition.comment') },
      },
      {
        name: scope('comment.block'),
        match: re`${BOL}\s*(/').*('/)\s*$`,
        captures: { 1: named('punctuation.definition.comment'), 2: named('punctuation.definition.comment') },
      },
      {
        name: scope('comment.block'),
        begin: re`${BOL}\s*(/')(?!.*'/)`,
        end: re`('/)\s*$`,
        beginCaptures: { 1: named('punctuation.definition.comment') },
        endCaptures: { 1: named('punctuation.definition.comment') },
      },
    ],
  },

  /**
   * A block comment that opens a line and closes before its end: the
   * engine drops it and parses the rest of the line. Diagram bodies wrap
   * their line rules with this so that the rest is still recognised (the
   * line rules accept `\G`, the end of this comment, as a line start).
   */
  'comment-leading': {
    name: scope('comment.block'),
    match: re`${BOL}\s*(/')(.*?)('/)`,
    captures: { 1: named('punctuation.definition.comment'), 3: named('punctuation.definition.comment') },
  },

  /**
   * A block comment that closes a line (the engine drops everything from
   * the last opening marker), and the `/'''word'''/` form, which the
   * engine drops wherever it appears.
   */
  'comment-inline': {
    patterns: [
      {
        name: scope('comment.block'),
        match: re`(/')(?:(?!/').)*('/)\s*$`,
        captures: { 1: named('punctuation.definition.comment'), 2: named('punctuation.definition.comment') },
      },
      {
        name: scope('comment.block'),
        match: re`(/''')[-\w]*('''/)`,
        captures: { 1: named('punctuation.definition.comment'), 2: named('punctuation.definition.comment') },
      },
    ],
  },

  preprocessor: {
    patterns: [
      // !define NAME(args) body — a legacy macro with arguments.
      {
        match: re`${BOL}\s*((?:!define))${SP}+(${IDENT})(\()([^)]*)(\))${REST}`,
        captures: {
          1: directive,
          2: named('entity.name.function.macro'),
          3: named('punctuation.definition.parameters.begin'),
          4: nested('#preprocessor-parameters'),
          5: named('punctuation.definition.parameters.end'),
          6: nested('#inline'),
        },
      },
      // !definelong NAME(args) — its body runs to !enddefinelong.
      {
        match: re`${BOL}\s*((?:!definelong))${SP}+(${IDENT})\b(?:(\()([^)]*)(\)))?${REST}`,
        captures: {
          1: directive,
          2: named('entity.name.function.macro'),
          3: named('punctuation.definition.parameters.begin'),
          4: nested('#preprocessor-parameters'),
          5: named('punctuation.definition.parameters.end'),
          6: nested('#inline'),
        },
      },
      // !define NAME value — a legacy constant.
      {
        match: re`${BOL}\s*((?:!define))${SP}+(${IDENT})\b${REST}`,
        captures: { 1: directive, 2: named('variable.other.constant'), 3: nested('#inline') },
      },
      // !$name = { … or [ … left open on its line: a JSON value over several
      // lines. The engine appends the next line until the JSON parses
      // (CodeIteratorAffectation upstream); VS Code's JSON grammar reads it up
      // to its closing bracket.
      {
        begin: re`${BOL}\s*(!${SP}*(?:(?:local|global)\b)?)${SP}*(\$?)(${IDENT})${SP}*(\??=)${SP}*(?=[\[{])(?!.*[\]}]${SP}*$)`,
        end: re`(?<=[\]}])`,
        beginCaptures: {
          1: directive,
          2: named('variable.other punctuation.definition.variable'),
          3: named('variable.other'),
          4: named('keyword.operator.assignment'),
        },
        contentName: 'meta.embedded.block.json',
        patterns: [include('source.json#value')],
      },
      // ![local|global] [$]name [?]= expression
      {
        match: re`${BOL}\s*(!${SP}*(?:(?:local|global)\b)?)${SP}*(\$?)(${IDENT})${SP}*(\??=)${REST}`,
        captures: {
          1: directive,
          2: named('variable.other punctuation.definition.variable'),
          3: named('variable.other'),
          4: named('keyword.operator.assignment'),
          5: nested('#expression'),
        },
      },
      // !ifdef / !ifndef take a name (or names joined by || and &&), !undef one name.
      {
        match: re`${BOL}\s*((?:!ifn?def|!undef))\b${REST}`,
        captures: { 1: directive, 2: nested('#expression') },
      },
      // Directives followed by an expression.
      {
        match: re`${BOL}\s*((?:!if|!elseif|!while|!return|!assert))\b${REST}`,
        captures: { 1: directive, 2: nested('#expression') },
      },
      // Directives without arguments.
      {
        match: re`${BOL}\s*((?:!else|!endif|!endwhile|!endfor|!endsub|!end${SP}*(?:function|definelong|procedure)))\b${REST}`,
        captures: { 1: directive, 2: nested('#inline') },
      },
      // !foreach $item in expression
      {
        match: re`${BOL}\s*((?:!foreach))\b${SP}*(\$?)(${IDENT})?${SP}*((?:in)\b)?${REST}`,
        captures: {
          1: directive,
          2: named('variable.other punctuation.definition.variable'),
          3: named('variable.other'),
          4: named('keyword.operator.word'),
          5: nested('#expression'),
        },
      },
      // !function / !procedure declarations, optionally unquoted or final,
      // with an optional one-line `!return`.
      {
        match: re`${BOL}\s*(!${SP}*(?:(?:unquoted|final)${SP}+)*(?:function|procedure))${SP}+(\$?)(${IDENT})${SP}*(?:(\()([^)]*)(\)))?${SP}*(?:((?:!return))\b${REST})?`,
        captures: {
          1: directive,
          2: named('entity.name.function punctuation.definition.variable'),
          3: named('entity.name.function'),
          4: named('punctuation.definition.parameters.begin'),
          5: nested('#preprocessor-parameters'),
          6: named('punctuation.definition.parameters.end'),
          7: directive,
          8: nested('#expression'),
        },
      },
      // Directives whose argument is a path, a name or free text.
      {
        match: re`${BOL}\s*((?:!include(?:url|_many|_once)?|!includedef|!includesub|!import|!startsub|!theme|!log|!dump_memory))\b${REST}`,
        captures: { 1: directive, 2: nested('#preprocessor-argument') },
      },
      // !option key value
      {
        match: re`${BOL}\s*((?:!option))\b${SP}*(${IDENT})?${REST}`,
        captures: { 1: directive, 2: named('variable.other.option'), 3: nested('#expression') },
      },
    ],
  },

  /** Parameter lists: `$x`, `$x = default`, or the bare names of a legacy macro. */
  'preprocessor-parameters': {
    patterns: [include('expression'), { name: scope('variable.parameter'), match: IDENT }],
  },

  /** Paths (`<azure/…>`, files, URLs), sub-part names and theme names. */
  'preprocessor-argument': {
    patterns: [
      { name: scope('string.unquoted.path'), match: re`<[^>]*>` },
      {
        match: re`\b((?i:from))\b${SP}*(.*)$`,
        captures: { 1: named('keyword.operator.word'), 2: named('string.unquoted.path') },
      },
      include('inline-preprocessor'),
      { name: scope('string.unquoted.path'), match: re`[^\s$%]+` },
    ],
  },

  /** Expressions of the preprocessor (`!if`, `!$x =`, `!return`, arguments). */
  expression: {
    patterns: [
      include('comment-inline'),
      include('inline-preprocessor'),
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
      { name: scope('constant.numeric'), match: re`(?<![\w$])-?\d+(?:\.\d+)?\b` },
      { name: scope('keyword.operator.comparison'), match: re`==|!=|<=|>=|<|>` },
      { name: scope('keyword.operator.logical'), match: re`&&|\|\|` },
      { name: scope('keyword.operator.arithmetic'), match: re`[-+*/]` },
      { name: scope('keyword.operator.assignment'), match: re`=` },
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('punctuation.section.brackets'), match: re`[()\[\]{}]` },
    ],
  },

  /**
   * What the preprocessor substitutes inside any line: calls of builtin
   * and user functions, and variables.
   */
  'inline-preprocessor': {
    patterns: [
      {
        match: re`(%)(${BUILTINS.map((b) => b.slice(1)).join('|')})(?=${SP}*\()`,
        captures: {
          1: named('support.function.builtin punctuation.definition.function'),
          2: named('support.function.builtin'),
        },
      },
      {
        match: re`(\$)(${IDENT})(?=${SP}*\()`,
        captures: {
          1: named('entity.name.function punctuation.definition.function'),
          2: named('entity.name.function'),
        },
      },
      {
        match: re`(\$)(${IDENT})`,
        captures: { 1: named('variable.other punctuation.definition.variable'), 2: named('variable.other') },
      },
    ],
  },
};
