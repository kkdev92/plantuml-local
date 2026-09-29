import { uml, type GrammarCase } from './types';

export const syntaxCases: GrammarCase[] = [
  {
    name: 'EBNF: rules on one line and over several, comments of every kind',
    covers: [
      'command:UBrexCommandComment',
      'command:CommandCommentMultilines2',
      'command:CommandCommentMultilines',
      'command:CommandEBnfSingleLine',
      'command:UBrexCommandEbnfMultilines',
    ],
    source: uml`
      @startebnf
      title Arithmetic
      (* a whole-line comment *)
      (*
        a comment
        over several lines *)
      (** a note
        over several lines **)
      expression = term, { ("+" | "-"), term };
      term = factor, { ('*' | '/'), factor };
      factor =
        number
        | "(", expression, ")"
        | ? special ?;
      digits = 3 * digit, [ "e", digit ], { digit }-, letter - vowel;
      @endebnf
    `,
    expect: [
      ['title', 'keyword.other'],
      ['(* a whole-line comment *)', 'comment.block'],
      ['a comment', 'comment.block'],
      ['over several lines *)', 'comment.block'],
      ['(** a note', 'comment.block'],
      ['over several lines **)', 'comment.block'],
      ['expression', 'entity.name.type.rule'],
      ['=', 'keyword.operator.definition'],
      ['term', 'variable.other.rule'],
      [',', 'keyword.operator.concatenation'],
      ['{', 'punctuation.section.repetition'],
      ['(', 'punctuation.section.group'],
      ['"+"', 'string.quoted.double'],
      ['|', 'keyword.operator.alternation'],
      [';', 'punctuation.terminator.rule'],
      ["'*'", 'string.quoted.single'],
      ['factor', 'variable.other.rule'],
      ['factor', 'entity.name.type.rule'],
      ['number', 'variable.other.rule'],
      ['|', 'keyword.operator.alternation'],
      ['? special ?', 'string.other.special'],
      [';', 'punctuation.terminator.rule'],
      ['digits', 'entity.name.type.rule'],
      ['3', 'constant.numeric'],
      ['*', 'keyword.operator.repetition'],
      ['[', 'punctuation.section.optional'],
      ['}-', 'keyword.operator.repetition'],
      ['-', 'keyword.operator.exception'],
    ],
  },
  {
    name: 'regular expressions: classes, groups, look-around, quantifiers, anchors, escapes',
    covers: ['command:CommandRegexfSingleLine'],
    source: uml`
      @startregex
      title Date and name
      ^(?<year>[0-9]{4})-(?:0[1-9]|1[0-2])(?=-)\d{2,}$
      [[:alpha:]]+?\p{L}*\x{41}.(?!x)(?<=a)(?<!b)\b(?#comment)
      @endregex
    `,
    expect: [
      ['title', 'keyword.other'],
      ['^', 'keyword.control.anchor'],
      ['(?<', 'punctuation.definition.group'],
      ['year', 'entity.name.tag.group'],
      ['[0-9]', 'constant.other.character-class.set'],
      ['{4}', 'keyword.operator.quantifier'],
      ['(?:', 'punctuation.definition.group.no-capture'],
      ['|', 'keyword.operator.or'],
      ['(?=', 'keyword.operator.lookaround'],
      ['\\d', 'constant.character.character-class'],
      ['{2,}', 'keyword.operator.quantifier'],
      ['$', 'keyword.control.anchor'],
      ['[:alpha:]', 'constant.other.character-class.posix'],
      ['+?', 'keyword.operator.quantifier'],
      ['\\p{L}', 'constant.character.character-class'],
      ['\\x{41}', 'constant.character.numeric'],
      ['.', 'constant.character.character-class'],
      ['(?!', 'keyword.operator.lookaround'],
      ['(?<=', 'keyword.operator.lookaround'],
      ['(?<!', 'keyword.operator.lookaround'],
      ['\\b', 'keyword.control.anchor'],
      ['(?#comment)', 'comment.block'],
    ],
  },
  {
    // A plain string: the test build would turn B inside a template into B.
    name: 'regular expressions: \\u escapes and octal escapes',
    covers: [],
    source: '@startregex\n\\u0042+\\0101\n@endregex',
    expect: [
      ['\\u0042', 'constant.character.numeric'],
      ['+', 'keyword.operator.quantifier'],
      ['\\0101', 'constant.character.numeric'],
    ],
  },
  {
    name: 'regular expressions: no lazy marker after {n,m} (the engine rejects it)',
    covers: [],
    source: uml`
      @startregex
      \d{2}?
      @endregex
    `,
    expect: [
      ['{2}', 'keyword.operator.quantifier'],
      ['?', 'keyword.operator.quantifier'],
    ],
    render: /Bad quantifier/,
  },
];
