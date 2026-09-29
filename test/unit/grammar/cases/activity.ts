import { uml, type GrammarCase } from './types';

export const activityCases: GrammarCase[] = [
  {
    name: 'actions on one or several lines, box styles, colours and links',
    covers: ['command:CommandActivity3', 'command:CommandActivityLong3', 'command:CommandStart3', 'command:CommandStop3'],
    source: uml`
      @startuml
      start
      :Hello **world**;
      :read input; <<input>>
      :write output; <<output>> [[https://example.com]]
      :coloured; <<#pink>>
      :first line
      second line;
      :text after the ; is not the end
      last line; <<procedure>>
      stop
      @enduml
    `,
    expect: [
      ['start', 'keyword.control'],
      [':', 'punctuation.definition.action.begin'],
      ['Hello', 'meta.action'],
      ['world', 'markup.bold'],
      [';', 'punctuation.definition.action.end'],
      ['read input', 'meta.action'],
      ['<<input>>', 'entity.name.tag.stereotype'],
      ['<<output>>', 'entity.name.tag.stereotype'],
      ['[[', 'punctuation.definition.link.begin'],
      ['coloured', 'meta.action'],
      ['<<#pink>>', 'entity.name.tag.stereotype'],
      ['first line', 'meta.action'],
      ['second line', 'meta.action'],
      [';', 'punctuation.definition.action.end'],
      ['text after the', 'meta.action'],
      [';', 'meta.action !punctuation.definition.action.end'],
      ['last line', 'meta.action'],
      [';', 'punctuation.definition.action.end'],
      ['<<procedure>>', 'entity.name.tag.stereotype !invalid.deprecated'],
      ['stop', 'keyword.control'],
    ],
  },
  {
    name: 'deprecated forms: a colour in front of the action, a stereotype in front of it',
    covers: ['command:CommandActivity3', 'command:CommandActivityLong3'],
    // The engine ignores both and warns. It reads `#colour:` only as the
    // start of an action on several lines: the `;` on the first line does
    // not end it, the next line ending with `;` does.
    source: uml`
      @startuml
      start
      #pink:coloured in front;
      second line;
      <<procedure>> :stereotype in front;
      stop
      @enduml
    `,
    warns: /deprecated, you must add <<#pink>> at the end.*You must use stereotype at the end/,
    expect: [
      ['#pink', 'meta.action constant.other.color invalid.deprecated'],
      [':', 'punctuation.definition.action.begin'],
      ['coloured in front', 'meta.action'],
      [';', 'meta.action !punctuation.definition.action.end'],
      ['second line', 'meta.action'],
      [';', 'punctuation.definition.action.end'],
      ['<<procedure>>', 'meta.action entity.name.tag.stereotype invalid.deprecated'],
      [':', 'punctuation.definition.action.begin'],
      ['stereotype in front', 'meta.action'],
      [';', 'punctuation.definition.action.end'],
    ],
  },
  {
    name: 'no stereotype in front of an action on several lines',
    covers: [],
    source: uml`
      @startuml
      start
      <<procedure>> :first line
      second line;
      stop
      @enduml
    `,
    render: /Syntax Error/,
    expect: [
      ['<<procedure>> :first line', '!meta.action'],
      ['second line;', '!punctuation.definition.action.end'],
    ],
  },
  {
    name: 'if, elseif, else and endif, with tests, values, colours and both spellings',
    covers: [
      'command:CommandIf2',
      'command:CommandIf4',
      'command:CommandElseIf2',
      'command:CommandElseIf3',
      'command:CommandElse3',
      'command:CommandEndif3',
    ],
    source: uml`
      @startuml
      start
      if (graphviz installed?) then (yes)
        :process;
      elseif (other?) then (maybe)
        :other;
      else (no)
        :error;
      endif
      if (x) is (1) then
        :one;
      elseif (y) is (2) then
        :two;
      else
        :three;
      end if
      #pink:if (coloured) then (yes)
        :a;
      endif
      stop
      @enduml
    `,
    expect: [
      ['if', 'keyword.control'],
      ['(', 'punctuation.section.parens.begin'],
      ['graphviz installed?', '!keyword.control'],
      [')', 'punctuation.section.parens.end'],
      ['then', 'keyword.control'],
      ['yes', '!keyword'],
      ['elseif', 'keyword.control'],
      ['then', 'keyword.control'],
      ['else', 'keyword.control'],
      ['no', '!keyword'],
      ['endif', 'keyword.control'],
      ['if', 'keyword.control'],
      ['is', 'keyword.control'],
      ['then', 'keyword.control'],
      ['elseif', 'keyword.control'],
      ['is', 'keyword.control'],
      ['else', 'keyword.control'],
      ['end if', 'keyword.control'],
      ['#pink', 'constant.other.color'],
      ['if', 'keyword.control'],
    ],
  },
  {
    name: 'the oldest if / else forms: then when, else when',
    covers: ['command:CommandIfLegacy1', 'command:CommandElseLegacy1'],
    source: uml`
      @startuml
      start
      if (legacy) then when yes
        :b;
      else when no
        :c;
      endif
      stop
      @enduml
    `,
    expect: [
      ['if', 'keyword.control'],
      ['then', 'keyword.control'],
      ['when', 'keyword.control'],
      ['yes', '!keyword'],
      ['else', 'keyword.control'],
      ['when', 'keyword.control'],
      ['endif', 'keyword.control'],
    ],
  },
  {
    name: 'if, elseif and else labels spanning several lines',
    covers: [
      'command:CommandDecoratorMultine.create(CommandIf2,50)',
      'command:CommandDecoratorMultine.create(CommandElseIf2,50)',
      'command:CommandDecoratorMultine.create(CommandElse3,50)',
    ],
    source: uml`
      @startuml
      start
      if (a condition
          on two lines) then (yes)
        :x;
      elseif (another condition
          on two lines) then (maybe)
        :y;
      else (a label
        on two lines)
        :z;
      endif
      stop
      @enduml
    `,
    expect: [
      ['if', 'keyword.control'],
      ['(', 'punctuation.section.parens.begin'],
      ['on two lines', '!keyword'],
      [')', 'punctuation.section.parens.end'],
      ['then', 'keyword.control'],
      [':x;', 'meta.action'],
      ['elseif', 'keyword.control'],
      ['then', 'keyword.control'],
      [':y;', 'meta.action'],
      ['else', 'keyword.control'],
      ['on two lines', '!keyword'],
      [')', 'punctuation.section.parens.end'],
      [':z;', 'meta.action'],
      ['endif', 'keyword.control'],
    ],
  },
  {
    name: 'switch, case and endswitch',
    covers: ['command:CommandSwitch', 'command:CommandCase', 'command:CommandEndSwitch'],
    source: uml`
      @startuml
      start
      switch (test?)
      case (condition A)
        :A;
      case (condition B)
        :B;
      endswitch
      stop
      @enduml
    `,
    expect: [
      ['switch', 'keyword.control'],
      ['test?', '!keyword'],
      ['case', 'keyword.control'],
      ['condition A', '!keyword'],
      ['case', 'keyword.control'],
      ['endswitch', 'keyword.control'],
    ],
  },
  {
    name: 'while and repeat loops, backward arrows, labels on the loop exit',
    covers: [
      'command:CommandWhile3',
      'command:CommandWhileEnd3',
      'command:CommandRepeat3',
      'command:CommandRepeatWhile3',
      'command:CommandRepeatWhile3Multilines',
      'command:CommandBackward3',
    ],
    source: uml`
      @startuml
      start
      while (data available?) is (yes)
        :read data;
      endwhile (no)
      while (more?)
        :again;
      while end
      repeat
        :read;
      repeat while (more data?) is (yes) not (no)
      repeat :first;
        :next;
        backward :retry;
      repeat while (again?) -> done;
      repeat
        :x;
      repeat while (a long
        condition)
      stop
      @enduml
    `,
    expect: [
      ['while', 'keyword.control'],
      ['data available?', '!keyword'],
      ['is', 'keyword.control'],
      ['endwhile', 'keyword.control'],
      ['while', 'keyword.control'],
      ['while end', 'keyword.control'],
      ['repeat', 'keyword.control'],
      ['repeat', 'keyword.control'],
      ['while', 'keyword.control'],
      ['is', 'keyword.control'],
      ['not', 'keyword.control'],
      ['repeat', 'keyword.control'],
      [':', 'punctuation.definition.action.begin'],
      ['backward', 'keyword.control'],
      ['retry', '!keyword'],
      ['repeat', 'keyword.control'],
      ['->', 'keyword.operator.arrow'],
      ['done;', '!punctuation.definition.action.end'],
      ['repeat', 'keyword.control'],
      ['repeat', 'keyword.control'],
      ['while', 'keyword.control'],
      ['a long', '!keyword'],
      ['condition', '!keyword'],
      [')', 'punctuation.section.parens.end'],
    ],
  },
  {
    name: 'a backward label spanning several lines',
    covers: ['command:CommandBackwardLong3'],
    source: uml`
      @startuml
      start
      repeat
        :step;
        backward: multi-line
        backward label;
      repeat while (again?)
      stop
      @enduml
    `,
    expect: [
      ['backward', 'keyword.control'],
      [':', 'punctuation.definition.action.begin'],
      ['multi-line', '!keyword'],
      ['backward label', '!keyword'],
      [';', 'punctuation.definition.action.end'],
      ['repeat', 'keyword.control'],
    ],
  },
  {
    name: 'fork, fork again, end fork, end merge; split, split again, end split',
    covers: [
      'command:CommandFork3',
      'command:CommandForkAgain3',
      'command:CommandForkEnd3',
      'command:CommandSplit3',
      'command:CommandSplitAgain3',
      'command:CommandSplitEnd3',
    ],
    source: uml`
      @startuml
      start
      fork
        :a;
      fork again
        :b;
      end fork
      fork
        :c;
      fork again
        :d;
      end merge
      split
        :e;
      split again
        :f;
      end split
      stop
      @enduml
    `,
    expect: [
      ['fork', 'keyword.control'],
      ['fork again', 'keyword.control'],
      ['end fork', 'keyword.control'],
      ['fork', 'keyword.control'],
      ['fork again', 'keyword.control'],
      ['end merge', 'keyword.control'],
      ['split', 'keyword.control'],
      ['split again', 'keyword.control'],
      ['end split', 'keyword.control'],
    ],
  },
  {
    name: 'kill',
    covers: ['command:CommandKill3'],
    source: uml`
      @startuml
      start
      :a;
      kill
      @enduml
    `,
    expect: [['kill', 'keyword.control']],
  },
  {
    name: 'detach',
    covers: ['command:CommandKill3'],
    source: uml`
      @startuml
      start
      :a;
      detach
      @enduml
    `,
    expect: [['detach', 'keyword.control']],
  },
  {
    name: 'break out of a loop, end',
    covers: ['command:CommandBreak', 'command:CommandEnd3'],
    source: uml`
      @startuml
      start
      while (loop?)
        :x;
        break
      endwhile
      end
      @enduml
    `,
    expect: [
      ['break', 'keyword.control'],
      ['endwhile', 'keyword.control'],
      ['end', 'keyword.control'],
    ],
  },
  {
    name: 'arrows with labels, styles and colours, on one or several lines',
    covers: ['command:CommandArrow3', 'command:CommandArrowLong3', 'command:CommandLink3'],
    source: uml`
      @startuml
      start
      :a;
      -> plain label;
      :b;
      -[#red,dashed]-> styled;
      :c;
      ->
      :d;
      -> a label on
      two lines;
      :e;
      link #blue;
      :f;
      stop
      @enduml
    `,
    expect: [
      ['->', 'keyword.operator.arrow'],
      ['plain label', '!keyword'],
      [';', 'punctuation.definition.action.end'],
      ['-[', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      ['dashed', 'keyword.other.line-style'],
      [']->', 'keyword.operator.arrow'],
      ['->', 'keyword.operator.arrow'],
      ['->', 'keyword.operator.arrow'],
      ['a label on', '!keyword'],
      ['two lines', '!keyword'],
      [';', 'punctuation.definition.action.end'],
      [':e;', 'meta.action'],
      ['link', 'keyword.other'],
      ['#blue', 'constant.other.color'],
      [':f;', 'meta.action'],
    ],
  },
  {
    name: 'swimlanes',
    covers: ['command:CommandSwimlane', 'command:CommandSwimlane2'],
    source: uml`
      @startuml
      |Customer|
      start
      :order;
      |#AntiqueWhite|Warehouse| picks
      :pick;
      swimlane Shipping as "Shipping team"
      :ship;
      stop
      @enduml
    `,
    expect: [
      ['|', 'punctuation.separator.swimlane'],
      ['Customer', 'entity.name.type'],
      ['|', 'punctuation.separator.swimlane'],
      ['#AntiqueWhite', 'constant.other.color'],
      ['Warehouse', 'entity.name.type'],
      ['picks', '!entity.name.type'],
      ['swimlane', 'storage.type'],
      ['Shipping', 'entity.name.type'],
      ['as', 'keyword.other'],
    ],
  },
  {
    name: 'partitions, groups, packages, rectangles and cards',
    covers: ['command:CommandPartition3', 'command:CommandCloseGroup3', 'command:CommandCloseGroupLegacy3'],
    // `end group` closes the group with a warning (use `}`). It is not
    // marked deprecated: in a sequence diagram the same line is `end` with
    // the comment `group`, and is fine.
    warns: /You should use a bracket \(\}\) instead of 'end group'/,
    source: uml`
      @startuml
      start
      partition Ordering {
        :a;
      }
      group Checkout {
        :b;
      end group
      package Pack {
        :c;
      }
      rectangle Rect {
        :d;
      }
      card Card {
        :e;
      }
      stop
      @enduml
    `,
    expect: [
      ['partition', 'keyword.control'],
      ['Ordering', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['group', 'keyword.control'],
      ['Checkout', 'entity.name.type'],
      ['end group', 'keyword.control'],
      ['Pack', 'entity.name.type'],
      ['Rect', 'entity.name.type'],
      ['Card', 'entity.name.type'],
    ],
  },
  {
    name: 'labels and goto',
    covers: ['command:CommandLabel', 'command:activitydiagram3.CommandGoto'],
    // `label here` without the `;` also declares a label element of a
    // description diagram, which the engine (and the grammar) tries first.
    source: uml`
      @startuml
      start
      label here;
      :a;
      goto here
      @enduml
    `,
    expect: [
      ['label', 'keyword.control'],
      ['here', 'entity.name.label'],
      ['goto', 'keyword.control'],
      ['here', 'entity.name.label'],
    ],
  },
  {
    name: 'connectors',
    covers: ['command:CommandCircleSpot3'],
    source: uml`
      @startuml
      start
      :a;
      (A)
      detach
      (A)
      :b;
      #red:(B)
      stop
      @enduml
    `,
    // `(A)` alone is also a use case of a description diagram, which the
    // engine (and the grammar) tries first; the coloured form is not.
    expect: [
      ['#red', 'constant.other.color'],
      ['(', 'punctuation.definition.connector.begin'],
      ['B', 'constant.character.connector'],
      [')', 'punctuation.definition.connector.end'],
    ],
  },
  {
    name: 'activity lists',
    covers: ['command:CommandActivityList'],
    source: uml`
      @startuml
      - first step
      - second step
      * third step
      @enduml
    `,
    expect: [
      ['-', 'punctuation.definition.list.begin'],
      ['first step', '!punctuation'],
      ['-', 'punctuation.definition.list.begin'],
      ['*', 'punctuation.definition.list.begin'],
    ],
  },
  {
    name: 'notes on activities, floating notes, multi-line notes',
    covers: ['command:CommandNote3', 'command:CommandNoteLong3'],
    source: uml`
      @startuml
      start
      :a;
      note right: a **note**
      :b;
      floating note left: floating
      note left
        multi-line
        note
      end note
      stop
      @enduml
    `,
    expect: [
      ['note', 'keyword.other.note'],
      ['right', 'keyword.other'],
      [':', 'punctuation.separator.label'],
      ['note', 'markup.bold'],
      ['floating', 'keyword.other'],
      ['note', 'keyword.other.note'],
      ['left', 'keyword.other'],
      ['note', 'keyword.other.note'],
      ['multi-line', 'meta.note'],
      ['end note', 'keyword.other.note'],
    ],
  },
  {
    name: 'legacy syntax: links between the start, activities and synchronisation bars',
    covers: ['command:CommandLinkActivity'],
    source: uml`
      @startuml
      (*) --> "First activity"
      "First activity" -down-> "Second activity" as Second
      Second -->[a label] ===B1===
      ===B1=== -right-> "Parallel 1"
      ===B1=== --> "Parallel 2"
      "Parallel 1" --> ===B2===
      "Parallel 2" --> ===B2===
      ===B2=== -[#blue,dashed]-> Unquoted target
      --> (*)
      @enduml
    `,
    expect: [
      ['(*)', 'constant.language.initial-final'],
      ['-->', 'keyword.operator.arrow'],
      ['"First activity"', 'string.quoted.double'],
      ['"First activity"', 'string.quoted.double'],
      ['-down->', 'keyword.operator.arrow'],
      ['as', 'keyword.other'],
      ['Second', 'entity.name.type'],
      ['Second', 'entity.name.type'],
      ['[', 'punctuation.section.brackets.begin'],
      ['a label', '!keyword'],
      ['===', 'punctuation.definition.bar'],
      ['B1', 'entity.name.type'],
      ['-right->', 'keyword.operator.arrow'],
      ['#blue', 'constant.other.color'],
      ['Unquoted target', 'entity.name.type'],
      ['-->', 'keyword.operator.arrow'],
      ['(*)', 'constant.language.initial-final'],
    ],
  },
  {
    name: 'legacy syntax: if, else, endif',
    covers: ['command:UBrexCommandIf', 'command:UBrexCommandElse', 'command:UBrexCommandEndif'],
    source: uml`
      @startuml
      (*) --> "Check input"
      if "valid?" then
        -->[yes] "Process"
        --> (*)
      else
        -->[no] "Reject"
        --> (*)
      endif
      @enduml
    `,
    expect: [
      ['if', 'keyword.control'],
      ['"valid?"', 'string.quoted.double'],
      ['then', 'keyword.control'],
      ['-->', 'keyword.operator.arrow'],
      ['yes', '!keyword'],
      ['"Process"', 'string.quoted.double'],
      ['else', 'keyword.control'],
      ['endif', 'keyword.control'],
    ],
  },
  {
    name: 'legacy syntax: a link to an activity described on several lines',
    covers: ['command:CommandLinkLongActivity'],
    source: uml`
      @startuml
      (*) --> "Start"
      --> "A long description
      spanning two lines" as Long
      Long --> (*)
      @enduml
    `,
    expect: [
      ['-->', 'keyword.operator.arrow'],
      ['"A long description', 'string.quoted.double'],
      ['spanning two lines"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['Long', 'entity.name.type'],
      ['Long', 'entity.name.type'],
      ['(*)', 'constant.language.initial-final'],
    ],
  },
  {
    name: 'legacy syntax: partitions, direction, footbox',
    covers: [
      'command:UBrexCommandPartition',
      'command:UBrexCommandEndPartition',
      'command:UBrexCommandRankDir',
      'command:UBrexCommandFootboxIgnored',
    ],
    source: uml`
      @startuml
      left to right direction
      hide footbox
      partition Conductor {
        (*) --> "Climbs on Platform"
        --> === S1 ===
      }
      partition Audience #LightSkyBlue {
        === S1 === --> "Applauds"
      }
      partition Other
      "Applauds" --> "Bows" in Other
      end partition
      @enduml
    `,
    expect: [
      ['left to right', 'keyword.other'],
      ['direction', 'keyword.other'],
      ['hide', 'keyword.other'],
      ['footbox', 'keyword.other'],
      ['partition', 'keyword.control'],
      ['Conductor', 'entity.name.type'],
      ['}', 'punctuation.section.block.end'],
      ['partition', 'keyword.control'],
      ['#LightSkyBlue', 'constant.other.color'],
      ['partition', 'keyword.control'],
      ['in', 'keyword.other'],
      ['Other', 'entity.name.type'],
      ['end partition', 'keyword.control'],
    ],
  },
  {
    name: 'legacy syntax: notes',
    covers: ['command:CommandFactoryNoteActivity.createSingleLine', 'command:CommandFactoryNoteActivity.createMultiLine(false)'],
    source: uml`
      @startuml
      (*) --> "First"
      note right: a note
      "First" --> "Second"
      note left
        a multi-line
        note
      end note
      "Second" --> (*)
      @enduml
    `,
    expect: [
      ['note', 'keyword.other.note'],
      ['right', 'keyword.other'],
      [':', 'punctuation.separator.label'],
      ['a note', '!keyword'],
      ['note left', 'keyword.other'],
      ['a multi-line', 'meta.note'],
      ['end note', 'keyword.other.note'],
    ],
  },
  {
    name: 'legacy syntax: hiding by stereotype',
    covers: ['command:UBrexCommandHideShow2'],
    source: uml`
      @startuml
      (*) --> "First" <<myStereo>>
      hide <<myStereo>>
      "First" --> (*)
      @enduml
    `,
    expect: [
      ['<<myStereo>>', 'entity.name.tag.stereotype'],
      ['hide', 'keyword.other'],
      ['<<myStereo>>', 'entity.name.tag.stereotype'],
    ],
  },
  {
    name: 'activity rules leave sequence lines alone',
    covers: [],
    source: uml`
      @startuml
      Alice -> Bob : hello
      group Retry [twice]
        Alice -> Bob
      end
      hide unlinked
      @enduml
    `,
    expect: [
      ['Alice', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      [':', 'punctuation.separator.label'],
      ['hello', '!entity.name.type'],
      ['group', 'keyword.control'],
      ['[', 'punctuation.section.brackets.begin'],
      ['end', 'keyword.control'],
      ['unlinked', 'keyword.other'],
    ],
  },
];
