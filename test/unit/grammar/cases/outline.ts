import { uml, type GrammarCase } from './types';

export const outlineCases: GrammarCase[] = [
  {
    name: 'mind map: org-mode items, colours, boxless items, multi-line texts',
    covers: ['command:CommandMindMapOrgmode', 'command:CommandMindMapOrgmodeMultiline'],
    source: uml`
      @startmindmap
      title Plan
      * Root
      ** Branch **one**
      ***[#lightgreen] Coloured
      ***_ Boxless
      **:Multi-line
      <b>text</b>;
      **[#FFBBCC]:Coloured multi-line
      more; <<tag>>
      @endmindmap
    `,
    expect: [
      ['title', 'keyword.other'],
      ['*', 'punctuation.definition.list.begin'],
      ['**', 'punctuation.definition.list.begin'],
      ['one', 'markup.bold'],
      ['***', 'punctuation.definition.list.begin'],
      ['#lightgreen', 'constant.other.color'],
      ['_', 'keyword.other.boxless'],
      ['**', 'punctuation.definition.list.begin'],
      [':', 'punctuation.separator.label'],
      ['<b>', 'entity.name.tag.creole'],
      [';', 'punctuation.terminator.label'],
      ['#FFBBCC', 'constant.other.color'],
      [';', 'punctuation.terminator.label'],
      ['<<tag>>', 'entity.name.tag.stereotype'],
    ],
  },
  {
    name: 'mind map: sides with + and -, the root marker 0, directions',
    covers: ['command:CommandMindMapPlus', 'command:CommandMindMapRoot', 'command:CommandMindMapDirection'],
    source: uml`
      @startmindmap
      top to bottom direction
      0 Root
      + Right
      ++[#gold] Right child
      -- Left child
      left side
      ** Also left
      @endmindmap
    `,
    expect: [
      ['top to bottom', 'keyword.other'],
      ['direction', 'keyword.other'],
      ['0', 'punctuation.definition.list.begin'],
      ['+', 'punctuation.definition.list.begin'],
      ['++', 'punctuation.definition.list.begin'],
      ['#gold', 'constant.other.color'],
      ['--', 'punctuation.definition.list.begin'],
      ['left', 'keyword.other'],
      ['side', 'keyword.other'],
    ],
  },
  {
    name: 'WBS: items with sides, colours, codes and boxless markers, in either order',
    covers: ['command:CommandWBSItemNew(0)', 'command:CommandWBSItemOld(0)'],
    // The side or shape after the colour or code is the older order: the
    // engine accepts it with a warning.
    warns: /Please define Direction\/Shape before Color\/Id/,
    source: uml`
      @startwbs
      title Work
      skinparam backgroundColor #FEFEFE
      * Project
      **< Left
      **> Right
      **_[#pink](design) Boxless, coloured, coded
      **[#aqua](build)< Old order
      *** Task
      @endwbs
    `,
    expect: [
      ['title', 'keyword.other'],
      ['skinparam', 'keyword.other'],
      ['#FEFEFE', 'constant.other.color'],
      ['*', 'punctuation.definition.list.begin'],
      ['**', 'punctuation.definition.list.begin'],
      ['<', 'keyword.operator.side !invalid.deprecated'],
      ['>', 'keyword.operator.side !invalid.deprecated'],
      ['_', 'keyword.other.boxless !invalid.deprecated'],
      ['#pink', 'constant.other.color'],
      ['design', 'entity.name.type'],
      ['#aqua', 'constant.other.color'],
      ['build', 'entity.name.type'],
      ['<', 'keyword.operator.side invalid.deprecated'],
    ],
  },
  {
    name: 'WBS: "label" as code, multi-line texts, links between codes',
    covers: [
      'command:CommandWBSItemNew(1)',
      'command:CommandWBSItemOld(1)',
      'command:CommandWBSItemMultilineNew',
      'command:CommandWBSItemMultilineOld',
      'command:CommandWBSLink',
    ],
    warns: /Please define Direction\/Shape before Color\/Id/,
    source: uml`
      @startwbs
      * "Project" as P
      **> "Design" as D
      **[#gold]< "Build" as B
      **<:Multi-line
      text;
      **[#pink](T)>:Old order
      multi-line;
      D -> B : depends
      B .> T #red
      @endwbs
    `,
    expect: [
      ['"Project"', 'string.quoted.double'],
      ['as', 'keyword.other'],
      ['P', 'entity.name.type'],
      ['>', 'keyword.operator.side !invalid.deprecated'],
      ['"Design"', 'string.quoted.double'],
      ['#gold', 'constant.other.color'],
      ['<', 'keyword.operator.side invalid.deprecated'],
      ['"Build"', 'string.quoted.double'],
      ['<', 'keyword.operator.side !invalid.deprecated'],
      [':', 'punctuation.separator.label'],
      [';', 'punctuation.terminator.label'],
      ['#pink', 'constant.other.color'],
      ['T', 'entity.name.type'],
      ['>', 'keyword.operator.side invalid.deprecated'],
      [';', 'punctuation.terminator.label'],
      ['D', 'entity.name.type'],
      ['->', 'keyword.operator.arrow'],
      ['B', 'entity.name.type'],
      [':', 'punctuation.separator.label'],
      ['.>', 'keyword.operator.arrow'],
      ['#red', 'constant.other.color'],
    ],
  },
];
