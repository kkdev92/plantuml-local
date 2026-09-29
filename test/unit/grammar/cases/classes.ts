import { uml, type GrammarCase } from './types';

export const classCases: GrammarCase[] = [
  {
    name: 'class-like declarations with bodies, generics, inheritance, stereotypes and colours',
    covers: ['command:CommandCreateClassMultilines', 'command:CommandCreateClass'],
    source: uml`
      @startuml
      interface Repository<T> {
        + findById(id : long) : T
        + save(entity : T) : void
      }
      abstract class Base <<Entity>> #pink ##[dashed]blue {
        # id : long
        {abstract} + validate() : boolean
        {static} - count : int
      }
      class User extends Base implements Repository {
        - name : String
        - email : String
        + getName() : String
        + rename(String newName)
        -- private helpers --
        ~ String normalize(String s)
        == static ==
        __ underlined __
        .. dotted ..
        {field} fake() looks like a method
        {method} realMethod
      }
      enum Role {
        ADMIN
        USER
      }
      annotation Audited
      struct Point {
        x : int
        y : int
      }
      protocol Service
      exception NotFound
      metaclass Meta
      stereotype Mark
      dataclass Data
      record Rec
      circle C1
      diamond D1
      static class Helper
      class Box<T> {
        - value : T
      }
      class Empty {}
      class NextLine
      {
        + field : int
      }
      class "Display Name" as Named
      class Code as "Displayed"
      @enduml
    `,
    expect: [
      ['interface', 'storage.type'],
      ['Repository', 'entity.name.type'],
      ['<', 'punctuation.definition.typeparameters'],
      ['T', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['+', 'storage.modifier.visibility'],
      ['findById', 'entity.name.function.member'],
      ['id', 'variable.parameter'],
      ['long', 'entity.name.type'],
      ['T', 'entity.name.type'],
      ['save', 'entity.name.function.member'],
      ['void', 'entity.name.type'],
      ['}', 'punctuation.section.block.end'],
      ['abstract class', 'storage.type'],
      ['Base', 'entity.name.type'],
      ['<<Entity>>', 'entity.name.tag.stereotype'],
      ['#pink', 'constant.other.color'],
      ['##', 'keyword.operator.line-color'],
      ['dashed', 'keyword.other.line-style'],
      ['blue', 'constant.other.color'],
      ['#', 'storage.modifier.visibility'],
      ['id', 'variable.other.member'],
      ['{abstract}', 'storage.modifier'],
      ['validate', 'entity.name.function.member'],
      ['boolean', 'entity.name.type'],
      ['{static}', 'storage.modifier'],
      ['-', 'storage.modifier.visibility !keyword.operator.arrow'],
      ['count', 'variable.other.member'],
      ['class', 'storage.type'],
      ['User', 'entity.name.type'],
      ['extends', 'keyword.other'],
      ['Base', 'entity.name.type'],
      ['implements', 'keyword.other'],
      ['Repository', 'entity.name.type'],
      ['-', 'storage.modifier.visibility !keyword.operator.arrow'],
      ['name', 'variable.other.member !keyword.operator.arrow'],
      [':', 'punctuation.separator.type !punctuation.separator.label'],
      ['String', 'entity.name.type !meta.label'],
      ['-', 'storage.modifier.visibility !keyword.operator.arrow'],
      ['email', 'variable.other.member !keyword.operator.arrow'],
      ['getName', 'entity.name.function.member'],
      ['rename', 'entity.name.function.member'],
      ['String', 'entity.name.type'],
      ['newName', 'variable.parameter'],
      ['--', 'punctuation.separator.member'],
      ['~', 'storage.modifier.visibility'],
      ['String', 'entity.name.type'],
      ['normalize', 'entity.name.function.member'],
      ['==', 'punctuation.separator.member'],
      ['__', 'punctuation.separator.member'],
      ['..', 'punctuation.separator.member'],
      ['{field}', 'storage.modifier'],
      ['{method}', 'storage.modifier'],
      ['enum', 'storage.type'],
      ['ADMIN', 'variable.other.member'],
      ['annotation', 'storage.type'],
      ['Audited', 'entity.name.type'],
      ['struct', 'storage.type'],
      ['protocol', 'storage.type'],
      ['exception', 'storage.type'],
      ['metaclass', 'storage.type'],
      ['stereotype', 'storage.type'],
      ['dataclass', 'storage.type'],
      ['record', 'storage.type'],
      ['circle', 'storage.type'],
      ['diamond', 'storage.type'],
      ['static class', 'storage.type'],
      ['class', 'storage.type'],
      ['Box', 'entity.name.type'],
      ['T', 'entity.name.type'],
      ['-', 'storage.modifier.visibility !keyword.operator.arrow'],
      ['value', 'variable.other.member !keyword.operator.arrow'],
      ['Empty', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['NextLine', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['field', 'variable.other.member'],
      ['}', 'punctuation.section.block.end'],
      ['"Display Name"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['Named', 'entity.name.type'],
      ['Code', 'entity.name.type'],
      ['as', 'keyword.other'],
      ['Displayed', 'string.quoted.double entity.name.type'],
    ],
  },
  {
    name: 'members added to an existing class',
    covers: ['command:CommandAddMethod'],
    source: uml`
      @startuml
      class Order
      Order : + total() : double
      Order : status : String
      Order : {static} counter
      @enduml
    `,
    expect: [
      ['Order', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['+', 'storage.modifier.visibility'],
      ['total', 'entity.name.function.member'],
      ['double', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['String', 'entity.name.type'],
      ['{static}', 'storage.modifier'],
    ],
  },
  {
    name: 'objects with fields, one-line objects',
    covers: ['command:CommandCreateEntityObjectMultilines', 'command:CommandCreateEntityObject'],
    source: uml`
      @startuml
      object user {
        name = "Dummy"
        id = 123
      }
      object "Main Group" as group <<Team>> #lightgreen
      object alone
      user --> group
      @enduml
    `,
    expect: [
      ['object', 'storage.type'],
      ['user', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['name', 'variable.other.member'],
      ['=', 'keyword.operator.assignment'],
      ['"Dummy"', 'string.quoted.double'],
      ['id', 'variable.other.member'],
      ['123', 'constant.numeric'],
      ['}', 'punctuation.section.block.end'],
      ['object', 'storage.type'],
      ['Main Group', 'string.quoted.double entity.name.type'],
      ['as', 'keyword.other'],
      ['group', 'entity.name.type'],
      ['<<Team>>', 'entity.name.tag.stereotype'],
      ['#lightgreen', 'constant.other.color'],
      ['alone', 'entity.name.type'],
      ['-->', 'keyword.operator.arrow'],
    ],
  },
  {
    name: 'maps: key => value entries and links to objects',
    covers: ['command:CommandCreateMap'],
    source: uml`
      @startuml
      object London
      map "Capital cities" as CC #lightblue ##[dashed]blue {
        UK => London
        France => Paris
        Home *-> London
      }
      @enduml
    `,
    expect: [
      ['map', 'storage.type'],
      ['Capital cities', 'entity.name.type'],
      ['as', 'keyword.other'],
      ['CC', 'entity.name.type'],
      ['#lightblue', 'constant.other.color'],
      ['##', 'keyword.operator.line-color'],
      ['UK', 'variable.other.member'],
      ['=>', 'keyword.operator.key-value'],
      ['France', 'variable.other.member'],
      ['Home', 'variable.other.member'],
      ['*->', 'keyword.operator.arrow'],
      ['London', 'entity.name.type'],
    ],
  },
  {
    name: 'JSON data over several lines, balanced braces, and one-line values',
    covers: ['command:CommandCreateJson', 'command:CommandCreateJsonSingleLine'],
    source: uml`
      @startuml
      json config {
        "name": "plantuml-local",
        "tags": ["vscode", "markdown"],
        "nested": {
          "enabled": true,
          "count": 3,
          "none": null
        }
      }
      json flag true
      json numbers [1, 2, 3]
      json title "text"
      json obj {"a": 1}
      @enduml
    `,
    expect: [
      ['json', 'storage.type'],
      ['config', 'entity.name.type'],
      ['{', 'punctuation.definition.dictionary.begin'],
      ['"name"', 'support.type.property-name'],
      ['"plantuml-local"', 'string.quoted.double'],
      ['[', 'punctuation.definition.array.begin'],
      ['"nested"', 'support.type.property-name'],
      ['true', 'constant.language'],
      ['3', 'constant.numeric'],
      ['null', 'constant.language'],
      ['}', 'punctuation.definition.dictionary.end'],
      ['}', 'punctuation.definition.dictionary.end'],
      ['json', 'storage.type'],
      ['flag', 'entity.name.type'],
      ['true', 'constant.language'],
      ['json', 'storage.type'],
      ['1', 'constant.numeric'],
      ['"text"', 'string.quoted.double'],
      ['"a"', 'support.type.property-name'],
    ],
  },
  {
    name: 'packages, namespaces, containers with a shape, together, braces on the next line',
    covers: [
      'command:CommandPackage',
      'command:CommandPackageEmpty',
      'command:CommandEndPackage',
      'command:CommandPackageWithUSymbol',
      'command:CommandNamespace',
      'command:CommandNamespace2',
      'command:CommandNamespaceEmpty',
      'command:CommandTogether',
    ],
    source: uml`
      @startuml
      package com.example <<Folder>> #EEEEEE {
        class Service
      }
      package "Quoted Package" as qp {
        class Inside
      }
      package empty {}
      namespace net.dummy #DDDDDD {
        class Person
      }
      namespace "Display" as net.other {
        class Other
      }
      namespace net.empty {}
      rectangle Boundary {
        class Guarded
      }
      together {
        class A1
        class A2
      }
      package Later
      {
        class InLater
      }
      @enduml
    `,
    expect: [
      ['package', 'storage.type'],
      ['com.example', 'entity.name.type !keyword.operator.arrow'],
      ['<<Folder>>', 'entity.name.tag.stereotype'],
      ['#EEEEEE', 'constant.other.color'],
      ['{', 'punctuation.section.block.begin'],
      ['class', 'storage.type'],
      ['}', 'punctuation.section.block.end'],
      ['"Quoted Package"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['qp', 'entity.name.type'],
      ['empty', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['namespace', 'storage.type'],
      ['net.dummy', 'entity.name.type'],
      ['#DDDDDD', 'constant.other.color'],
      ['namespace', 'storage.type'],
      ['"Display"', 'string.quoted.double'],
      ['net.other', 'entity.name.type'],
      ['net.empty', 'entity.name.type'],
      ['rectangle', 'storage.type'],
      ['Boundary', 'entity.name.type'],
      ['together', 'keyword.other'],
      ['{', 'punctuation.section.block.begin'],
      ['package', 'storage.type'],
      ['Later', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['class', 'storage.type'],
      ['InLater', 'entity.name.type'],
      ['}', 'punctuation.section.block.end'],
    ],
  },
  {
    name: 'links: inheritance, composition, aggregation, cardinalities, roles, qualifiers, styles, directions',
    covers: ['command:CommandLinkClass(CLASS)'],
    source: uml`
      @startuml
      class A
      class B
      class C
      class D
      A <|-- B
      A *-- "many" C : has >
      C "1" o-- "0..*" D : < owns
      A ..> D : uses
      A -[#red,dashed]-> B
      A -up-> C
      B --|> A
      A }o--|| D
      A -(0)- B
      A +-- C
      A #-- D
      A x-- B
      A --o C
      (A, B) .. C
      A [key] -- B
      A "role" -- "other" D
      @2 A -- D
      A --> B #blue : colored
      A --> C <<uses>>
      @enduml
    `,
    expect: [
      ['A', 'entity.name.type'],
      ['<|--', 'keyword.operator.arrow'],
      ['B', 'entity.name.type'],
      ['*--', 'keyword.operator.arrow'],
      ['"many"', 'string.quoted.double'],
      [':', 'punctuation.separator.label'],
      ['>', 'keyword.operator.direction'],
      ['"1"', 'string.quoted.double'],
      ['o--', 'keyword.operator.arrow'],
      ['"0..*"', 'string.quoted.double'],
      ['<', 'keyword.operator.direction'],
      ['..>', 'keyword.operator.arrow'],
      ['-[', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      ['dashed', 'keyword.other.line-style'],
      [']->', 'keyword.operator.arrow'],
      ['-up->', 'keyword.operator.arrow'],
      ['--|>', 'keyword.operator.arrow'],
      ['}o--||', 'keyword.operator.arrow'],
      ['-(0)-', 'keyword.operator.arrow'],
      ['+--', 'keyword.operator.arrow'],
      ['#--', 'keyword.operator.arrow'],
      ['x--', 'keyword.operator.arrow'],
      ['--o', 'keyword.operator.arrow'],
      ['(', 'punctuation.section.parens'],
      ['A', 'entity.name.type'],
      [',', 'punctuation.section.parens'],
      ['..', 'keyword.operator.arrow'],
      ['[', 'punctuation.definition.qualifier.begin'],
      ['key', 'variable.other.qualifier'],
      ['"role"', 'string.quoted.double'],
      ['@2', 'constant.numeric.weight'],
      ['#blue', 'constant.other.color'],
      ['<<uses>>', 'entity.name.tag.stereotype'],
    ],
  },
  {
    name: 'lollipop interfaces',
    covers: ['command:CommandLinkLollipop(CLASS)'],
    source: uml`
      @startuml
      class Foo
      class Bar
      Foo ()-- Bar
      Bar --() Foo : provides
      @enduml
    `,
    expect: [
      ['Foo', 'entity.name.type'],
      ['()--', 'keyword.operator.arrow'],
      ['Bar', 'entity.name.type'],
      ['--()', 'keyword.operator.arrow'],
      [':', 'punctuation.separator.label'],
    ],
  },
  {
    name: 'constraints on links and association diamonds',
    covers: ['command:CommandConstraintOnLinks', 'command:CommandDiamondAssociation'],
    source: uml`
      @startuml
      class A
      class B
      class C
      A -- B
      A -- C
      constraint on links #red : xor
      <> diamond
      diamond -- A
      diamond -- B
      @enduml
    `,
    expect: [
      ['constraint', 'keyword.other'],
      ['on', 'keyword.other'],
      ['links', 'keyword.other'],
      ['#red', 'constant.other.color'],
      [':', 'punctuation.separator.label'],
      ['<>', 'storage.type'],
      ['diamond', 'entity.name.type'],
    ],
  },
  {
    name: 'element shapes in class diagrams: allow mixing, mix_ prefix, () interfaces',
    covers: [
      'command:CommandAllowMixing',
      'command:CommandCreateElementFull2(NORMAL_KEYWORD)',
      'command:CommandCreateElementFull2(WITH_MIX_PREFIX)',
      'command:CommandCreateElementParenthesis',
    ],
    source: uml`
      @startuml
      allowmixing
      class Base
      usecase UC1
      actor Player
      component Engine
      mix_actor Mixed
      () Port1
      () "Port Two" as P2
      @enduml
    `,
    expect: [
      ['allowmixing', 'keyword.other'],
      ['usecase', 'storage.type'],
      ['UC1', 'entity.name.type'],
      ['actor', 'storage.type'],
      ['component', 'storage.type'],
      ['mix_actor', 'storage.type'],
      ['Mixed', 'entity.name.type'],
      ['()', 'storage.type'],
      ['Port1', 'entity.name.type'],
      ['()', 'storage.type'],
      ['"Port Two"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['P2', 'entity.name.type'],
    ],
  },
  {
    name: 'stereotypes on existing classes, hide, show, remove and restore',
    covers: ['command:CommandStereotype', 'command:CommandHideShow2', 'command:CommandRemoveRestore'],
    source: uml`
      @startuml
      class Foo
      Foo <<Entity>>
      hide Foo
      show Foo
      hide-class Foo
      show-class Foo
      hide <<Entity>>
      hide @unlinked
      remove Foo
      restore Foo
      @enduml
    `,
    expect: [
      ['Foo', 'entity.name.type'],
      ['<<Entity>>', 'entity.name.tag.stereotype'],
      ['hide', 'keyword.other'],
      ['Foo', 'entity.name.type'],
      ['show', 'keyword.other'],
      ['hide-class', 'keyword.other'],
      ['show-class', 'keyword.other'],
      ['hide', 'keyword.other !entity.name.type'],
      ['<<Entity>>', 'entity.name.tag.stereotype'],
      ['@unlinked', 'keyword.other'],
      ['remove', 'keyword.other'],
      ['restore', 'keyword.other'],
    ],
  },
  {
    name: 'layout direction, layout breaks, links on classes, pages',
    covers: [
      'command:CommandRankDir',
      'command:CommandLayoutNewLine',
      'command:classdiagram.CommandUrl',
      'command:descdiagram.CommandNewpage',
    ],
    source: uml`
      @startuml
      left to right direction
      class A
      layout_new_line
      class B
      url of A is [[https://example.com]]
      newpage
      class C
      @enduml
    `,
    expect: [
      ['left to right', 'keyword.other'],
      ['direction', 'keyword.other'],
      ['layout_new_line', 'keyword.other'],
      ['url', 'keyword.other'],
      ['of', 'keyword.other'],
      ['A', 'entity.name.type'],
      ['is', 'keyword.other'],
      ['[[', 'punctuation.definition.link.begin'],
      ['newpage', 'keyword.other'],
    ],
  },
  {
    name: 'notes in class diagrams: floating, on classes, on members, on links',
    covers: [
      'command:CommandFactoryNote.createSingleLine',
      'command:CommandFactoryNote.createMultiLine(false)',
      'command:CommandFactoryNoteOnEntity("class",codeForClass,ONE).createSingleLine',
      'command:CommandFactoryNoteOnEntity("class",codeForClass,ONE).createMultiLine(true)',
      'command:CommandFactoryNoteOnEntity("class",codeForClass,ONE).createMultiLine(false)',
      'command:CommandFactoryTipOnEntity.createMultiLine(true)',
      'command:CommandFactoryTipOnEntity.createMultiLine(false)',
      'command:CommandFactoryNoteOnLink(ONE).createSingleLine',
      'command:CommandFactoryNoteOnLink(ONE).createMultiLine(false)',
    ],
    source: uml`
      @startuml
      class Order {
        + total() : double
        - items : List
      }
      class Customer
      note "Floating note" as N1
      note as N2
        several
        lines
      end note
      N1 .. Order
      note left of Order : **one** line
      note right of Order
        several lines
      end note
      note top of Customer {
        in braces
      }
      note right of Order::total
        on a member
      end note
      note left of Order::items {
        on a field
      }
      Order --> Customer
      note on link : on the link
      Customer --> Order
      note right on link
        several lines
      end note
      @enduml
    `,
    expect: [
      ['note', 'keyword.other.note'],
      ['"Floating note"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['N1', 'entity.name.type'],
      ['note', 'keyword.other.note'],
      ['as', 'keyword.other'],
      ['N2', 'entity.name.type'],
      ['end note', 'keyword.other.note'],
      ['..', 'keyword.operator.arrow'],
      ['left', 'keyword.other'],
      ['of', 'keyword.other'],
      ['Order', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['one', 'markup.bold'],
      ['right', 'keyword.other'],
      ['end note', 'keyword.other.note'],
      ['top', 'keyword.other'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['Order::total', 'entity.name.type'],
      ['end note', 'keyword.other.note'],
      ['Order::items', 'entity.name.type'],
      ['{', 'punctuation.section.block.begin'],
      ['}', 'punctuation.section.block.end'],
      ['on', 'keyword.other'],
      ['link', 'keyword.other'],
      [':', 'punctuation.separator.label'],
      ['right', 'keyword.other'],
      ['on', 'keyword.other'],
      ['link', 'keyword.other'],
      ['end note', 'keyword.other.note'],
    ],
  },
];
