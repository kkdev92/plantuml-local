import { uml, type GrammarCase } from './types';

export const sequenceCases: GrammarCase[] = [
  {
    name: 'participants of every kind, with aliases, order, stereotypes, links and colours',
    covers: [
      'command:CommandParticipantA',
      'command:CommandParticipantA2',
      'command:CommandParticipantA3',
      'command:CommandParticipantA4',
    ],
    source: uml`
      @startuml
      participant "Web App" as Web <<Frontend>> order 10 [[https://example.com]] #lightblue
      actor User
      boundary Gate as "The gate"
      control Ctl as C
      entity "Order"
      database DB #FFAAAA
      queue Q
      collections Items
      create participant Late
      Web -> Late
      @enduml
    `,
    expect: [
      ['participant', 'storage.type'],
      ['Web App', 'string.quoted.double entity.name.type'],
      ['as', 'keyword.other'],
      ['Web', 'entity.name.type'],
      ['<<Frontend>>', 'entity.name.tag.stereotype'],
      ['order', 'keyword.other'],
      ['10', 'constant.numeric'],
      ['[[', 'punctuation.definition.link.begin'],
      ['#lightblue', 'constant.other.color'],
      ['actor', 'storage.type'],
      ['User', 'entity.name.type'],
      ['boundary', 'storage.type'],
      ['as', 'keyword.other'],
      ['"The gate"', 'string.quoted.double'],
      ['control', 'storage.type'],
      ['entity', 'storage.type'],
      ['database', 'storage.type'],
      ['#FFAAAA', 'constant.other.color'],
      ['queue', 'storage.type'],
      ['collections', 'storage.type'],
      ['create', 'storage.type'],
      ['participant', 'storage.type'],
      ['Late', 'entity.name.type'],
    ],
  },
  {
    name: 'a participant whose display spans several lines',
    covers: ['command:CommandParticipantMultilines'],
    source: uml`
      @startuml
      participant Service [
        =Service
        ----
        ""version 2""
      ]
      Service -> Service
      @enduml
    `,
    expect: [
      ['participant', 'storage.type'],
      ['Service', 'entity.name.type'],
      ['[', 'punctuation.section.brackets.begin'],
      ['=', 'punctuation.definition.heading'],
      ['version 2', 'markup.inline.raw'],
      [']', 'punctuation.section.brackets.end'],
    ],
  },
  {
    name: 'messages: arrow shapes, styles, heads, lost and found messages',
    covers: ['command:CommandArrow'],
    source: uml`
      @startuml
      Alice -> Bob : sync
      Alice --> Bob : reply
      Alice ->> Bob : async
      Alice -\ Bob : half
      Alice -\\ Bob : thin half
      Alice -// Bob : thin
      Alice ->x Bob : lost
      Alice o->o Bob : circles
      Alice <-> Bob : both
      Alice -[#red]> Bob : red
      Alice -[#blue,dashed]-> Bob : blue dashed
      Alice -[bold]->> Bob
      "Long name" as L -> Bob : quoted
      Alice -> Bob ++ #gold : activate the target
      Bob --> Alice -- : deactivate the source
      Alice -> Bob & Carol : multicast
      @enduml
    `,
    expect: [
      ['Alice', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['Bob', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['-->', 'keyword.operator.arrow'],
      ['->>', 'keyword.operator.arrow'],
      ['-\\', 'keyword.operator.arrow'],
      ['-\\\\', 'keyword.operator.arrow'],
      ['-//', 'keyword.operator.arrow'],
      ['->x', 'keyword.operator.arrow'],
      ['o->o', 'keyword.operator.arrow'],
      ['<->', 'keyword.operator.arrow'],
      ['-[', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      [']>', 'keyword.operator.arrow'],
      ['#blue', 'constant.other.color'],
      ['dashed', 'keyword.other.line-style'],
      ['bold', 'keyword.other.line-style'],
      ['"Long name"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['++', 'keyword.operator.activation'],
      ['#gold', 'constant.other.color'],
      ['-->', 'keyword.operator.arrow'],
      ['Alice', 'entity.name.type'],
      ['--', 'keyword.operator.activation'],
      ['&', 'keyword.operator.parallel'],
      ['Carol', 'entity.name.type'],
    ],
  },
  {
    name: 'messages from and to the edge of the diagram',
    covers: ['command:CommandExoArrowLeft', 'command:CommandExoArrowRight'],
    source: uml`
      @startuml
      [-> Alice : from the left
      [o-> Alice
      ?-> Alice : short
      Alice ->] : to the right
      Alice ->o] : circle
      Alice ->? : short
      Alice <--] : back
      @enduml
    `,
    expect: [
      ['[', 'keyword.operator.arrow'],
      ['->', 'keyword.operator.arrow'],
      ['Alice', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['[o', 'keyword.operator.arrow'],
      ['?', 'keyword.operator.arrow'],
      ['->', 'keyword.operator.arrow'],
      [']', 'keyword.operator.arrow'],
      ['->', 'keyword.operator.arrow'],
      ['o]', 'keyword.operator.arrow'],
      ['?', 'keyword.operator.arrow'],
      ['<--', 'keyword.operator.arrow'],
    ],
  },
  {
    name: 'teoz: parallel messages, anchors and durations',
    covers: ['command:CommandLinkAnchor'],
    source: uml`
      @startuml
      !pragma teoz true
      {start} Alice -> Bob : request
      & Bob -> Carol : forward
      {end} Bob -> Alice : response
      {start} <-> {end} : 2 s
      @enduml
    `,
    expect: [
      ['{start}', 'entity.name.label.anchor'],
      ['->', 'keyword.operator.arrow'],
      ['&', 'keyword.operator.parallel'],
      ['->', 'keyword.operator.arrow'],
      ['{end}', 'entity.name.label.anchor'],
      ['{start}', 'entity.name.label.anchor'],
      ['<->', 'keyword.operator.arrow'],
      ['{end}', 'entity.name.label.anchor'],
      [':', 'punctuation.separator.label'],
    ],
  },
  {
    name: 'activation, destruction, returns and auto-activation',
    covers: [
      'command:CommandActivate',
      'command:CommandDeactivateShort',
      'command:CommandActivate2',
      'command:CommandReturn',
      'command:CommandAutoactivate',
    ],
    source: uml`
      @startuml
      participant Alice
      participant Bob
      Alice -> Bob : call
      activate Bob #gold
      Bob -> Bob : self
      deactivate
      Alice -> Bob : again
      Bob++ #pink
      Bob --> Alice
      Bob--
      create Carol
      Alice -> Carol : new
      destroy Carol
      autoactivate on
      Alice -> Bob : auto
      return done
      @enduml
    `,
    expect: [
      ['activate', 'keyword.other'],
      ['Bob', 'entity.name.type'],
      ['#gold', 'constant.other.color'],
      ['deactivate', 'keyword.other'],
      ['Bob', 'entity.name.type'],
      ['++', 'keyword.operator.activation'],
      ['#pink', 'constant.other.color'],
      ['-->', 'keyword.operator.arrow'],
      ['Bob', 'entity.name.type'],
      ['--', 'keyword.operator.activation'],
      ['destroy', 'keyword.other'],
      ['autoactivate', 'keyword.other'],
      ['on', 'constant.language'],
      ['return', 'keyword.control'],
    ],
  },
  {
    name: 'groups: alt, else, opt, loop, par, break, critical, group, end, and boxes',
    covers: ['command:CommandGrouping', 'command:CommandBoxStart', 'command:CommandBoxEnd'],
    source: uml`
      @startuml
      box "Internal" #LightBlue
      participant Alice
      participant Bob
      end box
      alt#Gold #LightYellow success
        Alice -> Bob
      else failure
        Bob -> Alice
      end
      opt maybe
        Alice -> Bob
      end
      loop 1000 times
        Alice -> Bob
      end
      par
        Alice -> Bob
      also
        Bob -> Alice
      end
      break stop
        Alice -> Bob
      end
      critical
        Alice -> Bob
      end
      group Retry [up to three times]
        Alice -> Bob
      end
      @enduml
    `,
    expect: [
      ['box', 'keyword.control'],
      ['"Internal"', 'string.quoted.double'],
      ['#LightBlue', 'constant.other.color'],
      ['end box', 'keyword.control'],
      ['alt', 'keyword.control'],
      ['#Gold', 'constant.other.color'],
      ['#LightYellow', 'constant.other.color'],
      ['else', 'keyword.control'],
      ['end', 'keyword.control'],
      ['opt', 'keyword.control'],
      ['loop', 'keyword.control'],
      ['par', 'keyword.control'],
      ['also', 'keyword.control'],
      ['break', 'keyword.control'],
      ['critical', 'keyword.control'],
      ['group', 'keyword.control'],
      ['[', 'punctuation.section.brackets.begin'],
    ],
  },
  {
    name: 'notes on participants, over several, across, on messages, hnote and rnote',
    covers: [
      'command:FactorySequenceNoteCommand.createSingleLine',
      'command:FactorySequenceNoteCommand.createMultiLine(false)',
      'command:FactorySequenceNoteOverSeveralCommand.createSingleLine',
      'command:FactorySequenceNoteOverSeveralCommand.createMultiLine(false)',
      'command:FactorySequenceNoteAcrossCommand.createSingleLine',
      'command:FactorySequenceNoteAcrossCommand.createMultiLine(false)',
      'command:FactorySequenceNoteOnArrowCommand.createSingleLine',
      'command:FactorySequenceNoteOnArrowCommand.createMultiLine(false)',
    ],
    source: uml`
      @startuml
      participant Alice
      participant Bob
      note left of Alice #aqua : **left**
      note over Alice, Bob : shared
      hnote over Bob : hexagon
      rnote right of Bob
        rectangle
        note
      end rnote
      note over Alice, Bob
        spanning
      end note
      note across : everyone
      note across
        everyone again
      end note
      Alice -> Bob : call
      note right : on the message
      Bob -> Alice
      note left
        multi-line
        on the message
      end note
      @enduml
    `,
    expect: [
      ['note', 'keyword.other.note'],
      ['left', 'keyword.other'],
      ['of', 'keyword.other'],
      ['Alice', 'entity.name.type'],
      ['#aqua', 'constant.other.color'],
      [':', 'punctuation.separator.label'],
      ['left', 'markup.bold'],
      ['over', 'keyword.other'],
      [',', 'punctuation.separator.comma'],
      ['hnote', 'keyword.other.note'],
      ['rnote', 'keyword.other.note'],
      ['end rnote', 'keyword.other.note'],
      ['end note', 'keyword.other.note'],
      ['across', 'keyword.other'],
      ['across', 'keyword.other'],
      ['end note', 'keyword.other.note'],
      ['right', 'keyword.other'],
      ['note', 'keyword.other.note'],
      ['end note', 'keyword.other.note'],
    ],
  },
  {
    name: 'dividers, delays, spacing and references',
    covers: [
      'command:CommandDivider',
      'command:CommandDelay',
      'command:CommandHSpace',
      'command:CommandReferenceOverSeveral',
      'command:CommandReferenceMultilinesOverSeveral',
    ],
    source: uml`
      @startuml
      participant Alice
      participant Bob
      == Initialization ==
      Alice -> Bob
      ...
      ... 5 minutes later ...
      |||
      ||45||
      ref over Alice, Bob : init
      ref#pink over Bob
        multi-line
        reference
      end ref
      @enduml
    `,
    expect: [
      ['==', 'punctuation.separator.divider'],
      ['==', 'punctuation.separator.divider'],
      ['...', 'punctuation.separator.delay'],
      ['...', 'punctuation.separator.delay'],
      ['...', 'punctuation.separator.delay'],
      ['||', 'punctuation.separator.space'],
      ['45', 'constant.numeric'],
      ['ref', 'keyword.control'],
      ['over', 'keyword.other'],
      ['Alice', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['ref', 'keyword.control'],
      ['#pink', 'constant.other.color'],
      ['end ref', 'keyword.control'],
    ],
  },
  {
    name: 'autonumbering: start, step, format, stop, resume, increment',
    covers: [
      'command:CommandAutonumber',
      'command:CommandAutonumberStop',
      'command:CommandAutonumberResume',
      'command:CommandAutonumberIncrement',
    ],
    source: uml`
      @startuml
      autonumber 10 10 "<b>[000]"
      Alice -> Bob
      autonumber stop
      Alice -> Bob
      autonumber resume 5 "<font color=red>##"
      Alice -> Bob
      autonumber 1.1.1
      autonumber inc A
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['autonumber', 'keyword.other'],
      ['10', 'constant.numeric'],
      ['10', 'constant.numeric'],
      ['"<b>[000]"', 'string.quoted.double'],
      ['autonumber', 'keyword.other'],
      ['stop', 'keyword.other'],
      ['resume', 'keyword.other'],
      ['5', 'constant.numeric'],
      ['1.1.1', 'constant.numeric'],
      ['inc', 'keyword.other'],
      ['A', 'constant.numeric'],
    ],
  },
  {
    name: 'pages, footbox, unlinked participants and links',
    covers: [
      'command:sequencediagram.CommandNewpage',
      'command:CommandIgnoreNewpage',
      'command:CommandAutoNewpage',
      'command:CommandFootbox',
      'command:CommandFootboxOld',
      'command:CommandHideUnlinked',
      'command:sequencediagram.CommandUrl',
    ],
    source: uml`
      @startuml
      hide unlinked
      footbox off
      hide footbox
      autonewpage 20
      participant Alice
      participant Bob
      participant Unused
      url of Alice is [[https://example.com]]
      Alice -> Bob
      newpage Second page
      Alice -> Bob
      ignore newpage
      @enduml
    `,
    expect: [
      ['hide', 'keyword.other'],
      ['unlinked', 'keyword.other'],
      ['footbox', 'keyword.other'],
      ['off', 'constant.language'],
      ['hide', 'keyword.other'],
      ['footbox', 'keyword.other'],
      ['autonewpage', 'keyword.other'],
      ['20', 'constant.numeric'],
      ['url', 'keyword.other'],
      ['of', 'keyword.other'],
      ['is', 'keyword.other'],
      ['newpage', 'keyword.other'],
      ['ignore', 'keyword.other'],
      ['newpage', 'keyword.other'],
    ],
  },
  {
    name: 'messages from and to the edge without the edge mark',
    covers: ['command:CommandExoArrowLeft', 'command:CommandExoArrowRight'],
    source: uml`
      @startuml
      participant Bob
      participant Alice
      -> Bob : from the left edge
      Bob -> Alice : hi
      Alice -> : to the right edge
      Alice ->
      @enduml
    `,
    expect: [
      ['->', 'keyword.operator.arrow'],
      ['Bob', 'entity.name.type'],
      ['from the left edge', '!entity.name.type'],
      ['Alice', 'entity.name.type'],
      ['Alice', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['to the right edge', '!entity.name.type'],
      ['Alice', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
    ],
  },
];
