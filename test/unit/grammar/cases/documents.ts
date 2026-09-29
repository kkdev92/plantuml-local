import { uml, type GrammarCase } from './types';

export const documentCases: GrammarCase[] = [
  {
    name: 'creole documents: every line is creole text',
    covers: ['factory:PSystemCreoleFactory'],
    source: uml`
      @startcreole
      = Heading
      This is **bold**, //italic// and ""mono"".
      * item
      ** nested
      |= Name |= Value |
      | a | 1 |
      @endcreole
    `,
    expect: [
      ['=', 'punctuation.definition.heading'],
      ['Heading', 'markup.heading'],
      ['bold', 'markup.bold'],
      ['italic', 'markup.italic'],
      ['mono', 'markup.inline.raw'],
      ['*', 'punctuation.definition.list.begin'],
      ['**', 'punctuation.definition.list.begin'],
      ['|=', 'punctuation.separator.table'],
    ],
  },
  {
    name: 'creole documents: horizontal lines (not available in the browser engine)',
    covers: [],
    source: uml`
      @startcreole
      Above
      ----
      Below
      @endcreole
    `,
    expect: [['----', 'punctuation.separator']],
    render: /UHorizontalLine/,
  },
  {
    name: 'the version diagram',
    covers: ['factory:PSystemVersionFactory'],
    source: uml`
      @startuml
      version
      @enduml
    `,
    expect: [['version', 'keyword.other']],
  },
  {
    name: 'the authors diagram',
    covers: [],
    source: uml`
      @startuml
      authors
      @enduml
    `,
    expect: [['authors', 'keyword.other']],
  },
];
