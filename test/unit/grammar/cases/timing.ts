import { uml, type GrammarCase } from './types';

export const timingCases: GrammarCase[] = [
  {
    name: 'timing players: robust, concise, rectangle, binary, clock and analog',
    covers: ['command:CommandRobustConcise', 'command:CommandBinary', 'command:CommandClock', 'command:CommandAnalog'],
    source: uml`
      @startuml
      robust "Web Browser" as WB
      concise "Web User" <<user>> as WU #lightblue
      compact concise Server
      binary "Enable" as EN
      binary Flag <<flag>>
      clock clk with period 50 pulse 15 offset 10
      clock "Clock" as clk2 with period 20
      analog "Voltage" between 0 and 5 as V
      compact analog "Current" from -1 to 1 as C
      @0
      WU is Idle
      EN is low
      V is 3.5
      @clk*2
      EN is high
      @enduml
    `,
    expect: [
      ['robust', 'storage.type'],
      ['"Web Browser"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['WB', 'entity.name.type'],
      ['concise', 'storage.type'],
      ['<<user>>', 'entity.name.tag.stereotype'],
      ['WU', 'entity.name.type'],
      ['#lightblue', 'constant.other.color'],
      ['compact', 'keyword.other'],
      ['concise', 'storage.type'],
      ['Server', 'entity.name.type'],
      ['binary', 'storage.type'],
      ['EN', 'entity.name.type'],
      ['Flag', 'entity.name.type'],
      ['<<flag>>', 'entity.name.tag.stereotype'],
      ['clock', 'storage.type'],
      ['clk', 'entity.name.type'],
      ['with', 'keyword.other'],
      ['period', 'keyword.other'],
      ['50', 'constant.numeric'],
      ['pulse', 'keyword.other'],
      ['15', 'constant.numeric'],
      ['offset', 'keyword.other'],
      ['clock', 'storage.type'],
      ['"Clock"', 'string.quoted.double'],
      ['clk2', 'entity.name.type'],
      ['analog', 'storage.type'],
      ['"Voltage"', 'string.quoted.double'],
      ['between', 'keyword.other'],
      ['0', 'constant.numeric'],
      ['and', 'keyword.other'],
      ['5', 'constant.numeric'],
      ['V', 'entity.name.type'],
      ['compact', 'keyword.other'],
      ['from', 'keyword.other'],
      ['-1', 'constant.numeric'],
      ['to', 'keyword.other'],
      ['C', 'entity.name.type'],
      ['3.5', 'constant.other.state'],
      ['clk', 'entity.name.type'],
      ['*', 'keyword.operator'],
      ['2', 'constant.numeric'],
    ],
  },
  {
    name: 'timing rectangles as players',
    covers: [],
    source: uml`
      @startuml
      rectangle "Queue" as Q
      @0
      Q is Empty
      @10
      Q is Full
      @enduml
    `,
    expect: [
      ['rectangle', 'storage.type'],
      ['Q', 'entity.name.type'],
      ['Q', 'entity.name.type'],
      ['is', 'keyword.other'],
      ['Empty', 'constant.other.state'],
    ],
  },
  {
    name: 'timing states: definitions, time marks, changes by player and by time',
    covers: [
      'command:CommandDefineStateShort',
      'command:CommandDefineStateLong',
      'command:CommandAtTime',
      'command:CommandAtPlayer',
      'command:CommandChangeStateByPlayerCode',
      'command:CommandChangeStateByTime',
    ],
    source: uml`
      @startuml
      concise "Web User" as WU
      robust "Web Browser" as WB
      concise Server
      WU has Idle,Waiting,Busy
      WB has "Processing request" as Proc
      @0
      WU is Idle
      WB is Idle
      Server is {hidden}
      @100
      WU is Waiting #pink : clicked
      WB is Proc
      Server is {...}
      @+50
      Server is {-}
      @200 as :done
      WU is {?}
      @WB
      300 is Idle
      +50 is {Idle,Proc}
      @WU
      400 is "Back to idle"
      @enduml
    `,
    expect: [
      ['WU', 'entity.name.type'],
      ['has', 'keyword.other'],
      ['Idle', 'constant.other.state'],
      [',', 'punctuation.separator.comma'],
      ['Busy', 'constant.other.state'],
      ['has', 'keyword.other'],
      ['"Processing request"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['Proc', 'constant.other.state'],
      ['@', 'keyword.operator.time'],
      ['0', 'constant.numeric'],
      ['WU', 'entity.name.type'],
      ['is', 'keyword.other'],
      ['Idle', 'constant.other.state'],
      ['{hidden}', 'keyword.other.state'],
      ['100', 'constant.numeric'],
      ['Waiting', 'constant.other.state'],
      ['#pink', 'constant.other.color'],
      [':', 'punctuation.separator.label'],
      ['{...}', 'keyword.other.state'],
      ['+50', 'constant.numeric'],
      ['{-}', 'keyword.other.state'],
      ['200', 'constant.numeric'],
      ['as', 'keyword.other'],
      [':done', 'entity.name.label'],
      ['{?}', 'keyword.other.state'],
      ['@', 'keyword.operator.time'],
      ['WB', 'entity.name.type'],
      ['300', 'constant.numeric'],
      ['is', 'keyword.other'],
      ['+50', 'constant.numeric'],
      ['{', 'punctuation.section.braces.begin'],
      ['Idle', 'constant.other.state'],
      ['Proc', 'constant.other.state'],
      ['WU', 'entity.name.type'],
      ['400', 'constant.numeric'],
      ['"Back to idle"', 'string.quoted.double'],
    ],
  },
  {
    name: 'timing messages, constraints, highlights and notes',
    covers: [
      'command:CommandTimeMessage',
      'command:CommandConstraint',
      'command:CommandHighlight',
      'command:CommandNote',
      'command:CommandNoteLong',
    ],
    source: uml`
      @startuml
      concise "Web User" as WU
      robust "Web Browser" as WB
      @0
      WU is Idle
      WB is Idle
      @100
      WU -> WB : request
      WB@+10 -[#red]> WU@+60 : reply
      WB@100 <-> @150 : {50 ms lag}
      highlight 100 to 200 #Gold;line:DimGrey : busy period
      note top of WU : first note
      note bottom of WB
        second note
      end note
      @enduml
    `,
    expect: [
      ['WU', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['WB', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['WB', 'entity.name.type'],
      ['@', 'keyword.operator.time'],
      ['+10', 'constant.numeric'],
      ['-[', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      [']>', 'keyword.operator.arrow'],
      ['WU', 'entity.name.type'],
      ['+60', 'constant.numeric'],
      ['WB', 'entity.name.type'],
      ['@', 'keyword.operator.time'],
      ['100', 'constant.numeric'],
      ['<->', 'keyword.operator.arrow'],
      ['@', 'keyword.operator.time'],
      ['150', 'constant.numeric'],
      [':', 'punctuation.separator.label'],
      ['highlight', 'keyword.other'],
      ['100', 'constant.numeric'],
      ['to', 'keyword.other'],
      ['200', 'constant.numeric'],
      ['#Gold;line:DimGrey', 'constant.other.color'],
      [':', 'punctuation.separator.label'],
      ['note', 'keyword.other.note'],
      ['top', 'keyword.other'],
      ['of', 'keyword.other'],
      ['first note', '!keyword'],
      ['note', 'keyword.other.note'],
      ['bottom', 'keyword.other'],
      ['end note', 'keyword.other.note'],
    ],
  },
  {
    name: 'timing settings: pixel scale, time axis, compact mode, ticks, height',
    covers: [
      'command:CommandScalePixel',
      'command:CommandHideTimeAxis',
      'command:CommandModeCompact',
      'command:CommandTicks',
      'command:CommandPixelHeight',
    ],
    source: uml`
      @startuml
      concise "User" as U
      concise "Job" as J
      scale 100 as 50 pixels
      hide time-axis
      mode compact
      U ticks every 50
      J ticks num on multiple 3
      J is 60 pixels height
      @0
      U is Idle
      J is Idle
      @100
      U is Busy
      @enduml
    `,
    expect: [
      ['scale', 'keyword.other'],
      ['100', 'constant.numeric'],
      ['as', 'keyword.other'],
      ['50', 'constant.numeric'],
      ['pixels', 'keyword.other'],
      ['hide', 'keyword.other'],
      ['time-axis', 'keyword.other'],
      ['mode', 'keyword.other'],
      ['compact', 'keyword.other'],
      ['U', 'entity.name.type'],
      ['ticks', 'keyword.other'],
      ['every', 'keyword.other'],
      ['50', 'constant.numeric'],
      ['ticks', 'keyword.other'],
      ['num on multiple', 'keyword.other'],
      ['3', 'constant.numeric'],
      ['J', 'entity.name.type'],
      ['is', 'keyword.other'],
      ['60', 'constant.numeric'],
      ['pixels', 'keyword.other'],
      ['height', 'keyword.other'],
    ],
  },
  {
    name: 'timing dates and the date format',
    covers: ['command:CommandUseDateFormat'],
    source: uml`
      @startuml
      concise "User" as U
      use date format "YY-MM-dd"
      @2026/10/01
      U is Idle
      @2026/10/05
      U is Busy
      @enduml
    `,
    expect: [
      ['use', 'keyword.other'],
      ['date', 'keyword.other'],
      ['format', 'keyword.other'],
      ['"YY-MM-dd"', 'string.quoted.double'],
      ['@', 'keyword.operator.time'],
      ['2026/10/01', 'constant.numeric'],
    ],
  },
  {
    name: 'timing hours, time units and a manual time axis',
    covers: [],
    source: uml`
      @startuml
      concise "Job" as J
      scale 1 s as 20 pixels
      manual time axis
      @10:00:00
      J is Idle
      @10:00:30
      J is Running
      @enduml
    `,
    expect: [
      ['scale', 'keyword.other'],
      ['s', 'constant.numeric.unit'],
      ['manual', 'keyword.other'],
      ['time axis', 'keyword.other'],
      ['10:00:00', 'constant.numeric'],
      ['10:00:30', 'constant.numeric'],
    ],
  },
  {
    name: 'sequence page breaks written @newpage are not timing players',
    covers: [],
    source: uml`
      @startuml
      Alice -> Bob
      @newpage
      Bob -> Alice
      @enduml
    `,
    expect: [['@newpage', 'keyword.other !keyword.operator.time !entity.name.type']],
  },
];
