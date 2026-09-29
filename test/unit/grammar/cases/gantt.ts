import { uml, type GrammarCase } from './types';

export const ganttCases: GrammarCase[] = [
  {
    name: 'gantt tasks: project start, durations, starts and ends, dependencies',
    covers: [
      'command:NaturalGanttCommand(SubjectGantt)',
      'command:NaturalGanttCommand(SubjectTask)',
      'gantt:SubjectGantt starts ComplementDate.onlyAbsolute',
      'gantt:SubjectTask requires ComplementDuration',
      'gantt:SubjectTask starts ComplementBeforeOrAfterOrAtTaskStartOrEnd',
      'gantt:SubjectTask starts PairOfSomething(ComplementBeforeOrAfterOrAtTaskStartOrEnd,ComplementWithColorLink)',
      'gantt:SubjectTask starts ComplementDate.onlyRelative',
      'gantt:SubjectTask starts ComplementDate.any',
      'gantt:SubjectTask ends ComplementDate.onlyRelative',
      'gantt:SubjectTask ends ComplementDate.any',
      'gantt:SubjectTask happens ComplementDate.any',
      'gantt:SubjectTask happens ComplementBeforeOrAfterOrAtTaskStartOrEnd',
    ],
    source: uml`
      @startgantt
      Project starts the 1st of october 2026
      [Design] as [D] lasts 5 days
      [Build] requires 2 weeks and 3 days
      [Build] starts at [D]'s end
      [Test] requires 4 days
      [Test] starts 2 days after [Build]'s end with red dotted link
      then [Deploy] requires 1 day
      [Review] starts 2026-10-05 and ends 2026-10-09
      [Doc] starts D+3 and requires 3 days
      [Doc] ends D+10
      [Launch] happens 2026-11-20
      [Milestone] happens at [Test]'s end
      @endgantt
    `,
    expect: [
      ['Project', 'keyword.other'],
      ['starts', 'keyword.other'],
      ['the', 'keyword.other'],
      ['1st of october 2026', 'constant.numeric.date'],
      ['[', 'punctuation.definition.task.begin'],
      ['Design', 'entity.name.type'],
      [']', 'punctuation.definition.task.end'],
      ['as', 'keyword.other'],
      ['D', 'entity.name.type'],
      ['lasts', 'keyword.other'],
      ['5 days', 'constant.numeric'],
      ['Build', 'entity.name.type'],
      ['requires', 'keyword.other'],
      ['2 weeks', 'constant.numeric'],
      ['and', 'keyword.other'],
      ['3 days', 'constant.numeric'],
      ['starts', 'keyword.other'],
      ['at', 'keyword.other'],
      ['D', 'entity.name.type'],
      ["'s", 'keyword.other.possessive'],
      ['end', 'keyword.other'],
      ['2 days', 'constant.numeric'],
      ['after', 'keyword.other'],
      ['with', 'keyword.other'],
      ['red', 'support.constant.color'],
      ['dotted', 'keyword.other.line-style'],
      ['link', 'keyword.other'],
      ['then', 'keyword.other'],
      ['Deploy', 'entity.name.type'],
      ['2026-10-05', 'constant.numeric.date'],
      ['ends', 'keyword.other'],
      ['2026-10-09', 'constant.numeric.date'],
      ['D+3', 'constant.numeric'],
      ['D+10', 'constant.numeric'],
      ['happens', 'keyword.other'],
      ['2026-11-20', 'constant.numeric.date'],
      ['happens', 'keyword.other'],
      ['Test', 'entity.name.type'],
    ],
  },
  {
    name: 'gantt task states: completion, colours, deletion, rows, links, display names',
    covers: [
      'gantt:SubjectTask is ComplementDeleted',
      'gantt:SubjectTask is ComplementCompleted',
      'gantt:SubjectTask isColored ComplementInColors',
      'gantt:SubjectTask isColored for completion ComplementInColorsFromTo',
      'gantt:SubjectTask occurs ComplementFromTo',
      'gantt:SubjectTask displayOnSameRowAs ComplementNamed',
      'gantt:SubjectTask linksTo ComplementUrl',
      'gantt:SubjectTask isDisplayedAs ComplementAnything',
    ],
    source: uml`
      @startgantt
      Project starts 2026-10-01
      [Design] requires 5 days
      [Build] requires 5 days
      [Old] requires 2 days
      [Old] is deleted
      [Design] is 40% completed
      [Design] is colored in Lightblue/#0000FF
      [Build] is colored for completion from red to green
      [Extra] occurs from [Design] to [Build]
      [Extra2] requires 2 days
      [Extra2] displays on same row as [Extra]
      [Build] links to [[https://example.com]]
      [Build] is displayed as **Go live** on [Design] day
      @endgantt
    `,
    expect: [
      ['is', 'keyword.other'],
      ['deleted', 'keyword.other'],
      ['40%', 'constant.numeric'],
      ['completed', 'keyword.other'],
      ['colored', 'keyword.other'],
      ['in', 'keyword.other'],
      ['Lightblue', 'support.constant.color'],
      ['/', 'punctuation.separator.color'],
      ['#0000FF', 'constant.other.color'],
      ['colored', 'keyword.other'],
      ['for', 'keyword.other'],
      ['completion', 'keyword.other'],
      ['from', 'keyword.other'],
      ['red', 'support.constant.color'],
      ['to', 'keyword.other'],
      ['green', 'support.constant.color'],
      ['occurs', 'keyword.other'],
      ['from', 'keyword.other'],
      ['Design', 'entity.name.type'],
      ['to', 'keyword.other'],
      ['Build', 'entity.name.type'],
      ['displays', 'keyword.other'],
      ['on same row as', 'keyword.other'],
      ['Extra', 'entity.name.type'],
      ['links', 'keyword.other'],
      ['to', 'keyword.other'],
      ['https://example.com', 'markup.underline.link'],
      ['displayed', 'keyword.other'],
      ['as', 'keyword.other'],
      ['Go live', 'markup.bold'],
      ['on [Design] day', '!keyword.other !entity.name.type'],
    ],
  },
  {
    name: 'gantt task times and pauses',
    covers: [
      'gantt:SubjectTask starts ComplementTimePoint.any',
      'gantt:SubjectTask ends ComplementTimePoint.any',
      'gantt:SubjectTask ends ComplementBeforeOrAfterOrAtTaskStartOrEnd',
      'gantt:SubjectTask pauses ComplementIntervals',
      'gantt:SubjectTask pauses ComplementIntervalsSmart',
      'gantt:SubjectTask pauses ComplementDate.any',
      'gantt:SubjectTask pauses ComplementDayOfWeek',
    ],
    source: uml`
      @startgantt
      Project starts 2026-10-01
      [Prep] requires 3 days
      [Prep] starts 2026-10-02T09:00
      [Prep] ends 2026-10-06 17:30
      [Other] requires 2 days
      [Other] ends at [Prep]'s end
      [Pause] requires 10 days
      [Pause] pauses on 2026-10-03
      [Pause] pauses on D+5 to D+6
      [Pause] pauses from 2026-10-08 to the 2026-10-09
      [Pause] pauses on 2026-10-10 to 1 day after [Prep]'s end
      [Pause] pauses on monday
      @endgantt
    `,
    expect: [
      ['2026-10-02T09:00', 'constant.numeric.date'],
      ['ends', 'keyword.other'],
      ['2026-10-06 17:30', 'constant.numeric.date'],
      ['ends', 'keyword.other'],
      ['at', 'keyword.other'],
      ['Prep', 'entity.name.type'],
      ["'s", 'keyword.other.possessive'],
      ['pauses', 'keyword.other'],
      ['on', 'keyword.other'],
      ['2026-10-03', 'constant.numeric.date'],
      ['D+5', 'constant.numeric'],
      ['to', 'keyword.other'],
      ['D+6', 'constant.numeric'],
      ['from', 'keyword.other'],
      ['2026-10-08', 'constant.numeric.date'],
      ['the', 'keyword.other'],
      ['2026-10-09', 'constant.numeric.date'],
      ['2026-10-10', 'constant.numeric.date'],
      ['1 day', 'constant.numeric'],
      ['after', 'keyword.other'],
      ['Prep', 'entity.name.type'],
      ['monday', 'constant.language.weekday'],
    ],
  },
  {
    name: 'gantt resources and today',
    covers: [
      'command:NaturalGanttCommand(SubjectResource)',
      'command:NaturalGanttCommand(SubjectToday)',
      'gantt:SubjectResource isOff before ComplementDate.any',
      'gantt:SubjectResource isOff after ComplementDate.any',
      'gantt:SubjectResource isOff ComplementIntervals',
      'gantt:SubjectResource isOff ComplementDayOfWeek',
      'gantt:SubjectResource isOff ComplementDate.any',
      'gantt:SubjectResource isOn ComplementIntervals',
      'gantt:SubjectResource isOn ComplementDate.any',
      'gantt:SubjectToday isColored ComplementInColors',
      'gantt:SubjectToday is ComplementDate.any',
    ],
    source: uml`
      @startgantt
      Project starts 2026-10-01
      [Task1] on {Alice} requires 5 days
      [Task2] on {Bob:50%} {Carol} requires 3 days
      {Alice} is off on 2026-10-03
      {Alice} is off from 2026-10-05 to 2026-10-06
      {Alice} is off on saturday
      {Bob} is off before 2026-10-02
      {Bob} is off after 2026-10-20
      {Bob} is on 2026-10-04
      {Bob} is on 2026-10-10 to 2026-10-11
      today is colored in #AAF
      today is 2026-10-03
      @endgantt
    `,
    expect: [
      ['Task1', 'entity.name.type'],
      ['on', 'keyword.other'],
      ['{', 'punctuation.definition.resource.begin'],
      ['Alice', 'entity.name.type'],
      ['}', 'punctuation.definition.resource.end'],
      ['Bob:50%', 'entity.name.type'],
      ['Carol', 'entity.name.type'],
      ['Alice', 'entity.name.type'],
      ['is', 'keyword.other'],
      ['off', 'keyword.other'],
      ['on', 'keyword.other'],
      ['2026-10-03', 'constant.numeric.date'],
      ['from', 'keyword.other'],
      ['to', 'keyword.other'],
      ['saturday', 'constant.language.weekday'],
      ['before', 'keyword.other'],
      ['after', 'keyword.other'],
      ['is', 'keyword.other'],
      ['on', 'keyword.other'],
      ['2026-10-04', 'constant.numeric.date'],
      ['today', 'keyword.other'],
      ['colored', 'keyword.other'],
      ['#AAF', 'constant.other.color'],
      ['today', 'keyword.other'],
      ['is', 'keyword.other'],
      ['2026-10-03', 'constant.numeric.date'],
    ],
  },
  {
    // ComplementTask looks the task up with its brackets, so the engine
    // (1.2026.8) reports every `{Resource} works on [Task]` as unknown.
    name: 'gantt resources working on a task (the engine cannot resolve the task)',
    covers: ['gantt:SubjectResource worksOn ComplementTask'],
    source: uml`
      @startgantt
      [Task1] requires 5 days
      {Alice} works on [Task1]
      @endgantt
    `,
    expect: [
      ['Alice', 'entity.name.type'],
      ['works', 'keyword.other'],
      ['on', 'keyword.other'],
      ['Task1', 'entity.name.type'],
    ],
    render: /No such task \[Task1\]/,
  },
  {
    name: 'gantt calendar: closed, open, coloured and named days',
    covers: [
      'command:NaturalGanttCommand(SubjectDaysAsDates)',
      'command:NaturalGanttCommand(SubjectDayOfWeek)',
      'command:NaturalGanttCommand(SubjectDayAsDate)',
      'gantt:SubjectDaysAsDates isOrAre ComplementClose',
      'gantt:SubjectDaysAsDates isOrAre ComplementOpen',
      'gantt:SubjectDaysAsDates isOrAre ComplementInColors2',
      'gantt:SubjectDaysAsDates isOrAreNamed ComplementNamed',
      'gantt:SubjectDayOfWeek are ComplementOpen',
      'gantt:SubjectDayOfWeek are ComplementClose',
      'gantt:SubjectDayOfWeek isOrAre ComplementInColors2',
      'gantt:SubjectDayAsDate isOrAre ComplementOpen',
      'gantt:SubjectDayAsDate isOrAre ComplementClose',
      'gantt:SubjectDayAsDate isOrAre ComplementInColors2',
    ],
    source: uml`
      @startgantt
      Project starts 2026-10-01
      [T] requires 20 days
      2026-10-05 to 2026-10-06 are closed
      2026-10-07 to 2026-10-08 is named [Holiday]
      D+8 to D+9 are colored in salmon
      2026-10-12 and 2 days are opened
      then 2 days are colored pink
      saturday are closed
      sunday are open
      friday is colored in lightgreen
      2026-10-15 is closed
      2026-10-16 is open
      D+18 is colored in yellow
      2026-10-20 is closed for [T]
      @endgantt
    `,
    expect: [
      ['2026-10-05', 'constant.numeric.date'],
      ['to', 'keyword.other'],
      ['2026-10-06', 'constant.numeric.date'],
      ['are', 'keyword.other'],
      ['closed', 'keyword.other'],
      ['is', 'keyword.other'],
      ['named', 'keyword.other'],
      ['Holiday', 'entity.name.type'],
      ['D+8', 'constant.numeric'],
      ['D+9', 'constant.numeric'],
      ['salmon', 'support.constant.color'],
      ['and', 'keyword.other'],
      ['2', 'constant.numeric'],
      ['days', 'constant.numeric'],
      ['opened', 'keyword.other'],
      ['then', 'keyword.other'],
      ['colored', 'keyword.other'],
      ['pink', 'support.constant.color'],
      ['saturday', 'constant.language.weekday'],
      ['closed', 'keyword.other'],
      ['sunday', 'constant.language.weekday'],
      ['open', 'keyword.other'],
      ['friday', 'constant.language.weekday'],
      ['lightgreen', 'support.constant.color'],
      ['2026-10-15', 'constant.numeric.date'],
      ['2026-10-16', 'constant.numeric.date'],
      ['D+18', 'constant.numeric'],
      ['yellow', 'support.constant.color'],
      ['closed', 'keyword.other'],
      ['for', 'keyword.other'],
      ['T', 'entity.name.type'],
    ],
  },
  {
    name: 'gantt separators and working hours',
    covers: [
      'command:NaturalGanttCommand(SubjectSeparator)',
      'command:NaturalGanttCommand(SubjectWorkingHours)',
      'gantt:SubjectSeparator just before ComplementDate.any',
      'gantt:SubjectSeparator just after ComplementDate.any',
      'gantt:SubjectSeparator just ComplementBeforeOrAfterOrAtTaskStartOrEnd',
      'gantt:SubjectWorkingHours are ComplementWorkingHours',
    ],
    source: uml`
      @startgantt
      Project starts 2026-10-01
      [A] requires 3 days
      [B] requires 3 days
      separator just before 2026-10-02
      separator just after 2026-10-03
      separator just at [A]'s end
      from 9:00 to 17:00 are working hours
      [B] starts at [A]'s end
      @endgantt
    `,
    expect: [
      ['separator', 'keyword.other'],
      ['just', 'keyword.other'],
      ['before', 'keyword.other'],
      ['2026-10-02', 'constant.numeric.date'],
      ['after', 'keyword.other'],
      ['at', 'keyword.other'],
      ['A', 'entity.name.type'],
      ['from', 'keyword.other'],
      ['9:00', 'constant.numeric.time'],
      ['to', 'keyword.other'],
      ['17:00', 'constant.numeric.time'],
      ['are', 'keyword.other'],
      ['working', 'keyword.other'],
      ['hours', 'keyword.other'],
    ],
  },
  {
    name: 'gantt commands: arrows, task colours, groups, notes, separators, scale, columns',
    covers: [
      'command:CommandGanttArrow2',
      'command:CommandColorTask',
      'command:CommandGroupStart',
      'command:CommandGroupEnd',
      'command:CommandNoteBottom',
      'command:CommandSeparator',
      'command:CommandWeekNumberStrategy',
      'command:CommandLanguage',
      'command:CommandPrintScale',
      'command:CommandPrintBetween',
      'command:CommandFootboxGantt',
      'command:CommandLabelOnColumn',
      'command:CommandHideResourceName',
      'command:CommandHideResourceFootbox',
      'command:CommandHideShowColumns',
      'command:CommandHideClosed',
      'command:CommandTaskCompleteDefault',
    ],
    // `label on first column` does nothing any more; the engine warns.
    warns: /This command is deprecated/,
    source: uml`
      @startgantt
      language de
      printscale weekly with calendar date zoom 2
      weeks start on Monday and must have at least 4 days
      Project starts 2026-10-01
      task default completion to 50
      group [Phase 1]
      [Design] requires 5 days
      [Design] #Lightblue/Blue
      note bottom
        Designs are **reviewed**
      end note
      end group
      -- Build phase --
      [Build] requires 3 days
      [Design] -> [Build]
      [Build] -[#red,dashed]-> [Ship]
      [Ship] requires 1 day
      --
      label on first column and left aligned
      hide resources names
      hide ressources footbox
      hide column start
      show column duration
      hide closed
      hide footbox
      print between 2026-10-01 and 2026-10-31
      @endgantt
    `,
    expect: [
      ['language', 'keyword.other'],
      ['de', 'support.constant.language'],
      ['printscale', 'keyword.other'],
      ['weekly', 'support.constant.scale'],
      ['with calendar date', 'keyword.other'],
      ['zoom', 'keyword.other'],
      ['2', 'constant.numeric'],
      ['weeks', 'keyword.other'],
      ['start', 'keyword.other'],
      ['on', 'keyword.other'],
      ['Monday', 'constant.language.weekday'],
      ['must', 'keyword.other'],
      ['4', 'constant.numeric'],
      ['task', 'keyword.other'],
      ['default completion', 'keyword.other'],
      ['50', 'constant.numeric'],
      ['group', 'keyword.control'],
      ['Phase 1', 'entity.name.type'],
      ['#Lightblue', 'constant.other.color'],
      ['Blue', 'support.constant.color'],
      ['note', 'keyword.other.note'],
      ['bottom', 'keyword.other'],
      ['reviewed', 'markup.bold'],
      ['end note', 'keyword.other.note'],
      ['end group', 'keyword.control'],
      ['--', 'punctuation.separator.gantt'],
      ['Build phase', '!keyword.other'],
      ['->', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
      ['dashed', 'keyword.other.line-style'],
      [']->', 'keyword.operator.arrow'],
      ['--', 'punctuation.separator.gantt'],
      ['label', 'keyword.other invalid.deprecated'],
      ['first', 'keyword.other invalid.deprecated'],
      ['aligned', 'keyword.other invalid.deprecated'],
      ['resources', 'keyword.other !invalid.deprecated'],
      ['names', 'keyword.other'],
      ['ressources', 'keyword.other'],
      ['footbox', 'keyword.other'],
      ['column', 'keyword.other'],
      ['start', 'support.constant.column'],
      ['show', 'keyword.other'],
      ['duration', 'support.constant.column'],
      ['closed', 'keyword.other'],
      ['footbox', 'keyword.other'],
      ['print', 'keyword.other'],
      ['between', 'keyword.other'],
      ['2026-10-01', 'constant.numeric.date'],
      ['and', 'keyword.other'],
      ['2026-10-31', 'constant.numeric.date'],
    ],
  },
  {
    name: 'gantt arrows between task aliases',
    covers: ['command:CommandGanttArrow'],
    source: uml`
      @startgantt
      [Design] as [d1] requires 2 days
      [Build] as [b1] requires 2 days
      d1 -> b1
      @endgantt
    `,
    expect: [
      ['d1', 'entity.name.type'],
      ['d1', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['b1', 'entity.name.type'],
    ],
  },
  {
    name: 'gantt through @startproject, with the common commands it accepts',
    covers: [],
    source: uml`
      @startproject
      title Project view
      header Draft
      skinparam backgroundColor #EEE
      <style>
      ganttDiagram {
        task { BackGroundColor GreenYellow }
      }
      </style>
      scale 2
      projectscale daily with week numbering from 3
      [A] requires 2 days
      ' a comment
      !$owner = "Ops"
      [B] is displayed as $owner
      @endproject
    `,
    expect: [
      ['@startproject', 'keyword.control.diagram'],
      ['title', 'keyword.other'],
      ['header', 'keyword.other'],
      ['skinparam', 'keyword.other'],
      ['#EEE', 'constant.other.color'],
      ['style', 'entity.name.tag.style'],
      ['ganttDiagram', 'entity.name.tag.selector'],
      ['BackGroundColor', 'support.type.property-name'],
      ['scale', 'keyword.other'],
      ['projectscale', 'keyword.other'],
      ['daily', 'support.constant.scale'],
      ['with week numbering from', 'keyword.other'],
      ['3', 'constant.numeric'],
      ["' a comment", 'comment.line.single-quote'],
      ['$owner', 'variable.other'],
      ['$owner', 'variable.other'],
    ],
  },
  {
    name: 'gantt scale names and footbox visibility',
    covers: [],
    source: uml`
      @startgantt
      ganttscale monthly
      [A] requires 2 days
      show footbox
      @endgantt
    `,
    expect: [
      ['ganttscale', 'keyword.other'],
      ['monthly', 'support.constant.scale'],
      ['show', 'keyword.other'],
      ['footbox', 'keyword.other'],
    ],
  },
];
