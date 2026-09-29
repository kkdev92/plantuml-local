import { uml, type GrammarCase } from './types';

export const descriptionCases: GrammarCase[] = [
  {
    name: 'elements: every shape keyword, the short forms, aliases, stereotypes, tags and colours',
    covers: ['command:CommandCreateElementFull'],
    source: uml`
      @startuml
      actor User
      actor/ Business
      :Admin: as A
      usecase (Browse) as UC1
      usecase/ "Business case" as UC2
      (Checkout)
      [Web UI] as UI <<Frontend>> #lightblue
      component "Payment" as Pay $core
      () "Port" as P
      () Iface
      interface API
      node Server
      database DB
      cloud Internet
      person Customer
      artifact App
      folder Docs
      file Report
      frame Frame1
      card Card1
      hexagon Hex
      label Lbl
      agent Agent1
      boundary Bd
      control Ctl
      entity Ent
      collections Coll
      queue Q
      stack Stk
      storage Store
      action Act
      process Proc
      rectangle Rect
      package Pkg
      circle Circ
      component Host {
        port P1
        portin P2
        portout P3
      }
      "Quoted" as QU
      Code as "Display"
      @enduml
    `,
    expect: [
      ['actor', 'storage.type'],
      ['User', 'entity.name.type'],
      ['actor/', 'storage.type'],
      [':', 'punctuation.definition.element.begin'],
      ['Admin', 'entity.name.type'],
      [':', 'punctuation.definition.element.end'],
      ['as', 'keyword.other'],
      ['A', 'entity.name.type'],
      ['usecase', 'storage.type'],
      ['(', 'punctuation.definition.element.begin'],
      ['Browse', 'entity.name.type'],
      ['UC1', 'entity.name.type'],
      ['usecase/', 'storage.type'],
      ['"Business case"', 'string.quoted.double'],
      ['Checkout', 'entity.name.type'],
      ['[', 'punctuation.definition.element.begin'],
      ['Web UI', 'entity.name.type'],
      ['UI', 'entity.name.type'],
      ['<<Frontend>>', 'entity.name.tag.stereotype'],
      ['#lightblue', 'constant.other.color'],
      ['component', 'storage.type'],
      ['Pay', 'entity.name.type'],
      ['$core', 'entity.name.tag'],
      ['()', 'storage.type'],
      ['"Port"', 'string.quoted.double'],
      ['()', 'storage.type'],
      ['Iface', 'entity.name.type'],
      ['interface', 'storage.type'],
      ['node', 'storage.type'],
      ['database', 'storage.type'],
      ['cloud', 'storage.type'],
      ['person', 'storage.type'],
      ['artifact', 'storage.type'],
      ['folder', 'storage.type'],
      ['file', 'storage.type'],
      ['frame', 'storage.type'],
      ['card', 'storage.type'],
      ['hexagon', 'storage.type'],
      ['label', 'storage.type'],
      ['agent', 'storage.type'],
      ['boundary', 'storage.type'],
      ['control', 'storage.type'],
      ['entity', 'storage.type'],
      ['collections', 'storage.type'],
      ['queue', 'storage.type'],
      ['stack', 'storage.type'],
      ['storage', 'storage.type'],
      ['action', 'storage.type'],
      ['process', 'storage.type'],
      ['rectangle', 'storage.type'],
      ['package', 'storage.type'],
      ['circle', 'storage.type'],
      ['port', 'storage.type'],
      ['portin', 'storage.type'],
      ['portout', 'storage.type'],
      ['"Quoted"', 'string.quoted.double'],
      ['QU', 'entity.name.type'],
      ['Code', 'entity.name.type'],
      ['as', 'keyword.other'],
      ['"Display"', 'string.quoted.double'],
    ],
  },
  {
    name: 'links between elements: short forms, tildes, directions, several styles, cardinalities',
    covers: ['command:CommandLinkElement'],
    source: uml`
      @startuml
      actor User
      usecase UC1
      User --> (Browse)
      User -> UC1 : starts
      :Admin: ..> [Web UI] : deploys
      [Web UI] -up-> () API
      (Browse) ~~> (Other)
      User -[#red;#blue]-> UC1
      User -[dotted]left-> [Web UI]
      [Web UI] "1" --> "many" UC1
      @enduml
    `,
    expect: [
      ['User', 'entity.name.type'],
      ['-->', 'keyword.operator.arrow'],
      ['(', 'punctuation.definition.element.begin'],
      ['Browse', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      [':', 'punctuation.separator.label'],
      [':', 'punctuation.definition.element.begin'],
      ['Admin', 'entity.name.type'],
      ['..>', 'keyword.operator.arrow'],
      ['Web UI', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['-up->', 'keyword.operator.arrow'],
      ['()', 'punctuation.definition.element'],
      ['API', 'entity.name.type'],
      ['~~>', 'keyword.operator.arrow'],
      ['Other', 'entity.name.type'],
      ['-[', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      ['#blue', 'constant.other.color'],
      [']->', 'keyword.operator.arrow'],
      ['dotted', 'keyword.other.line-style'],
      [']left->', 'keyword.operator.arrow'],
      ['"1"', 'string.quoted.double'],
      ['-->', 'keyword.operator.arrow'],
      ['"many"', 'string.quoted.double'],
    ],
  },
  {
    name: 'notes on elements: one line, several lines, braces',
    covers: [
      'command:CommandFactoryNoteOnEntity("desc",RegexOr,ONE).createSingleLine',
      'command:CommandFactoryNoteOnEntity("desc",RegexOr,ONE).createMultiLine(true)',
      'command:CommandFactoryNoteOnEntity("desc",RegexOr,ONE).createMultiLine(false)',
    ],
    source: uml`
      @startuml
      component Service
      note left of Service : single
      note right of Service
        multi
      end note
      note bottom of Service {
        braces
      }
      note "floating" as N1
      N1 .. Service
      @enduml
    `,
    expect: [
      ['component', 'storage.type'],
      ['note', 'keyword.other.note'],
      ['left', 'keyword.other'],
      ['Service', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['note', 'keyword.other.note'],
      ['right', 'keyword.other'],
      ['end note', 'keyword.other.note'],
      ['bottom', 'keyword.other'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['..', 'keyword.operator.arrow'],
    ],
  },
  {
    name: 'ArchiMate elements, multi-line descriptions and groups',
    covers: ['command:CommandArchimate', 'command:CommandArchimateMultilines', 'command:CommandArchimatePackage'],
    source: uml`
      @startuml
      archimate #Technology "VPN Server" as vpnServerA <<technology-device>>
      archimate #Business Customer <<business-actor>>
      archimate #Application App1 <<application-component>> [
        first line
        second line
      ]
      archimate #Strategy "Group" as grp <<strategy-capability>> {
        archimate #Strategy Cap1 <<strategy-capability>>
      }
      Customer -> vpnServerA
      @enduml
    `,
    expect: [
      ['archimate', 'storage.type'],
      ['#Technology', 'constant.other.color'],
      ['"VPN Server"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['vpnServerA', 'entity.name.type'],
      ['<<technology-device>>', 'entity.name.tag.stereotype !keyword.operator.arrow'],
      ['archimate', 'storage.type'],
      ['Customer', 'entity.name.type'],
      ['<<business-actor>>', 'entity.name.tag.stereotype'],
      ['archimate', 'storage.type'],
      ['App1', 'entity.name.type'],
      ['[', 'punctuation.section.brackets.begin'],
      [']', 'punctuation.section.brackets.end'],
      ['archimate', 'storage.type'],
      ['"Group"', 'string.quoted.double'],
      ['{', 'punctuation.section.block.begin'],
      ['Cap1', 'entity.name.type'],
      ['}', 'punctuation.section.block.end'],
      ['->', 'keyword.operator.arrow'],
    ],
  },
  {
    name: 'requirements and domains',
    covers: ['command:CommandCreateDomain'],
    source: uml`
      @startuml
      requirement "Fast response" as R1 <<performance>>
      domain "Shop" as D1 {
        requirement "Inner" as R2
      }
      @enduml
    `,
    expect: [
      ['requirement', 'storage.type'],
      ['Fast response', 'string.quoted.double entity.name.type'],
      ['as', 'keyword.other'],
      ['R1', 'entity.name.type'],
      ['<<performance>>', 'entity.name.tag.stereotype'],
      ['domain', 'storage.type'],
      ['Shop', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['requirement', 'storage.type'],
      ['R2', 'entity.name.type'],
      ['}', 'punctuation.section.block.end'],
    ],
  },
  {
    name: 'elements whose description spans several lines',
    covers: ['command:CommandCreateElementMultilines.TYPE0', 'command:CommandCreateElementMultilines.TYPE1'],
    source: uml`
      @startuml
      usecase UC1 as "first line
      second **line**
      last line"
      component C1 <<Service>> [
        multi-line
        description
      ]
      UC1 --> C1
      @enduml
    `,
    expect: [
      ['usecase', 'storage.type'],
      ['UC1', 'entity.name.type'],
      ['as', 'keyword.other'],
      ['"first line', 'string.quoted.double'],
      ['line', 'markup.bold'],
      ['last line"', 'string.quoted.double'],
      ['component', 'storage.type'],
      ['C1', 'entity.name.type'],
      ['<<Service>>', 'entity.name.tag.stereotype'],
      ['[', 'punctuation.section.brackets.begin'],
      [']', 'punctuation.section.brackets.end'],
      ['-->', 'keyword.operator.arrow'],
    ],
  },
  {
    name: 'multi-line descriptions after a stereotype, a link and a colour',
    covers: ['command:CommandCreateElementMultilines.TYPE0', 'command:CommandCreateElementMultilines.TYPE1'],
    source: uml`
      @startuml
      node B <<server>> #red|green;line.dashed;line:blue [
      First line
      ]
      rectangle R [[https://example.com]] #pink as "Rectangle
      with two lines"
      @enduml
    `,
    expect: [
      ['node', 'storage.type'],
      ['<<server>>', 'entity.name.tag.stereotype'],
      ['#red|green;line.dashed;line:blue', 'constant.other.color'],
      ['[', 'punctuation.section.brackets.begin'],
      [']', 'punctuation.section.brackets.end'],
      ['rectangle', 'storage.type'],
      ['[[https://example.com]]', 'markup.underline.link'],
      ['#pink', 'constant.other.color'],
      ['as', 'keyword.other'],
      ['with two lines', 'string.quoted.double'],
    ],
  },
  {
    name: 'a package and a card with a description in brackets, not read as class containers',
    covers: ['command:CommandCreateElementMultilines.TYPE1'],
    source: uml`
      @startuml
      package foo1 [
        text containing a description
      ]
      card G [{{
      title With GraphViz
      component c1
      }}]
      @enduml
    `,
    expect: [
      ['package', 'storage.type'],
      ['[', 'punctuation.section.brackets.begin'],
      [']', 'punctuation.section.brackets.end'],
      ['card', 'storage.type'],
      ['[', 'punctuation.section.brackets.begin'],
      ['{{', '!punctuation.section.block.begin'],
      [']', 'punctuation.section.brackets.end'],
    ],
  },
];
