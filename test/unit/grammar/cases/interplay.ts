import { uml, type GrammarCase } from './types';

const NO_BREAK_SPACE = ' ';
const IDEOGRAPHIC_SPACE = '　';

/**
 * What separates words: the engine takes ASCII whitespace and the no-break
 * space (`%s` upstream), and nothing else — an ideographic space, easy to
 * type with a Japanese input method, makes the line a syntax error.
 */
export const whitespaceCases: GrammarCase[] = [
  {
    name: 'no-break spaces separate words, as for the engine',
    covers: [],
    source: uml`
      @startuml
      Alice${NO_BREAK_SPACE}->${NO_BREAK_SPACE}Bob : no-break spaces
      @enduml
    `,
    expect: [
      ['Alice', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['Bob', 'entity.name.type'],
    ],
  },
  {
    name: 'an ideographic space does not separate words: the engine rejects the line',
    covers: [],
    source: uml`
      @startuml
      利用者${IDEOGRAPHIC_SPACE}->${IDEOGRAPHIC_SPACE}システム : 全角空白
      @enduml
    `,
    render: /Syntax Error/,
    expect: [['->', '!keyword.operator.arrow']],
  },
];

/**
 * Keywords of a command in capitals. The engine compiles every command
 * pattern with CASE_INSENSITIVE (Pattern2 upstream): `-UP->`, `AS` and
 * `[DASHED]` are as good as their lower-case spelling. (Not so the
 * preprocessor, `@start`/`@end`, builtin functions, or the header of a
 * JSON/YAML diagram.)
 */
export const letterCaseCases: GrammarCase[] = [
  {
    name: 'class links: directions, line styles and colour keys in capitals',
    covers: [],
    source: uml`
      @startuml
      class "Order line" AS L #BACK:pink;LINE:blue
      class Order
      Order -UP-> L
      Order -[DOTTED]-> L : dotted
      @enduml
    `,
    expect: [
      ['AS', 'keyword.other'],
      ['#BACK:pink;LINE:blue', 'constant.other.color'],
      ['-UP->', 'keyword.operator.arrow'],
      ['DOTTED', 'keyword.other.line-style'],
    ],
  },
  {
    name: 'sequence: a participant alias and an arrow style in capitals',
    covers: [],
    source: uml`
      @startuml
      participant "Alice Smith" AS A
      A -[#red,DASHED]> A : hi
      @enduml
    `,
    expect: [
      ['AS', 'keyword.other'],
      ['DASHED', 'keyword.other.line-style'],
    ],
  },
  {
    name: 'component and state links with directions in capitals',
    covers: [],
    source: uml`
      @startuml
      component C1
      component C2
      C1 -LEFT-> C2 : uses
      @enduml
    `,
    expect: [['-LEFT->', 'keyword.operator.arrow']],
  },
  {
    name: 'state transition with a direction in capitals',
    covers: [],
    source: uml`
      @startuml
      state S1
      state S2
      S1 -DOWN-> S2
      @enduml
    `,
    expect: [['-DOWN->', 'keyword.operator.arrow']],
  },
  {
    name: 'legacy activity: an alias in capitals',
    covers: [],
    source: uml`
      @startuml
      (*) --> "First" AS f
      f --> (*)
      @enduml
    `,
    expect: [['AS', 'keyword.other']],
  },
  {
    name: 'activity and Gantt arrows with a line style in capitals',
    covers: [],
    source: uml`
      @startgantt
      [A] requires 2 days
      [B] requires 2 days
      [A] -[#red,DASHED]-> [B]
      @endgantt
    `,
    expect: [['DASHED', 'keyword.other.line-style']],
  },
];

/**
 * Lines that more than one UML diagram type could read. Inside @startuml
 * the engine keeps the type that accepts the whole diagram; the grammar
 * sees one line at a time, so these pin down the choices it makes.
 */
export const interplayCases: GrammarCase[] = [
  {
    name: 'a timing diagram: `:label is state` is a state change, not the start of an activity action',
    covers: [],
    source: uml`
      @startuml
      robust "Web browser" as WB
      concise "User" as WU
      @0 as :start
      @WB
      :start is Idle
      100 is Processing
      @WU
      :start is Waiting
      @enduml
    `,
    expect: [
      ['robust', 'storage.type'],
      [':start', 'entity.name.label'],
      ['is', 'keyword.other'],
      ['Idle', 'constant.other.state !meta.action'],
      ['100', 'constant.numeric !meta.action'],
      ['Processing', 'constant.other.state'],
      ['@WU', '!meta.action'],
      ['Waiting', 'constant.other.state !meta.action'],
    ],
  },
  {
    name: 'an activity diagram: hide-class is a command, not a link from hide to class',
    covers: [],
    source: uml`
      @startuml
      (*) --> "Check"
      "Check" --> (*)
      hide-class <<internal>>
      @enduml
    `,
    expect: [
      ['hide-class', 'keyword.other !keyword.operator.arrow'],
      ['<<internal>>', 'entity.name.tag.stereotype'],
    ],
  },
];
