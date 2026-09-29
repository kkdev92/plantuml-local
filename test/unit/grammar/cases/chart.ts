import { uml, type GrammarCase } from './types';

export const chartCases: GrammarCase[] = [
  {
    name: 'chart axes, bar and line series, legend position, stacking, orientation, annotations',
    covers: [
      'command:CommandChartHAxis',
      'command:CommandChartVAxis',
      'command:CommandChartBar',
      'command:CommandChartLine',
      'command:CommandChartLegend',
      'command:CommandChartStackMode',
      'command:CommandChartOrientation',
      'command:CommandChartAnnotation',
    ],
    source: uml`
      @startchart
      title Quarterly sales
      h-axis "Quarter" [Q1, Q2, Q3, Q4] label-right grid
      v-axis "Sales" 0 --> 100 ticks [0:"none", 50:"half", 100:"full"] spacing 25 label-top grid
      bar <<primary>> "Revenue" [40, 55, 70, 90] #3498db labels
      line "Trend" [35, 50, 65, 85] #e74c3c v2 labels
      v2-axis "Growth" 0 --> 100
      legend right
      stackMode grouped
      orientation vertical
      annotation "Peak" at (Q4, 90) <<arrow>>
      @endchart
    `,
    expect: [
      ['title', 'keyword.other'],
      ['h-axis', 'keyword.other'],
      ['"Quarter"', 'string.quoted.double'],
      ['[', 'punctuation.section.brackets'],
      ['Q1', 'string.unquoted.category'],
      [',', 'punctuation.separator.comma'],
      ['label-right', 'keyword.other'],
      ['grid', 'keyword.other'],
      ['v-axis', 'keyword.other'],
      ['"Sales"', 'string.quoted.double'],
      ['0', 'constant.numeric'],
      ['-->', 'keyword.operator.range'],
      ['100', 'constant.numeric'],
      ['ticks', 'keyword.other'],
      ['0', 'constant.numeric'],
      [':', 'punctuation.separator.key-value'],
      ['"none"', 'string.quoted.double'],
      ['spacing', 'keyword.other'],
      ['25', 'constant.numeric'],
      ['label-top', 'keyword.other'],
      ['bar', 'storage.type'],
      ['<<primary>>', 'entity.name.tag.stereotype'],
      ['"Revenue"', 'string.quoted.double'],
      ['40', 'constant.numeric'],
      ['#3498db', 'constant.other.color'],
      ['labels', 'keyword.other'],
      ['line', 'storage.type'],
      ['#e74c3c', 'constant.other.color'],
      ['v2', 'keyword.other'],
      ['v2-axis', 'keyword.other'],
      ['legend', 'keyword.other'],
      ['right', 'keyword.other'],
      ['stackMode', 'keyword.other'],
      ['grouped', 'support.constant.mode'],
      ['orientation', 'keyword.other'],
      ['vertical', 'support.constant.mode'],
      ['annotation', 'keyword.other'],
      ['"Peak"', 'string.quoted.double'],
      ['at', 'keyword.other'],
      ['(', 'punctuation.section.parens.begin'],
      ['Q4', 'string.unquoted.category'],
      ['90', 'constant.numeric'],
      ['<<arrow>>', 'entity.name.tag.stereotype'],
    ],
  },
  {
    name: 'chart x and y axes, area and scatter series, other legend and layout values',
    covers: ['command:CommandChartArea', 'command:CommandChartScatter'],
    source: uml`
      @startchart
      x-axis [Jan, Feb, Mar]
      y-axis 0 -> 50
      y2-axis "Right" 0 --> 10
      area "Visitors" [10, 30, 20] #green
      area "Returning" [5, 10, 8] v2 labels
      scatter "Points" [5, 25, 15] #red <<square>>
      scatter "More" [2, 2, 2] y2 labels <<circle>>
      legend bottom
      stackMode stacked
      orientation horizontal
      @endchart
    `,
    expect: [
      ['x-axis', 'keyword.other'],
      ['Jan', 'string.unquoted.category'],
      ['y-axis', 'keyword.other'],
      ['->', 'keyword.operator.range'],
      ['50', 'constant.numeric'],
      ['y2-axis', 'keyword.other'],
      ['area', 'storage.type'],
      ['"Visitors"', 'string.quoted.double'],
      ['#green', 'constant.other.color'],
      ['area', 'storage.type'],
      ['v2', 'keyword.other'],
      ['labels', 'keyword.other'],
      ['scatter', 'storage.type'],
      ['#red', 'constant.other.color'],
      ['<<square>>', 'entity.name.tag.stereotype'],
      ['scatter', 'storage.type'],
      ['y2', 'keyword.other'],
      ['<<circle>>', 'entity.name.tag.stereotype'],
      ['legend', 'keyword.other'],
      ['bottom', 'keyword.other'],
      ['stacked', 'support.constant.mode'],
      ['horizontal', 'support.constant.mode'],
    ],
  },
  {
    name: 'chart with the common commands and a multi-line legend',
    covers: [],
    source: uml`
      @startchart
      title Visits
      skinparam backgroundColor #FEFEFE
      <style>
      chartDiagram {
        BackGroundColor white
      }
      </style>
      h-axis [a, b, c] spacing 20
      bar "X" [1, 2, 3]
      legend center
        Unique visitors
      endlegend
      ' a comment
      @endchart
    `,
    expect: [
      ['title', 'keyword.other'],
      ['skinparam', 'keyword.other'],
      ['backgroundColor', 'support.type.property-name'],
      ['style', 'entity.name.tag.style'],
      ['chartDiagram', 'entity.name.tag.selector'],
      ['spacing', 'keyword.other'],
      ['20', 'constant.numeric'],
      ['legend', 'keyword.other'],
      ['center', 'keyword.other'],
      ['endlegend', 'keyword.other'],
      ["' a comment", 'comment.line.single-quote'],
    ],
  },
];
