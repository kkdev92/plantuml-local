import { uml, type GrammarCase } from './types';

export const stateCases: GrammarCase[] = [
  {
    name: 'states: names, display names, stereotypes, tags, colours, borders, descriptions',
    covers: ['command:CommandCreateState', 'command:CommandAddField'],
    source: uml`
      @startuml
      state S1
      state "Long name" as L
      state L2 as "Long name 2"
      state "Quoted"
      state Choice <<choice>>
      state Fork1 <<fork>>
      state Colored #pink ##[dashed]red : a description
      state Tagged $tag1
      state Linked <<Stereo>> [[https://example.com]]
      S1 : first description line
      S1 : second line
      "Quoted" : about the quoted state
      [*] --> S1
      S1 --> L
      L --> Choice
      Choice --> Fork1
      Fork1 --> L2
      L2 --> Colored
      Colored --> Tagged
      Tagged --> Linked
      Linked --> [*]
      @enduml
    `,
    expect: [
      ['state', 'storage.type'],
      ['S1', 'entity.name.type'],
      ['state', 'storage.type'],
      ['"Long name"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['L', 'entity.name.type'],
      ['L2', 'entity.name.type'],
      ['as', 'keyword.other'],
      ['"Long name 2"', 'string.quoted.double'],
      ['"Quoted"', 'string.quoted.double'],
      ['<<choice>>', 'entity.name.tag.stereotype'],
      ['<<fork>>', 'entity.name.tag.stereotype'],
      ['#pink', 'constant.other.color'],
      ['##', 'punctuation.definition.border'],
      ['dashed', 'keyword.other.line-style'],
      ['red', 'constant.other.color'],
      [':', 'punctuation.separator.label'],
      ['a description', '!entity.name.type'],
      ['$tag1', 'entity.name.tag'],
      ['<<Stereo>>', 'entity.name.tag.stereotype'],
      ['[[', 'punctuation.definition.link.begin'],
      ['S1', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['first description line', '!entity.name.type'],
      ['"Quoted"', 'string.quoted.double'],
      [':', 'punctuation.separator.label'],
    ],
  },
  {
    name: 'composite states, frames and concurrent regions',
    covers: [
      'command:CommandCreatePackageState',
      'command:CommandCreatePackage2',
      'command:CommandEndState',
      'command:CommandConcurrentState',
    ],
    source: uml`
      @startuml
      state Composite {
        [*] --> Inner
        Inner --> Inner2
        --
        [*] --> Other
        ||
        [*] --> Third
      }
      state "Another composite" as C2 begin
        [*] --> X
      end state
      frame Frame1 {
        [*] --> Y
      }
      [*] --> Composite
      Composite --> C2
      C2 --> Frame1
      @enduml
    `,
    expect: [
      ['state', 'storage.type'],
      ['Composite', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['[*]', 'constant.language.initial-final'],
      ['Inner2', 'entity.name.type'],
      ['--', 'punctuation.separator.concurrent'],
      ['||', 'punctuation.separator.concurrent'],
      ['}', 'punctuation.section.block.end'],
      ['state', 'storage.type'],
      ['"Another composite"', 'string.quoted.double'],
      ['C2', 'entity.name.type'],
      ['begin', 'keyword.other'],
      ['end state', 'punctuation.section.block.end'],
      ['frame', 'storage.type'],
      ['Frame1', 'entity.name.type'],
    ],
  },
  {
    name: 'transitions: both directions, pseudo-states, history, bars, styles, directions, stereotypes',
    covers: ['command:CommandLinkState', 'command:CommandLinkStateReverse'],
    source: uml`
      @startuml
      [*] --> S1
      S1 -> S2 : event
      S2 -down-> S3 : [guard] / action
      S3 -[#red,bold]-> S4
      S4 <-- S5
      S5 <-up- S6 : reverse
      S6 x--> S7
      S7 -->o S8
      S8 --> S1[H]
      S1 --> S1[H*]
      S1 --> [H]
      state J1 <<join>>
      S2 --> ==bar==
      ==bar== --> J1
      J1 --> [*] <<stereo>> : done
      @enduml
    `,
    expect: [
      ['[*]', 'constant.language.initial-final'],
      ['-->', 'keyword.operator.arrow'],
      ['S1', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      [':', 'punctuation.separator.label'],
      ['event', '!entity.name.type'],
      ['-down->', 'keyword.operator.arrow'],
      ['[guard] / action', '!entity.name.type'],
      ['#red', 'constant.other.color'],
      ['bold', 'keyword.other.line-style'],
      ['<--', 'keyword.operator.arrow'],
      ['<-up-', 'keyword.operator.arrow'],
      ['x-->', 'keyword.operator.arrow'],
      ['-->o', 'keyword.operator.arrow'],
      ['S1', 'entity.name.type'],
      ['[H]', 'constant.language.history'],
      ['[H*]', 'constant.language.history'],
      ['[H]', 'constant.language.history'],
      ['==', 'punctuation.definition.bar'],
      ['bar', 'entity.name.type'],
      ['<<stereo>>', 'entity.name.tag.stereotype'],
      ['done', '!entity.name.type'],
    ],
  },
  {
    name: 'notes on states and on transitions',
    covers: [
      'command:CommandFactoryNoteOnEntity("state",RegexOr,THREE).createSingleLine',
      'command:CommandFactoryNoteOnEntity("state",RegexOr,THREE).createMultiLine(false)',
      'command:CommandFactoryNoteOnEntity("state",RegexOr,THREE).createMultiLine(true)',
      'command:CommandFactoryNoteOnLink(TWO).createSingleLine',
      'command:CommandFactoryNoteOnLink(TWO).createMultiLine(false)',
    ],
    source: uml`
      @startuml
      state S1
      state S2
      note left of S1 : one line
      note right of S1
        multi-line
        note
      end note
      note top of S2 {
        in braces
      }
      S1 --> S2
      note on link : on the link
      S2 --> [*]
      note on link
        multi-line on link
      end note
      @enduml
    `,
    expect: [
      ['note', 'keyword.other.note'],
      ['left', 'keyword.other'],
      ['of', 'keyword.other'],
      ['S1', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['note', 'keyword.other.note'],
      ['multi-line', 'meta.note'],
      ['end note', 'keyword.other.note'],
      ['note', 'keyword.other.note'],
      ['top', 'keyword.other'],
      ['{', 'punctuation.section.block.begin'],
      ['in braces', 'meta.note'],
      ['}', 'punctuation.section.block.end'],
      ['on', 'keyword.other'],
      ['link', 'keyword.other'],
      ['on the link', '!keyword'],
      ['multi-line on link', 'meta.note'],
      ['end note', 'keyword.other.note'],
    ],
  },
];
